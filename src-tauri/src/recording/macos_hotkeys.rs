#![cfg(target_os = "macos")]

use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    EventField, KeyCode,
};
use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, Once};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::ShortcutState;

use super::{handle_hotkey_target, HotkeyTarget};

#[derive(Clone, Debug, Default)]
struct HotkeyConfig {
    recording: Option<HotkeySpec>,
    computer_use: Option<HotkeySpec>,
}

#[derive(Default)]
struct ListenerState {
    pressed_tokens: HashSet<&'static str>,
    recording_active: bool,
    computer_use_active: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HotkeySpec {
    modifier_requirements: Vec<ModifierRequirement>,
    regular_keys: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModifierRequirement {
    CommandAny,
    CommandLeft,
    CommandRight,
    ControlAny,
    ControlLeft,
    ControlRight,
    AltAny,
    AltLeft,
    AltRight,
    ShiftAny,
    ShiftLeft,
    ShiftRight,
    Fn,
}

static HOTKEY_CONFIG: Lazy<Arc<Mutex<HotkeyConfig>>> =
    Lazy::new(|| Arc::new(Mutex::new(HotkeyConfig::default())));
static LISTENER_STATE: Lazy<Arc<Mutex<ListenerState>>> =
    Lazy::new(|| Arc::new(Mutex::new(ListenerState::default())));
static LISTENER_START: Once = Once::new();

const KEY_A: u16 = 0;
const KEY_S: u16 = 1;
const KEY_D: u16 = 2;
const KEY_F: u16 = 3;
const KEY_H: u16 = 4;
const KEY_G: u16 = 5;
const KEY_Z: u16 = 6;
const KEY_X: u16 = 7;
const KEY_C: u16 = 8;
const KEY_V: u16 = 9;
const KEY_B: u16 = 11;
const KEY_Q: u16 = 12;
const KEY_W: u16 = 13;
const KEY_E: u16 = 14;
const KEY_R: u16 = 15;
const KEY_Y: u16 = 16;
const KEY_T: u16 = 17;
const NUM1: u16 = 18;
const NUM2: u16 = 19;
const NUM3: u16 = 20;
const NUM4: u16 = 21;
const NUM6: u16 = 22;
const NUM5: u16 = 23;
const EQUAL: u16 = 24;
const NUM9: u16 = 25;
const NUM7: u16 = 26;
const MINUS: u16 = 27;
const NUM8: u16 = 28;
const NUM0: u16 = 29;
const RIGHT_BRACKET: u16 = 30;
const KEY_O: u16 = 31;
const KEY_U: u16 = 32;
const LEFT_BRACKET: u16 = 33;
const KEY_I: u16 = 34;
const KEY_P: u16 = 35;
const RETURN: u16 = 36;
const KEY_L: u16 = 37;
const KEY_J: u16 = 38;
const QUOTE: u16 = 39;
const KEY_K: u16 = 40;
const SEMI_COLON: u16 = 41;
const BACK_SLASH: u16 = 42;
const COMMA: u16 = 43;
const SLASH: u16 = 44;
const KEY_N: u16 = 45;
const KEY_M: u16 = 46;
const PERIOD: u16 = 47;
const TAB: u16 = 48;
const SPACE: u16 = 49;
const BACK_QUOTE: u16 = 50;
const BACKSPACE: u16 = 51;

pub fn validate_shortcut(shortcut: &str) -> Result<(), String> {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        return Err("Hotkey cannot be empty".to_string());
    }
    if trimmed.len() > 100 {
        return Err("Hotkey is too long".to_string());
    }

    let spec = HotkeySpec::parse(trimmed)?;
    if spec.modifier_requirements.len() + spec.regular_keys.len() > 5 {
        return Err("Maximum 5 keys allowed in combination".to_string());
    }

    Ok(())
}

pub fn requires_custom_listener(shortcut: &str) -> bool {
    let parts = shortcut
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return false;
    }

