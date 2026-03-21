//! Cross-platform media suppression controller.
//!
//! On macOS, mutes system output while recording and restores it afterward.
//! On Windows, pauses compatible media sessions and resumes them afterward.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[cfg(target_os = "macos")]
use std::{
    io::Write,
    process::{Command as ProcessCommand, Stdio},
};

#[cfg(target_os = "macos")]
const NOW_PLAYING_JXA_SCRIPT: &str = r#"
function run() {
  const MediaRemote = $.NSBundle.bundleWithPath(
    "/System/Library/PrivateFrameworks/MediaRemote.framework/",
  );
  MediaRemote.load;

  const MRNowPlayingRequest = $.NSClassFromString("MRNowPlayingRequest");
  const client = MRNowPlayingRequest.localNowPlayingPlayerPath.client;
  const clientConverted = {
    bundleIdentifier: client.bundleIdentifier.js,
    parentApplicationBundleIdentifier:
      client.parentApplicationBundleIdentifier.js,
  };

  const infoDict = MRNowPlayingRequest.localNowPlayingItem.nowPlayingInfo;
  const infoConverted = {};
  for (const key in infoDict.js) {
    const value = infoDict.valueForKey(key).js;
    if (typeof value !== "object") {
      infoConverted[key] = value;
    } else if (value && typeof value.getTime === "function") {
      try {
        infoConverted[key] = value.getTime();
      } catch (e) {
        infoConverted[key] = value.toString();
      }
    } else {
      infoConverted[key] = value.toString();
    }
  }

  return JSON.stringify({
    isPlaying: MRNowPlayingRequest.localIsPlaying,
    client: clientConverted,
    info: infoConverted,
  });
}
"#;

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
struct NowPlayingSnapshot {
    is_playing: Option<bool>,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy)]
struct MacosDuckState {
    original_output_volume: u32,
    original_output_muted: bool,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MacosOutputState {
    output_volume: u32,
    output_muted: bool,
}

#[cfg(target_os = "macos")]
fn should_restore_macos_output_state(
    current_state: Option<MacosOutputState>,
    duck_state: MacosDuckState,
) -> bool {
    !matches!(
        current_state,
        Some(state)
            if state.output_volume == duck_state.original_output_volume
                && state.output_muted == duck_state.original_output_muted
    )
}

#[cfg(target_os = "macos")]
fn now_playing_snapshot_via_osascript() -> Option<NowPlayingSnapshot> {
    let mut child = ProcessCommand::new("/usr/bin/osascript")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .arg("-l")
        .arg("JavaScript")
        .spawn()
        .ok()?;

    {
        let stdin = child.stdin.as_mut()?;
        stdin.write_all(NOW_PLAYING_JXA_SCRIPT.as_bytes()).ok()?;
    }

    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        if log::log_enabled!(log::Level::Debug) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);

            let stderr = stderr.trim();
            let stdout = stdout.trim();

            let stderr_trunc: String = stderr.chars().take(400).collect();
            let stdout_trunc: String = stdout.chars().take(400).collect();

            log::debug!(
                "osascript now playing query failed | status={:?} stdout={:?} stderr={:?}",
                output.status,
                stdout_trunc,
                stderr_trunc
            );
        }
        return None;
    }

    let raw: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(err) => {
            if log::log_enabled!(log::Level::Debug) {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);

                let stderr = stderr.trim();
                let stdout = stdout.trim();

                let stderr_trunc: String = stderr.chars().take(400).collect();
                let stdout_trunc: String = stdout.chars().take(400).collect();

                log::debug!(
                    "osascript now playing JSON parse failed | error={:?} stdout={:?} stderr={:?}",
                    err,
                    stdout_trunc,
                    stderr_trunc
                );
            }

            return None;
        }
    };
    let is_playing = raw.get("isPlaying").and_then(|v| v.as_bool());

    Some(NowPlayingSnapshot { is_playing })
}

