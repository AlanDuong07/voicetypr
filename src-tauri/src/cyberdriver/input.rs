use std::time::Duration;

use device_query::{DeviceQuery, DeviceState};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse};
use tokio::sync::{Mutex, oneshot};
use tauri::AppHandle;

use crate::error::{CyberdriverError, Result};

use super::windows;

#[derive(Clone, Debug)]
pub struct MousePosition {
  pub x: i32,
  pub y: i32,
}

#[derive(Clone, Debug)]
pub struct KeyEvent {
  pub key: String,
  pub down: bool,
}

pub fn parse_xdo_sequence(sequence: &str) -> Vec<Vec<KeyEvent>> {
  let commands = sequence.trim().split_whitespace();
  let mut result = Vec::new();
  for command in commands {
    let mut events = Vec::new();
    let parts = command.split('+').map(|p| p.to_lowercase()).collect::<Vec<_>>();
    let modifiers = parts
      .iter()
      .filter(|p| matches!(p.as_str(), "ctrl" | "alt" | "shift" | "win" | "cmd" | "super" | "meta"))
      .cloned()
      .collect::<Vec<_>>();
    let keys = parts
      .iter()
      .filter(|p| !matches!(p.as_str(), "ctrl" | "alt" | "shift" | "win" | "cmd" | "super" | "meta"))
      .cloned()
      .collect::<Vec<_>>();
    for m in &modifiers {
      events.push(KeyEvent { key: m.clone(), down: true });
    }
    for k in &keys {
      events.push(KeyEvent { key: k.clone(), down: true });
      events.push(KeyEvent { key: k.clone(), down: false });
    }
    for m in modifiers.into_iter().rev() {
      events.push(KeyEvent { key: m, down: false });
    }
    result.push(events);
  }
  result
}

pub async fn ensure_capslock_off() -> Result<()> {
  #[cfg(windows)]
  {
    if windows::caps_lock_is_on() {
      windows::send_scancode(0x3A, false);
      windows::send_scancode(0x3A, true);
      std::thread::sleep(Duration::from_millis(50));
    }
    Ok(())
  }
  #[cfg(target_os = "linux")]
  {
    let output = std::process::Command::new("xset")
      .arg("q")
      .output()
      .ok()
      .and_then(|o| String::from_utf8(o.stdout).ok());
    if let Some(out) = output {
      if out.contains("Caps Lock:   on") || out.contains("Caps Lock: on") {
        let mut enigo = Enigo::new(&enigo::Settings::default())?;
        enigo.key(Key::CapsLock, Direction::Click)?;
      }
    }
    Ok(())
  }
  #[cfg(all(not(windows), not(target_os = "linux")))]
  {
    Ok(())
  }
}

pub async fn type_text(
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  text: &str,
  experimental_space: bool,
) -> Result<()> {
  ensure_capslock_off().await?;
  if cfg!(windows) {
    if type_with_scancodes(text, experimental_space) {
      return Ok(());
    }
  }
  let mut enigo = enigo.lock().await;
  enigo.text(text)?;
  Ok(())
}

pub async fn execute_xdo_sequence(
  app: Option<&AppHandle>,
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  sequence: &str,
  experimental_space: bool,
) -> Result<()> {
  if cfg!(windows) {
    let groups = parse_xdo_sequence(sequence);
    for group in groups {
      for event in group {
        let key = normalize_key(&event.key);
        press_key_with_scancode(&key, !event.down, experimental_space)?;
      }
    }
    return Ok(());
  }
  if cfg!(target_os = "macos") {
    let app = app
      .cloned()
      .ok_or_else(|| CyberdriverError::RuntimeError("Missing app handle".into()))?;
    let enigo = std::sync::Arc::clone(enigo);
    let sequence = sequence.to_string();
    let experimental_space = experimental_space;
    return run_on_main_thread(&app, move || {
      let mut enigo = tauri::async_runtime::block_on(enigo.lock());
      execute_xdo_sequence_inner(&mut enigo, &sequence, experimental_space)
    })
    .await;
  }
  let mut enigo = enigo.lock().await;
  execute_xdo_sequence_inner(&mut enigo, sequence, experimental_space)
}

pub async fn mouse_position() -> Result<MousePosition> {
  let state = DeviceState::new();
  let mouse = state.get_mouse();
  Ok(MousePosition { x: mouse.coords.0, y: mouse.coords.1 })
}

