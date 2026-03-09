use std::{
  path::PathBuf,
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
  },
  time::{Duration, Instant},
};

use axum::{
  body::Bytes,
  extract::{Query, State},
  http::{HeaderMap, StatusCode},
  response::{IntoResponse, Response},
  routing::{get, post},
  Json, Router,
};
use base64::Engine;
use image::GenericImageView;
use enigo::{Button, Enigo, Settings};
use serde::Deserialize;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use crate::error::CyberdriverError;

use super::{
  config::{Config, ConnectionInfo},
  diagnostics, input, keepalive::KeepAliveManager, logger::DebugLogger, update,
  CyberdriverSettings,
};

#[derive(Clone)]
pub struct ApiState {
  pub config: Config,
  pub keepalive: std::sync::Arc<KeepAliveManager>,
  pub settings: std::sync::Arc<Mutex<CyberdriverSettings>>,
  pub debug_logger: DebugLogger,
  pub connection_info: std::sync::Arc<Mutex<ConnectionInfo>>,
  pub enigo: std::sync::Arc<Mutex<Enigo>>,
  pub app_handle: Option<AppHandle>,
  pub typing_dedupe: Arc<Mutex<KeyboardTypeDedupeState>>,
  pub shutdown_requested: Arc<AtomicBool>,
  pub internal_request_token: Arc<String>,
}

#[derive(Default)]
pub struct KeyboardTypeDedupeState {
  inflight_key: Option<String>,
  inflight_started_at: Option<Instant>,
  last_completed_key: Option<String>,
  last_completed_at: Option<Instant>,
}

impl ApiState {
  pub fn new(
    app_handle: Option<AppHandle>,
    config: Config,
    keepalive: std::sync::Arc<KeepAliveManager>,
    settings: std::sync::Arc<Mutex<CyberdriverSettings>>,
    debug_logger: DebugLogger,
    connection_info: std::sync::Arc<Mutex<ConnectionInfo>>,
    internal_request_token: Arc<String>,
  ) -> Self {
    Self {
      app_handle,
      config,
      keepalive,
      settings,
      debug_logger,
      connection_info,
      enigo: std::sync::Arc::new(Mutex::new(Enigo::new(&Settings::default()).unwrap())),
      typing_dedupe: Arc::new(Mutex::new(KeyboardTypeDedupeState::default())),
      shutdown_requested: Arc::new(AtomicBool::new(false)),
      internal_request_token,
    }
  }
}

#[derive(Debug)]
struct ApiError {
  status: StatusCode,
  message: String,
}

impl ApiError {
  fn bad_request(message: &str) -> Self {
    Self {
      status: StatusCode::BAD_REQUEST,
      message: message.to_string(),
    }
  }

  fn internal(message: &str) -> Self {
    Self {
      status: StatusCode::INTERNAL_SERVER_ERROR,
      message: message.to_string(),
    }
  }

  fn status(status: StatusCode, message: &str) -> Self {
    Self {
      status,
      message: message.to_string(),
    }
  }
}

impl IntoResponse for ApiError {
  fn into_response(self) -> Response {
    (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
  }
}

type ApiResult<T> = std::result::Result<T, ApiError>;

pub fn router(state: ApiState) -> Router {
  Router::new()
    .route("/computer/display/screenshot", get(get_screenshot))
    .route("/computer/display/dimensions", get(get_dimensions))
    .route("/computer/input/keyboard/type", post(post_keyboard_type))
    .route("/computer/input/keyboard/key", post(post_keyboard_key))
    .route("/computer/input/mouse/position", get(get_mouse_position))
    .route("/computer/input/mouse/move", post(post_mouse_move))
    .route("/computer/input/mouse/click", post(post_mouse_click))
    .route("/computer/input/mouse/drag", post(post_mouse_drag))
    .route("/computer/input/mouse/scroll", post(post_mouse_scroll))
    .route("/computer/copy_to_clipboard", post(post_copy_to_clipboard))
    .route("/computer/fs/list", get(get_fs_list))
    .route("/computer/fs/read", get(get_fs_read))
    .route("/computer/fs/write", post(post_fs_write))
    .route("/computer/shell/powershell/simple", post(post_powershell_simple))
    .route("/computer/shell/powershell/test", post(post_powershell_test))
    .route("/computer/shell/powershell/exec", post(post_powershell_exec))
    .route("/computer/shell/powershell/session", post(post_powershell_session))
    .route("/internal/diagnostics", get(get_diagnostics))
    .route("/internal/shutdown", post(post_shutdown))
    .route("/internal/update", post(post_update))
    .route("/task-done", post(post_task_done))
    .route("/internal/keepalive/remote/activity", post(post_keepalive_activity))
    .route("/internal/keepalive/remote/enable", post(post_keepalive_enable))
    .route("/internal/keepalive/remote/disable", post(post_keepalive_disable))
    .with_state(state)
}

#[derive(Deserialize)]
struct ScreenshotQuery {
  width: Option<u32>,
  height: Option<u32>,
  mode: Option<String>,
}

#[derive(Clone, Copy)]
enum ScaleMode {
  Exact,
  AspectFit,
  AspectFill,
}

impl ScaleMode {
  fn from_str(mode: &str) -> Self {
    match mode.to_lowercase().as_str() {
      "aspect_fit" => Self::AspectFit,
      "aspect_fill" => Self::AspectFill,
      _ => Self::Exact,
    }
  }

