use std::{collections::HashMap, time::{Duration, Instant}};

use futures_util::{Sink, SinkExt, StreamExt};
use http::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tungstenite::{client::IntoClientRequest, protocol::WebSocketConfig, Error as WsError, Message};
use tauri_plugin_http::reqwest;
use rand::random;

use crate::error::{CyberdriverError, Result};

use super::{
  config::{Config, ConnectionInfo},
  keepalive::KeepAliveManager,
  logger::DebugLogger,
};

#[derive(Debug, Deserialize)]
struct RequestMeta {
  #[serde(rename = "requestId")]
  request_id: String,
  method: String,
  path: String,
  query: Option<String>,
  headers: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
struct ResponseMeta<'a> {
  #[serde(rename = "requestId")]
  request_id: &'a str,
  status: u16,
  headers: HashMap<String, String>,
}

#[derive(Clone, Debug)]
struct TunnelResponse {
  status: u16,
  headers: HashMap<String, String>,
  body: Vec<u8>,
}

pub struct TunnelClient {
  host: String,
  port: u16,
  secret: String,
  target_port: u16,
  config: Config,
  keepalive: Option<std::sync::Arc<KeepAliveManager>>,
  remote_keepalive_for: Option<String>,
  internal_request_token: std::sync::Arc<String>,
  debug_logger: DebugLogger,
  connection_info: std::sync::Arc<Mutex<ConnectionInfo>>,
  idempotency_cache: Mutex<HashMap<String, (Instant, TunnelResponse)>>,
}

const IDEMPOTENCY_CACHE_TTL: Duration = Duration::from_secs(60);
const IDEMPOTENCY_CACHE_MAX_SIZE: usize = 1000;

impl TunnelClient {
  pub fn new(
    host: String,
    port: u16,
    secret: String,
    target_port: u16,
    config: Config,
    keepalive: Option<std::sync::Arc<KeepAliveManager>>,
    remote_keepalive_for: Option<String>,
    internal_request_token: std::sync::Arc<String>,
    debug_logger: DebugLogger,
    connection_info: std::sync::Arc<Mutex<ConnectionInfo>>,
  ) -> Self {
    Self {
      host,
      port,
      secret,
      target_port,
      config,
      keepalive,
      remote_keepalive_for,
      internal_request_token,
      debug_logger,
      connection_info,
      idempotency_cache: Mutex::new(HashMap::new()),
    }
  }

  pub async fn run(mut self, stop: CancellationToken) {
    let mut sleep_time = 1u64;
    let mut failures_at_max = 0u8;
    loop {
      if stop.is_cancelled() {
        let mut info = self.connection_info.lock().await;
        info.connected = false;
        break;
      }
      let connection_start = Instant::now();
      let result = self.connect_and_run(stop.clone()).await;
      if stop.is_cancelled() {
        let mut info = self.connection_info.lock().await;
        info.connected = false;
        break;
      }
      {
        let mut info = self.connection_info.lock().await;
        info.connected = false;
        info.last_error = result.as_ref().err().map(|err| err.to_string());
      }
      if let Err(err) = result {
        let duration = connection_start.elapsed().as_secs_f64();
        self.debug_logger.connection_closed(&err.to_string(), duration, None);
        if err.to_string().contains("AUTH_FAILURE") {
          break;
        }
      }
      if connection_start.elapsed() >= Duration::from_secs(30) {
        sleep_time = 1;
        failures_at_max = 0;
      }
      if sleep_time >= 16 {
        failures_at_max += 1;
        if failures_at_max >= 3 {
          failures_at_max = 0;
        }
      }
      let jitter = random::<u64>() % 1000;
      let delay = Duration::from_millis((sleep_time * 1000) + jitter);
      tokio::select! {
        _ = stop.cancelled() => break,
        _ = tokio::time::sleep(delay) => {}
      }
      sleep_time = (sleep_time * 2).min(16);
    }
  }

