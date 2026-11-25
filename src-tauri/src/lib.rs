mod docs;
mod git_sync;
mod pdf_export;
mod quick_capture;
mod sticky;
mod storage;
mod tray;
mod watcher;

use docs::{
    create_doc_folder, delete_doc_entry, import_md_file_into_dir, import_md_folder_into_dir,
    list_docs_tree, read_doc_file, rename_doc_entry, resolve_doc_path, search_docs, write_doc_file,
    DocEntry, DocFileContent, DocSearchHit, FolderImportResult,
};

use git_sync::{
    get_git_status, git_clone_into_dir, git_commit_and_push, git_init_bind, git_pull_prepare,
    git_test_connection, GitAuth, GitConnectionResult, GitPullResult, GitPushResult, GitStatus,
};
use quick_capture::{
    ensure_quick_capture_window, hide_quick_capture_window, sync_all_global_shortcuts,
    toggle_quick_capture_window, QUICK_CAPTURE_LABEL,
};
use sticky::{
    apply_sticky_opacity, apply_sticky_pinned, capture_window_bounds, close_all_sticky_windows,
    close_sticky_window, find_sticky_in_file, open_auto_open_stickies,
    open_new_draft_sticky_window, open_sticky_window, sticky_id_from_label,
    update_sticky_pinned_in_file, upsert_sticky_in_file, StickyBounds, StickyState,
};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use storage::{
    cleanup_orphan_attachments, copy_workspace_files, delete_attachment_file, derive_sibling_dir,
    export_markdown_report, import_attachment_file, list_snapshots, load_app_config,
    load_workspace, read_attachment_data_url, resolve_attachment_path, restore_snapshot,
    save_app_config, save_attachment_bytes, save_shard, try_import_local_path, AppConfig,
    OrphanCleanupResult, SaveResult, SelfWriteTracker, SnapshotInfo, StoredAttachmentMeta,
    SwitchStorageModeResult, WorkspaceBundle,
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
    cfg.active_data_dir()
}

fn ensure_git_mode(state: &AppRuntime) -> Result<(), String> {
    let cfg = state.config.lock().unwrap();
    if cfg.storage_mode != "git" {
        return Err(
            "当前为本地明文存储模式，Git 同步已停用。请先切换至「Git 云端存储与同步」模式。"
                .to_string(),
        );
    }
    Ok(())
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
    mut config: AppConfig,
    state: State<'_, AppRuntime>,
) -> Result<AppConfig, String> {
    if config.storage_mode != "local" && config.storage_mode != "git" {
        config.storage_mode = "local".to_string();
    }
    config.data_dir = config.active_data_dir().to_string_lossy().to_string();
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
        let target_str = target.to_string_lossy().to_string();
        if cfg.storage_mode == "git" {
            cfg.git_data_dir = target_str.clone();
            if cfg.local_data_dir == target_str {
                cfg.local_data_dir = derive_sibling_dir(&target, "Anchor-Local")
                    .to_string_lossy()
                    .to_string();
            }
            let st = get_git_status(&target);
            if st.is_repo && !st.remote_url.is_empty() {
                cfg.git_remote_url = st.remote_url;
                cfg.git_branch = st.branch;
            }
        } else {
            cfg.local_data_dir = target_str.clone();
            if cfg.git_data_dir == target_str {
                cfg.git_data_dir = derive_sibling_dir(&target, "Anchor-Git")
                    .to_string_lossy()
                    .to_string();
            }
        }
        cfg.data_dir = target_str;
        save_app_config(&state.config_path, &cfg)?;
    }

    if let Ok(mut w_guard) = watcher_state.0.lock() {
        *w_guard = start_watcher(app.clone(), target.clone(), state.tracker.clone()).ok();
    }
    close_all_sticky_windows(&app, Some(&current), Some(&state.tracker));

    load_workspace(&target)
}

