use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_SNAPSHOTS: usize = 7;

fn default_storage_mode() -> String {
    "local".to_string()
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_accent() -> String {
    "blue".to_string()
}
fn default_lang() -> String {
    "zh".to_string()
}
fn default_true() -> bool {
    true
}
fn default_branch() -> String {
    "main".to_string()
}
fn default_git_auth_mode() -> String {
    "system".to_string()
}
pub fn default_quick_capture_shortcut() -> String {
    #[cfg(target_os = "macos")]
    {
        "Alt+Space".to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Alt+Shift+Space".to_string()
    }
}
fn default_quick_capture_mode() -> String {
    "last".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_storage_mode")]
    pub storage_mode: String,
    #[serde(default)]
    pub local_data_dir: String,
    #[serde(default)]
    pub git_data_dir: String,
    pub data_dir: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_accent")]
    pub accent: String,
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
    #[serde(default = "default_true")]
    pub quick_capture_enabled: bool,
    #[serde(default = "default_quick_capture_shortcut")]
    pub quick_capture_shortcut: String,
    #[serde(default = "default_quick_capture_mode")]
    pub quick_capture_default_mode: String,
    #[serde(default)]
    pub git_remote_url: String,
    #[serde(default = "default_branch")]
    pub git_branch: String,
    #[serde(default = "default_git_auth_mode")]
    pub git_auth_mode: String,
    #[serde(default)]
    pub git_username: String,
    #[serde(default)]
    pub git_token: String,
    #[serde(default)]
    pub git_pull_on_start: bool,
    #[serde(default)]
    pub git_auto_push: bool,
    #[serde(default)]
    pub git_last_sync_at: Option<u64>,
    #[serde(default)]
    pub ignored_update_version: String,
    #[serde(default)]
    pub pinned_docs: Vec<String>,
}

pub fn derive_sibling_dir(base: &Path, name: &str) -> PathBuf {
    match base.parent() {
        Some(parent) => parent.join(name),
        None => base.join(name),
    }
}

impl AppConfig {
    pub fn default_with_dir(default_data_dir: PathBuf) -> Self {
        let local_str = default_data_dir.to_string_lossy().to_string();
        let git_str = derive_sibling_dir(&default_data_dir, "Anchor-Git")
            .to_string_lossy()
            .to_string();
        Self {
            storage_mode: "local".to_string(),
            local_data_dir: local_str.clone(),
            git_data_dir: git_str,
            data_dir: local_str,
            theme: "system".to_string(),
            accent: "blue".to_string(),
            lang: "zh".to_string(),
            close_to_tray: true,
            quick_capture_enabled: true,
            quick_capture_shortcut: default_quick_capture_shortcut(),
            quick_capture_default_mode: "last".to_string(),
            git_remote_url: String::new(),
            git_branch: "main".to_string(),
            git_auth_mode: "system".to_string(),
            git_username: String::new(),
            git_token: String::new(),
            git_pull_on_start: false,
            git_auto_push: false,
            git_last_sync_at: None,
            ignored_update_version: String::new(),
            pinned_docs: Vec::new(),
        }
    }

    pub fn active_data_dir(&self) -> PathBuf {
        if self.storage_mode == "git" && !self.git_data_dir.trim().is_empty() {
            return PathBuf::from(self.git_data_dir.trim());
        }
        if !self.local_data_dir.trim().is_empty() {
            return PathBuf::from(self.local_data_dir.trim());
        }
        PathBuf::from(self.data_dir.trim())
    }

    /// Migrates legacy single-directory configs to isolated `local_data_dir` & `git_data_dir`
    /// and guarantees `data_dir` always mirrors the active storage mode.
    pub fn normalize_storage_dirs(&mut self, default_local_dir: &Path) -> bool {
        let mut changed = false;
        let default_local_str = default_local_dir.to_string_lossy().to_string();
        let default_git_str = derive_sibling_dir(default_local_dir, "Anchor-Git")
            .to_string_lossy()
            .to_string();

        if self.data_dir.trim().is_empty() {
            self.data_dir = default_local_str.clone();
            changed = true;
        }

        let is_legacy_single_dir =
            self.local_data_dir.trim().is_empty() && self.git_data_dir.trim().is_empty();

        if is_legacy_single_dir {
            let legacy_dir = self.data_dir.trim().to_string();
            let has_git_repo = !self.git_remote_url.trim().is_empty()
                || Path::new(&legacy_dir).join(".git").exists();
            if has_git_repo {
                self.storage_mode = "git".to_string();
                self.git_data_dir = legacy_dir.clone();
                self.local_data_dir = if legacy_dir == default_local_str {
                    derive_sibling_dir(default_local_dir, "Anchor-Local")
                        .to_string_lossy()
                        .to_string()
                } else {
                    default_local_str.clone()
                };
            } else {
                self.storage_mode = "local".to_string();
                self.local_data_dir = legacy_dir.clone();
                self.git_data_dir = if legacy_dir == default_git_str {
                    derive_sibling_dir(default_local_dir, "Anchor-Git-Sync")
                        .to_string_lossy()
                        .to_string()
                } else {
                    default_git_str.clone()
                };
            }
            changed = true;
        } else {
            if self.storage_mode != "local" && self.storage_mode != "git" {
                self.storage_mode = "local".to_string();
                changed = true;
            }
            if self.local_data_dir.trim().is_empty() {
                self.local_data_dir = if self.git_data_dir.trim() == default_local_str {
                    derive_sibling_dir(default_local_dir, "Anchor-Local")
                        .to_string_lossy()
                        .to_string()
                } else {
                    default_local_str.clone()
                };
                changed = true;
            }
            if self.git_data_dir.trim().is_empty() {
                self.git_data_dir = if self.local_data_dir.trim() == default_git_str {
                    derive_sibling_dir(default_local_dir, "Anchor-Git-Sync")
                        .to_string_lossy()
                        .to_string()
                } else {
                    default_git_str.clone()
                };
                changed = true;
            }
            if self.local_data_dir.trim() == self.git_data_dir.trim() {
                if self.storage_mode == "git" {
                    self.local_data_dir = derive_sibling_dir(default_local_dir, "Anchor-Local")
                        .to_string_lossy()
                        .to_string();
                } else {
                    self.git_data_dir = derive_sibling_dir(default_local_dir, "Anchor-Git")
                        .to_string_lossy()
                        .to_string();
                }
                changed = true;
            }
        }

        let synced = self.active_data_dir().to_string_lossy().to_string();
        if self.data_dir != synced {
            self.data_dir = synced;
            changed = true;
        }

        changed
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchStorageModeResult {
    pub config: AppConfig,
    pub workspace: WorkspaceBundle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanCleanupResult {
    pub removed_count: usize,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBundle {
    pub meta: Value,
    pub tasks: Value,
    pub projects: Value,
    pub notes: Value,
    pub members: Value,
    pub assignments: Value,
    pub daily: Value,
    pub is_new_workspace: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub date_key: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub shard: String,
    pub saved_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAttachmentMeta {
    pub id: String,
    pub name: String,
    pub rel_path: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Debug, Default, Clone)]
pub struct SelfWriteTracker {
    writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl SelfWriteTracker {
    pub fn record(&self, path: &Path) {
        let canonical = canonical_or_owned(path);
        if let Ok(mut map) = self.writes.lock() {
            let now = Instant::now();
            map.retain(|_, ts| now.duration_since(*ts) < Duration::from_secs(10));
            map.insert(canonical, now);
        }
    }

    pub fn is_recent_self_write(&self, path: &Path) -> bool {
        let canonical = canonical_or_owned(path);
        if let Ok(map) = self.writes.lock() {
            if let Some(ts) = map.get(&canonical) {
                return Instant::now().duration_since(*ts) < Duration::from_millis(1600);
            }
        }
        false
    }
}

fn canonical_or_owned(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn load_app_config(config_path: &Path, default_data_dir: &Path) -> AppConfig {
    if let Ok(raw) = fs::read_to_string(config_path) {
        if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&raw) {
            if cfg.normalize_storage_dirs(default_data_dir) {
                let _ = save_app_config(config_path, &cfg);
            }
            return cfg;
        }
    }
    let cfg = AppConfig::default_with_dir(default_data_dir.to_path_buf());
    let _ = save_app_config(config_path, &cfg);
    cfg
}

pub fn save_app_config(config_path: &Path, config: &AppConfig) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize app config: {e}"))?;
    atomic_write_text(config_path, &(serialized + "\n"))
}

/// Atomically writes UTF-8 LF text via temp file -> sync_all -> rename, with backoff retry
/// for transient cloud-sync file locks (especially OneDrive / Nutstore on Windows).
pub fn atomic_write_text(target: &Path, content: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Invalid target path: {}", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;

    let normalized = content.replace("\r\n", "\n");
    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid filename".to_string())?;
    let tmp_path = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    {
        let mut f = File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file {}: {e}", tmp_path.display()))?;
        f.write_all(normalized.as_bytes())
            .map_err(|e| format!("Failed to write temp file {}: {e}", tmp_path.display()))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temp file {}: {e}", tmp_path.display()))?;
    }

    let backoffs = [50u64, 150, 300];
    let mut last_err: Option<std::io::Error> = None;

    for attempt in 0..=backoffs.len() {
        match fs::rename(&tmp_path, target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < backoffs.len() {
                    thread::sleep(Duration::from_millis(backoffs[attempt]));
                }
            }
        }
    }

    let _ = fs::remove_file(&tmp_path);
    Err(format!(
        "Failed to atomically replace {}: {}",
        target.display(),
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".into())
    ))
}

fn validate_week_key(week: &str) -> bool {
    let bytes = week.as_bytes();
    // Strict `YYYY-Www`, e.g., `2026-W47`
    bytes.len() == 8
        && bytes[0..4].iter().all(|b| b.is_ascii_digit())
        && bytes[4] == b'-'
        && bytes[5] == b'W'
        && bytes[6..8].iter().all(|b| b.is_ascii_digit())
}

pub fn shard_to_rel_path(shard: &str) -> Result<PathBuf, String> {
    match shard {
        "meta" => Ok(PathBuf::from("meta.json")),
        "tasks" => Ok(PathBuf::from("tasks.json")),
        "projects" => Ok(PathBuf::from("projects.json")),
        "notes" => Ok(PathBuf::from("notes.json")),
        "members" => Ok(PathBuf::from("members.json")),
        "assignments" => Ok(PathBuf::from("assignments.json")),
        other if other.starts_with("daily:") => {
            let week = &other["daily:".len()..];
            if !validate_week_key(week) {
                return Err(format!("Invalid daily week shard key: {shard}"));
            }
            Ok(PathBuf::from("daily").join(format!("{week}.json")))
        }
        _ => Err(format!("Unknown shard key: {shard}")),
    }
}

pub fn ensure_daily_snapshot(data_dir: &Path) -> Result<(), String> {
    let today_key = Local::now().format("%Y-%m-%d").to_string();
    ensure_daily_snapshot_for_date(data_dir, &today_key)
}

pub fn ensure_daily_snapshot_for_date(data_dir: &Path, date_key: &str) -> Result<(), String> {
    let snapshots_root = data_dir.join(".snapshots");
    let snap_dir = snapshots_root.join(date_key);
    if snap_dir.exists() {
        return Ok(());
    }

    let top_shards = [
        "meta.json",
        "tasks.json",
        "projects.json",
        "notes.json",
        "members.json",
        "assignments.json",
    ];

    let has_any = top_shards.iter().any(|f| data_dir.join(f).exists())
        || data_dir
            .join("daily")
            .read_dir()
            .ok()
            .map(|mut rd| rd.next().is_some())
            .unwrap_or(false);

    if !has_any {
        return Ok(());
    }

    fs::create_dir_all(&snap_dir)
        .map_err(|e| format!("Failed to create snapshot dir {}: {e}", snap_dir.display()))?;

    for name in &top_shards {
        let src = data_dir.join(name);
        if src.is_file() {
            let _ = fs::copy(&src, snap_dir.join(name));
        }
    }

    let daily_src = data_dir.join("daily");
    if daily_src.is_dir() {
        let daily_dst = snap_dir.join("daily");
        if fs::create_dir_all(&daily_dst).is_ok() {
            if let Ok(entries) = fs::read_dir(&daily_src) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("json") {
                        if let Some(fname) = path.file_name() {
                            let _ = fs::copy(&path, daily_dst.join(fname));
                        }
                    }
                }
            }
        }
    }

    prune_old_snapshots(&snapshots_root, MAX_SNAPSHOTS);
    Ok(())
}

fn is_date_snapshot_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() == 10
        && b[0..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[7] == b'-'
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}

fn prune_old_snapshots(snapshots_root: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(snapshots_root) else {
        return;
    };
    let mut dated: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() {
                return None;
            }
            let name = p.file_name()?.to_str()?.to_string();
            if is_date_snapshot_name(&name) {
                Some((name, p))
            } else {
                None
            }
        })
        .collect();

    dated.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, stale_path) in dated.into_iter().skip(keep) {
        let _ = fs::remove_dir_all(stale_path);
    }
}