    let has_side_specific = parts.iter().any(|part| {
        matches!(
            normalize_token(part).as_str(),
            "leftcommand"
                | "rightcommand"
                | "leftcmd"
                | "rightcmd"
                | "leftmeta"
                | "rightmeta"
                | "leftsuper"
                | "rightsuper"
                | "leftcontrol"
                | "rightcontrol"
                | "leftctrl"
                | "rightctrl"
                | "leftalt"
                | "rightalt"
                | "leftoption"
                | "rightoption"
                | "leftshift"
                | "rightshift"
                | "fn"
                | "function"
        )
    });

    let has_non_modifier = parts.iter().any(|part| !is_modifier_token(part));

    has_side_specific || !has_non_modifier
}

pub fn input_monitoring_granted() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightListenEventAccess() -> bool;
    }

    unsafe { CGPreflightListenEventAccess() }
}

pub fn request_input_monitoring_access() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGRequestListenEventAccess() -> bool;
    }

    unsafe { CGRequestListenEventAccess() }
}

pub fn init_global_hotkey_listener(app: AppHandle) {
    LISTENER_START.call_once(move || {
        let app_handle = app.clone();
        let config = Arc::clone(&HOTKEY_CONFIG);
        let state = Arc::clone(&LISTENER_STATE);

        std::thread::spawn(move || {
            log::info!("Starting macOS custom hotkey listener");

            let current = CFRunLoop::get_current();
            let tap = match CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                vec![
                    CGEventType::KeyDown,
                    CGEventType::KeyUp,
                    CGEventType::FlagsChanged,
                ],
                move |_proxy, event_type, event| {
                    handle_event(&app_handle, &config, &state, event_type, event);
                    None
                },
            ) {
                Ok(tap) => tap,
                Err(_) => {
                    log::error!(
                        "Failed to create macOS custom hotkey event tap. Advanced hotkeys require Input Monitoring."
                    );
                    return;
                }
            };

            let loop_source = match tap.mach_port.create_runloop_source(0) {
                Ok(source) => source,
                Err(_) => {
                    log::error!("Failed to create run loop source for macOS custom hotkey listener");
                    return;
                }
            };

            current.add_source(&loop_source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            CFRunLoop::run_current();
        });
    });
}

pub fn configure_recording_hotkey(shortcut: &str) -> Result<(), String> {
    let mut config = HOTKEY_CONFIG
        .lock()
        .map_err(|_| "Failed to update macOS recording hotkey".to_string())?;
    config.recording = if shortcut.trim().is_empty() {
        None
    } else {
        Some(HotkeySpec::parse(shortcut)?)
    };
    if let Ok(mut state) = LISTENER_STATE.lock() {
        state.recording_active = false;
    }
    Ok(())
}

pub fn configure_computer_use_hotkey(shortcut: &str) -> Result<(), String> {
    let mut config = HOTKEY_CONFIG
        .lock()
        .map_err(|_| "Failed to update macOS computer-use hotkey".to_string())?;
    config.computer_use = if shortcut.trim().is_empty() {
        None
    } else {
        Some(HotkeySpec::parse(shortcut)?)
    };
    if let Ok(mut state) = LISTENER_STATE.lock() {
        state.computer_use_active = false;
    }
    Ok(())
}

