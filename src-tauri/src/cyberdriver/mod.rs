pub mod api;
mod black_screen;
mod config;
mod diagnostics;
pub mod headless;
mod input;
mod keepalive;
mod logger;
pub use logger::DebugLogger;
mod tunnel;
mod update;
mod windows;

use std::{net::SocketAddr, sync::Arc, time::Duration};
use std::fs;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_http::reqwest;
use tauri_plugin_store::StoreExt;
use tauri::async_runtime::JoinHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::error::{Result, CyberdriverError};

use self::{
  api::ApiState,
  config::{Config, ConnectionInfo, RuntimePidInfo},
  keepalive::KeepAliveManager,
  tunnel::TunnelClient,
};

const DEFAULT_HOST: &str = "api.cyberdesk.io";
const DEFAULT_PORT: u16 = 443;
const DEFAULT_TARGET_PORT: u16 = 3000;
const DEFAULT_KEEPALIVE_THRESHOLD_MINUTES: f64 = 3.0;
const DEFAULT_BLACK_SCREEN_INTERVAL_SECONDS: f64 = 30.0;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct CyberdriverSettings {
  pub host: String,
  pub port: u16,
  pub secret: String,
  pub target_port: u16,
  pub keepalive_enabled: bool,
  pub keepalive_threshold_minutes: f64,
  pub keepalive_click_x: Option<i32>,
  pub keepalive_click_y: Option<i32>,
  pub black_screen_recovery: bool,
  pub black_screen_check_interval: f64,
  pub debug: bool,
  pub register_as_keepalive_for: Option<String>,
  pub experimental_space: bool,
  pub driver_path: Option<String>,
}

impl Default for CyberdriverSettings {
  fn default() -> Self {
    Self {
      host: DEFAULT_HOST.to_string(),
      port: DEFAULT_PORT,
      secret: String::new(),
      target_port: DEFAULT_TARGET_PORT,
      keepalive_enabled: false,
      keepalive_threshold_minutes: DEFAULT_KEEPALIVE_THRESHOLD_MINUTES,
      keepalive_click_x: None,
      keepalive_click_y: None,
      black_screen_recovery: false,
      black_screen_check_interval: DEFAULT_BLACK_SCREEN_INTERVAL_SECONDS,
      debug: true,
      register_as_keepalive_for: None,
      experimental_space: false,
      driver_path: None,
    }
  }
}

impl CyberdriverSettings {
  pub fn settings_file_path() -> std::path::PathBuf {
    config::get_config_dir().join("settings.json")
  }

  pub fn from_file() -> Result<Self> {
    let path = Self::settings_file_path();
    if let Ok(content) = fs::read_to_string(&path) {
      if let Ok(settings) = serde_json::from_str::<CyberdriverSettings>(&content) {
        return Ok(settings);
      }
    }
    let settings = Self::default();
    let _ = settings.write_to_file();
    Ok(settings)
  }

  pub fn write_to_file(&self) -> Result<()> {
    let path = Self::settings_file_path();
    fs::create_dir_all(config::get_config_dir())?;
    let payload = serde_json::to_vec_pretty(self)?;
    fs::write(path, payload)?;
    Ok(())
  }

  pub fn from_store(app: &AppHandle) -> Result<Self> {
    let store = app.store("settings.json")?;
    let mut settings = Self::default();
    settings.host = read_string(&store, "cyberdriver_host", &settings.host);
    settings.port = read_u16(&store, "cyberdriver_port", settings.port);
    settings.secret = read_string(&store, "cyberdriver_secret", "");
    settings.target_port = read_u16(&store, "cyberdriver_target_port", settings.target_port);
    settings.keepalive_enabled = read_bool(&store, "cyberdriver_keepalive_enabled", settings.keepalive_enabled);
    settings.keepalive_threshold_minutes =
      read_f64(&store, "cyberdriver_keepalive_threshold_minutes", settings.keepalive_threshold_minutes);
    settings.keepalive_click_x = read_i32_opt(&store, "cyberdriver_keepalive_click_x");
    settings.keepalive_click_y = read_i32_opt(&store, "cyberdriver_keepalive_click_y");
    settings.black_screen_recovery =
      read_bool(&store, "cyberdriver_black_screen_recovery", settings.black_screen_recovery);
    settings.black_screen_check_interval =
      read_f64(&store, "cyberdriver_black_screen_check_interval", settings.black_screen_check_interval);
    settings.debug = read_bool(&store, "cyberdriver_debug", settings.debug);
    settings.register_as_keepalive_for =
      read_string_opt(&store, "cyberdriver_register_as_keepalive_for");
    settings.experimental_space = read_bool(&store, "cyberdriver_experimental_space", settings.experimental_space);
    settings.driver_path = read_string_opt(&store, "cyberdriver_driver_path");
    let _ = settings.write_to_file();
    Ok(settings)
  }