pub async fn move_mouse(
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  x: i32,
  y: i32,
) -> Result<()> {
  let mut enigo = enigo.lock().await;
  enigo.move_mouse(x, y, Coordinate::Abs)?;
  Ok(())
}

pub async fn mouse_click(
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  x: Option<i32>,
  y: Option<i32>,
  button: Button,
  press: bool,
  release: bool,
  clicks: u8,
) -> Result<()> {
  let mut enigo = enigo.lock().await;
  let moved = if let (Some(x), Some(y)) = (x, y) {
    enigo.move_mouse(x, y, Coordinate::Abs)?;
    true
  } else {
    false
  };
  if moved {
    std::thread::sleep(Duration::from_millis(14));
  }
  if clicks > 0 {
    for _ in 0..clicks {
      enigo.button(button, Direction::Press)?;
      std::thread::sleep(Duration::from_millis(24));
      enigo.button(button, Direction::Release)?;
      std::thread::sleep(Duration::from_millis(80));
    }
    return Ok(());
  }
  if press && release {
    enigo.button(button, Direction::Press)?;
    std::thread::sleep(Duration::from_millis(24));
    enigo.button(button, Direction::Release)?;
    return Ok(());
  }
  if press {
    enigo.button(button, Direction::Press)?;
  }
  if release {
    enigo.button(button, Direction::Release)?;
  }
  Ok(())
}

pub async fn mouse_drag(
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  start_x: i32,
  start_y: i32,
  end_x: i32,
  end_y: i32,
  button: Button,
  duration: Option<f64>,
) -> Result<()> {
  let mut enigo = enigo.lock().await;
  enigo.move_mouse(start_x, start_y, Coordinate::Abs)?;
  std::thread::sleep(Duration::from_millis(20));
  enigo.button(button, Direction::Press)?;
  std::thread::sleep(Duration::from_millis(20));
  if let Some(duration) = duration.filter(|d| *d > 0.0) {
    let steps = (duration * 60.0).max(1.0) as i32;
    for i in 1..=steps {
      let t = i as f64 / steps as f64;
      let x = start_x as f64 + (end_x - start_x) as f64 * t;
      let y = start_y as f64 + (end_y - start_y) as f64 * t;
      enigo.move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)?;
      std::thread::sleep(Duration::from_secs_f64(duration / steps as f64));
    }
  } else {
    enigo.move_mouse(end_x, end_y, Coordinate::Abs)?;
  }
  std::thread::sleep(Duration::from_millis(20));
  enigo.button(button, Direction::Release)?;
  Ok(())
}

pub async fn mouse_scroll(
  enigo: &std::sync::Arc<Mutex<Enigo>>,
  direction: &str,
  amount: i32,
  x: Option<i32>,
  y: Option<i32>,
) -> Result<()> {
  if amount == 0 {
    return Ok(());
  }
  let mut enigo = enigo.lock().await;
  if let (Some(x), Some(y)) = (x, y) {
    enigo.move_mouse(x, y, Coordinate::Abs)?;
  }
  match direction {
    "up" => enigo.scroll(amount, Axis::Vertical)?,
    "down" => enigo.scroll(-amount, Axis::Vertical)?,
    "left" => enigo.scroll(-amount, Axis::Horizontal)?,
    "right" => enigo.scroll(amount, Axis::Horizontal)?,
    _ => {
      return Err(CyberdriverError::RuntimeError(
        "Invalid scroll direction".into(),
      ))
    }
  }
  Ok(())
}

fn normalize_key(key: &str) -> String {
  key.to_lowercase().replace('_', "")
}

fn execute_xdo_sequence_inner(
  enigo: &mut Enigo,
  sequence: &str,
  _experimental_space: bool,
) -> Result<()> {
  let groups = parse_xdo_sequence(sequence);
  let mut modifier_pressed = false;
  for group in groups {
    for event in group {
      let key_name = normalize_key(&event.key);
      let is_modifier = is_modifier_key(&key_name);
      if let Some(key) = map_key_to_enigo(&key_name) {
        if is_modifier {
          let direction = if event.down { Direction::Press } else { Direction::Release };
          safe_key(enigo, key, direction)?;
          if event.down {
            modifier_pressed = true;
            std::thread::sleep(Duration::from_millis(8));
          }
        } else if event.down {
          if modifier_pressed {
            std::thread::sleep(Duration::from_millis(6));
          }
          safe_key(enigo, key, Direction::Click)?;
        }
      }
    }
  }
  Ok(())
}

