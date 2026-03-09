use serde_json::json;
use sysinfo::ProcessesToUpdate;

pub fn collect() -> serde_json::Value {
  let pid = sysinfo::Pid::from(std::process::id() as usize);
  let mut system = sysinfo::System::new();
  let processes = [pid];
  system.refresh_processes(ProcessesToUpdate::Some(&processes), false);
  let mut diagnostics = json!({
    "pid": std::process::id(),
    "psutil": "not_applicable",
    "open_files": serde_json::Value::Null,
    "num_fds": serde_json::Value::Null,
    "connections": serde_json::Value::Null,
  });
  if let Some(proc) = system.process(pid) {
    diagnostics["memory_bytes"] = json!(proc.memory());
    diagnostics["virtual_memory_bytes"] = json!(proc.virtual_memory());
    diagnostics["cpu_usage"] = json!(proc.cpu_usage());
    diagnostics["start_time"] = json!(proc.start_time());
    diagnostics["memory_mb"] = json!(proc.memory() as f64 / (1024.0 * 1024.0));
  }

  #[cfg(windows)]
  {
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;
    unsafe {
      let handle = GetCurrentProcess();
      let mut mem = PROCESS_MEMORY_COUNTERS::default();
      if GetProcessMemoryInfo(
        handle,
        &mut mem,
        std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
      )
      .is_ok()
      {
        diagnostics["working_set_bytes"] = json!(mem.WorkingSetSize);
      }
    }
  }

  diagnostics
}