  fn as_str(&self) -> &'static str {
    match self {
      Self::Exact => "exact",
      Self::AspectFit => "aspect_fit",
      Self::AspectFill => "aspect_fill",
    }
  }
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
enum ScreenshotBackend {
  XCap,
  ScreenCaptureKit,
}

impl ScreenshotBackend {
  fn as_str(&self) -> &'static str {
    match self {
      Self::XCap => "xcap",
      Self::ScreenCaptureKit => "screencapturekit",
    }
  }
}
const SCREENSHOT_CONTENT_TYPE: &str = "image/png";

async fn get_screenshot(
  State(state): State<ApiState>,
  Query(query): Query<ScreenshotQuery>,
) -> ApiResult<Response> {
  let width = query.width;
  let height = query.height;
  let mode = ScaleMode::from_str(query.mode.as_deref().unwrap_or("exact"));
  let debug_logger = state.debug_logger.clone();

  let mut last_error: Option<String> = None;
  for attempt in 0..3 {
    match tokio::task::spawn_blocking(move || {
      capture_screen(width, height, mode)
    })
    .await
    {
      Ok(Ok(result)) => {
        debug_logger.log(
          "SCREENSHOT",
          "Captured",
          &[
            ("requested_w", width.map(|v| v.to_string()).unwrap_or_else(|| "auto".into())),
            ("requested_h", height.map(|v| v.to_string()).unwrap_or_else(|| "auto".into())),
            ("mode", mode.as_str().to_string()),
            ("backend", result.metrics.backend.clone()),
            ("orig", format!("{}x{}", result.metrics.orig_w, result.metrics.orig_h)),
            ("out", format!("{}x{}", result.metrics.out_w, result.metrics.out_h)),
            ("bytes", result.metrics.bytes.to_string()),
            ("filter", result.metrics.filter.clone()),
            ("capture_ms", format!("{:.1}", result.metrics.capture_ms)),
            ("resize_ms", format!("{:.1}", result.metrics.resize_ms)),
            ("encode_ms", format!("{:.1}", result.metrics.encode_ms)),
          ],
        );
        return Ok(Response::builder()
          .header("Content-Type", SCREENSHOT_CONTENT_TYPE)
          .body(axum::body::Body::from(result.bytes))
          .unwrap());
      }
      Ok(Err(err)) => {
        debug_logger.log(
          "SCREENSHOT",
          "Failed",
          &[
            ("attempt", (attempt + 1).to_string()),
            ("error", err.clone()),
          ],
        );
        last_error = Some(err);
        if attempt < 2 {
          tokio::time::sleep(Duration::from_millis(50)).await;
        }
      }
      Err(err) => {
        let error = format!("Join error: {err}");
        debug_logger.log(
          "SCREENSHOT",
          "Failed",
          &[
            ("attempt", (attempt + 1).to_string()),
            ("error", error.clone()),
          ],
        );
        last_error = Some(error);
        if attempt < 2 {
          tokio::time::sleep(Duration::from_millis(50)).await;
        }
      }
    }
  }
  Err(ApiError::internal(
    last_error.unwrap_or_else(|| "Screen capture failed".into()).as_str(),
  ))
}

async fn get_dimensions(State(_state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
  let monitor = xcap::Monitor::all()
    .ok()
    .and_then(|mut list| list.pop())
    .ok_or_else(|| ApiError::internal("No monitor available"))?;
  let width = monitor
    .width()
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  let height = monitor
    .height()
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({ "width": width, "height": height })))
}

#[derive(Deserialize)]
struct TextPayload {
  text: String,
}

async fn post_keyboard_type(
  State(state): State<ApiState>,
  headers: HeaderMap,
  Json(payload): Json<TextPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.text.is_empty() {
    return Err(ApiError::bad_request("Missing 'text' field"));
  }
  let text = payload.text;
  let dedupe_key = headers
    .get("x-idempotency-key")
    .and_then(|value| value.to_str().ok())
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(|value| format!("idem:{value}"));

  if let Some(ref key) = dedupe_key {
    let now = Instant::now();
    let dedupe = state.typing_dedupe.lock().await;
    if dedupe.inflight_key.as_ref() == Some(key)
      && dedupe
        .inflight_started_at
        .map(|started| now.duration_since(started) <= Duration::from_secs(30))
        .unwrap_or(false)
    {
      state.debug_logger.info("INPUT", "Skipping in-flight duplicate keyboard type");
      return Ok(Json(serde_json::json!({})));
    }
    if dedupe.last_completed_key.as_ref() == Some(key)
      && dedupe
        .last_completed_at
        .map(|completed| now.duration_since(completed) <= Duration::from_secs(3))
        .unwrap_or(false)
    {
      state
        .debug_logger
        .info("INPUT", "Skipping recently completed duplicate keyboard type");
      return Ok(Json(serde_json::json!({})));
    }
  }

  {
    let mut dedupe = state.typing_dedupe.lock().await;
    dedupe.inflight_key = dedupe_key.clone();
    dedupe.inflight_started_at = Some(Instant::now());
  }
  let settings = state.settings.lock().await.clone();
  let typing_result = input::type_text(&state.enigo, &text, settings.experimental_space).await;
  {
    let mut dedupe = state.typing_dedupe.lock().await;
    dedupe.inflight_key = None;
    dedupe.inflight_started_at = None;
    if let Some(key) = dedupe_key {
      if typing_result.is_ok() {
        dedupe.last_completed_key = Some(key);
        dedupe.last_completed_at = Some(Instant::now());
      }
    }
  }
  typing_result.map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({})))
}