fn find_latest_valid_snapshot_file(data_dir: &Path, rel_path: &Path) -> Option<(String, Value)> {
    let snapshots_root = data_dir.join(".snapshots");
    let entries = fs::read_dir(&snapshots_root).ok()?;
    let mut dirs: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() {
                return None;
            }
            let name = p.file_name()?.to_str()?.to_string();
            Some((name, p))
        })
        .collect();
    dirs.sort_by(|a, b| b.0.cmp(&a.0));

    for (name, dir) in dirs {
        let candidate = dir.join(rel_path);
        if let Ok(raw) = fs::read_to_string(&candidate) {
            if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
                return Some((name, parsed));
            }
        }
    }
    None
}

fn read_json_with_recovery(
    data_dir: &Path,
    rel_path: &Path,
    default_val: Value,
    warnings: &mut Vec<String>,
) -> (Value, bool) {
    let full_path = data_dir.join(rel_path);
    if !full_path.exists() {
        return (default_val, false);
    }

    match fs::read_to_string(&full_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(val) => (val, true),
            Err(err) => {
                let bak_name = format!(
                    "{}.corrupted.{}.bak",
                    full_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("data.json"),
                    unix_secs()
                );
                let bak_path = full_path.with_file_name(bak_name);
                let _ = fs::rename(&full_path, &bak_path);

                if let Some((snap_name, recovered)) =
                    find_latest_valid_snapshot_file(data_dir, rel_path)
                {
                    if let Ok(pretty) = serde_json::to_string_pretty(&recovered) {
                        let _ = atomic_write_text(&full_path, &(pretty + "\n"));
                    }
                    warnings.push(format!(
                        "{} 格式损坏（已备份为 .corrupted.bak），已自动从快照 {} 恢复。",
                        rel_path.display(),
                        snap_name
                    ));
                    (recovered, true)
                } else {
                    warnings.push(format!(
                        "{} 格式损坏（{}），原文件已保留为 .corrupted.bak。",
                        rel_path.display(),
                        err
                    ));
                    (default_val, true)
                }
            }
        },
        Err(err) => {
            warnings.push(format!("无法读取 {}：{}", rel_path.display(), err));
            (default_val, true)
        }
    }
}

