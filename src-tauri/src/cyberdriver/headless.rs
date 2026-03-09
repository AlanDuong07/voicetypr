#![allow(dead_code)]
use std::{fs, net::SocketAddr, sync::Arc, time::{Duration, SystemTime}};

use tokio::sync::Mutex;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::error::{CyberdriverError, Result};

use super::{
  api::{self, ApiState},
  black_screen,
  config::{self, Config, ConnectionInfo, RuntimePidInfo},
  keepalive::KeepAliveManager,
  logger::DebugLogger,
  tunnel::TunnelClient,
  CyberdriverSettings,
};

struct ServerHandle {
  port: u16,
  stop: CancellationToken,
  task: tauri::async_runtime::JoinHandle<()>,
}

struct TunnelHandle {
  stop: CancellationToken,
  task: tauri::async_runtime::JoinHandle<()>,
}

struct BlackScreenHandle {
  stop: CancellationToken,
  task: tauri::async_runtime::JoinHandle<()>,
}

pub struct HeadlessRuntime {
  config: Config,
  settings: Arc<Mutex<CyberdriverSettings>>,
  keepalive: Arc<KeepAliveManager>,
  internal_request_token: Arc<String>,
  server: Option<ServerHandle>,
  tunnel: Option<TunnelHandle>,
  black_screen: Option<BlackScreenHandle>,
  debug_logger: DebugLogger,
  connection_info: Arc<Mutex<ConnectionInfo>>,
  settings_mtime: Option<SystemTime>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct ServiceStatusSnapshot {
  pub connected: bool,
  pub local_port: Option<u16>,
  pub cloud_host: Option<String>,
  pub cloud_port: Option<u16>,
  pub last_error: Option<String>,
}

impl HeadlessRuntime {
  pub fn new() -> Result<Self> {
    let config = config::get_config()?;
    let settings = CyberdriverSettings::from_file()?;
    let settings_mtime = read_settings_mtime();
    let keepalive = KeepAliveManager::new(
      settings.keepalive_enabled,
      settings.keepalive_threshold_minutes,
      settings.keepalive_click_x,
      settings.keepalive_click_y,
    );
    let internal_request_token = Arc::new(uuid::Uuid::new_v4().to_string());
    let debug_logger = DebugLogger::new(settings.debug)?;
    Ok(Self {
      config,
      settings: Arc::new(Mutex::new(settings)),
      keepalive,
      internal_request_token,
      server: None,
      tunnel: None,
      black_screen: None,
      debug_logger,
      connection_info: Arc::new(Mutex::new(ConnectionInfo::default())),
      settings_mtime,
    })
  }

  pub async fn start(&mut self) -> Result<()> {
    let settings = self.settings.lock().await.clone();
    if settings.secret.trim().is_empty() {
      self
        .debug_logger
        .log("SERVICE", "Missing API key; waiting for settings", &[]);
      return Ok(());
    }
    self.connect_tunnel().await
  }

  pub async fn stop(&mut self) -> Result<()> {
    self.disconnect_tunnel().await?;
    self.stop_local_server().await?;
    Ok(())
  }

  pub async fn refresh_settings_if_changed(&mut self) -> Result<()> {
    let next_mtime = read_settings_mtime();
    if next_mtime.is_none() || next_mtime == self.settings_mtime {
      return Ok(());
    }
    self.settings_mtime = next_mtime;
    let next = CyberdriverSettings::from_file()?;
    self.apply_settings(next).await
  }

  pub async fn start_local_server(&mut self) -> Result<u16> {
    if let Some(server) = &self.server {
      return Ok(server.port);
    }
    let settings = self.settings.lock().await.clone();
    let port = config::find_available_port("127.0.0.1", settings.target_port)
      .ok_or_else(|| CyberdriverError::RuntimeError("No available port found".into()))?;

    let state = ApiState::new(
      None,
      self.config.clone(),
      self.keepalive.clone(),
      self.settings.clone(),
      self.debug_logger.clone(),
      self.connection_info.clone(),
      self.internal_request_token.clone(),
    );
    let router = api::router(state);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
      .await
      .map_err(|err| CyberdriverError::RuntimeError(format!("Failed to bind server: {err}")))?;

    let stop = CancellationToken::new();
    let stop_signal = stop.clone();
    let task = tauri::async_runtime::spawn(async move {
      let _ = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
          stop_signal.cancelled().await;
        })
        .await;
    });

    self.server = Some(ServerHandle { port, stop, task });
    self
      .debug_logger
      .log("SERVICE", "Local API started", &[("port", port.to_string())]);
    config::write_pid_info(RuntimePidInfo {
      pid: std::process::id(),
      command: "service-start".to_string(),
      local_port: Some(port),
      cloud_host: settings.host.clone(),
      cloud_port: settings.port,
      version: None,
      started_at: None,
      frozen: None,
      argv: None,
    })?;

