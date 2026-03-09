use crate::cyberdriver::logger::DebugLogger;
use crate::error::{CyberdriverError, Result};
use tauri::AppHandle;

#[cfg(windows)]
use windows::core::w;
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
  GetKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
  KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, VIRTUAL_KEY, VK_CAPITAL, VK_SPACE,
};

#[cfg(windows)]
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
use tauri::Manager;

pub async fn install_persistent_display(
  app: &AppHandle,
  driver_path: Option<String>,
  logger: &DebugLogger,
) -> Result<()> {
  if !cfg!(windows) {
    return Err(CyberdriverError::RuntimeError(
      "Persistent display is only supported on Windows".into(),
    ));
  }

  #[cfg(windows)]
  {
    logger.log(
      "PERSISTENT_DISPLAY",
      "Install requested",
      &[(
        "driver_path",
        driver_path.clone().unwrap_or_else(|| "none".into()),
      )],
    );
    let driver_dir = match resolve_driver_path(app, driver_path) {
      Ok(path) => path,
      Err(err) => {
        logger.log(
          "PERSISTENT_DISPLAY",
          "Driver path resolve failed",
          &[("error", err.to_string())],
        );
        return Err(err);
      }
    };
    logger.log(
      "PERSISTENT_DISPLAY",
      "Driver path resolved",
      &[("driver_dir", driver_dir.display().to_string())],
    );
    let is_64bit = cfg!(target_pointer_width = "64");
    let installer_name = if is_64bit {
      "deviceinstaller64.exe"
    } else {
      "deviceinstaller.exe"
    };
    let installer = driver_dir.join(installer_name);
    let inf_path = driver_dir.join("usbmmidd.inf");
    if !installer.exists() || !inf_path.exists() {
      logger.log(
        "PERSISTENT_DISPLAY",
        "Driver files missing",
        &[
          ("installer", installer.display().to_string()),
          ("inf", inf_path.display().to_string()),
        ],
      );
      return Err(CyberdriverError::RuntimeError(
        "Amyuni driver files not found".into(),
      ));
    }

    logger.log(
      "PERSISTENT_DISPLAY",
      "Running installer",
      &[("installer", installer.display().to_string())],
    );
    run_elevated(
      installer.clone(),
      format!("install \"{}\" usbmmidd", inf_path.display()),
    )?;
    logger.log(
      "PERSISTENT_DISPLAY",
      "Enabling IDD",
      &[("installer", installer.display().to_string())],
    );
    run_elevated(installer.clone(), "enableidd 1".to_string())?;
    let detected = detect_usb_mobile_monitor();
    logger.log(
      "PERSISTENT_DISPLAY",
      "Device detection",
      &[("usb_mobile_monitor", detected.to_string())],
    );
    logger.info("PERSISTENT_DISPLAY", "Install command completed");
    Ok(())
  }

  #[cfg(not(windows))]
  {
    let _ = app;
    let _ = driver_path;
    let _ = logger;
    Err(CyberdriverError::RuntimeError(
      "Persistent display is only supported on Windows".into(),
    ))
  }
}

#[cfg(windows)]
fn detect_usb_mobile_monitor() -> bool {
  let output = std::process::Command::new("powershell")
    .args([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-PnpDevice -Class Monitor | Where-Object { $_.FriendlyName -like '*USB Mobile Monitor*' } | Select-Object -First 1 -ExpandProperty FriendlyName",
    ])
    .output()
    .ok();
  match output {
    Some(output) if output.status.success() => {
      let text = String::from_utf8_lossy(&output.stdout);
      !text.trim().is_empty()
    }
    _ => false,
  }
}

#[cfg(windows)]
fn resolve_driver_path(app: &AppHandle, driver_path: Option<String>) -> Result<PathBuf> {
  let mut candidates = Vec::new();
  if let Some(path) = driver_path {
    candidates.push(PathBuf::from(path));
  }
  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("amyuni_driver"));
    candidates.push(resource_dir.join("resources").join("amyuni_driver"));
    candidates.push(
      resource_dir
        .join("src-tauri")
        .join("resources")
        .join("amyuni_driver"),
    );
  }
  for candidate in &candidates {
    if candidate.exists() {
      return Ok(candidate.clone());
    }
  }
  let list = candidates
    .iter()
    .map(|p| p.display().to_string())
    .collect::<Vec<_>>()
    .join("; ");
  Err(CyberdriverError::RuntimeError(format!(
    "Amyuni driver resources not found. Tried: {list}"
  )))
}

#[cfg(windows)]
fn run_elevated(exe: PathBuf, args: String) -> Result<()> {
  use std::os::windows::ffi::OsStrExt;
  use windows::core::PCWSTR;

  let exe_wide: Vec<u16> = exe.as_os_str().encode_wide().chain(Some(0)).collect();
  let args_wide: Vec<u16> = std::ffi::OsStr::new(&args).encode_wide().chain(Some(0)).collect();
  let mut info = SHELLEXECUTEINFOW::default();
  info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
  info.fMask = SEE_MASK_NOCLOSEPROCESS;
  info.lpVerb = w!("runas");
  info.lpFile = PCWSTR(exe_wide.as_ptr());
  info.lpParameters = PCWSTR(args_wide.as_ptr());
  info.nShow = SW_SHOWNORMAL.0 as i32;
  unsafe {
    ShellExecuteExW(&mut info).map_err(|err| CyberdriverError::RuntimeError(err.to_string()))?;
  }
  Ok(())
}

#[cfg(windows)]
pub fn caps_lock_is_on() -> bool {
  unsafe { (GetKeyState(VK_CAPITAL.0 as i32) & 0x0001) != 0 }
}

#[cfg(windows)]
pub fn send_scancode(scan_code: u16, key_up: bool) {
  let mut flags = KEYEVENTF_SCANCODE;
  let mut sc = scan_code;
  if sc > 0xFF {
    flags |= KEYEVENTF_EXTENDEDKEY;
    sc &= 0xFF;
  }
  if key_up {
    flags |= KEYEVENTF_KEYUP;
  }
  let input = INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 {
      ki: KEYBDINPUT {
        wVk: VIRTUAL_KEY(0),
        wScan: sc,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
  unsafe {
    let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
  }
}

#[cfg(windows)]
pub fn send_vk_space(key_up: bool) {
  let mut flags = KEYBD_EVENT_FLAGS(0);
  if key_up {
    flags |= KEYEVENTF_KEYUP;
  }
  let input = INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 {
      ki: KEYBDINPUT {
        wVk: VK_SPACE,
        wScan: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
  unsafe {
    let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
  }
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn caps_lock_is_on() -> bool {
  false
}

#[cfg(not(windows))]
pub fn send_scancode(_scan_code: u16, _key_up: bool) {}

#[cfg(not(windows))]
pub fn send_vk_space(_key_up: bool) {}