  async fn connect_and_run(&mut self, stop: CancellationToken) -> Result<()> {
    let host = self.host.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/');
    let uri = format!("wss://{host}:{}/tunnel/ws", self.port);
    self.debug_logger.connection_attempt(&uri, 1);

    {
      let mut info = self.connection_info.lock().await;
      info.host = Some(host.to_string());
      info.port = Some(self.port);
    }

    let mut request = uri
      .clone()
      .into_client_request()
      .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
    {
      let headers = request.headers_mut();
      fn set_header(headers: &mut HeaderMap, name: &'static str, value: String) -> Result<()> {
        let header = HeaderValue::from_str(&value)
          .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
        headers.insert(name, header);
        Ok(())
      }
      set_header(headers, "Authorization", format!("Bearer {}", self.secret))?;
      set_header(headers, "X-PIGLET-FINGERPRINT", self.config.fingerprint.clone())?;
      set_header(headers, "X-PIGLET-VERSION", self.config.version.clone())?;
      if let Some(main_id) = &self.remote_keepalive_for {
        set_header(headers, "X-Remote-Keepalive-For", main_id.clone())?;
      }
    }

    let mut config = WebSocketConfig::default();
    config.max_message_size = None;
    config.max_frame_size = None;
    config.accept_unmasked_frames = false;

    let connect_result =
      tokio_tungstenite::connect_async_with_config(request, Some(config), false).await;
    let (ws_stream, _) = match connect_result {
      Ok(value) => value,
      Err(err) => {
        if let WsError::Http(response) = &err {
          if response.status() == http::StatusCode::FORBIDDEN {
            return Err(CyberdriverError::RuntimeError("AUTH_FAILURE".into()));
          }
        }
        return Err(CyberdriverError::RuntimeError(format!("Connection failed: {err}")));
      }
    };
    self.debug_logger.connection_established(&uri);
    {
      let mut info = self.connection_info.lock().await;
      info.connected = true;
      info.last_error = None;
    }

    let (mut write, mut read) = ws_stream.split();
    let mut ping = tokio::time::interval(Duration::from_secs(20));
    let mut request_meta: Option<RequestMeta> = None;
    let mut body_buffer: Vec<u8> = Vec::new();

    loop {
      tokio::select! {
        _ = stop.cancelled() => break,
        _ = ping.tick() => {
          if let Err(err) = write.send(Message::Ping(Vec::new().into())).await {
            return Err(CyberdriverError::RuntimeError(format!("Ping failed: {err}")));
          }
        }
        msg = read.next() => {
          let msg = match msg {
            Some(Ok(msg)) => msg,
            Some(Err(err)) => return Err(CyberdriverError::RuntimeError(format!("{err}"))),
            None => return Err(CyberdriverError::RuntimeError("Connection closed".into())),
          };
          match msg {
            Message::Text(text) => {
              if text == "end" {
                if let Some(meta) = request_meta.take() {
                  if let Some(k) = &self.keepalive {
                    k.record_activity().await;
                  }
                  let response = self.forward_request(&meta, &body_buffer).await;
                  self.send_response(&mut write, &meta, response).await?;
                  body_buffer.clear();
                }
              } else {
                request_meta = Some(serde_json::from_str(&text)?);
                if let Some(k) = &self.keepalive {
                  k.record_activity().await;
                }
                body_buffer.clear();
              }
            }
            Message::Binary(bytes) => {
              body_buffer.extend_from_slice(&bytes);
            }
            Message::Close(frame) => {
              if let Some(frame) = frame {
                if frame.code == tungstenite::protocol::frame::coding::CloseCode::Policy {
                  return Err(CyberdriverError::RuntimeError("AUTH_FAILURE".into()));
                }
              }
              return Err(CyberdriverError::RuntimeError("Connection closed".into()));
            }
            _ => {}
          }
        }
      }
    }
    Ok(())
  }