#[tauri::command]
fn switch_storage_mode_cmd(
    app: AppHandle,
    mode: String,
    migration: String,
    state: State<'_, AppRuntime>,
    watcher_state: State<'_, WatcherState>,
) -> Result<SwitchStorageModeResult, String> {
    if mode != "local" && mode != "git" {
        return Err(format!("Unsupported storage mode: {mode}"));
    }

    let (src_dir, dst_dir, updated_cfg) = {
        let mut cfg = state.config.lock().unwrap();
        let src = cfg.active_data_dir();
        cfg.storage_mode = mode.clone();
        let dst = cfg.active_data_dir();
        if migration == "copy_current" && src != dst {
            copy_workspace_files(&src, &dst)?;
        } else {
            std::fs::create_dir_all(&dst)
                .map_err(|e| format!("Failed to create target dir {}: {e}", dst.display()))?;
        }
        cfg.data_dir = dst.to_string_lossy().to_string();
        if cfg.storage_mode == "git" {
            let st = get_git_status(&dst);
            if st.is_repo && !st.remote_url.is_empty() {
                cfg.git_remote_url = st.remote_url;
                cfg.git_branch = st.branch;
            }
        }
        save_app_config(&state.config_path, &cfg)?;
        (src, dst, cfg.clone())
    };

    if src_dir != dst_dir {
        if let Ok(mut w_guard) = watcher_state.0.lock() {
            *w_guard = start_watcher(app.clone(), dst_dir.clone(), state.tracker.clone()).ok();
        }
        close_all_sticky_windows(&app, Some(&src_dir), Some(&state.tracker));
    }

    let workspace = load_workspace(&dst_dir)?;
    Ok(SwitchStorageModeResult {
        config: updated_cfg,
        workspace,
    })
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
    app: AppHandle,
    date_key: String,
    state: State<'_, AppRuntime>,
) -> Result<WorkspaceBundle, String> {
    let dir = current_data_dir(&state);
    close_all_sticky_windows(&app, Some(&dir), Some(&state.tracker));
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
    let (prev_qc_sc, prev_qc_en, sticky_sc, sticky_en) = {
        let guard = state.config.lock().unwrap();
        (
            guard.quick_capture_shortcut.clone(),
            guard.quick_capture_enabled,
            guard.sticky_shortcut.clone(),
            guard.sticky_shortcut_enabled,
        )
    };

    sync_all_global_shortcuts(
        &app,
        (&prev_qc_sc, prev_qc_en),
        (&sticky_sc, sticky_en),
        (&trimmed, enabled),
        (&sticky_sc, sticky_en),
    )?;

    let mut guard = state.config.lock().unwrap();
    guard.quick_capture_shortcut = trimmed;
    guard.quick_capture_enabled = enabled;
    save_app_config(&state.config_path, &guard)?;
    Ok(guard.clone())
}

#[tauri::command]
fn update_sticky_shortcut_cmd(
    app: AppHandle,
    shortcut: String,
    enabled: bool,
    state: State<'_, AppRuntime>,
) -> Result<AppConfig, String> {
    let trimmed = shortcut.trim().to_string();
    let (qc_sc, qc_en, prev_sticky_sc, prev_sticky_en) = {
        let guard = state.config.lock().unwrap();
        (
            guard.quick_capture_shortcut.clone(),
            guard.quick_capture_enabled,
            guard.sticky_shortcut.clone(),
            guard.sticky_shortcut_enabled,
        )
    };

    sync_all_global_shortcuts(
        &app,
        (&qc_sc, qc_en),
        (&prev_sticky_sc, prev_sticky_en),
        (&qc_sc, qc_en),
        (&trimmed, enabled),
    )?;

    let mut guard = state.config.lock().unwrap();
    guard.sticky_shortcut = trimmed;
    guard.sticky_shortcut_enabled = enabled;
    save_app_config(&state.config_path, &guard)?;
    Ok(guard.clone())
}

#[tauri::command]
fn notify_quick_capture_saved_cmd(app: AppHandle, kind: String) -> Result<(), String> {
    let _ = app.emit_to("main", "workspace://quick-capture-saved", kind);
    Ok(())
}

// ================= KNOWLEDGE BASE / DOCS COMMANDS =================

#[tauri::command]
fn list_docs_tree_cmd(state: State<'_, AppRuntime>) -> Result<Vec<DocEntry>, String> {
    let dir = current_data_dir(&state);
    list_docs_tree(&dir)
}