fn is_modifier_key(key: &str) -> bool {
  matches!(
    key,
    "ctrl"
      | "control"
      | "shift"
      | "alt"
      | "option"
      | "cmd"
      | "command"
      | "win"
      | "windows"
      | "super"
      | "meta"
  )
}

fn safe_key(enigo: &mut Enigo, key: Key, direction: Direction) -> Result<()> {
  let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    enigo.key(key, direction)
  }));
  match result {
    Ok(res) => res.map_err(|err| CyberdriverError::RuntimeError(err.to_string())),
    Err(_) => Err(CyberdriverError::RuntimeError(
      "Keyboard simulation panicked".into(),
    )),
  }
}

async fn run_on_main_thread<R>(
  app: &AppHandle,
  task: impl FnOnce() -> Result<R> + Send + 'static,
) -> Result<R>
where
  R: Send + 'static,
{
  let (tx, rx) = oneshot::channel();
  app
    .run_on_main_thread(move || {
      let _ = tx.send(task());
    })
    .map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
  rx
    .await
    .map_err(|_| CyberdriverError::RuntimeError("Main thread task cancelled".into()))?
}

fn map_key_to_enigo(key: &str) -> Option<Key> {
  let key = normalize_key(key);
  let mapped = match key.as_str() {
    "ctrl" | "control" => Key::Control,
    "alt" => Key::Alt,
    "shift" => Key::Shift,
    "cmd" | "win" | "super" | "meta" => Key::Meta,
    "enter" | "return" => Key::Return,
    "esc" | "escape" => Key::Escape,
    "tab" => Key::Tab,
    "backspace" => Key::Backspace,
    "delete" => Key::Delete,
    "home" => Key::Home,
    "end" => Key::End,
    "pageup" | "pgup" => Key::PageUp,
    "pagedown" | "pgdn" => Key::PageDown,
    "left" => Key::LeftArrow,
    "right" => Key::RightArrow,
    "up" => Key::UpArrow,
    "down" => Key::DownArrow,
    "space" => Key::Space,
    "f1" => Key::F1,
    "f2" => Key::F2,
    "f3" => Key::F3,
    "f4" => Key::F4,
    "f5" => Key::F5,
    "f6" => Key::F6,
    "f7" => Key::F7,
    "f8" => Key::F8,
    "f9" => Key::F9,
    "f10" => Key::F10,
    "f11" => Key::F11,
    "f12" => Key::F12,
    _ => {
      let mut chars = key.chars();
      if let Some(c) = chars.next() {
        return Some(Key::Unicode(c));
      }
      return None;
    }
  };
  Some(mapped)
}

fn type_with_scancodes(text: &str, experimental_space: bool) -> bool {
  if !cfg!(windows) {
    return false;
  }
  for ch in text.chars() {
    if ch == ' ' && experimental_space {
      windows::send_vk_space(false);
      windows::send_vk_space(true);
      continue;
    }
    let upper = ch.to_ascii_uppercase();
    let (scan_code, needs_shift) = if let Some(base) = shift_map(ch) {
      (scancode_for_char(base), true)
    } else if ch.is_ascii_uppercase() {
      (scancode_for_char(upper), true)
    } else {
      (scancode_for_char(ch), false)
    };
    if let Some(code) = scan_code {
      if needs_shift {
        windows::send_scancode(0x2A, false);
      }
      windows::send_scancode(code, false);
      windows::send_scancode(code, true);
      if needs_shift {
        windows::send_scancode(0x2A, true);
      }
    }
  }
  true
}

fn press_key_with_scancode(key: &str, key_up: bool, experimental_space: bool) -> Result<()> {
  if !cfg!(windows) {
    return Err(CyberdriverError::RuntimeError("Scancodes only supported on Windows".into()));
  }
  let key = normalize_key(key);
  if key == "space" && experimental_space {
    windows::send_vk_space(key_up);
    return Ok(());
  }
  if let Some(code) = scancode_for_key(&key) {
    windows::send_scancode(code, key_up);
    Ok(())
  } else {
    Err(CyberdriverError::RuntimeError(format!("Unknown key: {key}")))
  }
}