/// Controller for temporarily quieting other media during voice recording.
pub struct MediaPauseController {
    /// Tracks if we changed external media state (so we know whether to restore it)
    was_playing_before_recording: AtomicBool,

    /// On macOS, remember the system output state we changed so we can restore it.
    #[cfg(target_os = "macos")]
    duck_state: Mutex<Option<MacosDuckState>>,

    /// On Windows, track which media session we paused so we only resume the same session.
    #[cfg(target_os = "windows")]
    paused_session_source_app_user_model_id: Mutex<Option<String>>,
}

impl Default for MediaPauseController {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaPauseController {
    pub fn new() -> Self {
        Self {
            was_playing_before_recording: AtomicBool::new(false),
            #[cfg(target_os = "macos")]
            duck_state: Mutex::new(None),
            #[cfg(target_os = "windows")]
            paused_session_source_app_user_model_id: Mutex::new(None),
        }
    }

    /// Quiet media if currently playing. Call when recording starts.
    /// Returns true if media state was changed.
    pub fn pause_if_playing(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.pause_if_playing_macos()
        }

        #[cfg(target_os = "windows")]
        {
            self.pause_if_playing_windows()
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            log::debug!("Media pause not supported on this platform");
            false
        }
    }

    /// Restore media if we previously quieted it. Call when recording stops.
    /// Returns true if media state was restored.
    pub fn resume_if_we_paused(&self) -> bool {
        if self
            .was_playing_before_recording
            .swap(false, Ordering::SeqCst)
        {
            #[cfg(target_os = "macos")]
            {
                self.resume_macos()
            }

            #[cfg(target_os = "windows")]
            {
                return self.resume_windows();
            }

            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                false
            }
        } else {
            false
        }
    }

    /// Reset state without resuming (e.g., if app is closing)
    #[allow(dead_code)]
    pub fn reset(&self) {
        self.was_playing_before_recording
            .store(false, Ordering::SeqCst);

        #[cfg(target_os = "windows")]
        {
            *self.paused_session_source_app_user_model_id.lock().unwrap() = None;
        }

        #[cfg(target_os = "macos")]
        {
            *self.duck_state.lock().unwrap() = None;
        }
    }
}

// ============================================
#[cfg(target_os = "macos")]
impl MediaPauseController {
    fn pause_if_playing_macos(&self) -> bool {
        let snapshot = now_playing_snapshot_via_osascript();
        let is_playing = snapshot
            .as_ref()
            .and_then(|s| s.is_playing)
            .unwrap_or(false);

        if !is_playing {
            log::debug!("No media playing, nothing to duck");
            self.was_playing_before_recording
                .store(false, Ordering::SeqCst);
            *self.duck_state.lock().unwrap() = None;
            return false;
        }

        let Some(current_output_state) = get_system_output_state_via_osascript() else {
            log::warn!("⚠️ Failed to read current output state for media suppression");
            self.was_playing_before_recording
                .store(false, Ordering::SeqCst);
            *self.duck_state.lock().unwrap() = None;
            return false;
        };

        if current_output_state.output_muted {
            log::debug!(
                "System output is already muted at volume {}; skipping media suppression",
                current_output_state.output_volume
            );
            self.was_playing_before_recording
                .store(false, Ordering::SeqCst);
            *self.duck_state.lock().unwrap() = None;
            return false;
        }

        log::info!(
            "🎵 Media is playing, muting system output while preserving volume at {} for recording...",
            current_output_state.output_volume
        );

        if set_system_output_state_via_osascript(MacosOutputState {
            output_volume: current_output_state.output_volume,
            output_muted: true,
        }) {
            log::info!("✅ Media output muted successfully");
            self.was_playing_before_recording
                .store(true, Ordering::SeqCst);
            *self.duck_state.lock().unwrap() = Some(MacosDuckState {
                original_output_volume: current_output_state.output_volume,
                original_output_muted: current_output_state.output_muted,
            });
            true
        } else {
            log::warn!("⚠️ Failed to mute media output");
            self.was_playing_before_recording
                .store(false, Ordering::SeqCst);
            *self.duck_state.lock().unwrap() = None;
            false
        }
    }