    Ok(port)
  }

  pub async fn stop_local_server(&mut self) -> Result<()> {
    if let Some(server) = self.server.take() {
      server.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), server.task).await;
      self.debug_logger.info("SERVICE", "Local API stopped");
    }
    Ok(())
  }

  pub async fn connect_tunnel(&mut self) -> Result<()> {
    if self.tunnel.is_some() {
      return Ok(());
    }
    let settings = self.settings.lock().await.clone();
    if settings.secret.trim().is_empty() {
      return Err(CyberdriverError::RuntimeError("Missing API key".into()));
    }
    let local_port = self.start_local_server().await?;

    let stop = CancellationToken::new();
    let stop_signal = stop.clone();
    let keepalive = if settings.keepalive_enabled {
      Some(self.keepalive.clone())
    } else {
      None
    };
    let client = TunnelClient::new(
      settings.host.clone(),
      settings.port,
      settings.secret.clone(),
      local_port,
      self.config.clone(),
      keepalive,
      settings.register_as_keepalive_for.clone(),
      self.internal_request_token.clone(),
      self.debug_logger.clone(),
      self.connection_info.clone(),
    );

    self
      .debug_logger
      .log("SERVICE", "Tunnel connect requested", &[("host", settings.host.clone())]);
    let task = tauri::async_runtime::spawn(async move {
      client.run(stop_signal).await;
    });

    self.tunnel = Some(TunnelHandle { stop, task });
    config::write_pid_info(RuntimePidInfo {
      pid: std::process::id(),
      command: "service-join".to_string(),
      local_port: Some(local_port),
      cloud_host: settings.host.clone(),
      cloud_port: settings.port,
      version: None,
      started_at: None,
      frozen: None,
      argv: None,
    })?;
    self.start_keepalive_if_enabled().await;
    self.start_black_screen_if_enabled().await;
    Ok(())
  }

  pub async fn disconnect_tunnel(&mut self) -> Result<()> {
    if let Some(tunnel) = self.tunnel.take() {
      tunnel.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), tunnel.task).await;
    }
    self.debug_logger.info("SERVICE", "Tunnel disconnected");
    self.stop_keepalive().await;
    self.stop_black_screen().await;
    Ok(())
  }

  pub async fn start_keepalive_if_enabled(&mut self) {
    let settings = self.settings.lock().await.clone();
    if settings.keepalive_enabled {
      self.keepalive.ensure_started().await;
    }
  }

  pub async fn stop_keepalive(&mut self) {
    self.keepalive.stop().await;
  }

  pub async fn start_black_screen_if_enabled(&mut self) {
    let settings = self.settings.lock().await.clone();
    if !settings.black_screen_recovery {
      return;
    }
    if self.black_screen.is_some() {
      return;
    }
    let stop = CancellationToken::new();
    let stop_signal = stop.clone();
    let interval = settings.black_screen_check_interval;
    let task = tauri::async_runtime::spawn(async move {
      black_screen::run_black_screen_recovery(stop_signal, interval).await;
    });
    self.black_screen = Some(BlackScreenHandle { stop, task });
    self.debug_logger.info("SERVICE", "Black screen recovery enabled");
  }

  pub async fn stop_black_screen(&mut self) {
    if let Some(handle) = self.black_screen.take() {
      handle.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), handle.task).await;
    }
    self.debug_logger.info("SERVICE", "Black screen recovery stopped");
  }

  async fn apply_settings(&mut self, next: CyberdriverSettings) -> Result<()> {
    let current = self.settings.lock().await.clone();
    let tunnel_changed = current.host != next.host
      || current.port != next.port
      || current.secret != next.secret
      || current.target_port != next.target_port
      || current.register_as_keepalive_for != next.register_as_keepalive_for;
    let debug_changed = current.debug != next.debug;

    {
      let mut guard = self.settings.lock().await;
      *guard = next.clone();
    }

    if debug_changed {
      let _ = self.debug_logger.set_enabled(next.debug);
    }

    self.keepalive
      .update_config(
        next.keepalive_enabled,
        next.keepalive_threshold_minutes,
        next.keepalive_click_x,
        next.keepalive_click_y,
      )
      .await;
    if next.keepalive_enabled {
      self.keepalive.ensure_started().await;
    } else {
      self.keepalive.stop().await;
    }

    if next.black_screen_recovery {
      self.start_black_screen_if_enabled().await;
    } else {
      self.stop_black_screen().await;
    }

    if tunnel_changed {
      self.debug_logger.info("SERVICE", "Settings changed; restarting tunnel");
      self.disconnect_tunnel().await?;
      self.stop_local_server().await?;
      if next.secret.trim().is_empty() {
        self.start_local_server().await?;
      } else {
        self.connect_tunnel().await?;
      }
    }

    Ok(())
  }

  pub async fn status_snapshot(&self) -> ServiceStatusSnapshot {
    let connection = self.connection_info.lock().await.clone();
    ServiceStatusSnapshot {
      connected: self.tunnel.is_some() && connection.connected,
      local_port: self.server.as_ref().map(|s| s.port),
      cloud_host: connection.host,
      cloud_port: connection.port,
      last_error: connection.last_error,
    }
  }
}

fn read_settings_mtime() -> Option<SystemTime> {
  let path = CyberdriverSettings::settings_file_path();
  fs::metadata(path).ok().and_then(|meta| meta.modified().ok())
}