fn scancode_for_char(ch: char) -> Option<u16> {
  let ch = ch.to_ascii_uppercase();
  match ch {
    'A' => Some(0x1E),
    'B' => Some(0x30),
    'C' => Some(0x2E),
    'D' => Some(0x20),
    'E' => Some(0x12),
    'F' => Some(0x21),
    'G' => Some(0x22),
    'H' => Some(0x23),
    'I' => Some(0x17),
    'J' => Some(0x24),
    'K' => Some(0x25),
    'L' => Some(0x26),
    'M' => Some(0x32),
    'N' => Some(0x31),
    'O' => Some(0x18),
    'P' => Some(0x19),
    'Q' => Some(0x10),
    'R' => Some(0x13),
    'S' => Some(0x1F),
    'T' => Some(0x14),
    'U' => Some(0x16),
    'V' => Some(0x2F),
    'W' => Some(0x11),
    'X' => Some(0x2D),
    'Y' => Some(0x15),
    'Z' => Some(0x2C),
    '1' => Some(0x02),
    '2' => Some(0x03),
    '3' => Some(0x04),
    '4' => Some(0x05),
    '5' => Some(0x06),
    '6' => Some(0x07),
    '7' => Some(0x08),
    '8' => Some(0x09),
    '9' => Some(0x0A),
    '0' => Some(0x0B),
    '-' => Some(0x0C),
    '=' => Some(0x0D),
    '[' => Some(0x1A),
    ']' => Some(0x1B),
    ';' => Some(0x27),
    '\'' => Some(0x28),
    '`' => Some(0x29),
    '\\' => Some(0x2B),
    ',' => Some(0x33),
    '.' => Some(0x34),
    '/' => Some(0x35),
    ' ' => Some(0x39),
    '\t' => Some(0x0F),
    '\n' => Some(0x1C),
    _ => None,
  }
}

fn scancode_for_key(key: &str) -> Option<u16> {
  let key = normalize_key(key);
  let code = match key.as_str() {
    "shift" => 0x2A,
    "lshift" => 0x2A,
    "rshift" => 0x36,
    "ctrl" | "control" | "lcontrol" => 0x1D,
    "rcontrol" => 0xE01D,
    "alt" | "lalt" => 0x38,
    "ralt" => 0xE038,
    "win" | "windows" | "lwin" | "super" | "cmd" => 0xE05B,
    "rwin" => 0xE05C,
    "escape" | "esc" => 0x01,
    "backspace" => 0x0E,
    "tab" => 0x0F,
    "enter" | "return" => 0x1C,
    "space" => 0x39,
    "capslock" => 0x3A,
    "home" => 0xE047,
    "end" => 0xE04F,
    "pageup" => 0xE049,
    "pagedown" => 0xE051,
    "insert" => 0xE052,
    "delete" => 0xE053,
    "up" | "uparrow" => 0xE048,
    "down" | "downarrow" => 0xE050,
    "left" | "leftarrow" => 0xE04B,
    "right" | "rightarrow" => 0xE04D,
    "f1" => 0x3B,
    "f2" => 0x3C,
    "f3" => 0x3D,
    "f4" => 0x3E,
    "f5" => 0x3F,
    "f6" => 0x40,
    "f7" => 0x41,
    "f8" => 0x42,
    "f9" => 0x43,
    "f10" => 0x44,
    "f11" => 0x57,
    "f12" => 0x58,
    _ => return scancode_for_char(key.chars().next()?),
  };
  Some(code)
}

fn shift_map(ch: char) -> Option<char> {
  match ch {
    '!' => Some('1'),
    '@' => Some('2'),
    '#' => Some('3'),
    '$' => Some('4'),
    '%' => Some('5'),
    '^' => Some('6'),
    '&' => Some('7'),
    '*' => Some('8'),
    '(' => Some('9'),
    ')' => Some('0'),
    '_' => Some('-'),
    '+' => Some('='),
    '{' => Some('['),
    '}' => Some(']'),
    ':' => Some(';'),
    '"' => Some('\''),
    '~' => Some('`'),
    '|' => Some('\\'),
    '<' => Some(','),
    '>' => Some('.'),
    '?' => Some('/'),
    _ => None,
  }
}