  pub fn write_to_store(&self, app: &AppHandle) -> Result<()> {
    let store = app.store("settings.json")?;
    store.set("cyberdriver_host", self.host.clone());
    store.set("cyberdriver_port", self.port);
    store.set("cyberdriver_secret", self.secret.clone());
    store.set("cyberdriver_target_port", self.target_port);
    store.set("cyberdriver_keepalive_enabled", self.keepalive_enabled);
    store.set(
      "cyberdriver_keepalive_threshold_minutes",
      self.keepalive_threshold_minutes,
    );
    store.set("cyberdriver_keepalive_click_x", self.keepalive_click_x);
    store.set("cyberdriver_keepalive_click_y", self.keepalive_click_y);
    store.set("cyberdriver_black_screen_recovery", self.black_screen_recovery);
    store.set(
      "cyberdriver_black_screen_check_interval",
      self.black_screen_check_interval,
    );
    store.set("cyberdriver_debug", self.debug);
    store.set(
      "cyberdriver_register_as_keepalive_for",
      self.register_as_keepalive_for.clone(),
    );
    store.set("cyberdriver_experimental_space", self.experimental_space);
    store.set("cyberdriver_driver_path", self.driver_path.clone());
    let _ = self.write_to_file();
    Ok(())
  }
}

#[derive(Clone, Debug, Serialize)]
pub struct CyberdriverStatus {
  pub local_server_running: bool,
  pub local_server_port: Option<u16>,
  pub tunnel_connected: bool,
  pub service_running: bool,
  pub keepalive_enabled: bool,
  pub black_screen_recovery: bool,
  pub debug_enabled: bool,
  pub last_error: Option<String>,
  pub machine_uuid: String,
  pub version: String,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(default)]
struct ServiceStatusResponse {
  running: bool,
  connected: bool,
  local_port: Option<u16>,
  cloud_host: Option<String>,
  cloud_port: Option<u16>,
  last_error: Option<String>,
}

struct ServerHandle {
  port: u16,
  stop: CancellationToken,
  task: JoinHandle<()>,
}

struct TunnelHandle {
  stop: CancellationToken,
  task: JoinHandle<()>,
}

struct BlackScreenHandle {
  stop: CancellationToken,
  task: JoinHandle<()>,
}

pub struct CyberdriverRuntime {
  app: AppHandle,
  config: Config,
  settings: Arc<Mutex<CyberdriverSettings>>,
  keepalive: Arc<KeepAliveManager>,
  internal_request_token: Arc<String>,
  server: Option<ServerHandle>,
  tunnel: Option<TunnelHandle>,
  black_screen: Option<BlackScreenHandle>,
  debug_logger: DebugLogger,
  connection_info: Arc<Mutex<ConnectionInfo>>,
  last_error: Option<String>,
}

impl CyberdriverRuntime {
  pub fn new(app: AppHandle) -> Result<Self> {
    let config = config::get_config()?;
    let settings = CyberdriverSettings::from_store(&app)?;
    let keepalive = KeepAliveManager::new(
      settings.keepalive_enabled,
      settings.keepalive_threshold_minutes,
      settings.keepalive_click_x,
      settings.keepalive_click_y,
    );
    let internal_request_token = Arc::new(uuid::Uuid::new_v4().to_string());
    let debug_logger = DebugLogger::new(settings.debug)?;
    Ok(Self {
      app,
      config,
      settings: Arc::new(Mutex::new(settings)),
      keepalive,
      internal_request_token,
      server: None,
      tunnel: None,
      black_screen: None,
      debug_logger,
      connection_info: Arc::new(Mutex::new(ConnectionInfo::default())),
      last_error: None,
    })
  }

