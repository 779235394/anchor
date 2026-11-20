use crate::storage::SelfWriteTracker;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct WorkspaceWatcher {
    _watcher: RecommendedWatcher,
    stop_tx: mpsc::Sender<()>,
}

impl Drop for WorkspaceWatcher {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

fn should_ignore_path(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    for comp in rel.components() {
        let s = comp.as_os_str().to_string_lossy();
        if s == ".snapshots" || s == "reports" || s.starts_with('.') {
            return true;
        }
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".tmp") || name.ends_with(".bak") || !name.ends_with(".json") {
        return true;
    }
    false
}

pub fn start_watcher(
    app: AppHandle,
    data_dir: PathBuf,
    tracker: SelfWriteTracker,
) -> Result<WorkspaceWatcher, String> {
    let _ = std::fs::create_dir_all(&data_dir);
    let root_for_cb = data_dir.clone();
    let (evt_tx, evt_rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let relevant = event.paths.iter().any(|p| {
                !should_ignore_path(&root_for_cb, p) && !tracker.is_recent_self_write(p)
            });
            if relevant {
                let _ = evt_tx.send(());
            }
        }
    })
    .map_err(|e| format!("Failed to initialize file watcher: {e}"))?;

    watcher
        .watch(&data_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory {}: {e}", data_dir.display()))?;

    thread::spawn(move || {
        let mut pending_since: Option<Instant> = None;
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match evt_rx.recv_timeout(Duration::from_millis(150)) {
                Ok(()) => {
                    pending_since = Some(Instant::now());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ts) = pending_since {
                        if ts.elapsed() >= Duration::from_millis(500) {
                            pending_since = None;
                            let _ = app.emit("workspace://external-change", ());
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WorkspaceWatcher {
        _watcher: watcher,
        stop_tx,
    })
}

pub struct WatcherState(pub Arc<Mutex<Option<WorkspaceWatcher>>>);
