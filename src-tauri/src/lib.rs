mod git_sync;
mod quick_capture;
mod storage;
mod tray;
mod watcher;

use git_sync::{
    get_git_status, git_clone_into_dir, git_commit_and_push, git_init_bind, git_pull_prepare,
    git_test_connection, GitAuth, GitConnectionResult, GitPullResult, GitPushResult, GitStatus,
};
use quick_capture::{
    apply_shortcut_update, ensure_quick_capture_window, hide_quick_capture_window,
    register_global_shortcut, toggle_quick_capture_window, QUICK_CAPTURE_LABEL,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use storage::{
    cleanup_orphan_attachments, copy_workspace_files, delete_attachment_file,
    export_markdown_report, import_attachment_file, list_snapshots, load_app_config,
    load_workspace, read_attachment_data_url, resolve_attachment_path, restore_snapshot,
    save_app_config, save_attachment_bytes, save_shard, try_import_local_path, AppConfig,
    OrphanCleanupResult, SaveResult, SelfWriteTracker, SnapshotInfo, StoredAttachmentMeta,
    WorkspaceBundle,
};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tray::{setup_tray, update_tray_badge};
use watcher::{start_watcher, WatcherState};

struct AppRuntime {
    config_path: PathBuf,
    config: Mutex<AppConfig>,
    tracker: SelfWriteTracker,
}

fn current_data_dir(state: &AppRuntime) -> PathBuf {
    let cfg = state.config.lock().unwrap();
    PathBuf::from(&cfg.data_dir)
}

fn current_git_auth(state: &AppRuntime) -> (String, GitAuth) {
    let cfg = state.config.lock().unwrap();
    (
        cfg.git_branch.clone(),
        GitAuth {
            mode: cfg.git_auth_mode.clone(),
            username: cfg.git_username.clone(),
            token: cfg.git_token.clone(),
        },
    )
}

#[tauri::command]
fn get_app_config(state: State<'_, AppRuntime>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
fn save_app_config_cmd(
    config: AppConfig,
    state: State<'_, AppRuntime>,
) -> Result<AppConfig, String> {
    save_app_config(&state.config_path, &config)?;
    let mut guard = state.config.lock().unwrap();
    *guard = config.clone();
    Ok(config)
}

#[tauri::command]
async fn pick_data_dir(app: AppHandle) -> Option<String> {
    let folder = app.dialog().file().blocking_pick_folder();
    folder.map(|fp| fp.to_string())
}

#[tauri::command]
fn switch_data_dir(
    app: AppHandle,
    target_dir: String,
    mode: String,
    state: State<'_, AppRuntime>,
    watcher_state: State<'_, WatcherState>,
) -> Result<WorkspaceBundle, String> {
    let target = PathBuf::from(target_dir.trim());
    if target.as_os_str().is_empty() {
        return Err("Target directory cannot be empty".to_string());
    }

    let current = current_data_dir(&state);
    if mode == "copy_current" && current != target {
        copy_workspace_files(&current, &target)?;
    } else {
        std::fs::create_dir_all(&target)
            .map_err(|e| format!("Failed to create target dir {}: {e}", target.display()))?;
    }

    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = target.to_string_lossy().to_string();
        let st = get_git_status(&target);
        if st.is_repo && !st.remote_url.is_empty() {
            cfg.git_remote_url = st.remote_url;
            cfg.git_branch = st.branch;
        }
        save_app_config(&state.config_path, &cfg)?;
    }

    if let Ok(mut w_guard) = watcher_state.0.lock() {
        *w_guard = start_watcher(app, target.clone(), state.tracker.clone()).ok();
    }

    load_workspace(&target)
}

#[tauri::command]
fn open_data_dir(app: AppHandle, state: State<'_, AppRuntime>) -> Result<(), String> {
    let dir = current_data_dir(&state);
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open data directory: {e}"))
}

#[tauri::command]
fn load_workspace_cmd(state: State<'_, AppRuntime>) -> Result<WorkspaceBundle, String> {
    let dir = current_data_dir(&state);
    load_workspace(&dir)
}

#[tauri::command]
fn save_shard_cmd(
    shard: String,
    payload_json: String,
    state: State<'_, AppRuntime>,
) -> Result<SaveResult, String> {
    let dir = current_data_dir(&state);
    save_shard(&dir, &shard, &payload_json, &state.tracker)
}

#[tauri::command]
fn export_markdown_report_cmd(
    week_key: String,
    content: String,
    state: State<'_, AppRuntime>,
) -> Result<String, String> {
    let dir = current_data_dir(&state);
    export_markdown_report(&dir, &week_key, &content)
}

#[tauri::command]
fn list_snapshots_cmd(state: State<'_, AppRuntime>) -> Vec<SnapshotInfo> {
    let dir = current_data_dir(&state);
    list_snapshots(&dir)
}

#[tauri::command]
fn restore_snapshot_cmd(
    date_key: String,
    state: State<'_, AppRuntime>,
) -> Result<WorkspaceBundle, String> {
    let dir = current_data_dir(&state);
    restore_snapshot(&dir, &date_key, &state.tracker)
}

#[tauri::command]
fn update_tray_badge_cmd(
    app: AppHandle,
    open_today: usize,
    overdue: usize,
    lang: Option<String>,
) {
    update_tray_badge(&app, open_today, overdue, lang.as_deref().unwrap_or("zh"));
}

// ================= QUICK CAPTURE COMMANDS =================

#[tauri::command]
fn toggle_quick_capture_cmd(app: AppHandle) -> Result<(), String> {
    toggle_quick_capture_window(&app)
}

#[tauri::command]
fn hide_quick_capture_cmd(app: AppHandle) -> Result<(), String> {
    hide_quick_capture_window(&app)
}

#[tauri::command]
fn update_quick_capture_shortcut_cmd(
    app: AppHandle,
    shortcut: String,
    enabled: bool,
    state: State<'_, AppRuntime>,
) -> Result<AppConfig, String> {
    let trimmed = shortcut.trim().to_string();
    let (prev_shortcut, prev_enabled) = {
        let guard = state.config.lock().unwrap();
        (guard.quick_capture_shortcut.clone(), guard.quick_capture_enabled)
    };

    apply_shortcut_update(&app, &prev_shortcut, prev_enabled, &trimmed, enabled)?;

    let mut guard = state.config.lock().unwrap();
    guard.quick_capture_shortcut = trimmed;
    guard.quick_capture_enabled = enabled;
    save_app_config(&state.config_path, &guard)?;
    Ok(guard.clone())
}

#[tauri::command]
fn notify_quick_capture_saved_cmd(app: AppHandle, kind: String) -> Result<(), String> {
    let _ = app.emit_to("main", "workspace://quick-capture-saved", kind);
    Ok(())
}

// ================= ATTACHMENT COMMANDS =================

#[tauri::command]
async fn pick_attachment_files_cmd(app: AppHandle, images_only: bool) -> Vec<String> {
    let mut dialog = app.dialog().file();
    if images_only {
        dialog = dialog.add_filter(
            "Images",
            &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "heic"],
        );
    }
    match dialog.blocking_pick_files() {
        Some(files) => files.into_iter().map(|f| f.to_string()).collect(),
        None => vec![],
    }
}