  pub async fn get_status(&self) -> CyberdriverStatus {
    let settings = self.settings.lock().await.clone();
    let connection_info = self.connection_info.lock().await.clone();
    let service_status = fetch_service_status().await;
    let service_running = service_status.as_ref().map(|status| status.running).unwrap_or(false);
    let mut local_server_running = self.server.is_some();
    let mut local_server_port = self.server.as_ref().map(|s| s.port);
    let mut tunnel_connected = self.tunnel.is_some() && connection_info.connected;
    let mut last_error = self.last_error.clone();
    if let Some(status) = &service_status {
      if status.running {
        local_server_running = status.local_port.is_some();
        local_server_port = status.local_port;
        tunnel_connected = status.connected;
        if status.last_error.is_some() {
          last_error = status.last_error.clone();
        }
      }
    }
    CyberdriverStatus {
      local_server_running,
      local_server_port,
      tunnel_connected,
      service_running,
      keepalive_enabled: settings.keepalive_enabled,
      black_screen_recovery: settings.black_screen_recovery,
      debug_enabled: settings.debug,
      last_error,
      machine_uuid: self.config.fingerprint.clone(),
      version: self.config.version.clone(),
    }
  }

  pub async fn clear_config(&mut self) -> Result<()> {
    config::clear_config_file()?;
    self.config = config::get_config()?;
    self.debug_logger.log(
      "RUNTIME",
      "Config cleared",
      &[("version", self.config.version.clone())],
    );
    Ok(())
  }

  pub async fn update_settings(&mut self, settings: CyberdriverSettings) -> Result<()> {
    settings.write_to_store(&self.app)?;
    {
      let mut current = self.settings.lock().await;
      *current = settings.clone();
    }
    self.debug_logger.set_enabled(settings.debug)?;
    self.debug_logger.log(
      "RUNTIME",
      "Settings updated",
      &[
        ("host", settings.host.clone()),
        ("port", settings.port.to_string()),
        ("local_port", settings.target_port.to_string()),
        ("debug", settings.debug.to_string()),
      ],
    );
    self.keepalive.update_config(
      settings.keepalive_enabled,
      settings.keepalive_threshold_minutes,
      settings.keepalive_click_x,
      settings.keepalive_click_y,
    ).await;
    if settings.keepalive_enabled {
      self.start_keepalive_if_enabled().await;
    } else {
      self.stop_keepalive().await;
    }
    if settings.black_screen_recovery {
      self.start_black_screen_if_enabled().await;
    } else {
      self.stop_black_screen().await;
    }
    Ok(())
  }