fn handle_event(
    app: &AppHandle,
    config: &Arc<Mutex<HotkeyConfig>>,
    state: &Arc<Mutex<ListenerState>>,
    event_type: CGEventType,
    event: &core_graphics::event::CGEvent,
) {
    let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;

    let mut listener_state = match state.lock() {
        Ok(guard) => guard,
        Err(error) => {
            log::error!("Custom hotkey state lock poisoned: {}", error);
            return;
        }
    };

    match event_type {
        CGEventType::KeyDown => {
            if event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0 {
                return;
            }
            if let Some(token) = token_for_keycode(keycode) {
                listener_state.pressed_tokens.insert(token);
            }
        }
        CGEventType::KeyUp => {
            if let Some(token) = token_for_keycode(keycode) {
                listener_state.pressed_tokens.remove(token);
            }
        }
        CGEventType::FlagsChanged => {
            if let Some(token) = modifier_token_for_keycode(keycode) {
                if listener_state.pressed_tokens.contains(token) {
                    listener_state.pressed_tokens.remove(token);
                } else {
                    listener_state.pressed_tokens.insert(token);
                }
            }
        }
        _ => return,
    }

    let config_snapshot = match config.lock() {
        Ok(guard) => guard.clone(),
        Err(error) => {
            log::error!("Custom hotkey config lock poisoned: {}", error);
            return;
        }
    };

    let pressed_tokens = listener_state.pressed_tokens.clone();

    update_target_state(
        app,
        HotkeyTarget::Dictation,
        config_snapshot.recording.as_ref(),
        &pressed_tokens,
        &mut listener_state.recording_active,
    );
    update_target_state(
        app,
        HotkeyTarget::ComputerUse,
        config_snapshot.computer_use.as_ref(),
        &pressed_tokens,
        &mut listener_state.computer_use_active,
    );
}

fn update_target_state(
    app: &AppHandle,
    target: HotkeyTarget,
    spec: Option<&HotkeySpec>,
    pressed_tokens: &HashSet<&'static str>,
    active: &mut bool,
) {
    let matches = spec.map(|spec| spec.matches(pressed_tokens)).unwrap_or(false);

    if matches && !*active {
        *active = true;
        handle_hotkey_target(app, target, ShortcutState::Pressed);
    } else if !matches && *active {
        *active = false;
        handle_hotkey_target(app, target, ShortcutState::Released);
    }
}

impl HotkeySpec {
    fn parse(shortcut: &str) -> Result<Self, String> {
        let parts = shortcut
            .split('+')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();

        if parts.is_empty() {
            return Err("Hotkey must include at least one key".to_string());
        }

        let mut modifier_requirements = Vec::new();
        let mut regular_keys = Vec::new();

        for part in parts {
            if let Some(requirement) = parse_modifier_requirement(part) {
                modifier_requirements.push(requirement);
            } else {
                let key = parse_regular_key(part)?;
                if regular_keys.contains(&key) {
                    return Err(format!("Duplicate key in shortcut: {}", part));
                }
                regular_keys.push(key);
            }
        }

        Ok(Self {
            modifier_requirements,
            regular_keys,
        })
    }

    fn matches(&self, pressed_tokens: &HashSet<&'static str>) -> bool {
        let pressed_regular = pressed_tokens
            .iter()
            .copied()
            .filter(|token| !is_modifier_token(token))
            .collect::<HashSet<_>>();

        if self.regular_keys.is_empty() {
            // Modifier-only shortcuts should remain active while the modifier is held,
            // even if the user presses other non-modifier keys. Without this, PTT
            // modifier-only hotkeys flap between released/pressed on every keystroke.
        } else {
            if pressed_regular.len() != self.regular_keys.len() {
                return false;
            }

            if !self
                .regular_keys
                .iter()
                .all(|key| pressed_regular.contains(key.as_str()))
            {
                return false;
            }
        }

        if !self
            .modifier_requirements
            .iter()
            .all(|requirement| requirement.matches(pressed_tokens))
        {
            return false;
        }

        for token in pressed_tokens
            .iter()
            .copied()
            .filter(|token| is_modifier_token(token))
        {
            if !self.allows_modifier_token(token) {
                return false;
            }
        }

        true
    }

    fn allows_modifier_token(&self, token: &str) -> bool {
        self.modifier_requirements
            .iter()
            .any(|requirement| requirement.allows(token))
    }
}

impl ModifierRequirement {
    fn matches(&self, pressed_tokens: &HashSet<&'static str>) -> bool {
        pressed_tokens.iter().copied().any(|token| self.allows(token))
    }

