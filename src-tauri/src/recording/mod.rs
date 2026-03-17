pub mod escape_handler;
mod hotkeys;
#[cfg(target_os = "macos")]
mod macos_hotkeys;

pub use hotkeys::{handle_global_shortcut, HotkeyTarget, handle_hotkey_target};
#[cfg(target_os = "macos")]
pub use macos_hotkeys::{
    configure_computer_use_hotkey as configure_macos_computer_use_hotkey,
    configure_recording_hotkey as configure_macos_recording_hotkey,
    input_monitoring_granted as macos_input_monitoring_granted,
    init_global_hotkey_listener as init_macos_global_hotkey_listener,
    request_input_monitoring_access as request_macos_input_monitoring_access,
    requires_custom_listener as macos_hotkey_requires_custom_listener,
    validate_shortcut as validate_macos_hotkey,
};
