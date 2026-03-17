use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SilenceState {
    None,
    Warning(u64),
    ClearWarning,
    InitialTimeout,
    PostSpeechTimeout,
}

/// Simple silence detector based on audio level
pub struct SilenceDetector {
    /// When recording started
    started_at: Instant,
    /// Last time voice was detected
    last_voice_time: Instant,
    /// How long initial silence is allowed before any speech is detected
    initial_silence_duration: Duration,
    /// How long silence is allowed after speech has already been detected
    post_speech_silence_duration: Duration,
    /// Whether we've heard real speech during this recording
    has_detected_voice: bool,
    /// Last countdown value emitted to the UI
    last_countdown_emitted: Option<u64>,
    /// RMS threshold for voice detection
    voice_threshold: f32,
}

impl SilenceDetector {
    pub fn new(initial_silence_duration: Duration, post_speech_silence_duration: Duration) -> Self {
        Self {
            started_at: Instant::now(),
            last_voice_time: Instant::now(),
            initial_silence_duration,
            post_speech_silence_duration,
            has_detected_voice: false,
            last_countdown_emitted: None,
            voice_threshold: 0.005, // 0.5% - matches original whisper.cpp threshold
        }
    }

    /// Update with current RMS level and check if should stop
    pub fn update(&mut self, rms: f32) -> SilenceState {
        if rms > self.voice_threshold {
            let had_warning = self.last_countdown_emitted.take().is_some();
            // Voice detected, update timestamp
            self.has_detected_voice = true;
            self.last_voice_time = Instant::now();
            if had_warning {
                SilenceState::ClearWarning
            } else {
                SilenceState::None
            }
        } else {
            // The inactivity timeout applies both before and after speech is
            // detected. Once we're in the final five seconds, emit countdown
            // events so the pill can warn the user before auto-stop.
            if self.has_detected_voice {
                let elapsed = self.last_voice_time.elapsed();
                if elapsed >= self.post_speech_silence_duration {
                    self.last_countdown_emitted = None;
                    SilenceState::PostSpeechTimeout
                } else {
                    let remaining = self
                        .post_speech_silence_duration
                        .saturating_sub(elapsed);
                    let seconds_remaining = remaining.as_secs()
                        + u64::from(remaining.subsec_nanos() > 0);
                    if seconds_remaining <= 5
                        && self.last_countdown_emitted != Some(seconds_remaining)
                    {
                        self.last_countdown_emitted = Some(seconds_remaining);
                        SilenceState::Warning(seconds_remaining)
                    } else {
                        SilenceState::None
                    }
                }
            } else {
                let elapsed = self.started_at.elapsed();
                if elapsed >= self.initial_silence_duration {
                    self.last_countdown_emitted = None;
                    SilenceState::InitialTimeout
                } else {
                    let remaining = self
                        .initial_silence_duration
                        .saturating_sub(elapsed);
                    let seconds_remaining = remaining.as_secs()
                        + u64::from(remaining.subsec_nanos() > 0);
                    if seconds_remaining <= 5
                        && self.last_countdown_emitted != Some(seconds_remaining)
                    {
                        self.last_countdown_emitted = Some(seconds_remaining);
                        SilenceState::Warning(seconds_remaining)
                    } else {
                        SilenceState::None
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_silence_can_timeout_before_any_speech() {
        let mut detector = SilenceDetector::new(Duration::from_secs(10), Duration::from_secs(60));
        detector.started_at = Instant::now() - Duration::from_secs(11);
        assert_eq!(detector.update(0.0), SilenceState::InitialTimeout);
    }

    #[test]
    fn pauses_after_speech_use_longer_timeout() {
        let mut detector = SilenceDetector::new(Duration::from_secs(10), Duration::from_secs(60));
        assert_eq!(detector.update(0.02), SilenceState::None);
        detector.last_voice_time = Instant::now() - Duration::from_secs(30);
        assert_eq!(detector.update(0.0), SilenceState::None);
    }

    #[test]
    fn long_pause_after_speech_eventually_times_out() {
        let mut detector = SilenceDetector::new(Duration::from_secs(10), Duration::from_secs(60));
        assert_eq!(detector.update(0.02), SilenceState::None);
        detector.last_voice_time = Instant::now() - Duration::from_secs(61);
        assert_eq!(detector.update(0.0), SilenceState::PostSpeechTimeout);
    }

    #[test]
    fn emits_countdown_during_final_five_seconds() {
        let mut detector = SilenceDetector::new(Duration::from_secs(10), Duration::from_secs(60));
        assert_eq!(detector.update(0.02), SilenceState::None);
        detector.last_voice_time = Instant::now() - Duration::from_millis(55_100);
        assert_eq!(detector.update(0.0), SilenceState::Warning(5));
    }

    #[test]
    fn emits_countdown_during_initial_timeout_window() {
        let mut detector = SilenceDetector::new(Duration::from_secs(10), Duration::from_secs(60));
        detector.started_at = Instant::now() - Duration::from_millis(5_100);
        assert_eq!(detector.update(0.0), SilenceState::Warning(5));
    }
}
