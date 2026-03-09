use std::{
  sync::Arc,
  time::{Duration, Instant},
};

use rand::seq::SliceRandom;
use tauri::async_runtime::JoinHandle;
use tokio::sync::{Mutex, Notify};

use enigo::{Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

use crate::error::Result;

#[derive(Clone)]
pub struct KeepAliveManager {
  state: Arc<Mutex<KeepAliveState>>,
  schedule_notify: Arc<Notify>,
  idle_notify: Arc<Notify>,
  task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

struct KeepAliveState {
  enabled: bool,
  threshold_seconds: f64,
  last_activity: Instant,
  next_allowed: Instant,
  busy: bool,
  click_x: Option<i32>,
  click_y: Option<i32>,
  stop: bool,
}

impl KeepAliveManager {
  pub fn new(
    enabled: bool,
    threshold_minutes: f64,
    click_x: Option<i32>,
    click_y: Option<i32>,
  ) -> Arc<Self> {
    let threshold_seconds = (threshold_minutes.max(0.1)) * 60.0;
    let now = Instant::now();
    Arc::new(Self {
      state: Arc::new(Mutex::new(KeepAliveState {
        enabled,
        threshold_seconds,
        last_activity: now,
        next_allowed: now + Duration::from_secs_f64(threshold_seconds),
        busy: false,
        click_x,
        click_y,
        stop: false,
      })),
      schedule_notify: Arc::new(Notify::new()),
      idle_notify: Arc::new(Notify::new()),
      task: Arc::new(Mutex::new(None)),
    })
  }

  pub async fn update_config(
    &self,
    enabled: bool,
    threshold_minutes: f64,
    click_x: Option<i32>,
    click_y: Option<i32>,
  ) {
    let mut state = self.state.lock().await;
    state.enabled = enabled;
    state.threshold_seconds = (threshold_minutes.max(0.1)) * 60.0;
    state.click_x = click_x;
    state.click_y = click_y;
    state.next_allowed = Instant::now() + Duration::from_secs_f64(state.threshold_seconds);
    self.schedule_notify.notify_waiters();
  }

  pub async fn record_activity(&self) {
    let mut state = self.state.lock().await;
    state.last_activity = Instant::now();
    state.next_allowed = state.last_activity + Duration::from_secs_f64(state.threshold_seconds);
    self.schedule_notify.notify_waiters();
  }

  pub async fn wait_until_idle(&self) {
    loop {
      {
        let state = self.state.lock().await;
        if !state.busy {
          return;
        }
      }
      self.idle_notify.notified().await;
    }
  }

  pub async fn ensure_started(self: &Arc<Self>) {
    let mut guard = self.task.lock().await;
    if guard.is_some() {
      return;
    }
    let manager = Arc::clone(self);
    let task = tauri::async_runtime::spawn(async move {
      manager.run_loop().await;
    });
    *guard = Some(task);
  }

  pub async fn stop(&self) {
    {
      let mut state = self.state.lock().await;
      state.stop = true;
      state.enabled = false;
    }
    self.schedule_notify.notify_waiters();
    let mut guard = self.task.lock().await;
    if let Some(task) = guard.take() {
      let _ = tokio::time::timeout(Duration::from_secs(2), task).await;
    }
  }

  async fn run_loop(self: Arc<Self>) {
    loop {
      let (enabled, deadline, stop) = {
        let state = self.state.lock().await;
        (state.enabled, state.next_allowed, state.stop)
      };
      if stop {
        break;
      }
      if !enabled {
        self.schedule_notify.notified().await;
        continue;
      }

      let now = Instant::now();
      if now < deadline {
        let sleep = tokio::time::sleep(deadline - now);
        tokio::select! {
          _ = sleep => {},
          _ = self.schedule_notify.notified() => continue,
        }
      }

      let (click_x, click_y) = {
        let mut state = self.state.lock().await;
        if !state.enabled || state.stop {
          continue;
        }
        state.busy = true;
        (state.click_x, state.click_y)
      };
      let _ = tokio::task::spawn_blocking(move || Self::perform_keepalive_action(click_x, click_y)).await;
      {
        let mut state = self.state.lock().await;
        state.busy = false;
        let jitter = rand::random::<f64>() * 14.0 - 7.0;
        let cooldown = (state.threshold_seconds + jitter).max(0.0);
        state.next_allowed = Instant::now() + Duration::from_secs_f64(cooldown);
      }
      self.idle_notify.notify_waiters();
    }
  }

  fn perform_keepalive_action(click_x: Option<i32>, click_y: Option<i32>) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())?;
    let mut phrases = vec![
      "cookies", "checking notes", "be right back", "just a sec", "one moment", "thinking",
      "hmm", "on it", "almost there", "nearly done", "okay", "ok", "sure", "yep", "cool",
      "thanks", "working", "system settings", "logs", "utilities", "reports", "status",
      "calendar", "updates", "notepad", "calculator", "network",
    ];
    let mut rng = rand::thread_rng();
    phrases.shuffle(&mut rng);
    let count = (rand::random::<u8>() % 4) + 2;
    let chosen = phrases.into_iter().take(count as usize).collect::<Vec<_>>();

    let screen = xcap::Monitor::all()
      .ok()
      .and_then(|mut monitors| monitors.pop())
      .and_then(|m| match (m.width(), m.height()) {
        (Ok(w), Ok(h)) => Some((w as i32, h as i32)),
        _ => None,
      });
    let (_width, height) = screen.unwrap_or((1920, 1080));

    let (click_x, click_y) = match (click_x, click_y) {
      (Some(x), Some(y)) => (x, y),
      _ => (
        rand::random::<i32>().abs() % 3 + 1,
        height - (rand::random::<i32>().abs() % 3 + 1),
      ),
    };
    enigo.move_mouse(click_x, click_y, Coordinate::Abs)?;
    enigo.button(enigo::Button::Left, Direction::Click)?;

    for phrase in chosen {
      enigo.text(phrase)?;
      std::thread::sleep(Duration::from_millis(80));
    }
    enigo.key(Key::Escape, Direction::Click)?;
    Ok(())
  }
}