pub fn load_workspace(data_dir: &Path) -> Result<WorkspaceBundle, String> {
    fs::create_dir_all(data_dir)
        .map_err(|e| format!("Failed to prepare data dir {}: {e}", data_dir.display()))?;

    let mut warnings = Vec::new();
    let today = Local::now().format("%Y-%m-%d").to_string();

    let (meta, e_meta) = read_json_with_recovery(
        data_dir,
        Path::new("meta.json"),
        json!({
            "schemaVersion": 1,
            "lastOpenDate": today,
            "hasSample": false,
            "lastExportAt": null
        }),
        &mut warnings,
    );
    let (tasks, e_tasks) = read_json_with_recovery(
        data_dir,
        Path::new("tasks.json"),
        Value::Array(vec![]),
        &mut warnings,
    );
    let (projects, e_proj) = read_json_with_recovery(
        data_dir,
        Path::new("projects.json"),
        Value::Array(vec![]),
        &mut warnings,
    );
    let (notes, e_notes) = read_json_with_recovery(
        data_dir,
        Path::new("notes.json"),
        Value::Array(vec![]),
        &mut warnings,
    );
    let (members, e_mem) = read_json_with_recovery(
        data_dir,
        Path::new("members.json"),
        Value::Array(vec![]),
        &mut warnings,
    );
    let (assignments, e_asg) = read_json_with_recovery(
        data_dir,
        Path::new("assignments.json"),
        Value::Array(vec![]),
        &mut warnings,
    );

    // Load all weekly daily/*.json files
    let mut all_daily: Vec<Value> = Vec::new();
    let mut e_daily = false;
    let daily_dir = data_dir.join("daily");
    if daily_dir.is_dir() {
        let mut files: Vec<PathBuf> = fs::read_dir(&daily_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
            .collect();
        files.sort();

        for path in files {
            if let Some(fname) = path.file_name() {
                let rel = PathBuf::from("daily").join(fname);
                let (val, existed) =
                    read_json_with_recovery(data_dir, &rel, Value::Array(vec![]), &mut warnings);
                if existed {
                    e_daily = true;
                }
                if let Some(arr) = val.as_array() {
                    all_daily.extend(arr.iter().cloned());
                }
            }
        }
    }

    let is_new_workspace = !(e_meta || e_tasks || e_proj || e_notes || e_mem || e_asg || e_daily);

    Ok(WorkspaceBundle {
        meta,
        tasks,
        projects,
        notes,
        members,
        assignments,
        daily: Value::Array(all_daily),
        is_new_workspace,
        warnings,
    })
}

pub fn save_shard(
    data_dir: &Path,
    shard: &str,
    payload_json: &str,
    tracker: &SelfWriteTracker,
) -> Result<SaveResult, String> {
    let rel_path = shard_to_rel_path(shard)?;
    let parsed: Value = serde_json::from_str(payload_json)
        .map_err(|e| format!("Invalid JSON payload for shard {shard}: {e}"))?;
    let pretty = serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Failed to format JSON for shard {shard}: {e}"))?;

    let _ = ensure_daily_snapshot(data_dir);

    let full_path = data_dir.join(rel_path);
    tracker.record(&full_path);
    atomic_write_text(&full_path, &(pretty + "\n"))?;
    tracker.record(&full_path);

    Ok(SaveResult {
        shard: shard.to_string(),
        saved_at: unix_secs(),
    })
}

pub fn export_markdown_report(
    data_dir: &Path,
    week_key: &str,
    content: &str,
) -> Result<String, String> {
    if !validate_week_key(week_key) {
        return Err(format!("Invalid week key: {week_key}"));
    }
    let path = data_dir.join("reports").join(format!("{week_key}.md"));
    atomic_write_text(&path, content)?;
    Ok(path.to_string_lossy().to_string())
}

pub fn copy_workspace_files(src_dir: &Path, dst_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dst_dir)
        .map_err(|e| format!("Failed to create destination {}: {e}", dst_dir.display()))?;

    let top_shards = [
        "meta.json",
        "tasks.json",
        "projects.json",
        "notes.json",
        "members.json",
        "assignments.json",
    ];

    for name in &top_shards {
        let src = src_dir.join(name);
        if src.is_file() {
            let content = fs::read_to_string(&src)
                .map_err(|e| format!("Failed reading {}: {e}", src.display()))?;
            atomic_write_text(&dst_dir.join(name), &content)?;
        }
    }

    let daily_src = src_dir.join("daily");
    if daily_src.is_dir() {
        let daily_dst = dst_dir.join("daily");
        fs::create_dir_all(&daily_dst)
            .map_err(|e| format!("Failed to create daily dir {}: {e}", daily_dst.display()))?;
        if let Ok(entries) = fs::read_dir(&daily_src) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Some(fname) = path.file_name() {
                        let content = fs::read_to_string(&path)
                            .map_err(|e| format!("Failed reading {}: {e}", path.display()))?;
                        atomic_write_text(&daily_dst.join(fname), &content)?;
                    }
                }
            }
        }
    }

    let att_src = src_dir.join("attachments");
    if att_src.is_dir() {
        let att_dst = dst_dir.join("attachments");
        fs::create_dir_all(&att_dst)
            .map_err(|e| format!("Failed to create attachments dir {}: {e}", att_dst.display()))?;
        if let Ok(entries) = fs::read_dir(&att_src) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(fname) = path.file_name() {
                        let _ = fs::copy(&path, att_dst.join(fname));
                    }
                }
            }
        }
    }

    Ok(())
}

