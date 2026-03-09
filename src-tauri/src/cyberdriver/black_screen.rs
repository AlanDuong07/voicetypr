use std::time::Duration;

use tokio_util::sync::CancellationToken;

pub async fn run_black_screen_recovery(stop: CancellationToken, check_interval_seconds: f64) {
  if !cfg!(windows) {
    return;
  }
  let interval = check_interval_seconds.max(5.0);
  tokio::select! {
    _ = stop.cancelled() => return,
    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
  }
  if stop.is_cancelled() {
    return;
  }
  check_and_recover(&stop).await;

  loop {
    tokio::select! {
      _ = stop.cancelled() => return,
      _ = tokio::time::sleep(Duration::from_secs_f64(interval)) => {}
    }
    if stop.is_cancelled() {
      return;
    }
    check_and_recover(&stop).await;
  }
}

async fn check_and_recover(stop: &CancellationToken) {
  if stop.is_cancelled() {
    return;
  }
  let is_black = tokio::task::spawn_blocking(check_if_screen_black)
    .await
    .unwrap_or(false);
  if !is_black {
    return;
  }
  tokio::select! {
    _ = stop.cancelled() => return,
    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
  }
  let still_black = tokio::task::spawn_blocking(check_if_screen_black)
    .await
    .unwrap_or(false);
  if still_black {
    let _ = tokio::task::spawn_blocking(execute_console_switch).await;
  }
}

fn check_if_screen_black() -> bool {
  let monitor = match xcap::Monitor::all() {
    Ok(mut list) => list.pop(),
    Err(_) => None,
  };
  let monitor = match monitor {
    Some(m) => m,
    None => return false,
  };
  let image = match monitor.capture_image() {
    Ok(img) => img,
    Err(_) => return false,
  };
  let bytes = image.as_raw();
  if bytes.is_empty() {
    return false;
  }
  let mut sum = 0f64;
  let mut sum_sq = 0f64;
  for &b in bytes.iter() {
    let v = b as f64;
    sum += v;
    sum_sq += v * v;
  }
  let n = bytes.len() as f64;
  let mean = sum / n;
  let variance = (sum_sq / n) - (mean * mean);
  variance < 1.0 && mean < 10.0
}

fn execute_console_switch() {
  if !cfg!(windows) {
    return;
  }
  let ps_script = r#"
$sessionId = (Get-Process -Id $PID).SessionId
function Invoke-Tscon {
    param($Id)
    & tscon $Id /dest:console
    $rc = $LASTEXITCODE
    if ($rc -ne 0) { throw "tscon exited with code $rc" }
}
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -WindowStyle Hidden -Command `"& { tscon $sessionId /dest:console }`""
    return
}
Invoke-Tscon -Id $sessionId
"#;
  let _ = std::process::Command::new("powershell")
    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"])
    .arg(ps_script)
    .output();
}