async fn post_keyboard_key(
  State(state): State<ApiState>,
  Json(payload): Json<TextPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.text.is_empty() {
    return Err(ApiError::bad_request("Missing 'text' field"));
  }
  state.debug_logger.log(
    "INPUT",
    "Keyboard sequence",
    &[("sequence", payload.text.clone())],
  );
  let settings = state.settings.lock().await.clone();
  input::execute_xdo_sequence(state.app_handle.as_ref(), &state.enigo, &payload.text, settings.experimental_space)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({})))
}

async fn post_copy_to_clipboard(
  State(state): State<ApiState>,
  Json(payload): Json<TextPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.text.is_empty() {
    return Err(ApiError::bad_request("Missing 'text' field (key name)"));
  }
  let key_name = payload.text.clone();
  let settings = state.settings.lock().await.clone();
  let _ = tokio::task::spawn_blocking(|| {
    let mut clipboard = arboard::Clipboard::new().ok();
    if let Some(cb) = clipboard.as_mut() {
      let _ = cb.set_text(String::new());
    }
  }).await;

  input::execute_xdo_sequence(state.app_handle.as_ref(), &state.enigo, "ctrl+c", settings.experimental_space)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;

  let mut clipboard_content = String::new();
  for attempt in 0..8 {
    tokio::time::sleep(Duration::from_millis(200 + attempt * 100)).await;
    let read = tokio::task::spawn_blocking(|| {
      let clipboard = arboard::Clipboard::new().ok();
      clipboard.and_then(|mut cb| cb.get_text().ok()).unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    if !read.is_empty() {
      clipboard_content = read;
      break;
    }
  }

  let mut response = serde_json::Map::new();
  response.insert(key_name, serde_json::Value::String(clipboard_content));
  Ok(Json(serde_json::Value::Object(response)))
}

async fn get_mouse_position(
  State(_state): State<ApiState>,
) -> ApiResult<Json<serde_json::Value>> {
  let pos = input::mouse_position()
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({ "x": pos.x, "y": pos.y })))
}

#[derive(Deserialize)]
struct MouseMovePayload {
  x: i32,
  y: i32,
}

async fn post_mouse_move(
  State(state): State<ApiState>,
  Json(payload): Json<MouseMovePayload>,
) -> ApiResult<Json<serde_json::Value>> {
  input::move_mouse(&state.enigo, payload.x, payload.y)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({})))
}

#[derive(Deserialize)]
struct MouseClickPayload {
  x: Option<i32>,
  y: Option<i32>,
  button: Option<String>,
  down: Option<bool>,
  clicks: Option<u8>,
}

async fn post_mouse_click(
  State(state): State<ApiState>,
  Json(payload): Json<MouseClickPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  let button = match payload.button.as_deref().unwrap_or("left") {
    "left" => Button::Left,
    "right" => Button::Right,
    "middle" => Button::Middle,
    _ => return Err(ApiError::bad_request("Invalid button")),
  };
  state.debug_logger.log(
    "INPUT",
    "Mouse click",
    &[
      ("x", payload.x.map(|v| v.to_string()).unwrap_or_else(|| "none".into())),
      ("y", payload.y.map(|v| v.to_string()).unwrap_or_else(|| "none".into())),
      ("button", payload.button.clone().unwrap_or_else(|| "left".into())),
      (
        "down",
        payload
          .down
          .map(|v| v.to_string())
          .unwrap_or_else(|| "none".into()),
      ),
      (
        "clicks",
        payload
          .clicks
          .map(|v| v.to_string())
          .unwrap_or_else(|| "default".into()),
      ),
    ],
  );
  if let Some(down) = payload.down {
    input::mouse_click(&state.enigo, payload.x, payload.y, button, down, !down, 0)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  } else {
    let clicks = payload.clicks.unwrap_or(1);
    if clicks < 1 || clicks > 3 {
      return Err(ApiError::bad_request("clicks must be 1, 2, or 3"));
    }
    input::mouse_click(&state.enigo, payload.x, payload.y, button, false, false, clicks)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  }
  Ok(Json(serde_json::json!({})))
}

#[derive(Deserialize)]
struct MouseDragPayload {
  start_x: Option<i32>,
  start_y: Option<i32>,
  from_x: Option<i32>,
  from_y: Option<i32>,
  to_x: Option<i32>,
  to_y: Option<i32>,
  x: Option<i32>,
  y: Option<i32>,
  button: Option<String>,
  duration: Option<f64>,
}