fn sanitize_ext(file_name: &str, fallback: &str) -> String {
    let raw = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(fallback);
    let clean: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(12)
        .collect::<String>()
        .to_lowercase();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean
    }
}

pub fn infer_mime_type(ext: &str) -> String {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "md" => "text/markdown",
        "txt" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn generate_attachment_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pid = std::process::id();
    format!("att-{nanos:x}-{pid:x}")
}

/// Strictly resolves `attachments/<safe-filename>` inside `data_dir`, blocking any traversal.
pub fn resolve_attachment_path(data_dir: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let stripped = rel_path
        .strip_prefix("attachments/")
        .ok_or_else(|| format!("Invalid attachment relative path: {rel_path}"))?;
    if stripped.is_empty()
        || stripped.contains('/')
        || stripped.contains('\\')
        || stripped.contains("..")
        || stripped.starts_with('.')
    {
        return Err(format!("Unsafe attachment filename: {rel_path}"));
    }
    Ok(data_dir.join("attachments").join(stripped))
}

fn atomic_write_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Invalid target path: {}", target.display()))?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;

    let file_name = target
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid filename".to_string())?;
    let tmp_path = parent.join(format!(".{}.{}.tmp", file_name, std::process::id()));

    {
        let mut f = File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {e}"))?;
        f.write_all(bytes)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;
    }

    fs::rename(&tmp_path, target).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to finalize attachment {}: {e}", target.display())
    })
}