    fn resume_macos(&self) -> bool {
        let duck_state = *self.duck_state.lock().unwrap();
        let Some(duck_state) = duck_state else {
            log::debug!("No stored ducked volume state, skipping restore");
            return false;
        };

        let current_output_state = get_system_output_state_via_osascript();
        if !should_restore_macos_output_state(current_output_state, duck_state) {
            log::debug!(
                "System output state is already back at volume={} muted={}, clearing duck state",
                duck_state.original_output_volume,
                duck_state.original_output_muted
            );
            *self.duck_state.lock().unwrap() = None;
            return false;
        }

        if let Some(current_output_state) = current_output_state {
            if current_output_state.output_volume != duck_state.original_output_volume
                || current_output_state.output_muted != duck_state.original_output_muted
            {
                log::info!(
                    "System output state changed during recording (current_volume={}, current_muted={}, original_volume={}, original_muted={}); restoring saved pre-recording state",
                    current_output_state.output_volume,
                    current_output_state.output_muted,
                    duck_state.original_output_volume,
                    duck_state.original_output_muted
                );
            }
        }

        log::info!(
            "🎵 Restoring system output to volume={} muted={}...",
            duck_state.original_output_volume,
            duck_state.original_output_muted
        );
        if set_system_output_state_via_osascript(MacosOutputState {
            output_volume: duck_state.original_output_volume,
            output_muted: duck_state.original_output_muted,
        }) {
            log::info!("✅ Media output state restored successfully");
            *self.duck_state.lock().unwrap() = None;
            true
        } else {
            log::warn!("⚠️ Failed to restore media output state");
            false
        }
    }
}

#[cfg(target_os = "macos")]
fn get_system_output_state_via_osascript() -> Option<MacosOutputState> {
    let output = ProcessCommand::new("/usr/bin/osascript")
        .arg("-e")
        .arg("set volume_settings to get volume settings")
        .arg("-e")
        .arg(
            "return (output volume of volume_settings as string) & \",\" & (output muted of volume_settings as string)",
        )
        .output()
        .ok()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("Failed to read system output state: {}", stderr);
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let mut parts = stdout.trim().splitn(2, ',');
    let output_volume = parts.next()?.trim().parse::<u32>().ok()?.min(100);
    let output_muted = match parts.next()?.trim() {
        "true" => true,
        "false" => false,
        _ => return None,
    };

    Some(MacosOutputState {
        output_volume,
        output_muted,
    })
}

#[cfg(target_os = "macos")]
fn set_system_output_state_via_osascript(state: MacosOutputState) -> bool {
    let volume = state.output_volume.min(100);
    let command = if state.output_muted {
        format!("set volume with output muted output volume {}", volume)
    } else {
        format!("set volume without output muted output volume {}", volume)
    };
    let output = ProcessCommand::new("/usr/bin/osascript")
        .arg("-e")
        .arg(command)
        .output();

    match output {
        Ok(output) if output.status.success() => true,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            log::warn!(
                "osascript set output state failed | status={:?} stdout={:?} stderr={:?}",
                output.status,
                stdout,
                stderr
            );
            false
        }
        Err(err) => {
            log::warn!("Failed to execute osascript set output state: {}", err);
            false
        }
    }
}

// ============================================
// Windows Implementation (GSMTC - Global System Media Transport Controls)
// ============================================
// Uses Windows.Media.Control APIs to properly detect playback state
// and use explicit pause/play (not toggle). Requires Windows 10 1809+.
#[cfg(target_os = "windows")]
impl MediaPauseController {
    fn pause_if_playing_windows(&self) -> bool {
        use std::{thread, time::Duration};
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSession,
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };

