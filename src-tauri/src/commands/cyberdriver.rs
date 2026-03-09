use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

use crate::cyberdriver::{CyberdriverRuntime, CyberdriverSettings};

#[tauri::command]
pub async fn get_cyberdriver_status(app: AppHandle) -> Result<crate::cyberdriver::CyberdriverStatus, String> {
  let status = app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .get_status()
    .await;
  Ok(status)
}

#[tauri::command]
pub async fn start_local_api(app: AppHandle) -> Result<u16, String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .start_local_server()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn stop_local_api(app: AppHandle) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .stop_local_server()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn connect_tunnel(app: AppHandle) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .connect_tunnel()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn disconnect_tunnel(app: AppHandle) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .disconnect_tunnel()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn update_cyberdriver_settings(
  app: AppHandle,
  settings: CyberdriverSettings,
) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .update_settings(settings)
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn get_cyberdriver_settings(app: AppHandle) -> Result<CyberdriverSettings, String> {
  crate::cyberdriver::CyberdriverSettings::from_store(&app)
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn clear_cyberdriver_config(app: AppHandle) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .clear_config()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn install_persistent_display(app: AppHandle) -> Result<(), String> {
  app
    .state::<Mutex<CyberdriverRuntime>>()
    .lock()
    .await
    .install_persistent_display()
    .await
    .map_err(|err| format!("{err:?}"))
}

#[tauri::command]
pub async fn get_cyberdriver_log_dir() -> Result<String, String> {
  let path = crate::cyberdriver::log_dir_path();
  Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_recent_logs(lines: Option<usize>) -> Result<String, String> {
  let max_lines = lines.unwrap_or(400);
  crate::cyberdriver::read_recent_logs(max_lines)
    .map_err(|err| format!("{err:?}"))
}