async fn post_mouse_drag(
  State(state): State<ApiState>,
  Json(payload): Json<MouseDragPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  let button = match payload.button.as_deref().unwrap_or("left") {
    "left" => Button::Left,
    "right" => Button::Right,
    "middle" => Button::Middle,
    _ => return Err(ApiError::bad_request("Invalid button")),
  };
  let end_x = payload
    .to_x
    .or(payload.x)
    .ok_or_else(|| ApiError::bad_request("Missing or invalid destination coordinates"))?;
  let end_y = payload
    .to_y
    .or(payload.y)
    .ok_or_else(|| ApiError::bad_request("Missing or invalid destination coordinates"))?;
  let start_x = payload
    .start_x
    .or(payload.from_x)
    .ok_or_else(|| ApiError::bad_request("Missing or invalid start coordinates"))?;
  let start_y = payload
    .start_y
    .or(payload.from_y)
    .ok_or_else(|| ApiError::bad_request("Missing or invalid start coordinates"))?;
  input::mouse_drag(
    &state.enigo,
    start_x,
    start_y,
    end_x,
    end_y,
    button,
    payload.duration,
  )
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({})))
}

#[derive(Deserialize)]
struct MouseScrollPayload {
  direction: String,
  amount: i32,
  x: Option<i32>,
  y: Option<i32>,
}

async fn post_mouse_scroll(
  State(state): State<ApiState>,
  Json(payload): Json<MouseScrollPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.amount < 0 {
    return Err(ApiError::bad_request("'amount' must be non-negative"));
  }
  input::mouse_scroll(
    &state.enigo,
    payload.direction.to_lowercase().as_str(),
    payload.amount,
    payload.x,
    payload.y,
  )
  .await
  .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({})))
}

#[derive(Deserialize)]
struct FsListQuery {
  path: Option<String>,
}

async fn get_fs_list(
  Query(query): Query<FsListQuery>,
) -> ApiResult<Json<serde_json::Value>> {
  let path = query.path.unwrap_or_else(|| ".".to_string());
  let safe_path = PathBuf::from(path).expand_dir();
  if !safe_path.exists() {
    return Err(ApiError::status(StatusCode::NOT_FOUND, "Directory not found"));
  }
  if !safe_path.is_dir() {
    return Err(ApiError::bad_request("Path is not a directory"));
  }
  let mut entries = Vec::new();
  for item in std::fs::read_dir(&safe_path).map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to list directory"))? {
    if let Ok(item) = item {
      let path = item.path();
      let name = item.file_name().to_string_lossy().to_string();
      let meta = item.metadata();
      let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
      let size = meta.as_ref().ok().and_then(|m| if m.is_file() { Some(m.len()) } else { None });
      let modified = meta.ok().and_then(|m| m.modified().ok()).and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64());
      entries.push(serde_json::json!({
        "name": name,
        "path": path.to_string_lossy(),
        "is_dir": is_dir,
        "size": size,
        "modified": modified,
      }));
    }
  }
  entries.sort_by(|a, b| {
    let a_dir = a.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);
    let b_dir = b.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);
    a_dir
      .cmp(&b_dir)
      .reverse()
      .then_with(|| a.get("name").unwrap().as_str().cmp(&b.get("name").unwrap().as_str()))
  });
  Ok(Json(serde_json::json!({ "path": safe_path.to_string_lossy(), "entries": entries })))
}

#[derive(Deserialize)]
struct FsReadQuery {
  path: String,
}

async fn get_fs_read(
  Query(query): Query<FsReadQuery>,
) -> ApiResult<Json<serde_json::Value>> {
  let safe_path = PathBuf::from(query.path).expand_dir();
  if !safe_path.exists() {
    return Err(ApiError::status(StatusCode::NOT_FOUND, "File not found"));
  }
  if !safe_path.is_file() {
    return Err(ApiError::bad_request("Path is not a file"));
  }
  let meta = safe_path.metadata().map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to read file"))?;
  if meta.len() > 100 * 1024 * 1024 {
    return Err(ApiError::status(StatusCode::PAYLOAD_TOO_LARGE, "File too large (>100MB)"));
  }
  let content = tokio::fs::read(&safe_path)
    .await
    .map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to read file"))?;
  Ok(Json(serde_json::json!({
    "path": safe_path.to_string_lossy(),
    "content": base64::engine::general_purpose::STANDARD.encode(content),
    "size": meta.len(),
  })))
}

#[derive(Deserialize)]
struct FsWritePayload {
  path: String,
  content: String,
  mode: Option<String>,
}

