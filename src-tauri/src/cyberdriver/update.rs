use std::{path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use tauri_plugin_http::reqwest;
use tokio::sync::Mutex;

use crate::error::{CyberdriverError, Result};

use super::config::ConnectionInfo;

const GITHUB_RELEASES_API_URL: &str = "https://api.github.com/repos/cyberdesk-hq/cyberdriver/releases";
const GITHUB_DOWNLOAD_BASE_URL: &str =
  "https://github.com/cyberdesk-hq/cyberdriver/releases/download";

#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct UpdateRequest {
  pub version: String,
  pub restart: bool,
}

impl Default for UpdateRequest {
  fn default() -> Self {
    Self {
      version: "latest".to_string(),
      restart: true,
    }
  }
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdateResponse {
  pub status: String,
  pub current_version: String,
  pub target_version: String,
  pub message: String,
}

pub async fn handle_update(
  payload: UpdateRequest,
  connection_info: &Mutex<ConnectionInfo>,
  current_version: &str,
) -> Result<UpdateResponse> {
  if !cfg!(windows) {
    return Err(CyberdriverError::RuntimeError(
      "Self-update is currently only supported on Windows".into(),
    ));
  }
  let current_exe = std::env::current_exe()
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
  let mut target_version = payload.version;
  if target_version == "latest" {
    target_version = resolve_latest_version(connection_info).await?.ok_or_else(|| {
      CyberdriverError::RuntimeError("Could not determine latest version".into())
    })?;
  }

  if is_version_at_least(current_version, &target_version) {
    return Ok(UpdateResponse {
      status: "already_up_to_date".to_string(),
      current_version: current_version.to_string(),
      target_version,
      message: "Cyberdriver is already running the requested version".into(),
    });
  }

  let download_url = format!("{GITHUB_DOWNLOAD_BASE_URL}/v{target_version}/cyberdriver.exe");
  let tool_dir = current_exe
    .parent()
    .ok_or_else(|| CyberdriverError::RuntimeError("Missing executable directory".into()))?
    .to_path_buf();
  let staging_exe = tool_dir.join("cyberdriver-update.exe");

  let response = reqwest::Client::new()
    .get(&download_url)
    .timeout(Duration::from_secs(120))
    .send()
    .await
    .map_err(|err| CyberdriverError::RuntimeError(format!("Update download failed: {err}")))?;
  if response.status() == reqwest::StatusCode::NOT_FOUND {
    return Err(CyberdriverError::RuntimeError(format!(
      "Version v{target_version} not found on GitHub releases"
    )));
  }
  if !response.status().is_success() {
    return Err(CyberdriverError::RuntimeError(format!(
      "Failed to download update: HTTP {}",
      response.status()
    )));
  }
  let bytes = response
    .bytes()
    .await
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
  tokio::fs::write(&staging_exe, bytes)
    .await
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;

  let script = build_updater_script(&current_exe, &staging_exe, payload.restart);
  let script_path = tool_dir.join("cyberdriver-updater.ps1");
  tokio::fs::write(&script_path, script)
    .await
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;

  let _ = std::process::Command::new("powershell")
    .args([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script_path.to_string_lossy().as_ref(),
    ])
    .spawn();

  Ok(UpdateResponse {
    status: "update_initiated".to_string(),
    current_version: current_version.to_string(),
    target_version: target_version.clone(),
    message: format!(
      "Updating to v{target_version}. Cyberdriver will restart automatically."
    ),
  })
}

fn build_updater_script(current_exe: &PathBuf, staging_exe: &PathBuf, restart: bool) -> String {
  let exe = current_exe.to_string_lossy().replace('\'', "''");
  let staging = staging_exe.to_string_lossy().replace('\'', "''");
  let restart_cmd = if restart {
    format!("Start-Process -FilePath '{exe}'")
  } else {
    "Write-Output \"Restart skipped\"".to_string()
  };
  format!(
    r#"
$pid = {pid}
while (Get-Process -Id $pid -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 200 }}
Copy-Item -Force '{staging}' '{exe}'
{restart_cmd}
"#,
    pid = std::process::id(),
  )
}

fn is_version_at_least(current: &str, target: &str) -> bool {
  let parse = |v: &str| -> Vec<u32> {
    v.trim_start_matches('v')
      .split('.')
      .filter_map(|p| p.parse::<u32>().ok())
      .collect()
  };
  let c = parse(current);
  let t = parse(target);
  c >= t
}

async fn resolve_latest_version(connection_info: &Mutex<ConnectionInfo>) -> Result<Option<String>> {
  if let Some(version) = fetch_latest_version_from_api(connection_info).await? {
    return Ok(Some(version));
  }
  fetch_latest_version_from_github().await
}

async fn fetch_latest_version_from_api(
  connection_info: &Mutex<ConnectionInfo>,
) -> Result<Option<String>> {
  let info = connection_info.lock().await;
  let (host, port) = match (&info.host, info.port) {
    (Some(host), Some(port)) => (host.clone(), port),
    _ => return Ok(None),
  };
  let protocol = if port == 443 { "https" } else { "http" };
  let url = format!("{protocol}://{host}/v1/internal/cyberdriver-version");
  let response = reqwest::Client::new()
    .get(url)
    .timeout(Duration::from_secs(10))
    .send()
    .await;
  if let Ok(resp) = response {
    if resp.status().is_success() {
      if let Ok(bytes) = resp.bytes().await {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
          if let Some(version) = json.get("latest_version").and_then(|v| v.as_str()) {
          return Ok(Some(version.to_string()));
          }
        }
      }
    }
  }
  Ok(None)
}

async fn fetch_latest_version_from_github() -> Result<Option<String>> {
  let response = reqwest::Client::new()
    .get(GITHUB_RELEASES_API_URL)
    .header("Accept", "application/vnd.github.v3+json")
    .timeout(Duration::from_secs(30))
    .send()
    .await;
  let resp = match response {
    Ok(resp) => resp,
    Err(_) => return Ok(None),
  };
  if !resp.status().is_success() {
    return Ok(None);
  }
  let bytes = match resp.bytes().await {
    Ok(bytes) => bytes,
    Err(_) => return Ok(None),
  };
  let releases: Vec<serde_json::Value> =
    serde_json::from_slice(&bytes).unwrap_or_default();
  let mut versions = releases
    .into_iter()
    .filter_map(|release| release.get("tag_name").and_then(|v| v.as_str()).map(|v| v.to_string()))
    .filter(|tag| tag.trim_start_matches('v').split('.').all(|p| p.chars().all(|c| c.is_ascii_digit())))
    .collect::<Vec<_>>();
  versions.sort_by(|a, b| version_tuple(b).cmp(&version_tuple(a)));
  Ok(versions.first().map(|v| v.trim_start_matches('v').to_string()))
}

fn version_tuple(tag: &str) -> Vec<u32> {
  tag.trim_start_matches('v')
    .split('.')
    .filter_map(|p| p.parse::<u32>().ok())
    .collect()
}
