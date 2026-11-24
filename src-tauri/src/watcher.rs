use crate::docs::DOCS_DIR_NAME;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchKind {
    JsonShard,
    DocsTree,
}

fn classify_watch_path(root: &Path, path: &Path) -> Option<WatchKind> {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let mut comps = rel.components();
    let first = comps
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())?;

    if first == ".snapshots" || first == "reports" || first.starts_with('.') {
        return None;
    }

    // Check remaining components for hidden dirs/files
    for comp in comps {
        let s = comp.as_os_str().to_string_lossy();
        if s.starts_with('.') {
            return None;
        }
    }

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.ends_with(".tmp") || name.ends_with(".bak") {
        return None;
    }

    if first == DOCS_DIR_NAME {
        // Watch .md files and directory create/rename/remove inside docs/
        if name.to_lowercase().ends_with(".md") || path.is_dir() || !name.contains('.') {
            return Some(WatchKind::DocsTree);
        }
        return None;
    }

    if name.ends_with(".json") {
        return Some(WatchKind::JsonShard);
    }

    None
}

pub fn start_watcher(
    app: AppHandle,
    data_dir: PathBuf,
    tracker: SelfWriteTracker,
) -> Result<WorkspaceWatcher, String> {
    let _ = std::fs::create_dir_all(&data_dir);
    let root_for_cb = data_dir.clone();
    let (evt_tx, evt_rx) = mpsc::channel::<WatchKind>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let mut saw_json = false;
            let mut saw_docs = false;
            for p in &event.paths {
                if tracker.is_recent_self_write(p) {
                    continue;
                }
                match classify_watch_path(&root_for_cb, p) {
                    Some(WatchKind::JsonShard) => saw_json = true,
                    Some(WatchKind::DocsTree) => saw_docs = true,
                    None => {}
                }
            }
            if saw_json {
                let _ = evt_tx.send(WatchKind::JsonShard);
            }
            if saw_docs {
                let _ = evt_tx.send(WatchKind::DocsTree);
            }
        }
    })
    .map_err(|e| format!("Failed to initialize file watcher: {e}"))?;

    watcher
        .watch(&data_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory {}: {e}", data_dir.display()))?;

    thread::spawn(move || {
        let mut pending_json: Option<Instant> = None;
        let mut pending_docs: Option<Instant> = None;
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }
            match evt_rx.recv_timeout(Duration::from_millis(150)) {
                Ok(WatchKind::JsonShard) => {
                    pending_json = Some(Instant::now());
                }
                Ok(WatchKind::DocsTree) => {
                    pending_docs = Some(Instant::now());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if let Some(ts) = pending_json {
                        if ts.elapsed() >= Duration::from_millis(500) {
                            pending_json = None;
                            let _ = app.emit("workspace://external-change", ());
                        }
                    }
                    if let Some(ts) = pending_docs {
                        if ts.elapsed() >= Duration::from_millis(500) {
                            pending_docs = None;
                            let _ = app.emit("workspace://docs-external-change", ());
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