async fn post_fs_write(
  Json(payload): Json<FsWritePayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.path.is_empty() {
    return Err(ApiError::bad_request("Missing 'path' field"));
  }
  if payload.content.is_empty() {
    return Err(ApiError::bad_request("Missing 'content' field"));
  }
  let file_data = base64::engine::general_purpose::STANDARD
    .decode(payload.content)
    .map_err(|_| ApiError::bad_request("Invalid base64 content"))?;
  let raw_path = PathBuf::from(&payload.path).expand_dir();
  let mut safe_path = raw_path.clone();
  if !raw_path.is_absolute()
    && raw_path
      .parent()
      .map(|p| p == std::path::Path::new("."))
      .unwrap_or(true)
  {
    safe_path = dirs::home_dir()
      .unwrap_or_else(|| PathBuf::from("."))
      .join("CyberdeskTransfers")
      .join(raw_path.file_name().unwrap());
  }
  if let Some(parent) = safe_path.parent() {
    let _ = tokio::fs::create_dir_all(parent).await;
  }
  let write_mode = payload.mode.unwrap_or_else(|| "write".to_string());
  if write_mode == "append" {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(&safe_path)
      .await
      .map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to write file"))?;
    file
      .write_all(&file_data)
      .await
      .map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to write file"))?;
  } else {
    tokio::fs::write(&safe_path, file_data)
      .await
      .map_err(|_| ApiError::status(StatusCode::FORBIDDEN, "Permission denied to write file"))?;
  }
  Ok(Json(serde_json::json!({})))
}

async fn post_shutdown(
  State(state): State<ApiState>,
  headers: HeaderMap,
  body: Bytes,
) -> ApiResult<Json<serde_json::Value>> {
  let provided = headers
    .get("x-cyberdesk-tunnel-token")
    .and_then(|value| value.to_str().ok())
    .unwrap_or_default();
  if provided != state.internal_request_token.as_str() {
    return Err(ApiError::status(
      StatusCode::FORBIDDEN,
      "Forbidden: tunnel-only endpoint",
    ));
  }

  let payload = serde_json::from_slice::<serde_json::Value>(&body).ok();
  let reason = payload
    .as_ref()
    .and_then(|value| value.get("reason"))
    .and_then(|value| value.as_str())
    .unwrap_or("none")
    .to_string();
  let source = payload
    .as_ref()
    .and_then(|value| value.get("source"))
    .and_then(|value| value.as_str())
    .unwrap_or("unknown")
    .to_string();

  if state.shutdown_requested.swap(true, Ordering::SeqCst) {
    return Ok(Json(serde_json::json!({
      "status": "already_shutting_down",
      "pid": std::process::id(),
      "reason": reason,
      "source": source,
    })));
  }

  state.debug_logger.log(
    "RUNTIME",
    "Shutdown requested",
    &[
      ("pid", std::process::id().to_string()),
      ("source", source.clone()),
      ("reason", reason.clone()),
    ],
  );

  let app_handle = state.app_handle.clone();
  tauri::async_runtime::spawn(async move {
    tokio::time::sleep(Duration::from_millis(250)).await;
    let _ = super::config::remove_pid_file();
    if let Some(app) = app_handle {
      app.exit(0);
    } else {
      std::process::exit(0);
    }
  });

  Ok(Json(serde_json::json!({
    "status": "shutting_down",
    "pid": std::process::id(),
    "reason": reason,
    "source": source,
  })))
}

async fn post_task_done(State(state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
  state.debug_logger.info("TASK", "Task completion callback received");
  if let Some(app) = state.app_handle.clone() {
    let _ = app.emit("computer-task-completed", serde_json::json!({ "status": "success" }));
    let _ = app.emit("computer-task-state", "success");
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(Duration::from_millis(1500)).await;
      let _ = crate::commands::window::hide_pill_widget(app.clone()).await;
      let _ = app.emit("computer-task-cleared", ());
    });
  }
  Ok(Json(serde_json::json!({ "status": "ok" })))
}

async fn post_powershell_simple() -> ApiResult<Json<serde_json::Value>> {
  let output = if cfg!(windows) {
    std::process::Command::new("powershell")
      .args(["-NoProfile", "-Command", "Write-Output 'Hello World'"])
      .output()
  } else {
    std::process::Command::new("/bin/sh")
      .args(["-c", "printf 'Hello World'"])
      .output()
  }
  .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({
    "returncode": output.status.code().unwrap_or(0),
    "stdout": truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
    "stderr": truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
  })))
}

async fn post_powershell_test() -> ApiResult<Json<serde_json::Value>> {
  let output = if cfg!(windows) {
    std::process::Command::new("powershell")
      .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"])
      .arg("Write-Output \"Hello from PowerShell\"")
      .output()
  } else {
    std::process::Command::new("/bin/sh")
      .args(["-c", "printf 'Hello from shell'"])
      .output()
  }
  .map_err(|err| ApiError::internal(&err.to_string()))?;
  Ok(Json(serde_json::json!({
    "returncode": output.status.code().unwrap_or(0),
    "stdout": truncate_output(String::from_utf8_lossy(&output.stdout).to_string()),
    "stderr": truncate_output(String::from_utf8_lossy(&output.stderr).to_string()),
  })))
}

#[derive(Deserialize)]
struct PowerShellExecPayload {
  command: String,
  #[allow(dead_code)]
  same_session: Option<bool>,
  working_directory: Option<String>,
  session_id: Option<String>,
  timeout: Option<f64>,
}