pub fn import_attachment_file(
    data_dir: &Path,
    source_path: &Path,
) -> Result<StoredAttachmentMeta, String> {
    if !source_path.is_file() {
        return Err(format!("Source file does not exist: {}", source_path.display()));
    }
    let bytes = fs::read(source_path)
        .map_err(|e| format!("Failed to read source file {}: {e}", source_path.display()))?;
    let name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let ext = sanitize_ext(&name, "bin");
    let mime = infer_mime_type(&ext);
    save_attachment_bytes(data_dir, &name, &mime, &bytes)
}

fn percent_decode_utf8(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push(((hi << 4) | lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub fn normalize_pasted_local_path(raw: &str) -> Option<PathBuf> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return None;
    }
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        if s.len() >= 2 {
            s = s[1..s.len() - 1].trim().to_string();
        }
    }
    if let Some(rest) = s.strip_prefix("file://localhost") {
        s = percent_decode_utf8(rest);
    } else if let Some(rest) = s.strip_prefix("file://") {
        let decoded = percent_decode_utf8(rest);
        // Handle Windows file:///C:/path -> C:/path
        if decoded.len() >= 3
            && decoded.as_bytes()[0] == b'/'
            && decoded.as_bytes()[1].is_ascii_alphabetic()
            && decoded.as_bytes()[2] == b':'
        {
            s = decoded[1..].to_string();
        } else {
            s = decoded;
        }
    }

    // Unescape shell-escaped spaces/chars from macOS Finder/Terminal paste if raw path doesn't exist
    if !Path::new(&s).exists() && s.contains("\\ ") {
        s = s.replace("\\ ", " ");
    }

    if let Some(rest) = s.strip_prefix("~/") {
        let home = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from);
        if let Some(home) = home {
            return Some(home.join(rest));
        }
    }

    let p = PathBuf::from(&s);
    if p.is_absolute() {
        Some(p)
    } else {
        None
    }
}

/// Checks whether a pasted local path string points to a real file on disk; if so, imports it
/// into `<dataDir>/attachments/` and returns its metadata. Returns `Ok(None)` for non-files.
pub fn try_import_local_path(
    data_dir: &Path,
    raw_path: &str,
) -> Result<Option<StoredAttachmentMeta>, String> {
    let Some(candidate) = normalize_pasted_local_path(raw_path) else {
        return Ok(None);
    };
    if !candidate.is_file() {
        return Ok(None);
    }
    import_attachment_file(data_dir, &candidate).map(Some)
}

