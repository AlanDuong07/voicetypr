use serde::Serialize;
use tokio::time::Duration;

use crate::audio::device_watcher::try_start_device_watcher_if_ready;

#[cfg(target_os = "macos")]
fn main_window_is_visible(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;

    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn restore_main_window_after_permission_prompt(app: &tauri::AppHandle) {
    use tauri::Manager;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(250)).await;

        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }

        crate::show_dock_icon(&app_handle);
    });
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSnapshot {
    pub microphone: PermissionState,
    pub accessibility: PermissionState,
    pub screen_capture: PermissionState,
    pub automation: PermissionState,
}

#[cfg(target_os = "macos")]
fn macos_accessibility_is_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "macos")]
pub(crate) fn macos_microphone_is_trusted() -> bool {
    use objc2_avf_audio::{AVAudioApplication, AVAudioApplicationRecordPermission};

    unsafe {
        AVAudioApplication::sharedInstance().recordPermission()
            == AVAudioApplicationRecordPermission::Granted
    }
}

#[cfg(target_os = "macos")]
fn macos_microphone_permission_state() -> PermissionState {
    use objc2_avf_audio::{AVAudioApplication, AVAudioApplicationRecordPermission};

    let permission = unsafe { AVAudioApplication::sharedInstance().recordPermission() };
    if permission == AVAudioApplicationRecordPermission::Granted {
        PermissionState::Granted
    } else if permission == AVAudioApplicationRecordPermission::Denied {
        PermissionState::Denied
    } else {
        PermissionState::NotDetermined
    }
}

#[cfg(target_os = "macos")]
fn macos_screen_capture_is_trusted() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn macos_request_screen_capture_access() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    unsafe { CGRequestScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn automation_probe_script() -> &'static str {
    r#"
        tell application "System Events"
            count every process
        end tell
    "#
}

#[cfg(target_os = "macos")]
fn run_automation_probe() -> Result<bool, String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(automation_probe_script())
        .output()
        .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let error = String::from_utf8_lossy(&output.stderr).to_string();
        if error.contains("1743")
            || error.to_lowercase().contains("not authorized")
            || error.to_lowercase().contains("not permitted")
        {
            Ok(false)
        } else {
            Err(format!("AppleScript error: {}", error))
        }
    }
}

#[cfg(target_os = "macos")]
fn current_permission_snapshot() -> PermissionSnapshot {
    PermissionSnapshot {
        microphone: macos_microphone_permission_state(),
        accessibility: if macos_accessibility_is_trusted() {
            PermissionState::Granted
        } else {
            PermissionState::Denied
        },
        screen_capture: if macos_screen_capture_is_trusted() {
            PermissionState::Granted
        } else {
            PermissionState::Denied
        },
        // Apple Events automation is best treated as an explicit probe-on-demand.
        automation: PermissionState::Unknown,
    }
}

#[cfg(not(target_os = "macos"))]
fn current_permission_snapshot() -> PermissionSnapshot {
    PermissionSnapshot {
        microphone: PermissionState::Granted,
        accessibility: PermissionState::Granted,
        screen_capture: PermissionState::Granted,
        automation: PermissionState::Granted,
    }
}

#[cfg(target_os = "macos")]
async fn macos_request_microphone_access() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        use block2::RcBlock;
        use objc2::runtime::Bool;
        use std::sync::{mpsc, Arc, Mutex};
        use std::time::Duration;

        let current_state = macos_microphone_permission_state();
        if current_state != PermissionState::NotDetermined {
            return Ok(current_state == PermissionState::Granted);
        }

        let (sender, receiver) = mpsc::channel::<bool>();
        let sender = Arc::new(Mutex::new(Some(sender)));
        let completion = {
            let sender = Arc::clone(&sender);
            RcBlock::new(move |granted: Bool| {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(granted.as_bool());
                    }
                }
            })
        };

        unsafe {
            objc2_avf_audio::AVAudioApplication::requestRecordPermissionWithCompletionHandler(
                &completion,
            );
        }

        match receiver.recv_timeout(Duration::from_secs(30)) {
            Ok(granted) => Ok(granted),
            Err(_) => Ok(macos_microphone_is_trusted()),
        }
    })
    .await
    .map_err(|error| format!("Microphone permission request task failed: {error}"))?
}

#[tauri::command]
pub async fn get_permission_snapshot() -> Result<PermissionSnapshot, String> {
    Ok(current_permission_snapshot())
}