async fn post_powershell_exec(
  Json(payload): Json<PowerShellExecPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.command.is_empty() {
    return Err(ApiError::bad_request("Missing 'command' field"));
  }
  let timeout = payload.timeout.unwrap_or(30.0);
  let working_directory = payload.working_directory.clone();
  let command = payload.command.clone();
  let session_id = payload.session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
  let result: std::result::Result<CommandResult, CyberdriverError> =
    tokio::task::spawn_blocking(move || {
      execute_shell_command(&command, working_directory.as_deref(), timeout)
    })
    .await
    .unwrap_or_else(|err| Err(CyberdriverError::RuntimeError(err.to_string())));

  match result {
    Ok(result) => Ok(Json(serde_json::json!({
      "stdout": truncate_output(result.stdout),
      "stderr": truncate_output(result.stderr),
      "exit_code": result.exit_code,
      "session_id": session_id,
      "timeout_reached": result.timeout_reached,
    }))),
    Err(err) => Err(ApiError::internal(&err.to_string())),
  }
}

#[derive(Deserialize)]
struct PowerShellSessionPayload {
  action: String,
  #[allow(dead_code)]
  session_id: Option<String>,
}

async fn post_powershell_session(
  Json(payload): Json<PowerShellSessionPayload>,
) -> ApiResult<Json<serde_json::Value>> {
  if payload.action != "create" && payload.action != "destroy" {
    return Err(ApiError::bad_request("Invalid action. Must be 'create' or 'destroy'"));
  }
  if payload.action == "create" {
    Ok(Json(serde_json::json!({
      "session_id": uuid::Uuid::new_v4().to_string(),
      "message": "Session ID generated (sessions are stateless)"
    })))
  } else {
    Ok(Json(serde_json::json!({ "message": "Session destroyed (no-op in stateless mode)" })))
  }
}

async fn get_diagnostics() -> ApiResult<Json<serde_json::Value>> {
  Ok(Json(diagnostics::collect()))
}

