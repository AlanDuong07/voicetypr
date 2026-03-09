use std::{
  fs::{self, OpenOptions},
  io::Write,
  path::PathBuf,
  sync::atomic::{AtomicBool, Ordering},
  sync::Arc,
};

use chrono::Utc;

use crate::error::{CyberdriverError, Result};

#[derive(Clone)]
pub struct DebugLogger {
  enabled: Arc<AtomicBool>,
  log_dir: PathBuf,
}

impl DebugLogger {
  pub fn new(enabled: bool) -> Result<Self> {
    let log_dir = super::config::get_config_dir().join("logs");
    fs::create_dir_all(&log_dir)?;
    Ok(Self {
      enabled: Arc::new(AtomicBool::new(enabled)),
      log_dir,
    })
  }

  pub fn set_enabled(&self, enabled: bool) -> Result<()> {
    self.enabled.store(enabled, Ordering::Relaxed);
    if enabled {
      fs::create_dir_all(&self.log_dir)?;
    }
    Ok(())
  }

  fn log_file_path(&self) -> PathBuf {
    let date = Utc::now().format("%Y-%m-%d").to_string();
    self.log_dir.join(format!("cyberdriver-{date}.log"))
  }

  fn write_line(&self, line: &str) {
    if !self.enabled.load(Ordering::Relaxed) {
      return;
    }
    let path = self.log_file_path();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
      let _ = writeln!(file, "{line}");
    }
  }

  pub fn log(&self, category: &str, message: &str, fields: &[(&str, String)]) {
    if !self.enabled.load(Ordering::Relaxed) {
      return;
    }
    let timestamp = Utc::now().to_rfc3339();
    let mut line = format!("[{timestamp}] [{category}] {message}");
    for (key, value) in fields {
      line.push_str(&format!(" {key}={value}"));
    }
    self.write_line(&line);
  }

  pub fn info(&self, category: &str, message: &str) {
    self.log(category, message, &[]);
  }

  #[allow(dead_code)]
  pub fn warning(&self, category: &str, message: &str) {
    self.log(category, message, &[]);
  }

  #[allow(dead_code)]
  pub fn error(&self, category: &str, message: &str) {
    self.log(category, message, &[]);
  }

  pub fn connection_attempt(&self, uri: &str, attempt: usize) {
    self.log(
      "CONNECTION",
      "Attempt",
      &[("uri", uri.to_string()), ("attempt", attempt.to_string())],
    );
  }

  pub fn connection_established(&self, uri: &str) {
    self.log("CONNECTION", "Established", &[("uri", uri.to_string())]);
  }

  pub fn connection_closed(&self, reason: &str, duration: f64, close_code: Option<u16>) {
    self.log(
      "CONNECTION",
      "Closed",
      &[
        ("reason", reason.to_string()),
        ("duration_s", format!("{duration:.2}")),
        ("close_code", close_code.map(|c| c.to_string()).unwrap_or_else(|| "None".into())),
      ],
    );
  }

  pub fn request_forwarded(&self, method: &str, path: &str, status: u16, duration_ms: f64) {
    self.log(
      "REQUEST",
      "Forwarded",
      &[
        ("method", method.to_string()),
        ("path", path.to_string()),
        ("status", status.to_string()),
        ("duration_ms", format!("{duration_ms:.1}")),
      ],
    );
  }

  #[allow(dead_code)]
  pub fn resource_stats(&self) {
    if !self.enabled.load(Ordering::Relaxed) {
      return;
    }
    let mut info = vec![];
    let pid = sysinfo::Pid::from(std::process::id() as usize);
    let mut system = sysinfo::System::new();
    let processes = [pid];
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&processes), false);
    if let Some(proc) = system.process(pid) {
      info.push(("memory_bytes", proc.memory().to_string()));
      info.push(("virtual_bytes", proc.virtual_memory().to_string()));
      info.push(("cpu_usage", format!("{:.2}", proc.cpu_usage())));
    }
    let timestamp = Utc::now().to_rfc3339();
    let mut line = format!("[{timestamp}] [RESOURCE] stats");
    for (key, value) in info {
      line.push_str(&format!(" {key}={value}"));
    }
    self.write_line(&line);
  }

  #[allow(dead_code)]
  pub fn log_error_to_file(&self, filename: &str, context: &str, message: &str) {
    if !self.enabled.load(Ordering::Relaxed) {
      return;
    }
    let timestamp = Utc::now().to_rfc3339();
    let path = super::config::get_config_dir().join(filename);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
      let _ = writeln!(file, "[{timestamp}] {context}");
      let _ = writeln!(file, "{message}");
    }
  }

  #[allow(dead_code)]
  pub fn ensure_log_dir(&self) -> Result<()> {
    fs::create_dir_all(&self.log_dir).map_err(|err| CyberdriverError::RuntimeError(err.to_string()))
  }
}