    fn allows(&self, token: &str) -> bool {
        match self {
            ModifierRequirement::CommandAny => {
                matches!(token, "LeftCommand" | "RightCommand")
            }
            ModifierRequirement::CommandLeft => token == "LeftCommand",
            ModifierRequirement::CommandRight => token == "RightCommand",
            ModifierRequirement::ControlAny => {
                matches!(token, "LeftControl" | "RightControl")
            }
            ModifierRequirement::ControlLeft => token == "LeftControl",
            ModifierRequirement::ControlRight => token == "RightControl",
            ModifierRequirement::AltAny => matches!(token, "LeftAlt" | "RightAlt"),
            ModifierRequirement::AltLeft => token == "LeftAlt",
            ModifierRequirement::AltRight => token == "RightAlt",
            ModifierRequirement::ShiftAny => {
                matches!(token, "LeftShift" | "RightShift")
            }
            ModifierRequirement::ShiftLeft => token == "LeftShift",
            ModifierRequirement::ShiftRight => token == "RightShift",
            ModifierRequirement::Fn => token == "Fn",
        }
    }
}

fn parse_modifier_requirement(part: &str) -> Option<ModifierRequirement> {
    match normalize_token(part).as_str() {
        "commandorcontrol" | "command" | "cmd" | "super" | "meta" => {
            Some(ModifierRequirement::CommandAny)
        }
        "leftcommand" | "leftcmd" | "leftsuper" | "leftmeta" => {
            Some(ModifierRequirement::CommandLeft)
        }
        "rightcommand" | "rightcmd" | "rightsuper" | "rightmeta" => {
            Some(ModifierRequirement::CommandRight)
        }
        "control" | "ctrl" => Some(ModifierRequirement::ControlAny),
        "leftcontrol" | "leftctrl" => Some(ModifierRequirement::ControlLeft),
        "rightcontrol" | "rightctrl" => Some(ModifierRequirement::ControlRight),
        "alt" | "option" => Some(ModifierRequirement::AltAny),
        "leftalt" | "leftoption" => Some(ModifierRequirement::AltLeft),
        "rightalt" | "rightoption" | "altgr" => Some(ModifierRequirement::AltRight),
        "shift" => Some(ModifierRequirement::ShiftAny),
        "leftshift" => Some(ModifierRequirement::ShiftLeft),
        "rightshift" => Some(ModifierRequirement::ShiftRight),
        "fn" | "function" => Some(ModifierRequirement::Fn),
        _ => None,
    }
}

fn parse_regular_key(part: &str) -> Result<String, String> {
    let normalized = normalize_token(part);
    let token = match normalized.as_str() {
        "a" => "A",
        "b" => "B",
        "c" => "C",
        "d" => "D",
        "e" => "E",
        "f" => "F",
        "g" => "G",
        "h" => "H",
        "i" => "I",
        "j" => "J",
        "k" => "K",
        "l" => "L",
        "m" => "M",
        "n" => "N",
        "o" => "O",
        "p" => "P",
        "q" => "Q",
        "r" => "R",
        "s" => "S",
        "t" => "T",
        "u" => "U",
        "v" => "V",
        "w" => "W",
        "x" => "X",
        "y" => "Y",
        "z" => "Z",
        "0" => "0",
        "1" => "1",
        "2" => "2",
        "3" => "3",
        "4" => "4",
        "5" => "5",
        "6" => "6",
        "7" => "7",
        "8" => "8",
        "9" => "9",
        "space" => "Space",
        "enter" | "return" => "Return",
        "tab" => "Tab",
        "escape" | "esc" => "Escape",
        "backspace" => "Backspace",
        "delete" => "Delete",
        "home" => "Home",
        "end" => "End",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "up" | "arrowup" => "Up",
        "down" | "arrowdown" => "Down",
        "left" | "arrowleft" => "Left",
        "right" | "arrowright" => "Right",
        "minus" => "Minus",
        "equal" | "plus" => "Equal",
        "comma" => "Comma",
        "period" | "dot" => "Period",
        "semicolon" => "Semicolon",
        "quote" => "Quote",
        "bracketleft" => "BracketLeft",
        "bracketright" => "BracketRight",
        "backslash" => "Backslash",
        "slash" => "Slash",
        "backquote" | "grave" => "Backquote",
        "capslock" => "CapsLock",
        "numlock" => "NumLock",
        "scrolllock" => "ScrollLock",
        "printscreen" => "PrintScreen",
        "insert" => "Insert",
        "pause" => "Pause",
        _ => {
            if let Some(function_key) = parse_function_key(&normalized) {
                function_key
            } else {
                return Err(format!("Unsupported key: {}", part));
            }
        }
    };

    Ok(token.to_string())
}