async fn post_keepalive_activity(State(state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
  state.keepalive.record_activity().await;
  Ok(Json(serde_json::json!({})))
}

async fn post_keepalive_enable(State(state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
  let settings = state.settings.lock().await.clone();
  state
    .keepalive
    .update_config(
      true,
      settings.keepalive_threshold_minutes,
      settings.keepalive_click_x,
      settings.keepalive_click_y,
    )
    .await;
  Ok(Json(serde_json::json!({})))
}

async fn post_keepalive_disable(State(state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
  let settings = state.settings.lock().await.clone();
  state
    .keepalive
    .update_config(
      false,
      settings.keepalive_threshold_minutes,
      settings.keepalive_click_x,
      settings.keepalive_click_y,
    )
    .await;
  Ok(Json(serde_json::json!({})))
}

async fn post_update(
  State(state): State<ApiState>,
  Json(payload): Json<update::UpdateRequest>,
) -> ApiResult<Json<serde_json::Value>> {
  let response = update::handle_update(payload, &state.connection_info, &state.config.version)
    .await
    .map_err(|err| ApiError::internal(&err.to_string()))?;
  if let Some(app) = state.app_handle.clone() {
    tauri::async_runtime::spawn(async move {
      tokio::time::sleep(Duration::from_secs(2)).await;
      app.exit(0);
    });
  }
  Ok(Json(serde_json::to_value(response).unwrap_or_else(|_| serde_json::json!({}))))
}

#[derive(Debug)]
struct CommandResult {
  stdout: String,
  stderr: String,
  exit_code: i32,
  timeout_reached: bool,
}

fn execute_shell_command(
  command: &str,
  working_dir: Option<&str>,
  timeout: f64,
) -> std::result::Result<CommandResult, CyberdriverError> {
  let mut cmd = if cfg!(windows) {
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"])
      .arg("-Command")
      .arg(command);
    cmd
  } else {
    let mut cmd = std::process::Command::new("/bin/sh");
    cmd.args(["-c", command]);
    cmd
  };
  if let Some(dir) = working_dir {
    cmd.current_dir(dir);
  }
  let child = cmd
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped())
    .spawn()
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;

  let (tx, rx) = std::sync::mpsc::channel();
  std::thread::spawn(move || {
    let output = child.wait_with_output();
    let _ = tx.send(output);
  });
  match rx.recv_timeout(Duration::from_secs_f64(timeout.max(1.0))) {
    Ok(Ok(output)) => Ok(CommandResult {
      stdout: String::from_utf8_lossy(&output.stdout).to_string(),
      stderr: String::from_utf8_lossy(&output.stderr).to_string(),
      exit_code: output.status.code().unwrap_or(-1),
      timeout_reached: false,
    }),
    _ => Ok(CommandResult {
      stdout: String::new(),
      stderr: format!(
        "Command timeout reached after {timeout} seconds. Process continues in background."
      ),
      exit_code: 0,
      timeout_reached: true,
    }),
  }
}

struct ScreenshotMetrics {
  capture_ms: f64,
  resize_ms: f64,
  encode_ms: f64,
  orig_w: u32,
  orig_h: u32,
  out_w: u32,
  out_h: u32,
  bytes: usize,
  filter: String,
  backend: String,
}

struct ScreenshotResult {
  bytes: Vec<u8>,
  metrics: ScreenshotMetrics,
}

fn determine_target_dimensions(
  width: Option<u32>,
  height: Option<u32>,
) -> Option<(u32, u32)> {
  if let (Some(width), Some(height)) = (width, height) {
    return Some((width, height));
  }
  if width.is_some() || height.is_some() {
    return None;
  }
  get_logical_dimensions()
}

fn capture_screen(
  width: Option<u32>,
  height: Option<u32>,
  mode: ScaleMode,
) -> std::result::Result<ScreenshotResult, String> {
  let target_hint = determine_target_dimensions(width, height);
  let capture_target = if matches!(mode, ScaleMode::Exact) {
    target_hint
  } else {
    None
  };
  let capture_start = Instant::now();
  let capture = capture_backend_image(select_backend(), capture_target)?;
  let capture_ms = capture_start.elapsed().as_secs_f64() * 1000.0;

  let mut dyn_image = capture.image;
  let orig_width = capture.orig_w;
  let orig_height = capture.orig_h;
  let (mut target_width, mut target_height) = match target_hint {
    Some((target_w, target_h)) => (target_w, target_h),
    None => {
      let target_w = width.unwrap_or(orig_width);
      let target_h = height.unwrap_or(orig_height);
      (target_w, target_h)
    }
  };
  let (captured_w, captured_h) = dyn_image.dimensions();
  let skip_auto_resize = matches!(capture.backend, ScreenshotBackend::XCap)
    && width.is_none()
    && height.is_none()
    && matches!(mode, ScaleMode::Exact);
  if skip_auto_resize {
    target_width = captured_w;
    target_height = captured_h;
  }
  let resize_start = Instant::now();
  let needs_resize = target_width != captured_w || target_height != captured_h;
  let (filter, resize_ms) = if needs_resize {
    let (scaled, filter) = scale_image(dyn_image, target_width, target_height, mode);
    dyn_image = scaled;
    (filter, resize_start.elapsed().as_secs_f64() * 1000.0)
  } else {
    (image::imageops::FilterType::Nearest, 0.0)
  };
  let (out_w, out_h) = dyn_image.dimensions();
  let encode_start = Instant::now();
  let buf = encode_image(&dyn_image)?;
  let encode_ms = encode_start.elapsed().as_secs_f64() * 1000.0;
  let byte_len = buf.len();
  Ok(ScreenshotResult {
    bytes: buf,
    metrics: ScreenshotMetrics {
      capture_ms,
      resize_ms,
      encode_ms,
      orig_w: orig_width,
      orig_h: orig_height,
      out_w,
      out_h,
      bytes: byte_len,
      filter: if needs_resize {
        filter_label(filter).to_string()
      } else {
        "none".to_string()
      },
      backend: capture.backend.as_str().to_string(),
    },
  })
}

struct CaptureImageResult {
  image: image::DynamicImage,
  orig_w: u32,
  orig_h: u32,
  backend: ScreenshotBackend,
}

fn capture_backend_image(
  backend: ScreenshotBackend,
  target: Option<(u32, u32)>,
) -> std::result::Result<CaptureImageResult, String> {
  match backend {
    ScreenshotBackend::XCap => {
      let (image, orig_w, orig_h) = capture_screen_xcap()?;
      Ok(CaptureImageResult {
        image,
        orig_w,
        orig_h,
        backend: ScreenshotBackend::XCap,
      })
    }
    ScreenshotBackend::ScreenCaptureKit => {
      let (image, orig_w, orig_h) = capture_screen_screencapturekit(target)?;
      Ok(CaptureImageResult {
        image,
        orig_w,
        orig_h,
        backend: ScreenshotBackend::ScreenCaptureKit,
      })
    }
  }
}

fn select_backend() -> ScreenshotBackend {
  if cfg!(target_os = "macos") {
    #[cfg(all(target_os = "macos", feature = "screencapturekit"))]
    {
      return ScreenshotBackend::ScreenCaptureKit;
    }
  }
  ScreenshotBackend::XCap
}

fn capture_screen_xcap() -> std::result::Result<(image::DynamicImage, u32, u32), String> {
  let monitor = xcap::Monitor::all()
    .ok()
    .and_then(|mut list| list.pop())
    .ok_or_else(|| "No monitor available".to_string())?;
  let image = monitor.capture_image().map_err(|err| err.to_string())?;
  let dyn_image = image::DynamicImage::ImageRgba8(image);
  let (orig_w, orig_h) = dyn_image.dimensions();
  Ok((dyn_image, orig_w, orig_h))
}

#[cfg(all(target_os = "macos", feature = "screencapturekit"))]
fn capture_screen_screencapturekit(
  target: Option<(u32, u32)>,
) -> std::result::Result<(image::DynamicImage, u32, u32), String> {
  use screencapturekit::prelude::*;
  use screencapturekit::screenshot_manager::SCScreenshotManager;
  use screencapturekit::shareable_content::SCShareableContentInfo;

  let content = SCShareableContent::get().map_err(|err| err.to_string())?;
  let display = content
    .displays()
    .into_iter()
    .next()
    .ok_or_else(|| "No displays found".to_string())?;
  let filter = SCContentFilter::create()
    .with_display(&display)
    .with_excluding_windows(&[])
    .build();
  let mut config = SCStreamConfiguration::new();
  let (source_w, source_h) = if let Some(info) = SCShareableContentInfo::for_filter(&filter) {
    let (width, height) = info.pixel_size();
    (width as u32, height as u32)
  } else {
    (display.width() as u32, display.height() as u32)
  };
  if let Some((target_w, target_h)) = target {
    config = config.with_width(target_w).with_height(target_h);
  } else {
    config = config.with_width(source_w).with_height(source_h);
  }
  let image = SCScreenshotManager::capture_image(&filter, &config).map_err(|err| err.to_string())?;
  let width = image.width() as u32;
  let height = image.height() as u32;
  let rgba = image.rgba_data().map_err(|err| err.to_string())?;
  let image = image::RgbaImage::from_raw(width, height, rgba)
    .ok_or_else(|| "Invalid ScreenCaptureKit image buffer".to_string())?;
  Ok((image::DynamicImage::ImageRgba8(image), source_w, source_h))
}

#[cfg(any(not(target_os = "macos"), not(feature = "screencapturekit")))]
fn capture_screen_screencapturekit(
  _target: Option<(u32, u32)>,
) -> std::result::Result<(image::DynamicImage, u32, u32), String> {
  Err("ScreenCaptureKit support not enabled (build with --features screencapturekit)".to_string())
}

fn encode_image(
  image: &image::DynamicImage,
) -> std::result::Result<Vec<u8>, String> {
  let mut buf = Vec::new();
  image
    .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
    .map_err(|err| err.to_string())?;
  Ok(buf)
}

fn scale_image(
  image: image::DynamicImage,
  target_width: u32,
  target_height: u32,
  mode: ScaleMode,
) -> (image::DynamicImage, image::imageops::FilterType) {
  let (orig_width, orig_height) = image.dimensions();
  if target_width == orig_width && target_height == orig_height {
    return (image, image::imageops::FilterType::Nearest);
  }
  match mode {
    ScaleMode::Exact => {
      let filter = choose_resize_filter(orig_width, orig_height, target_width, target_height);
      (image.resize_exact(target_width, target_height, filter), filter)
    }
    ScaleMode::AspectFit => {
      let orig_aspect = orig_width as f32 / orig_height as f32;
      let target_aspect = target_width as f32 / target_height as f32;
      let (new_w, new_h) = if orig_aspect > target_aspect {
        (target_width, (target_width as f32 / orig_aspect) as u32)
      } else {
        ((target_height as f32 * orig_aspect) as u32, target_height)
      };
      let filter = choose_resize_filter(orig_width, orig_height, new_w, new_h);
      (image.resize_exact(new_w, new_h, filter), filter)
    }
    ScaleMode::AspectFill => {
      let orig_aspect = orig_width as f32 / orig_height as f32;
      let target_aspect = target_width as f32 / target_height as f32;
      let (new_w, new_h) = if orig_aspect > target_aspect {
        ((target_height as f32 * orig_aspect) as u32, target_height)
      } else {
        (target_width, (target_width as f32 / orig_aspect) as u32)
      };
      let filter = choose_resize_filter(orig_width, orig_height, new_w, new_h);
      (image.resize_exact(new_w, new_h, filter), filter)
    }
  }
}

fn choose_resize_filter(
  orig_width: u32,
  orig_height: u32,
  target_width: u32,
  target_height: u32,
) -> image::imageops::FilterType {
  let scale_x = target_width as f64 / orig_width as f64;
  let scale_y = target_height as f64 / orig_height as f64;
  let scale = scale_x.min(scale_y);
  if scale < 0.5 {
    image::imageops::FilterType::Triangle
  } else if scale < 1.0 {
    image::imageops::FilterType::CatmullRom
  } else {
    image::imageops::FilterType::CatmullRom
  }
}

fn filter_label(filter: image::imageops::FilterType) -> &'static str {
  match filter {
    image::imageops::FilterType::Nearest => "nearest",
    image::imageops::FilterType::Triangle => "triangle",
    image::imageops::FilterType::CatmullRom => "catmullrom",
    image::imageops::FilterType::Gaussian => "gaussian",
    image::imageops::FilterType::Lanczos3 => "lanczos3",
  }
}

fn get_logical_dimensions() -> Option<(u32, u32)> {
  let monitor = xcap::Monitor::all().ok()?.pop()?;
  let width = monitor.width().ok()?;
  let height = monitor.height().ok()?;
  Some((width, height))
}

trait ExpandPath {
  fn expand_dir(self) -> PathBuf;
}

impl ExpandPath for PathBuf {
  fn expand_dir(self) -> PathBuf {
    if let Some(str_path) = self.to_str() {
      if str_path.starts_with("~") {
        if let Some(home) = dirs::home_dir() {
          return PathBuf::from(str_path.replacen("~", home.to_string_lossy().as_ref(), 1));
        }
      }
    }
    self
  }
}

fn truncate_output(output: String) -> String {
  let max = 15_000;
  if output.len() <= max {
    return output;
  }
  let head = &output[..max / 2];
  let tail = &output[output.len() - max / 2..];
  format!("{head}\n... (truncated) ...\n{tail}")
}