  async fn forward_request(&self, meta: &RequestMeta, body: &[u8]) -> TunnelResponse {
    let start = Instant::now();
    if let Some(idempotency_key) = get_idempotency_key(meta.headers.as_ref()) {
      self.cleanup_idempotency_cache().await;
      let cache = self.idempotency_cache.lock().await;
      if let Some((ts, cached)) = cache.get(&idempotency_key) {
        if ts.elapsed() < IDEMPOTENCY_CACHE_TTL {
          return cached.clone();
        }
      }
    }

    if let Some(keepalive) = &self.keepalive {
      keepalive.wait_until_idle().await;
      keepalive.record_activity().await;
    }

    let mut url = format!("http://127.0.0.1:{}{}", self.target_port, meta.path);
    if let Some(query) = &meta.query {
      if !query.is_empty() {
        url.push('?');
        url.push_str(query);
      }
    }

    let mut headers = HeaderMap::new();
    if let Some(raw) = &meta.headers {
      for (key, value) in raw {
        if let (Ok(name), Ok(val)) = (
          http::header::HeaderName::from_bytes(key.as_bytes()),
          HeaderValue::from_str(value),
        ) {
          headers.insert(name, val);
        }
      }
    }
    if meta.path == "/internal/shutdown" {
      if let Ok(value) = HeaderValue::from_str(self.internal_request_token.as_str()) {
        headers.insert("x-cyberdesk-tunnel-token", value);
      }
    }

    let method = meta.method.to_uppercase();
    let client = reqwest::Client::new();
    let timeout = if meta.path == "/computer/shell/powershell/exec" {
      extract_timeout(body).map(|t| t + 3.0).unwrap_or(30.0)
    } else if meta.path == "/computer/input/keyboard/type" {
      extract_keyboard_type_timeout(body)
        .map(|t| t + 3.0)
        .unwrap_or(30.0)
    } else {
      30.0
    };

    let response = client
      .request(method.parse().unwrap_or(reqwest::Method::GET), url)
      .headers(headers)
      .timeout(Duration::from_secs_f64(timeout.max(1.0)))
      .body(body.to_vec())
      .send()
      .await;

    match response {
      Ok(resp) => {
        let status = resp.status().as_u16();
        let mut headers = HashMap::new();
        for (key, value) in resp.headers().iter() {
          if let Ok(val) = value.to_str() {
            headers.insert(key.to_string(), val.to_string());
          }
        }
        let bytes = resp.bytes().await.unwrap_or_default().to_vec();
        let mut response = TunnelResponse { status, headers, body: bytes };
        self
          .debug_logger
          .request_forwarded(&meta.method, &meta.path, response.status, start.elapsed().as_millis() as f64);
        if response.status >= 400 && response.body.is_empty() {
          response.headers.insert("content-type".to_string(), "application/json".to_string());
          response.body = serde_json::json!({
            "detail": "Cyberdriver local API returned an error with an empty body",
            "status": response.status,
            "method": meta.method,
            "path": meta.path,
          })
          .to_string()
          .into_bytes();
        }
        if let Some(idempotency_key) = get_idempotency_key(meta.headers.as_ref()) {
          let mut cache = self.idempotency_cache.lock().await;
          cache.insert(idempotency_key, (Instant::now(), response.clone()));
        }
        response
      }
      Err(err) => TunnelResponse {
        status: 500,
        headers: [("content-type".to_string(), "text/plain".to_string())]
          .into_iter()
          .collect(),
        body: err.to_string().into_bytes(),
      },
    }
  }

  async fn send_response<S>(
    &self,
    write: &mut S,
    meta: &RequestMeta,
    response: TunnelResponse,
  ) -> Result<()>
  where
    S: Sink<Message, Error = tungstenite::Error> + Unpin,
  {
    let resp_meta = ResponseMeta {
      request_id: &meta.request_id,
      status: response.status,
      headers: response.headers.clone(),
    };
    let meta_text = serde_json::to_string(&resp_meta)?;
    write
      .send(Message::Text(meta_text.into()))
      .await
      .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
    for chunk in response.body.chunks(16 * 1024) {
      write
        .send(Message::Binary(chunk.to_vec().into()))
        .await
        .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
    }
    write
      .send(Message::Text("end".to_string().into()))
      .await
      .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
    Ok(())
  }

  async fn cleanup_idempotency_cache(&self) {
    let mut cache = self.idempotency_cache.lock().await;
    let now = Instant::now();
    cache.retain(|_, (ts, _)| now.duration_since(*ts) <= IDEMPOTENCY_CACHE_TTL);
    if cache.len() > IDEMPOTENCY_CACHE_MAX_SIZE {
      let mut keys = cache.keys().cloned().collect::<Vec<_>>();
      keys.sort_by_key(|k| cache.get(k).map(|(ts, _)| *ts));
      for key in keys.into_iter().take(cache.len() / 5) {
        cache.remove(&key);
      }
    }
  }
}

fn get_idempotency_key(headers: Option<&HashMap<String, String>>) -> Option<String> {
  headers.and_then(|headers| {
    headers
      .iter()
      .find(|(k, _)| k.to_lowercase() == "x-idempotency-key")
      .map(|(_, v)| v.clone())
  })
}

fn extract_timeout(body: &[u8]) -> Option<f64> {
  serde_json::from_slice::<serde_json::Value>(body)
    .ok()
    .and_then(|value| value.get("timeout").and_then(|v| v.as_f64()))
}

fn extract_keyboard_type_timeout(body: &[u8]) -> Option<f64> {
  let text_len = serde_json::from_slice::<serde_json::Value>(body)
    .ok()
    .and_then(|value| value.get("text").and_then(|v| v.as_str()).map(str::len))?;
  let dynamic = 5.0 + ((text_len as f64) / 40.0);
  Some(dynamic.clamp(5.0, 120.0))
}