pub fn save_attachment_bytes(
    data_dir: &Path,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<StoredAttachmentMeta, String> {
    const MAX_BYTES: usize = 50 * 1024 * 1024; // 50 MiB safety guard
    if bytes.len() > MAX_BYTES {
        return Err("Attachment exceeds 50 MB size limit".to_string());
    }
    let fallback_ext = match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        _ => "bin",
    };
    let ext = sanitize_ext(file_name, fallback_ext);
    let id = generate_attachment_id();
    let stored_name = format!("{id}.{ext}");
    let rel_path = format!("attachments/{stored_name}");
    let target = resolve_attachment_path(data_dir, &rel_path)?;

    atomic_write_bytes(&target, bytes)?;

    let clean_display_name = if file_name.trim().is_empty() {
        stored_name
    } else {
        file_name.trim().to_string()
    };
    let resolved_mime = if mime_type.trim().is_empty() || mime_type == "application/octet-stream" {
        infer_mime_type(&ext)
    } else {
        mime_type.to_string()
    };

    Ok(StoredAttachmentMeta {
        id,
        name: clean_display_name,
        rel_path,
        mime_type: resolved_mime,
        size: bytes.len() as u64,
    })
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub fn read_attachment_data_url(data_dir: &Path, rel_path: &str) -> Result<String, String> {
    let full = resolve_attachment_path(data_dir, rel_path)?;
    let bytes = fs::read(&full)
        .map_err(|e| format!("Failed to read attachment {}: {e}", full.display()))?;
    let ext = sanitize_ext(rel_path, "bin");
    let mime = infer_mime_type(&ext);
    Ok(format!("data:{mime};base64,{}", encode_base64(&bytes)))
}

pub fn delete_attachment_file(data_dir: &Path, rel_path: &str) -> Result<(), String> {
    let full = resolve_attachment_path(data_dir, rel_path)?;
    if full.is_file() {
        fs::remove_file(&full)
            .map_err(|e| format!("Failed to delete attachment {}: {e}", full.display()))?;
    }
    Ok(())
}

/// Scans `attachments/` and deletes files not referenced by any record in tasks/assignments/notes.
pub fn cleanup_orphan_attachments(data_dir: &Path) -> Result<OrphanCleanupResult, String> {
    let att_dir = data_dir.join("attachments");
    if !att_dir.is_dir() {
        return Ok(OrphanCleanupResult {
            removed_count: 0,
            freed_bytes: 0,
        });
    }

    let mut referenced = std::collections::HashSet::<String>::new();
    for shard_file in ["tasks.json", "assignments.json", "notes.json"] {
        let p = data_dir.join(shard_file);
        if let Ok(raw) = fs::read_to_string(&p) {
            if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) {
                for item in items {
                    if let Some(Value::Array(atts)) = item.get("attachments") {
                        for att in atts {
                            if let Some(rel) = att.get("relPath").and_then(|v| v.as_str()) {
                                referenced.insert(rel.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    let mut removed_count = 0usize;
    let mut freed_bytes = 0u64;

    if let Ok(entries) = fs::read_dir(&att_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if fname.starts_with('.') || fname.ends_with(".tmp") {
                continue;
            }
            let rel = format!("attachments/{fname}");
            if !referenced.contains(&rel) {
                let sz = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if fs::remove_file(&path).is_ok() {
                    removed_count += 1;
                    freed_bytes += sz;
                }
            }
        }
    }

    Ok(OrphanCleanupResult {
        removed_count,
        freed_bytes,
    })
}

pub fn list_snapshots(data_dir: &Path) -> Vec<SnapshotInfo> {
    let snapshots_root = data_dir.join(".snapshots");
    let Ok(entries) = fs::read_dir(&snapshots_root) else {
        return vec![];
    };

    let mut out: Vec<SnapshotInfo> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_dir() {
                return None;
            }
            let name = p.file_name()?.to_str()?.to_string();
            if !is_date_snapshot_name(&name) {
                return None;
            }
            let top_count = fs::read_dir(&p)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .filter(|f| f.path().extension().and_then(|x| x.to_str()) == Some("json"))
                .count();
            let daily_count = fs::read_dir(p.join("daily"))
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .filter(|f| f.path().extension().and_then(|x| x.to_str()) == Some("json"))
                .count();
            Some(SnapshotInfo {
                date_key: name,
                file_count: top_count + daily_count,
            })
        })
        .collect();

    out.sort_by(|a, b| b.date_key.cmp(&a.date_key));
    out
}

pub fn restore_snapshot(
    data_dir: &Path,
    date_key: &str,
    tracker: &SelfWriteTracker,
) -> Result<WorkspaceBundle, String> {
    if !is_date_snapshot_name(date_key) {
        return Err(format!("Invalid snapshot date key: {date_key}"));
    }
    let snap_dir = data_dir.join(".snapshots").join(date_key);
    if !snap_dir.is_dir() {
        return Err(format!("Snapshot {date_key} not found"));
    }

    // Preserve current live state before restoring
    let pre_restore_dir = data_dir
        .join(".snapshots")
        .join(format!("pre-restore-{}", unix_secs()));
    let _ = copy_workspace_files(data_dir, &pre_restore_dir);

    let top_shards = [
        "meta.json",
        "tasks.json",
        "projects.json",
        "notes.json",
        "members.json",
        "assignments.json",
    ];
    for name in &top_shards {
        let src = snap_dir.join(name);
        if src.is_file() {
            let content = fs::read_to_string(&src)
                .map_err(|e| format!("Failed reading snapshot {}: {e}", src.display()))?;
            let dst = data_dir.join(name);
            tracker.record(&dst);
            atomic_write_text(&dst, &content)?;
            tracker.record(&dst);
        }
    }

    let snap_daily = snap_dir.join("daily");
    if snap_daily.is_dir() {
        let dst_daily = data_dir.join("daily");
        fs::create_dir_all(&dst_daily)
            .map_err(|e| format!("Failed to prepare daily dir: {e}"))?;
        if let Ok(entries) = fs::read_dir(&snap_daily) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Some(fname) = path.file_name() {
                        let content = fs::read_to_string(&path)
                            .map_err(|e| format!("Failed reading {}: {e}", path.display()))?;
                        let dst = dst_daily.join(fname);
                        tracker.record(&dst);
                        atomic_write_text(&dst, &content)?;
                        tracker.record(&dst);
                    }
                }
            }
        }
    }

    load_workspace(data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn atomic_write_saves_pretty_lf_json_and_leaves_no_tmp() {
        let tmp = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        let res = save_shard(tmp.path(), "tasks", r#"[{"id":"1","title":"Test"}]"#, &tracker);
        assert!(res.is_ok());

        let raw = fs::read_to_string(tmp.path().join("tasks.json")).unwrap();
        assert!(!raw.contains("\r\n"));
        assert!(raw.contains("\"title\": \"Test\""));

        let leftover_tmp = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!leftover_tmp);
    }

    #[test]
    fn rejects_invalid_shard_and_path_traversal() {
        let tmp = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        assert!(save_shard(tmp.path(), "../evil", "[]", &tracker).is_err());
        assert!(save_shard(tmp.path(), "daily:../../etc", "[]", &tracker).is_err());
        assert!(save_shard(tmp.path(), "daily:2026-W47", "[]", &tracker).is_ok());
    }

    #[test]
    fn rotates_snapshots_to_keep_latest_seven() {
        let tmp = TempDir::new().unwrap();
        atomic_write_text(&tmp.path().join("tasks.json"), "[]\n").unwrap();

        for day in 1..=10 {
            let key = format!("2026-11-{day:02}");
            ensure_daily_snapshot_for_date(tmp.path(), &key).unwrap();
        }

        let snaps = list_snapshots(tmp.path());
        assert_eq!(snaps.len(), 7);
        assert_eq!(snaps[0].date_key, "2026-11-10");
        assert_eq!(snaps[6].date_key, "2026-11-04");
    }

    #[test]
    fn corrupted_json_backs_up_and_recovers_from_snapshot() {
        let tmp = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        save_shard(tmp.path(), "tasks", r#"[{"id":"good"}]"#, &tracker).unwrap();
        ensure_daily_snapshot_for_date(tmp.path(), "2026-11-20").unwrap();

        // Corrupt live tasks.json
        fs::write(tmp.path().join("tasks.json"), "{broken json!!!").unwrap();

        let loaded = load_workspace(tmp.path()).unwrap();
        assert_eq!(loaded.tasks.as_array().unwrap().len(), 1);
        assert_eq!(loaded.tasks[0]["id"], "good");
        assert!(!loaded.warnings.is_empty());

        let has_corrupted_bak = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .any(|e| e.file_name().to_string_lossy().contains(".corrupted."));
        assert!(has_corrupted_bak);
    }

    #[test]
    fn saves_reads_and_deletes_attachments_safely() {
        let tmp = TempDir::new().unwrap();
        let meta = save_attachment_bytes(tmp.path(), "mockup.png", "image/png", &[137, 80, 78, 71])
            .unwrap();
        assert!(meta.rel_path.starts_with("attachments/"));
        assert!(meta.rel_path.ends_with(".png"));
        assert_eq!(meta.size, 4);

        let data_url = read_attachment_data_url(tmp.path(), &meta.rel_path).unwrap();
        assert!(data_url.starts_with("data:image/png;base64,"));

        // Path traversal must be rejected
        assert!(resolve_attachment_path(tmp.path(), "attachments/../tasks.json").is_err());
        assert!(resolve_attachment_path(tmp.path(), "../secret.txt").is_err());

        // Copy workspace carries attachments over
        let dst = TempDir::new().unwrap();
        copy_workspace_files(tmp.path(), dst.path()).unwrap();
        assert!(resolve_attachment_path(dst.path(), &meta.rel_path).unwrap().is_file());

        delete_attachment_file(tmp.path(), &meta.rel_path).unwrap();
        assert!(!resolve_attachment_path(tmp.path(), &meta.rel_path).unwrap().exists());
    }

    #[test]
    fn cleans_up_only_unreferenced_orphan_attachments() {
        let tmp = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        let keep = save_attachment_bytes(tmp.path(), "keep.png", "image/png", &[1, 2, 3, 4]).unwrap();
        let orphan = save_attachment_bytes(tmp.path(), "orphan.pdf", "application/pdf", &[5, 6, 7, 8, 9]).unwrap();

        let tasks_json = format!(
            r#"[{{"id":"t1","title":"Has att","attachments":[{{"id":"a1","kind":"image","name":"keep.png","relPath":"{}"}}]}}]"#,
            keep.rel_path
        );
        save_shard(tmp.path(), "tasks", &tasks_json, &tracker).unwrap();

        let res = cleanup_orphan_attachments(tmp.path()).unwrap();
        assert_eq!(res.removed_count, 1);
        assert_eq!(res.freed_bytes, 5);
        assert!(resolve_attachment_path(tmp.path(), &keep.rel_path).unwrap().is_file());
        assert!(!resolve_attachment_path(tmp.path(), &orphan.rel_path).unwrap().exists());
    }

    #[test]
    fn imports_pasted_local_paths_and_ignores_missing_ones() {
        let data = TempDir::new().unwrap();
        let src_dir = TempDir::new().unwrap();
        let img = src_dir.path().join("screen shot 中文.png");
        fs::write(&img, &[137, 80, 78, 71, 13, 10]).unwrap();

        // Raw quoted path
        let quoted = format!("\"{}\"", img.display());
        let imported = try_import_local_path(data.path(), &quoted).unwrap().unwrap();
        assert_eq!(imported.name, "screen shot 中文.png");
        assert_eq!(imported.mime_type, "image/png");
        assert!(resolve_attachment_path(data.path(), &imported.rel_path).unwrap().is_file());

        // file:// URI with percent-encoded space
        let encoded = format!(
            "file://{}",
            img.to_string_lossy().replace(' ', "%20")
        );
        let imported2 = try_import_local_path(data.path(), &encoded).unwrap().unwrap();
        assert_eq!(imported2.name, "screen shot 中文.png");

        // Non-existent path returns Ok(None) cleanly
        let missing = try_import_local_path(data.path(), "/nonexistent/path/ghost.png").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn deserializes_legacy_app_config_with_quick_capture_defaults() {
        let legacy = r#"{"dataDir":"/tmp/anchor","theme":"dark","accent":"blue","lang":"zh","closeToTray":true}"#;
        let mut cfg: AppConfig = serde_json::from_str(legacy).unwrap();
        cfg.normalize_storage_dirs(Path::new("/tmp/default/Anchor"));
        assert!(cfg.quick_capture_enabled);
        assert_eq!(cfg.quick_capture_shortcut, default_quick_capture_shortcut());
        assert_eq!(cfg.quick_capture_default_mode, "last");
        assert_eq!(cfg.storage_mode, "local");
        assert_eq!(cfg.local_data_dir, "/tmp/anchor");
        assert_ne!(cfg.local_data_dir, cfg.git_data_dir);
        assert_eq!(cfg.data_dir, "/tmp/anchor");
        assert_eq!(cfg.ignored_update_version, "");
    }

    #[test]
    fn migrates_legacy_git_config_into_isolated_git_and_local_dirs() {
        let base = Path::new("docs").join("Anchor");
        let expected_local = Path::new("docs").join("Anchor-Local");
        let legacy = serde_json::json!({
            "dataDir": base.to_string_lossy(),
            "gitRemoteUrl": "https://gitee.com/demo/anchor.git"
        })
        .to_string();
        let mut cfg: AppConfig = serde_json::from_str(&legacy).unwrap();
        cfg.normalize_storage_dirs(&base);
        assert_eq!(cfg.storage_mode, "git");
        assert_eq!(Path::new(&cfg.git_data_dir), base.as_path());
        assert_eq!(Path::new(&cfg.local_data_dir), expected_local.as_path());
        assert_eq!(Path::new(&cfg.data_dir), base.as_path());
    }

    #[test]
    fn copy_workspace_files_excludes_git_metadata() {
        let src = TempDir::new().unwrap();
        let dst = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        save_shard(src.path(), "tasks", r#"[{"id":"t1","title":"Keep"}]"#, &tracker).unwrap();
        fs::create_dir_all(src.path().join(".git")).unwrap();
        fs::write(src.path().join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();

        copy_workspace_files(src.path(), dst.path()).unwrap();
        assert!(dst.path().join("tasks.json").is_file());
        assert!(!dst.path().join(".git").exists());
    }
}