  pub async fn start_local_server(&mut self) -> Result<u16> {
    if let Some(server) = &self.server {
      return Ok(server.port);
    }
    let settings = self.settings.lock().await.clone();
    if let Some(status) = fetch_service_status().await {
      if status.running {
        if let Some(port) = status.local_port {
          self
            .debug_logger
            .log("RUNTIME", "Service already running local API", &[("port", port.to_string())]);
          return Ok(port);
        }
        self
          .debug_logger
          .log("RUNTIME", "Service already running local API", &[("port", settings.target_port.to_string())]);
        return Ok(settings.target_port);
      }
    }
    if is_service_running().await {
      self
        .debug_logger
        .log("RUNTIME", "Service already running local API", &[("port", settings.target_port.to_string())]);
      return Ok(settings.target_port);
    }
    let port = config::find_available_port("127.0.0.1", settings.target_port)
      .ok_or_else(|| CyberdriverError::RuntimeError("No available port found".into()))?;

    let state = ApiState::new(
      Some(self.app.clone()),
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
      .log("RUNTIME", "Local API started", &[("port", port.to_string())]);
    config::write_pid_info(RuntimePidInfo {
      pid: std::process::id(),
      command: "start".to_string(),
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
    if is_service_running().await {
      self
        .debug_logger
        .info("RUNTIME", "Service running; skipping local API stop");
      return Ok(());
    }
    if let Some(server) = self.server.take() {
      server.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), server.task).await;
      self.debug_logger.info("RUNTIME", "Local API stopped");
    }
    Ok(())
  }

  pub async fn connect_tunnel(&mut self) -> Result<()> {
    if self.tunnel.is_some() {
      return Ok(());
    }
    let settings = self.settings.lock().await.clone();
    if is_service_running().await {
      self
        .debug_logger
        .info("RUNTIME", "Service running; tunnel handled by service");
      return Ok(());
    }
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
      .log("RUNTIME", "Tunnel connect requested", &[("host", settings.host.clone())]);
    let task = tauri::async_runtime::spawn(async move {
      client.run(stop_signal).await;
    });

    self.tunnel = Some(TunnelHandle { stop, task });
    config::write_pid_info(RuntimePidInfo {
      pid: std::process::id(),
      command: "join".to_string(),
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
    if is_service_running().await {
      self
        .debug_logger
        .info("RUNTIME", "Service running; tunnel handled by service");
      return Ok(());
    }
    if let Some(tunnel) = self.tunnel.take() {
      tunnel.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), tunnel.task).await;
    }
    self.debug_logger.info("RUNTIME", "Tunnel disconnected");
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
    self.debug_logger.info("RUNTIME", "Black screen recovery enabled");
  }

  pub async fn stop_black_screen(&mut self) {
    if let Some(handle) = self.black_screen.take() {
      handle.stop.cancel();
      let _ = tokio::time::timeout(Duration::from_secs(2), handle.task).await;
    }
    self.debug_logger.info("RUNTIME", "Black screen recovery stopped");
  }

  #[allow(dead_code)]
  pub async fn shutdown(&mut self) -> Result<()> {
    self.disconnect_tunnel().await?;
    self.stop_keepalive().await;
    self.stop_black_screen().await;
    self.stop_local_server().await?;
    config::remove_pid_file()?;
    Ok(())
  }

  pub async fn install_persistent_display(&self) -> Result<()> {
    self.debug_logger.info("RUNTIME", "Installing persistent display driver");
    let settings = self.settings.lock().await.clone();
    windows::install_persistent_display(&self.app, settings.driver_path, &self.debug_logger).await
  }

}

async fn is_service_running() -> bool {
  fetch_service_status()
    .await
    .map(|status| status.running)
    .unwrap_or(false)
}

async fn fetch_service_status() -> Option<ServiceStatusResponse> {
  if !cfg!(windows) {
    return None;
  }
  let client = reqwest::Client::new();
  let response = client
    .get("http://127.0.0.1:3415/status")
    .timeout(Duration::from_millis(300))
    .send()
    .await
    .ok()?;
  let body = response.text().await.ok()?;
  serde_json::from_str::<ServiceStatusResponse>(&body).ok()
}

pub fn log_dir_path() -> std::path::PathBuf {
  config::get_config_dir().join("logs")
}

pub fn read_recent_logs(max_lines: usize) -> Result<String> {
  let log_dir = log_dir_path();
  if !log_dir.exists() {
    return Ok(String::new());
  }
  let mut newest: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
  for entry in std::fs::read_dir(&log_dir)? {
    let entry = entry?;
    let path = entry.path();
    if path.extension().and_then(|e| e.to_str()) != Some("log") {
      continue;
    }
    let metadata = entry.metadata()?;
    let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    match &newest {
      Some((time, _)) if *time >= modified => {}
      _ => newest = Some((modified, path)),
    }
  }
  let (_, path) = match newest {
    Some(value) => value,
    None => return Ok(String::new()),
  };
  let content = std::fs::read_to_string(path)?;
  let lines: Vec<&str> = content.lines().collect();
  if lines.len() <= max_lines {
    return Ok(content);
  }
  Ok(lines[lines.len() - max_lines..].join("\n"))
}

pub fn current_machine_id() -> Result<String> {
  Ok(config::get_config()?.fingerprint)
}

fn read_string<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str, default: &str) -> String {
  store
    .get(key)
    .and_then(|value| value.as_str().map(|v| v.to_string()))
    .unwrap_or_else(|| default.to_string())
}

fn read_string_opt<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str) -> Option<String> {
  store
    .get(key)
    .and_then(|value| value.as_str().map(|v| v.to_string()))
}

fn read_u16<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str, default: u16) -> u16 {
  store
    .get(key)
    .and_then(|value| value.as_u64().map(|v| v as u16))
    .unwrap_or(default)
}

fn read_bool<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str, default: bool) -> bool {
  store
    .get(key)
    .and_then(|value| value.as_bool())
    .unwrap_or(default)
}

fn read_f64<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str, default: f64) -> f64 {
  store
    .get(key)
    .and_then(|value| value.as_f64())
    .unwrap_or(default)
}

fn read_i32_opt<R: Runtime>(store: &tauri_plugin_store::Store<R>, key: &str) -> Option<i32> {
  store
    .get(key)
    .and_then(|value| value.as_i64())
    .map(|value| value as i32)
}