        // Get the session manager (blocking wait with .join())
        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            Ok(op) => match op.join() {
                Ok(mgr) => mgr,
                Err(e) => {
                    log::warn!("Failed to get GSMTC session manager: {:?}", e);
                    return false;
                }
            },
            Err(e) => {
                log::warn!("Failed to request GSMTC session manager: {:?}", e);
                return false;
            }
        };

        fn is_pausable(session: &GlobalSystemMediaTransportControlsSession) -> bool {
            let playback_info = match session.GetPlaybackInfo() {
                Ok(info) => info,
                Err(_) => return false,
            };

            let controls = match playback_info.Controls() {
                Ok(controls) => controls,
                Err(_) => return false,
            };

            controls.IsPauseEnabled().unwrap_or(false)
        }

        fn is_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
            let playback_info = match session.GetPlaybackInfo() {
                Ok(info) => info,
                Err(_) => return false,
            };

            let status = match playback_info.PlaybackStatus() {
                Ok(status) => status,
                Err(_) => return false,
            };

            status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
        }

        fn timeline_position_ticks(
            session: &GlobalSystemMediaTransportControlsSession,
        ) -> Option<i64> {
            let timeline = session.GetTimelineProperties().ok()?;
            Some(timeline.Position().ok()?.Duration)
        }

        let mut candidate_session = manager
            .GetCurrentSession()
            .ok()
            .filter(|session| is_playing(session) && is_pausable(session));

        if candidate_session.is_none() {
            if let Ok(sessions) = manager.GetSessions() {
                if let Ok(size) = sessions.Size() {
                    for i in 0..size {
                        let session = match sessions.GetAt(i) {
                            Ok(session) => session,
                            Err(_) => continue,
                        };

                        if !is_playing(&session) {
                            continue;
                        }

                        if !is_pausable(&session) {
                            continue;
                        }

                        candidate_session = Some(session);
                        break;
                    }
                }
            }
        }

        // Fallback: some sessions occasionally report non-Playing states even while audio is
        // progressing. If we can observe timeline position advancing over a short interval,
        // treat it as playing and pause it.
        if candidate_session.is_none() {
            let current_session_id = manager
                .GetCurrentSession()
                .ok()
                .and_then(|s| s.SourceAppUserModelId().ok().map(|id| id.to_string()));

            let mut candidates: Vec<(String, GlobalSystemMediaTransportControlsSession, i64)> =
                Vec::new();

            if let Ok(sessions) = manager.GetSessions() {
                if let Ok(size) = sessions.Size() {
                    for i in 0..size {
                        let session = match sessions.GetAt(i) {
                            Ok(session) => session,
                            Err(_) => continue,
                        };

                        if !is_pausable(&session) {
                            continue;
                        }

                        let id = match session.SourceAppUserModelId() {
                            Ok(id) => id.to_string(),
                            Err(_) => continue,
                        };

                        let pos = timeline_position_ticks(&session).unwrap_or(0);
                        candidates.push((id, session, pos));
                    }
                }
            }

            if !candidates.is_empty() {
                if let Some(current_session_id) = current_session_id {
                    if let Some(idx) = candidates
                        .iter()
                        .position(|(id, _, _)| id == &current_session_id)
                    {
                        let current = candidates.remove(idx);
                        candidates.insert(0, current);
                    }
                }

                thread::sleep(Duration::from_millis(120));

                // 1 tick = 100ns, so 50ms = 500_000 ticks.
                const DELTA_THRESHOLD_TICKS: i64 = 50 * 10_000;

                for (id, session, before) in candidates {
                    let after = timeline_position_ticks(&session).unwrap_or(before);
                    let delta = after.saturating_sub(before);

                    if delta > DELTA_THRESHOLD_TICKS {
                        log::debug!(
                            "Inferred playing session via timeline movement | source_app_id={} delta_ms={}",
                            id,
                            delta / 10_000
                        );
                        candidate_session = Some(session);
                        break;
                    }
                }
            }
        }

        let Some(session) = candidate_session else {
            log::debug!("No playing, pausable media session found");
            self.was_playing_before_recording
                .store(false, Ordering::SeqCst);
            *self.paused_session_source_app_user_model_id.lock().unwrap() = None;
            return false;
        };

        log::info!("Media is playing, pausing for recording...");

        let source_app_id = session.SourceAppUserModelId().ok().map(|id| id.to_string());

        // Use explicit pause (not toggle!)
        match session.TryPauseAsync() {
            Ok(op) => match op.join() {
                Ok(success) => {
                    if success {
                        log::info!("Media paused successfully via GSMTC");
                        self.was_playing_before_recording
                            .store(true, Ordering::SeqCst);
                        *self.paused_session_source_app_user_model_id.lock().unwrap() =
                            source_app_id;
                        true
                    } else {
                        log::warn!("GSMTC TryPauseAsync returned false");
                        self.was_playing_before_recording
                            .store(false, Ordering::SeqCst);
                        *self.paused_session_source_app_user_model_id.lock().unwrap() = None;
                        false
                    }
                }
                Err(e) => {
                    log::warn!("Failed to pause media: {:?}", e);
                    self.was_playing_before_recording
                        .store(false, Ordering::SeqCst);
                    *self.paused_session_source_app_user_model_id.lock().unwrap() = None;
                    false
                }
            },
            Err(e) => {
                log::warn!("Failed to request pause: {:?}", e);
                self.was_playing_before_recording
                    .store(false, Ordering::SeqCst);
                *self.paused_session_source_app_user_model_id.lock().unwrap() = None;
                false
            }
        }
    }

    fn resume_windows(&self) -> bool {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

        log::info!("Resuming media playback via GSMTC...");

        // Get the session manager (blocking wait with .join())
        let manager = match GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
            Ok(op) => match op.join() {
                Ok(mgr) => mgr,
                Err(e) => {
                    log::warn!("Failed to get GSMTC session manager for resume: {:?}", e);
                    return false;
                }
            },
            Err(e) => {
                log::warn!(
                    "Failed to request GSMTC session manager for resume: {:?}",
                    e
                );
                return false;
            }
        };

        let paused_id = self
            .paused_session_source_app_user_model_id
            .lock()
            .unwrap()
            .take();

        let session = if let Some(paused_id) = paused_id {
            let sessions = match manager.GetSessions() {
                Ok(sessions) => sessions,
                Err(e) => {
                    log::warn!("Failed to enumerate GSMTC sessions for resume: {:?}", e);
                    return false;
                }
            };

            let size = match sessions.Size() {
                Ok(size) => size,
                Err(e) => {
                    log::warn!("Failed to read GSMTC sessions size for resume: {:?}", e);
                    return false;
                }
            };

            let mut found = None;
            for i in 0..size {
                let session = match sessions.GetAt(i) {
                    Ok(session) => session,
                    Err(_) => continue,
                };

                let session_id = match session.SourceAppUserModelId() {
                    Ok(id) => id.to_string(),
                    Err(_) => continue,
                };

                if session_id == paused_id {
                    found = Some(session);
                    break;
                }
            }

            match found {
                Some(session) => session,
                None => {
                    log::debug!("Paused media session is no longer available; skipping resume");
                    return false;
                }
            }
        } else {
            match manager.GetCurrentSession() {
                Ok(session) => session,
                Err(_) => {
                    log::warn!("No active media session found for resume");
                    return false;
                }
            }
        };

        // If it is already playing, don't send play.
        if let Ok(playback_info) = session.GetPlaybackInfo() {
            if let Ok(status) = playback_info.PlaybackStatus() {
                use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
                if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                    log::debug!("Media already playing, skipping resume");
                    return false;
                }
            }
        }

        // Use explicit play (not toggle!)
        match session.TryPlayAsync() {
            Ok(op) => match op.join() {
                Ok(success) => {
                    if success {
                        log::info!("Media resumed successfully via GSMTC");
                        true
                    } else {
                        log::warn!("GSMTC TryPlayAsync returned false");
                        false
                    }
                }
                Err(e) => {
                    log::warn!("Failed to resume media: {:?}", e);
                    false
                }
            },
            Err(e) => {
                log::warn!("Failed to request play: {:?}", e);
                false
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_controller_creation() {
        let controller = MediaPauseController::new();
        assert!(!controller
            .was_playing_before_recording
            .load(Ordering::SeqCst));
    }

    #[test]
    fn test_default_impl() {
        let controller = MediaPauseController::default();
        assert!(!controller
            .was_playing_before_recording
            .load(Ordering::SeqCst));
    }

    #[test]
    fn test_resume_without_pause_does_nothing() {
        let controller = MediaPauseController::new();
        // Should return false since we didn't pause anything
        assert!(!controller.resume_if_we_paused());
    }

    #[test]
    fn test_resume_clears_was_playing_flag() {
        let controller = MediaPauseController::new();
        // Manually set the flag to true
        controller
            .was_playing_before_recording
            .store(true, Ordering::SeqCst);

        // Resume should clear the flag (swap returns old value)
        // Note: actual resume behavior depends on platform APIs
        let _ = controller.resume_if_we_paused();

        // Flag should be cleared after resume attempt
        assert!(!controller
            .was_playing_before_recording
            .load(Ordering::SeqCst));
    }

    #[test]
    fn test_reset() {
        let controller = MediaPauseController::new();
        controller
            .was_playing_before_recording
            .store(true, Ordering::SeqCst);
        controller.reset();
        assert!(!controller
            .was_playing_before_recording
            .load(Ordering::SeqCst));
    }

    #[test]
    fn test_multiple_resets_are_safe() {
        let controller = MediaPauseController::new();
        controller.reset();
        controller.reset();
        controller.reset();
        assert!(!controller
            .was_playing_before_recording
            .load(Ordering::SeqCst));
    }

    #[test]
    fn test_was_playing_flag_is_atomic() {
        use std::sync::Arc;
        use std::thread;

        let controller = Arc::new(MediaPauseController::new());
        let mut handles = vec![];

        // Spawn multiple threads toggling the flag
        for i in 0..10 {
            let c = Arc::clone(&controller);
            handles.push(thread::spawn(move || {
                c.was_playing_before_recording
                    .store(i % 2 == 0, Ordering::SeqCst);
                c.was_playing_before_recording.load(Ordering::SeqCst)
            }));
        }

        // All threads should complete without panic
        for handle in handles {
            let _ = handle.join().unwrap();
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn should_restore_macos_output_state_when_still_muted() {
        let duck_state = MacosDuckState {
            original_output_volume: 65,
            original_output_muted: false,
        };

        assert!(should_restore_macos_output_state(
            Some(MacosOutputState {
                output_volume: 65,
                output_muted: true,
            }),
            duck_state
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn should_restore_macos_output_state_when_volume_changed_mid_recording() {
        let duck_state = MacosDuckState {
            original_output_volume: 65,
            original_output_muted: false,
        };

        assert!(should_restore_macos_output_state(
            Some(MacosOutputState {
                output_volume: 30,
                output_muted: false,
            }),
            duck_state
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn should_not_restore_macos_output_state_when_already_restored() {
        let duck_state = MacosDuckState {
            original_output_volume: 65,
            original_output_muted: false,
        };

        assert!(!should_restore_macos_output_state(
            Some(MacosOutputState {
                output_volume: 65,
                output_muted: false,
            }),
            duck_state
        ));
    }
}