#[tauri::command]
pub async fn check_accessibility_permission() -> Result<bool, String> {
    Ok(matches!(
        current_permission_snapshot().accessibility,
        PermissionState::Granted
    ))
}

#[tauri::command]
pub async fn request_accessibility_permission(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_plugin_macos_permissions::request_accessibility_permission;

        // First check if permission is already granted
        let already_granted = macos_accessibility_is_trusted();
        if already_granted {
            log::info!("Accessibility permission already granted");

            // Emit accessibility-granted event for UI update
            log::info!("Emitting accessibility-granted event");
            use tauri::Emitter;
            let _ = app.emit("accessibility-granted", ());

            // Return true to indicate permission is already granted
            return Ok(true);
        }

        log::info!("Requesting accessibility permissions");
        request_accessibility_permission().await;

        // Check the permission status after request and update readiness
        let has_permission = macos_accessibility_is_trusted();

        log::info!(
            "Accessibility permission check after request: {}",
            has_permission
        );

        // Emit appropriate event based on permission status
        use tauri::Emitter;
        if has_permission {
            let _ = app.emit("accessibility-granted", ());
        } else {
            let _ = app.emit("accessibility-denied", ());
        }

        Ok(has_permission)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn check_microphone_permission() -> Result<bool, String> {
    Ok(matches!(
        current_permission_snapshot().microphone,
        PermissionState::Granted
    ))
}

#[tauri::command]
pub async fn request_microphone_permission(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let should_restore_main_window = main_window_is_visible(&app);

        let current_state = macos_microphone_permission_state();
        if current_state == PermissionState::Granted {
            log::info!("Microphone permission already granted");

            // Emit microphone-granted event for UI update
            log::info!("Emitting microphone-granted event");
            use tauri::Emitter;
            let _ = app.emit("microphone-granted", ());

            // Try to start device watcher if onboarding is complete
            try_start_device_watcher_if_ready(&app).await;

            return Ok(true);
        }

        log::info!("Requesting microphone permissions using AVAudioApplication");
        let has_permission = macos_request_microphone_access().await?;

        if has_permission {
            log::info!("Microphone permission granted");
        } else {
            log::warn!("Microphone permission denied");
        }

        if should_restore_main_window {
            restore_main_window_after_permission_prompt(&app);
        }

        // Emit appropriate event based on permission status
        use tauri::Emitter;
        if has_permission {
            let _ = app.emit("microphone-granted", ());

            // Try to start device watcher if onboarding is complete
            try_start_device_watcher_if_ready(&app).await;
        } else {
            let _ = app.emit("microphone-denied", ());
        }

        Ok(has_permission)
    }

    #[cfg(not(target_os = "macos"))]
    {
        // On non-macOS, try to start device watcher (permission always granted)
        try_start_device_watcher_if_ready(&app).await;
        Ok(true)
    }
}

#[tauri::command]
pub async fn check_screen_capture_permission() -> Result<bool, String> {
    Ok(matches!(
        current_permission_snapshot().screen_capture,
        PermissionState::Granted
    ))
}

#[tauri::command]
pub async fn request_screen_capture_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if macos_screen_capture_is_trusted() {
            return Ok(true);
        }

        // Apple documents that Screen Recording only becomes usable after the app
        // is relaunched, so return the current observable state rather than
        // optimistically treating the request as granted.
        let _ = macos_request_screen_capture_access();
        Ok(macos_screen_capture_is_trusted())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn request_automation_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        run_automation_probe()
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

#[tauri::command]
pub async fn test_automation_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        log::info!("Testing automation permission by simulating Cmd+V");

        // Try to simulate Cmd+V which will trigger the System Events permission dialog
        // This is exactly what happens during actual paste operation
        let script = r#"
            tell application "System Events"
                -- Simulate Cmd+V (paste)
                keystroke "v" using command down
                return "success"
            end tell
        "#;

        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

        if output.status.success() {
            log::info!("Automation permission granted - Cmd+V simulation succeeded");
            Ok(true)
        } else {
            let error = String::from_utf8_lossy(&output.stderr);
            if error.contains("not allowed assistive access") || error.contains("1743") {
                log::warn!("Automation permission denied by user: {}", error);

                Ok(false)
            } else {
                log::error!("AppleScript failed with unexpected error: {}", error);

                Err(format!("AppleScript error: {}", error))
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}