#[tauri::command]
fn read_doc_file_cmd(
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<DocFileContent, String> {
    let dir = current_data_dir(&state);
    read_doc_file(&dir, &rel_path)
}

#[tauri::command]
fn write_doc_file_cmd(
    rel_path: String,
    content: String,
    state: State<'_, AppRuntime>,
) -> Result<DocFileContent, String> {
    let dir = current_data_dir(&state);
    write_doc_file(&dir, &rel_path, &content, &state.tracker)
}

#[tauri::command]
fn create_doc_folder_cmd(
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<DocEntry, String> {
    let dir = current_data_dir(&state);
    create_doc_folder(&dir, &rel_path, &state.tracker)
}

#[tauri::command]
fn rename_doc_entry_cmd(
    old_rel_path: String,
    new_rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<String, String> {
    let dir = current_data_dir(&state);
    rename_doc_entry(&dir, &old_rel_path, &new_rel_path, &state.tracker)
}

#[tauri::command]
fn delete_doc_entry_cmd(rel_path: String, state: State<'_, AppRuntime>) -> Result<(), String> {
    let dir = current_data_dir(&state);
    delete_doc_entry(&dir, &rel_path, &state.tracker)
}

#[tauri::command]
async fn import_md_files_cmd(
    app: AppHandle,
    target_dir_rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<Vec<DocEntry>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_files();
    let Some(files) = picked else {
        return Ok(vec![]);
    };
    let dir = current_data_dir(&state);
    let mut imported = Vec::new();
    for fp in files {
        let src = PathBuf::from(fp.to_string());
        if let Ok(entry) = import_md_file_into_dir(&dir, &src, &target_dir_rel_path, &state.tracker)
        {
            imported.push(entry);
        }
    }
    Ok(imported)
}

#[tauri::command]
async fn import_md_folder_cmd(
    app: AppHandle,
    target_dir_rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<Option<FolderImportResult>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(folder) = picked else {
        return Ok(None);
    };
    let dir = current_data_dir(&state);
    let src = PathBuf::from(folder.to_string());
    let res = import_md_folder_into_dir(&dir, &src, &target_dir_rel_path, &state.tracker)?;
    Ok(Some(res))
}

#[tauri::command]
async fn export_doc_file_cmd(
    app: AppHandle,
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<Option<String>, String> {
    let dir = current_data_dir(&state);
    let file = read_doc_file(&dir, &rel_path)?;
    let default_name = file
        .rel_path
        .rsplit('/')
        .next()
        .unwrap_or("document.md")
        .to_string();
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(dest) = picked else {
        return Ok(None);
    };
    let dest_path = PathBuf::from(dest.to_string());
    storage::atomic_write_text(&dest_path, &file.content)?;
    Ok(Some(dest_path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn export_doc_pdf_cmd(
    app: AppHandle,
    default_name: String,
    html: String,
) -> Result<Option<String>, String> {
    let trimmed = default_name.trim();
    let pdf_name = if trimmed.is_empty() {
        "document.pdf".to_string()
    } else if trimmed.to_lowercase().ends_with(".pdf") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.pdf")
    };
    let picked = app
        .dialog()
        .file()
        .set_file_name(&pdf_name)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();
    let Some(dest) = picked else {
        return Ok(None);
    };
    let mut dest_path = PathBuf::from(dest.to_string());
    if dest_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| !e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(true)
    {
        dest_path.set_extension("pdf");
    }
    pdf_export::export_html_to_pdf(&app, &html, &dest_path).await?;
    Ok(Some(dest_path.to_string_lossy().to_string()))
}

#[tauri::command]
fn reveal_doc_entry_cmd(
    app: AppHandle,
    rel_path: String,
    state: State<'_, AppRuntime>,
) -> Result<(), String> {
    let dir = current_data_dir(&state);
    let (_, full) = resolve_doc_path(&dir, &rel_path)?;
    if !full.exists() {
        return Err("文件或文件夹不存在".to_string());
    }
    app.opener()
        .reveal_item_in_dir(full.to_string_lossy().as_ref())
        .map_err(|e| format!("无法在系统中定位文件: {e}"))
}

#[tauri::command]
fn search_docs_cmd(
    query: String,
    state: State<'_, AppRuntime>,
) -> Result<Vec<DocSearchHit>, String> {
    let dir = current_data_dir(&state);
    search_docs(&dir, &query, 20)
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
    ensure_git_mode(&state)?;
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
        let target_str = target.to_string_lossy().to_string();
        cfg.storage_mode = "git".to_string();
        cfg.git_data_dir = target_str.clone();
        if cfg.local_data_dir == target_str {
            cfg.local_data_dir = derive_sibling_dir(&target, "Anchor-Local")
                .to_string_lossy()
                .to_string();
        }
        cfg.data_dir = target_str;
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
    ensure_git_mode(&state)?;
    let dir = current_data_dir(&state);
    let (branch, auth) = current_git_auth(&state);
    git_pull_prepare(&dir, &branch, &auth, &state.tracker)
}

#[tauri::command]
async fn git_commit_and_push_cmd(
    message: Option<String>,
    state: State<'_, AppRuntime>,
) -> Result<GitPushResult, String> {
    ensure_git_mode(&state)?;
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

pub fn create_and_open_sticky_from_tray(app: &AppHandle) {
    let _ = open_new_draft_sticky_window(app, Some("yellow"), None);
}

#[tauri::command]
fn open_new_draft_sticky_cmd(
    app: AppHandle,
    color: Option<String>,
    offset_from_id: Option<String>,
) -> Result<String, String> {
    open_new_draft_sticky_window(&app, color.as_deref(), offset_from_id.as_deref())
}

#[tauri::command]
fn upsert_sticky_cmd(
    app: AppHandle,
    sticky_json: String,
    state: State<'_, AppRuntime>,
    sticky_state: State<'_, StickyState>,
) -> Result<serde_json::Value, String> {
    let incoming: serde_json::Value = serde_json::from_str(&sticky_json)
        .map_err(|e| format!("Invalid sticky JSON payload: {e}"))?;
    let dir = current_data_dir(&state);
    let stored = {
        let _guard = sticky_state.shard_lock.lock().unwrap();
        upsert_sticky_in_file(&dir, incoming, &state.tracker)?
    };

    if let Some(id) = stored.get("id").and_then(|v| v.as_str()) {
        let deleted = stored.get("deletedAt").is_some_and(|v| !v.is_null());
        if deleted {
            let _ = close_sticky_window(&app, id, Some(&dir), Some(&state.tracker));
            sticky_state.remove_bounds(id);
        } else if let Some(pinned) = stored.get("pinned").and_then(|v| v.as_bool()) {
            let _ = apply_sticky_pinned(&app, id, pinned);
        }
    }

    let _ = app.emit("workspace://stickies-changed", stored.clone());
    Ok(stored)
}

#[tauri::command]
fn open_sticky_window_cmd(
    app: AppHandle,
    sticky_id: String,
    offset_from_id: Option<String>,
    state: State<'_, AppRuntime>,
    sticky_state: State<'_, StickyState>,
) -> Result<StickyBounds, String> {
    let dir = current_data_dir(&state);
    let pinned = {
        let _guard = sticky_state.shard_lock.lock().unwrap();
        find_sticky_in_file(&dir, &sticky_id)
            .and_then(|v| v.get("pinned").and_then(|p| p.as_bool()))
            .unwrap_or(true)
    };
    open_sticky_window(&app, &sticky_id, pinned, offset_from_id.as_deref(), true)
}

#[tauri::command]
fn close_sticky_window_cmd(
    app: AppHandle,
    sticky_id: String,
    state: State<'_, AppRuntime>,
) -> Result<(), String> {
    let dir = current_data_dir(&state);
    close_sticky_window(&app, &sticky_id, Some(&dir), Some(&state.tracker))
}

#[tauri::command]
fn close_all_sticky_windows_cmd(app: AppHandle, state: State<'_, AppRuntime>) {
    let dir = current_data_dir(&state);
    close_all_sticky_windows(&app, Some(&dir), Some(&state.tracker));
}

#[tauri::command]
fn set_sticky_pinned_cmd(
    app: AppHandle,
    sticky_id: String,
    pinned: bool,
    state: State<'_, AppRuntime>,
    sticky_state: State<'_, StickyState>,
) -> Result<Option<serde_json::Value>, String> {
    let dir = current_data_dir(&state);
    let updated = {
        let _guard = sticky_state.shard_lock.lock().unwrap();
        update_sticky_pinned_in_file(&dir, &sticky_id, pinned, &state.tracker)?
    };
    apply_sticky_pinned(&app, &sticky_id, pinned)?;
    if let Some(ref val) = updated {
        let _ = app.emit("workspace://stickies-changed", val.clone());
    }
    Ok(updated)
}

#[tauri::command]
fn set_sticky_opacity_cmd(
    app: AppHandle,
    sticky_id: String,
    opacity: f64,
) -> Result<f64, String> {
    apply_sticky_opacity(&app, &sticky_id, opacity)
}

#[tauri::command]
fn get_sticky_bounds_cmd(
    sticky_id: String,
    sticky_state: State<'_, StickyState>,
) -> StickyBounds {
    sticky_state.get_bounds(&sticky_id)
}

#[tauri::command]
fn list_open_sticky_ids_cmd(sticky_state: State<'_, StickyState>) -> Vec<String> {
    sticky_state.list_open()
}

#[tauri::command]
fn open_stickies_in_main_cmd(app: AppHandle) {
    tray::show_main_window(&app);
    let _ = app.emit_to("main", "workspace://navigate-view", "stickies");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
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
            let initial_sticky_enabled = config.sticky_shortcut_enabled;
            let initial_sticky_shortcut = config.sticky_shortcut.clone();

            let tracker = SelfWriteTracker::default();
            let runtime = AppRuntime {
                config_path,
                config: Mutex::new(config),
                tracker: tracker.clone(),
            };
            app.manage(runtime);
            app.manage(StickyState::new(&config_dir));

            let active_watcher =
                start_watcher(app.handle().clone(), data_dir.clone(), tracker.clone()).ok();
            app.manage(WatcherState(Arc::new(Mutex::new(active_watcher))));

            if let Ok(tray_state) = setup_tray(app.handle()) {
                app.manage(tray_state);
            }

            // Pre-warm hidden floating Quick Capture window & register global shortcuts (Quick Capture + New Sticky)
            let _ = ensure_quick_capture_window(app.handle());
            if let Err(err) = sync_all_global_shortcuts(
                app.handle(),
                ("", false),
                ("", false),
                (&initial_qc_shortcut, initial_qc_enabled),
                (&initial_sticky_shortcut, initial_sticky_enabled),
            ) {
                eprintln!("[Anchor] Global shortcut registration warning: {err}");
            }

            // Prune leftover empty stickies & auto-open ONLY non-empty stickies marked `autoOpen: true`
            open_auto_open_stickies(app.handle(), &data_dir, &tracker);

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                if let Some(sid) = sticky_id_from_label(window.label()) {
                    if let Some(wv) = window.app_handle().get_webview_window(window.label()) {
                        capture_window_bounds(window.app_handle(), &wv, sid);
                    }
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() == QUICK_CAPTURE_LABEL {
                    api.prevent_close();
                    let _ = hide_quick_capture_window(window.app_handle());
                    return;
                }
                if let Some(sid) = sticky_id_from_label(window.label()) {
                    api.prevent_close();
                    let app = window.app_handle();
                    let rt_info = app
                        .try_state::<AppRuntime>()
                        .map(|rt| (current_data_dir(&rt), rt.tracker.clone()));
                    if let Some((dir, trk)) = rt_info {
                        let _ = close_sticky_window(app, sid, Some(&dir), Some(&trk));
                    } else {
                        let _ = close_sticky_window(app, sid, None, None);
                    }
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
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            save_app_config_cmd,
            pick_data_dir,
            switch_data_dir,
            switch_storage_mode_cmd,
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
            update_sticky_shortcut_cmd,
            notify_quick_capture_saved_cmd,
            open_new_draft_sticky_cmd,
            upsert_sticky_cmd,
            open_sticky_window_cmd,
            close_sticky_window_cmd,
            close_all_sticky_windows_cmd,
            set_sticky_pinned_cmd,
            set_sticky_opacity_cmd,
            get_sticky_bounds_cmd,
            list_open_sticky_ids_cmd,
            open_stickies_in_main_cmd,
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
            list_docs_tree_cmd,
            read_doc_file_cmd,
            write_doc_file_cmd,
            create_doc_folder_cmd,
            rename_doc_entry_cmd,
            delete_doc_entry_cmd,
            import_md_files_cmd,
            import_md_folder_cmd,
            export_doc_file_cmd,
            export_doc_pdf_cmd,
            reveal_doc_entry_cmd,
            search_docs_cmd,
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
