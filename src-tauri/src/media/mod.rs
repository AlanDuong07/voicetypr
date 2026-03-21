//! Media control module for temporarily quieting other media during recording.
//!
//! Uses platform-specific APIs:
//! - macOS: `media-remote` crate (MediaRemote.framework via Perl adapter)
//! - Windows: `windows` crate (GlobalSystemMediaTransportControls)

mod controller;

pub use controller::MediaPauseController;