fn parse_function_key(normalized: &str) -> Option<&'static str> {
    match normalized {
        "f1" => Some("F1"),
        "f2" => Some("F2"),
        "f3" => Some("F3"),
        "f4" => Some("F4"),
        "f5" => Some("F5"),
        "f6" => Some("F6"),
        "f7" => Some("F7"),
        "f8" => Some("F8"),
        "f9" => Some("F9"),
        "f10" => Some("F10"),
        "f11" => Some("F11"),
        "f12" => Some("F12"),
        _ => None,
    }
}

fn normalize_token(token: &str) -> String {
    token
        .trim()
        .to_lowercase()
        .replace([' ', '-', '_'], "")
}

fn token_for_keycode(keycode: u16) -> Option<&'static str> {
    match keycode {
        SPACE => Some("Space"),
        RETURN => Some("Return"),
        TAB => Some("Tab"),
        code if code == KeyCode::ESCAPE => Some("Escape"),
        BACKSPACE => Some("Backspace"),
        code if code == KeyCode::FORWARD_DELETE => Some("Delete"),
        code if code == KeyCode::HOME => Some("Home"),
        code if code == KeyCode::END => Some("End"),
        code if code == KeyCode::PAGE_UP => Some("PageUp"),
        code if code == KeyCode::PAGE_DOWN => Some("PageDown"),
        code if code == KeyCode::UP_ARROW => Some("Up"),
        code if code == KeyCode::DOWN_ARROW => Some("Down"),
        code if code == KeyCode::LEFT_ARROW => Some("Left"),
        code if code == KeyCode::RIGHT_ARROW => Some("Right"),
        code if code == KeyCode::CAPS_LOCK => Some("CapsLock"),
        code if code == KeyCode::F1 => Some("F1"),
        code if code == KeyCode::F2 => Some("F2"),
        code if code == KeyCode::F3 => Some("F3"),
        code if code == KeyCode::F4 => Some("F4"),
        code if code == KeyCode::F5 => Some("F5"),
        code if code == KeyCode::F6 => Some("F6"),
        code if code == KeyCode::F7 => Some("F7"),
        code if code == KeyCode::F8 => Some("F8"),
        code if code == KeyCode::F9 => Some("F9"),
        code if code == KeyCode::F10 => Some("F10"),
        code if code == KeyCode::F11 => Some("F11"),
        code if code == KeyCode::F12 => Some("F12"),
        BACK_QUOTE => Some("Backquote"),
        MINUS => Some("Minus"),
        EQUAL => Some("Equal"),
        COMMA => Some("Comma"),
        PERIOD => Some("Period"),
        SEMI_COLON => Some("Semicolon"),
        QUOTE => Some("Quote"),
        LEFT_BRACKET => Some("BracketLeft"),
        RIGHT_BRACKET => Some("BracketRight"),
        BACK_SLASH => Some("Backslash"),
        SLASH => Some("Slash"),
        NUM0 => Some("0"),
        NUM1 => Some("1"),
        NUM2 => Some("2"),
        NUM3 => Some("3"),
        NUM4 => Some("4"),
        NUM5 => Some("5"),
        NUM6 => Some("6"),
        NUM7 => Some("7"),
        NUM8 => Some("8"),
        NUM9 => Some("9"),
        KEY_A => Some("A"),
        KEY_B => Some("B"),
        KEY_C => Some("C"),
        KEY_D => Some("D"),
        KEY_E => Some("E"),
        KEY_F => Some("F"),
        KEY_G => Some("G"),
        KEY_H => Some("H"),
        KEY_I => Some("I"),
        KEY_J => Some("J"),
        KEY_K => Some("K"),
        KEY_L => Some("L"),
        KEY_M => Some("M"),
        KEY_N => Some("N"),
        KEY_O => Some("O"),
        KEY_P => Some("P"),
        KEY_Q => Some("Q"),
        KEY_R => Some("R"),
        KEY_S => Some("S"),
        KEY_T => Some("T"),
        KEY_U => Some("U"),
        KEY_V => Some("V"),
        KEY_W => Some("W"),
        KEY_X => Some("X"),
        KEY_Y => Some("Y"),
        KEY_Z => Some("Z"),
        _ => modifier_token_for_keycode(keycode),
    }
}

