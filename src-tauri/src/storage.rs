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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub data_dir: String,
    pub theme: String,
    pub accent: String,
    pub lang: String,
    pub close_to_tray: bool,
}

impl AppConfig {
    pub fn default_with_dir(default_data_dir: PathBuf) -> Self {
        Self {
            data_dir: default_data_dir.to_string_lossy().to_string(),
            theme: "system".to_string(),
            accent: "blue".to_string(),
            lang: "zh".to_string(),
            close_to_tray: true,
        }
    }
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
            if cfg.data_dir.trim().is_empty() {
                cfg.data_dir = default_data_dir.to_string_lossy().to_string();
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

    Ok(())
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
}