#[tauri::command]
fn import_attachment_file_cmd(
    source_path: String,
    state: State<'_, AppRuntime>,
) -> Result<StoredAttachmentMeta, String> {
    let dir = current_data_dir(&state);
    import_attachment_file(&dir, &PathBuf::from(source_path))
}

#[tauri::command]
fn save_attachment_bytes_cmd(
    file_name: String,
    mime_type: String,
    bytes: Vec<u8>,
    state: State<'_, AppRuntime>,
) -> Result<StoredAttachmentMeta, String> {
    let dir = current_data_dir(&state);
    save_attachment_bytes(&dir, &file_name, &mime_type, &bytes)
}

#[tauri::command]
fn read_attachment_data_url_cmd(
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<String, String> {
    let dir = current_data_dir(&state);
    read_attachment_data_url(&dir, &rel_path)
}

#[tauri::command]
fn open_attachment_cmd(
    app: AppHandle,
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<(), String> {
    let dir = current_data_dir(&state);
    let full = resolve_attachment_path(&dir, &rel_path)?;
    if !full.is_file() {
        return Err("Attachment file not found on disk".to_string());
    }
    app.opener()
        .open_path(full.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open attachment: {e}"))
}

#[tauri::command]
fn reveal_attachment_cmd(
    app: AppHandle,
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<(), String> {
    let dir = current_data_dir(&state);
    let full = resolve_attachment_path(&dir, &rel_path)?;
    if !full.is_file() {
        return Err("Attachment file not found on disk".to_string());
    }
    app.opener()
        .reveal_item_in_dir(full)
        .map_err(|e| format!("Failed to reveal attachment: {e}"))
}

#[tauri::command]
fn open_external_url_cmd(app: AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are supported".to_string());
    }
    app.opener()
        .open_url(trimmed.to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open URL: {e}"))
}

#[tauri::command]
fn delete_attachment_file_cmd(
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<(), String> {
    let dir = current_data_dir(&state);
    delete_attachment_file(&dir, &rel_path)
}

#[tauri::command]
fn cleanup_orphan_attachments_cmd(
    state: State<'_, AppRuntime>,
) -> Result<OrphanCleanupResult, String> {
    let dir = current_data_dir(&state);
    cleanup_orphan_attachments(&dir)
}

#[tauri::command]
fn try_import_local_path_cmd(
    raw_path: String,
    state: State<'_, AppRuntime>,
) -> Result<Option<StoredAttachmentMeta>, String> {
    let dir = current_data_dir(&state);
    try_import_local_path(&dir, &raw_path)
}

// ================= GIT SYNC COMMANDS =================

#[tauri::command]
fn git_status_cmd(state: State<'_, AppRuntime>) -> GitStatus {
    let dir = current_data_dir(&state);
    get_git_status(&dir)
}

#[tauri::command]
async fn git_test_connection_cmd(
    remote_url: String,
    auth: GitAuth,
) -> GitConnectionResult {
    git_test_connection(&remote_url, &auth)
}

#[tauri::command]
fn git_init_bind_cmd(
    remote_url: String,
    branch: String,
    state: State<'_, AppRuntime>,
) -> Result<GitStatus, String> {
    let dir = current_data_dir(&state);
    let st = git_init_bind(&dir, &remote_url, &branch)?;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.git_remote_url = remote_url.trim().to_string();
        cfg.git_branch = st.branch.clone();
        let _ = save_app_config(&state.config_path, &cfg);
    }
    Ok(st)
}

#[tauri::command]
async fn git_clone_into_dir_cmd(
    app: AppHandle,
    remote_url: String,
    target_dir: String,
    branch: String,
    auth: GitAuth,
    state: State<'_, AppRuntime>,
    watcher_state: State<'_, WatcherState>,
) -> Result<WorkspaceBundle, String> {
    let target = PathBuf::from(target_dir.trim());
    let st = git_clone_into_dir(&remote_url, &target, &branch, &auth)?;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.data_dir = target.to_string_lossy().to_string();
        cfg.git_remote_url = remote_url.trim().to_string();
        cfg.git_branch = st.branch;
        cfg.git_auth_mode = auth.mode;
        cfg.git_username = auth.username;
        cfg.git_token = auth.token;
        save_app_config(&state.config_path, &cfg)?;
    }
    if let Ok(mut w_guard) = watcher_state.0.lock() {
        *w_guard = start_watcher(app, target.clone(), state.tracker.clone()).ok();
    }
    load_workspace(&target)
}

#[tauri::command]
async fn git_pull_prepare_cmd(state: State<'_, AppRuntime>) -> Result<GitPullResult, String> {
    let dir = current_data_dir(&state);
    let (branch, auth) = current_git_auth(&state);
    git_pull_prepare(&dir, &branch, &auth, &state.tracker)
}

#[tauri::command]
async fn git_commit_and_push_cmd(
    message: Option<String>,
    state: State<'_, AppRuntime>,
) -> Result<GitPushResult, String> {
    let dir = current_data_dir(&state);
    let (branch, auth) = current_git_auth(&state);
    let res = git_commit_and_push(&dir, &branch, message.as_deref(), &auth)?;
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.git_last_sync_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
        let _ = save_app_config(&state.config_path, &cfg);
    }
    Ok(res)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .expect("failed to resolve app config dir");
            let doc_dir = app
                .path()
                .document_dir()
                .unwrap_or_else(|_| config_dir.clone());
            let default_data_dir = doc_dir.join("Anchor");
            let config_path = config_dir.join("config.json");

            let config = load_app_config(&config_path, &default_data_dir);
            let data_dir = PathBuf::from(&config.data_dir);
            let _ = std::fs::create_dir_all(&data_dir);

            let initial_qc_enabled = config.quick_capture_enabled;
            let initial_qc_shortcut = config.quick_capture_shortcut.clone();

            let tracker = SelfWriteTracker::default();
            let runtime = AppRuntime {
                config_path,
                config: Mutex::new(config),
                tracker: tracker.clone(),
            };
            app.manage(runtime);

            let active_watcher = start_watcher(app.handle().clone(), data_dir, tracker).ok();
            app.manage(WatcherState(Arc::new(Mutex::new(active_watcher))));

            if let Ok(tray_state) = setup_tray(app.handle()) {
                app.manage(tray_state);
            }

            // Pre-warm hidden floating Quick Capture window & register global shortcut
            let _ = ensure_quick_capture_window(app.handle());
            if initial_qc_enabled && !initial_qc_shortcut.trim().is_empty() {
                if let Err(err) = register_global_shortcut(app.handle(), &initial_qc_shortcut) {
                    eprintln!("[Anchor] Global shortcut registration warning: {err}");
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == QUICK_CAPTURE_LABEL {
                    api.prevent_close();
                    let _ = hide_quick_capture_window(window.app_handle());
                    return;
                }
                let app = window.app_handle();
                let should_hide = app
                    .try_state::<AppRuntime>()
                    .and_then(|rt| rt.config.lock().ok().map(|c| c.close_to_tray))
                    .unwrap_or(true);
                if should_hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            save_app_config_cmd,
            pick_data_dir,
            switch_data_dir,
            open_data_dir,
            load_workspace_cmd,
            save_shard_cmd,
            export_markdown_report_cmd,
            list_snapshots_cmd,
            restore_snapshot_cmd,
            update_tray_badge_cmd,
            toggle_quick_capture_cmd,
            hide_quick_capture_cmd,
            update_quick_capture_shortcut_cmd,
            notify_quick_capture_saved_cmd,
            pick_attachment_files_cmd,
            import_attachment_file_cmd,
            save_attachment_bytes_cmd,
            read_attachment_data_url_cmd,
            open_attachment_cmd,
            reveal_attachment_cmd,
            open_external_url_cmd,
            delete_attachment_file_cmd,
            cleanup_orphan_attachments_cmd,
            try_import_local_path_cmd,
            git_status_cmd,
            git_test_connection_cmd,
            git_init_bind_cmd,
            git_clone_into_dir_cmd,
            git_pull_prepare_cmd,
            git_commit_and_push_cmd,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Anchor")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main_window(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app_handle, event);
        });
}