fn modifier_token_for_keycode(keycode: u16) -> Option<&'static str> {
    match keycode {
        code if code == KeyCode::COMMAND => Some("LeftCommand"),
        code if code == KeyCode::RIGHT_COMMAND => Some("RightCommand"),
        code if code == KeyCode::CONTROL => Some("LeftControl"),
        code if code == KeyCode::RIGHT_CONTROL => Some("RightControl"),
        code if code == KeyCode::OPTION => Some("LeftAlt"),
        code if code == KeyCode::RIGHT_OPTION => Some("RightAlt"),
        code if code == KeyCode::SHIFT => Some("LeftShift"),
        code if code == KeyCode::RIGHT_SHIFT => Some("RightShift"),
        code if code == KeyCode::FUNCTION => Some("Fn"),
        _ => None,
    }
}

fn is_modifier_token(token: &str) -> bool {
    matches!(
        token,
        "LeftCommand"
            | "RightCommand"
            | "LeftControl"
            | "RightControl"
            | "LeftAlt"
            | "RightAlt"
            | "LeftShift"
            | "RightShift"
            | "Fn"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pressed(tokens: &[&'static str]) -> HashSet<&'static str> {
        tokens.iter().copied().collect()
    }

    #[test]
    fn parses_modifier_only_hotkey() {
        let spec = HotkeySpec::parse("RightCommand").unwrap();
        assert!(spec.matches(&pressed(&["RightCommand"])));
        assert!(!spec.matches(&pressed(&["LeftCommand"])));
    }

    #[test]
    fn modifier_only_hotkey_stays_matched_with_extra_regular_keys() {
        let spec = HotkeySpec::parse("RightCommand").unwrap();
        assert!(spec.matches(&pressed(&["RightCommand", "A"])));
        assert!(spec.matches(&pressed(&["RightCommand", "A", "B"])));
        assert!(!spec.matches(&pressed(&["LeftCommand", "A"])));
        assert!(!spec.matches(&pressed(&["RightCommand", "LeftShift"])));
    }

    #[test]
    fn parses_side_specific_combo() {
        let spec = HotkeySpec::parse("RightAlt+P").unwrap();
        assert!(spec.matches(&pressed(&["RightAlt", "P"])));
        assert!(!spec.matches(&pressed(&["LeftAlt", "P"])));
        assert!(!spec.matches(&pressed(&["RightAlt", "P", "LeftShift"])));
    }

    #[test]
    fn generic_command_matches_both_sides() {
        let spec = HotkeySpec::parse("CommandOrControl+Shift+Space").unwrap();
        assert!(spec.matches(&pressed(&["LeftCommand", "LeftShift", "Space"])));
        assert!(spec.matches(&pressed(&["RightCommand", "RightShift", "Space"])));
    }
}
