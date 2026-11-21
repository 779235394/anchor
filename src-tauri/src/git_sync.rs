use crate::storage::{
    atomic_write_text, load_workspace, SelfWriteTracker, WorkspaceBundle,
};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const DATA_GITIGNORE: &str = "# Anchor local-only artifacts (never sync)\n.snapshots/\n*.tmp\n*.corrupted.*.bak\n.DS_Store\nThumbs.db\n";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAuth {
    #[serde(default)]
    pub mode: String, // "system" | "https_token"
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitInfo {
    pub hash: String,
    pub message: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub git_available: bool,
    pub git_version: String,
    pub is_repo: bool,
    pub remote_url: String,
    pub branch: String,
    pub dirty_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub recent_commits: Vec<GitCommitInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConnectionResult {
    pub ok: bool,
    pub default_branch: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullResult {
    pub outcome: String, // "up_to_date" | "updated" | "empty_remote" | "semantic_merge"
    pub had_conflict: bool,
    pub local_bundle: Option<WorkspaceBundle>,
    pub remote_bundle: Option<WorkspaceBundle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub committed: bool,
    pub pushed: bool,
    pub status: GitStatus,
}

struct AskPassGuard {
    script_path: Option<PathBuf>,
}

impl AskPassGuard {
    fn create(auth: &GitAuth) -> Result<Self, String> {
        if auth.mode != "https_token" || auth.token.trim().is_empty() {
            return Ok(Self { script_path: None });
        }
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let pid = std::process::id();

        #[cfg(target_os = "windows")]
        let (path, content) = (
            std::env::temp_dir().join(format!("anchor-askpass-{pid}-{nanos}.cmd")),
            "@echo off\r\necho %~1 | findstr /i \"username\" >nul && (echo %ANCHOR_GIT_USER%) || (echo %ANCHOR_GIT_TOKEN%)\r\n"
                .to_string(),
        );

        #[cfg(not(target_os = "windows"))]
        let (path, content) = (
            std::env::temp_dir().join(format!("anchor-askpass-{pid}-{nanos}.sh")),
            "#!/bin/sh\ncase \"$1\" in\n  *[Uu]sername*) printf '%s\\n' \"$ANCHOR_GIT_USER\" ;;\n  *) printf '%s\\n' \"$ANCHOR_GIT_TOKEN\" ;;\nesac\n"
                .to_string(),
        );

        fs::write(&path, content)
            .map_err(|e| format!("Failed to create temporary git askpass script: {e}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o700));
        }

        Ok(Self {
            script_path: Some(path),
        })
    }
}

impl Drop for AskPassGuard {
    fn drop(&mut self) {
        if let Some(p) = &self.script_path {
            let _ = fs::remove_file(p);
        }
    }
}

pub fn find_git_binary() -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = {
        #[cfg(target_os = "macos")]
        {
            vec![
                PathBuf::from("/opt/homebrew/bin/git"),
                PathBuf::from("/usr/local/bin/git"),
                PathBuf::from("/usr/bin/git"),
                PathBuf::from("git"),
            ]
        }
        #[cfg(target_os = "windows")]
        {
            vec![
                PathBuf::from("git"),
                PathBuf::from(r"C:\Program Files\Git\cmd\git.exe"),
                PathBuf::from(r"C:\Program Files (x86)\Git\cmd\git.exe"),
            ]
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            vec![PathBuf::from("/usr/bin/git"), PathBuf::from("git")]
        }
    };

    for bin in candidates {
        let mut cmd = Command::new(&bin);
        cmd.arg("--version");
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                return Some(bin);
            }
        }
    }
    None
}

fn sanitize_error(raw: &str, token: &str) -> String {
    let trimmed = raw.trim();
    if token.trim().is_empty() {
        return trimmed.to_string();
    }
    trimmed.replace(token.trim(), "***")
}

fn run_git(cwd: Option<&Path>, args: &[&str], auth: Option<&GitAuth>) -> Result<String, String> {
    let bin = find_git_binary()
        .ok_or_else(|| "未检测到本机 Git，请先安装 Git（macOS: xcode-select --install，Windows: git-scm.com）".to_string())?;

    let default_auth = GitAuth::default();
    let effective_auth = auth.unwrap_or(&default_auth);
    let askpass = AskPassGuard::create(effective_auth)?;

    let mut cmd = Command::new(&bin);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Some(script) = &askpass.script_path {
        let user = if effective_auth.username.trim().is_empty() {
            "oauth2"
        } else {
            effective_auth.username.trim()
        };
        cmd.env("GIT_ASKPASS", script)
            .env("ANCHOR_GIT_USER", user)
            .env("ANCHOR_GIT_TOKEN", effective_auth.token.trim());
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute git {:?}: {e}", args))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = if stderr.trim().is_empty() {
            stdout.to_string()
        } else {
            stderr.to_string()
        };
        Err(sanitize_error(&combined, &effective_auth.token))
    }
}

pub fn ensure_data_gitignore(data_dir: &Path) -> Result<(), String> {
    let gi_path = data_dir.join(".gitignore");
    if gi_path.is_file() {
        let existing = fs::read_to_string(&gi_path).unwrap_or_default();
        if existing.contains(".snapshots/") && existing.contains("*.tmp") {
            return Ok(());
        }
        let merged = format!("{}\n{}", existing.trim_end(), DATA_GITIGNORE);
        return atomic_write_text(&gi_path, &merged);
    }
    atomic_write_text(&gi_path, DATA_GITIGNORE)
}

fn ensure_git_identity(data_dir: &Path) {
    let has_name = run_git(Some(data_dir), &["config", "user.name"], None)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !has_name {
        let _ = run_git(Some(data_dir), &["config", "user.name", "Anchor Sync"], None);
    }
    let has_email = run_git(Some(data_dir), &["config", "user.email"], None)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !has_email {
        let _ = run_git(
            Some(data_dir),
            &["config", "user.email", "anchor@local.sync"],
            None,
        );
    }
}

pub fn get_git_status(data_dir: &Path) -> GitStatus {
    let Some(bin) = find_git_binary() else {
        return GitStatus {
            git_available: false,
            git_version: String::new(),
            is_repo: false,
            remote_url: String::new(),
            branch: "main".to_string(),
            dirty_count: 0,
            ahead: 0,
            behind: 0,
            recent_commits: vec![],
        };
    };

    let mut v_cmd = Command::new(&bin);
    v_cmd.arg("--version");
    #[cfg(target_os = "windows")]
    v_cmd.creation_flags(CREATE_NO_WINDOW);
    let git_version = v_cmd
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();

    let is_repo = data_dir.join(".git").exists()
        || run_git(Some(data_dir), &["rev-parse", "--is-inside-work-tree"], None)
            .map(|s| s.trim() == "true")
            .unwrap_or(false);

    if !is_repo {
        return GitStatus {
            git_available: true,
            git_version,
            is_repo: false,
            remote_url: String::new(),
            branch: "main".to_string(),
            dirty_count: 0,
            ahead: 0,
            behind: 0,
            recent_commits: vec![],
        };
    }

    let remote_url = run_git(Some(data_dir), &["remote", "get-url", "origin"], None)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let branch = run_git(Some(data_dir), &["symbolic-ref", "--short", "HEAD"], None)
        .or_else(|_| run_git(Some(data_dir), &["rev-parse", "--abbrev-ref", "HEAD"], None))
        .map(|s| {
            let b = s.trim();
            if b.is_empty() || b == "HEAD" {
                "main".to_string()
            } else {
                b.to_string()
            }
        })
        .unwrap_or_else(|_| "main".to_string());

    let dirty_count = run_git(Some(data_dir), &["status", "--porcelain"], None)
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    let (ahead, behind) = run_git(
        Some(data_dir),
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("HEAD...origin/{branch}"),
        ],
        None,
    )
    .ok()
    .and_then(|s| {
        let mut parts = s.split_whitespace();
        let a = parts.next()?.parse::<usize>().ok()?;
        let b = parts.next()?.parse::<usize>().ok()?;
        Some((a, b))
    })
    .unwrap_or((0, 0));

    let recent_commits = run_git(
        Some(data_dir),
        &["log", "-n", "10", "--pretty=format:%h%x1f%s%x1f%ad", "--date=format:%Y-%m-%d %H:%M"],
        None,
    )
    .ok()
    .map(|out| {
        out.lines()
            .filter_map(|line| {
                let mut p = line.split('\x1f');
                let hash = p.next()?.trim().to_string();
                let message = p.next()?.trim().to_string();
                let date = p.next()?.trim().to_string();
                if hash.is_empty() {
                    return None;
                }
                Some(GitCommitInfo { hash, message, date })
            })
            .collect()
    })
    .unwrap_or_default();

    GitStatus {
        git_available: true,
        git_version,
        is_repo: true,
        remote_url,
        branch,
        dirty_count,
        ahead,
        behind,
        recent_commits,
    }
}

pub fn git_test_connection(remote_url: &str, auth: &GitAuth) -> GitConnectionResult {
    let url = remote_url.trim();
    if url.is_empty() {
        return GitConnectionResult {
            ok: false,
            default_branch: "main".to_string(),
            message: "请先输入 Git 仓库地址".to_string(),
        };
    }

    match run_git(None, &["ls-remote", "--symref", url, "HEAD"], Some(auth)) {
        Ok(out) => {
            let mut default_branch = "main".to_string();
            for line in out.lines() {
                if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
                    if let Some(name) = rest.split_whitespace().next() {
                        default_branch = name.to_string();
                        break;
                    }
                }
            }
            GitConnectionResult {
                ok: true,
                default_branch,
                message: "连接成功".to_string(),
            }
        }
        Err(err) => GitConnectionResult {
            ok: false,
            default_branch: "main".to_string(),
            message: err,
        },
    }
}

pub fn git_init_bind(data_dir: &Path, remote_url: &str, branch: &str) -> Result<GitStatus, String> {
    let url = remote_url.trim();
    if url.is_empty() {
        return Err("Git 仓库地址不能为空".to_string());
    }
    let target_branch = if branch.trim().is_empty() {
        "main"
    } else {
        branch.trim()
    };

    fs::create_dir_all(data_dir)
        .map_err(|e| format!("Failed to prepare data dir: {e}"))?;

    if !data_dir.join(".git").exists() {
        run_git(Some(data_dir), &["init"], None)?;
        let _ = run_git(
            Some(data_dir),
            &["symbolic-ref", "HEAD", &format!("refs/heads/{target_branch}")],
            None,
        );
    }

    ensure_data_gitignore(data_dir)?;
    ensure_git_identity(data_dir);

    let has_origin = run_git(Some(data_dir), &["remote", "get-url", "origin"], None).is_ok();
    if has_origin {
        run_git(Some(data_dir), &["remote", "set-url", "origin", url], None)?;
    } else {
        run_git(Some(data_dir), &["remote", "add", "origin", url], None)?;
    }

    Ok(get_git_status(data_dir))
}

pub fn git_clone_into_dir(
    remote_url: &str,
    target_dir: &Path,
    branch: &str,
    auth: &GitAuth,
) -> Result<GitStatus, String> {
    let url = remote_url.trim();
    if url.is_empty() {
        return Err("Git 仓库地址不能为空".to_string());
    }
    if target_dir.join(".git").exists() {
        return Err("目标目录已经是 Git 仓库，请直接使用「切换目录」或「绑定当前目录」".to_string());
    }
    if target_dir.exists() {
        let non_empty = fs::read_dir(target_dir)
            .ok()
            .map(|mut rd| rd.next().is_some())
            .unwrap_or(false);
        if non_empty {
            return Err("目标目录非空，请选择一个空文件夹来克隆远端数据仓库".to_string());
        }
    } else {
        fs::create_dir_all(target_dir)
            .map_err(|e| format!("Failed to create target dir: {e}"))?;
    }

    let target_str = target_dir.to_string_lossy().to_string();
    let mut args = vec!["clone"];
    if !branch.trim().is_empty() {
        args.push("--branch");
        args.push(branch.trim());
    }
    args.push(url);
    args.push(&target_str);

    // If specified branch doesn't exist yet (e.g. empty repo), fallback to plain clone
    if let Err(first_err) = run_git(None, &args, Some(auth)) {
        if !branch.trim().is_empty() {
            run_git(None, &["clone", url, &target_str], Some(auth))
                .map_err(|_| first_err)?;
        } else {
            return Err(first_err);
        }
    }

    let _ = ensure_data_gitignore(target_dir);
    ensure_git_identity(target_dir);
    Ok(get_git_status(target_dir))
}

fn backup_local_attachments(data_dir: &Path) -> Option<PathBuf> {
    let att_dir = data_dir.join("attachments");
    if !att_dir.is_dir() {
        return None;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let backup_dir = std::env::temp_dir().join(format!("anchor-att-bak-{nanos}"));
    if fs::create_dir_all(&backup_dir).is_err() {
        return None;
    }
    let mut copied = 0usize;
    if let Ok(entries) = fs::read_dir(&att_dir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                if let Some(name) = p.file_name() {
                    if fs::copy(&p, backup_dir.join(name)).is_ok() {
                        copied += 1;
                    }
                }
            }
        }
    }
    if copied > 0 {
        Some(backup_dir)
    } else {
        let _ = fs::remove_dir_all(&backup_dir);
        None
    }
}

fn restore_missing_attachments(backup_dir: &Path, data_dir: &Path) {
    let dst_dir = data_dir.join("attachments");
    let _ = fs::create_dir_all(&dst_dir);
    if let Ok(entries) = fs::read_dir(backup_dir) {
        for e in entries.flatten() {
            let src = e.path();
            if src.is_file() {
                if let Some(name) = src.file_name() {
                    let dst = dst_dir.join(name);
                    if !dst.exists() {
                        let _ = fs::copy(&src, &dst);
                    }
                }
            }
        }
    }
    let _ = fs::remove_dir_all(backup_dir);
}

fn record_all_json_self_writes(data_dir: &Path, tracker: &SelfWriteTracker) {
    for name in [
        "meta.json",
        "tasks.json",
        "projects.json",
        "notes.json",
        "members.json",
        "assignments.json",
    ] {
        tracker.record(&data_dir.join(name));
    }
    if let Ok(entries) = fs::read_dir(data_dir.join("daily")) {
        for e in entries.flatten() {
            tracker.record(&e.path());
        }
    }
}

/// Fetches remote updates and integrates them cleanly.
/// If a rebase conflict happens (two machines edited the same JSON shard offline),
/// aborts the textual conflict, resets cleanly to remote + unions attachments,
/// and returns both `local_bundle` and `remote_bundle` so the frontend performs
/// lossless record-level LWW semantic merge via `mergeWorkspaces`.
pub fn git_pull_prepare(
    data_dir: &Path,
    branch: &str,
    auth: &GitAuth,
    tracker: &SelfWriteTracker,
) -> Result<GitPullResult, String> {
    if !data_dir.join(".git").exists() {
        return Err("当前数据目录尚未初始化 Git 仓库".to_string());
    }
    ensure_data_gitignore(data_dir)?;
    ensure_git_identity(data_dir);

    let active_branch = if branch.trim().is_empty() {
        get_git_status(data_dir).branch
    } else {
        branch.trim().to_string()
    };

    let local_bundle = load_workspace(data_dir)?;

    // Fetch remote
    run_git(Some(data_dir), &["fetch", "origin"], Some(auth))?;

    let remote_ref = format!("origin/{active_branch}");
    let remote_exists = run_git(Some(data_dir), &["rev-parse", "--verify", &remote_ref], None).is_ok();
    if !remote_exists {
        return Ok(GitPullResult {
            outcome: "empty_remote".to_string(),
            had_conflict: false,
            local_bundle: None,
            remote_bundle: None,
        });
    }

    // Commit any uncommitted local changes before pull/rebase so nothing is lost
    let dirty = run_git(Some(data_dir), &["status", "--porcelain"], None)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if dirty {
        run_git(Some(data_dir), &["add", "-A"], None)?;
        let msg = format!("sync(anchor): local snapshot {}", Local::now().format("%Y-%m-%d %H:%M"));
        let _ = run_git(Some(data_dir), &["commit", "-m", &msg], None);
    }

    // Evaluate HEAD *after* committing local files so binding a populated local folder to a
    // non-empty remote (e.g. initialized with README.md or existing data) never discards local
    // records via `checkout -B`, and instead cleanly rebases or falls back to semantic_merge.
    let head_exists = run_git(Some(data_dir), &["rev-parse", "--verify", "HEAD"], None).is_ok();

    // Check if remote actually has commits we don't have
    if head_exists {
        let behind_cnt = run_git(
            Some(data_dir),
            &["rev-list", "--count", &format!("HEAD..{remote_ref}")],
            None,
        )
        .ok()
        .and_then(|s| s.trim().parse::<usize>().ok())
        .unwrap_or(0);

        if behind_cnt == 0 {
            return Ok(GitPullResult {
                outcome: "up_to_date".to_string(),
                had_conflict: false,
                local_bundle: None,
                remote_bundle: None,
            });
        }
    }

    let att_backup = backup_local_attachments(data_dir);
    record_all_json_self_writes(data_dir, tracker);

    let pull_ok = if head_exists {
        run_git(
            Some(data_dir),
            &["pull", "--rebase", "origin", &active_branch],
            Some(auth),
        )
        .is_ok()
    } else {
        // Fresh local repo with no commits yet: check out remote branch
        run_git(
            Some(data_dir),
            &["checkout", "-B", &active_branch, &remote_ref],
            None,
        )
        .is_ok()
    };

    if pull_ok {
        if let Some(bak) = att_backup {
            restore_missing_attachments(&bak, data_dir);
        }
        record_all_json_self_writes(data_dir, tracker);
        let updated = load_workspace(data_dir)?;
        return Ok(GitPullResult {
            outcome: "updated".to_string(),
            had_conflict: false,
            local_bundle: None,
            remote_bundle: Some(updated),
        });
    }

    // Rebase conflicted: cleanly abort, align to remote, union attachments, and let frontend semantic-merge!
    let _ = run_git(Some(data_dir), &["rebase", "--abort"], None);
    let _ = run_git(Some(data_dir), &["merge", "--abort"], None);
    run_git(Some(data_dir), &["reset", "--hard", &remote_ref], None)?;
    if let Some(bak) = att_backup {
        restore_missing_attachments(&bak, data_dir);
    }
    let _ = ensure_data_gitignore(data_dir);
    record_all_json_self_writes(data_dir, tracker);
    let remote_bundle = load_workspace(data_dir)?;

    Ok(GitPullResult {
        outcome: "semantic_merge".to_string(),
        had_conflict: true,
        local_bundle: Some(local_bundle),
        remote_bundle: Some(remote_bundle),
    })
}

pub fn git_commit_and_push(
    data_dir: &Path,
    branch: &str,
    custom_message: Option<&str>,
    auth: &GitAuth,
) -> Result<GitPushResult, String> {
    if !data_dir.join(".git").exists() {
        return Err("当前数据目录尚未初始化 Git 仓库".to_string());
    }
    ensure_data_gitignore(data_dir)?;
    ensure_git_identity(data_dir);

    let active_branch = if branch.trim().is_empty() {
        get_git_status(data_dir).branch
    } else {
        branch.trim().to_string()
    };

    // Ensure local branch name matches configured target branch
    let head_exists = run_git(Some(data_dir), &["rev-parse", "--verify", "HEAD"], None).is_ok();
    if head_exists {
        let cur = get_git_status(data_dir).branch;
        if cur != active_branch {
            let _ = run_git(Some(data_dir), &["branch", "-M", &active_branch], None);
        }
    }

    run_git(Some(data_dir), &["add", "-A"], None)?;
    let has_staged = run_git(Some(data_dir), &["status", "--porcelain"], None)
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let mut committed = false;
    if has_staged {
        let default_msg = format!("sync(anchor): {}", Local::now().format("%Y-%m-%d %H:%M"));
        let msg = custom_message
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(&default_msg);
        run_git(Some(data_dir), &["commit", "-m", msg], None)?;
        committed = true;
    }

    let has_any_commit = run_git(Some(data_dir), &["rev-parse", "--verify", "HEAD"], None).is_ok();
    let mut pushed = false;
    if has_any_commit {
        run_git(
            Some(data_dir),
            &["push", "-u", "origin", &active_branch],
            Some(auth),
        )?;
        pushed = true;
    }

    Ok(GitPushResult {
        committed,
        pushed,
        status: get_git_status(data_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{save_attachment_bytes, save_shard};
    use tempfile::TempDir;

    #[test]
    fn syncs_between_two_clones_and_recovers_cleanly_from_json_conflict() {
        if find_git_binary().is_none() {
            return;
        }
        let bare = TempDir::new().unwrap();
        run_git(Some(bare.path()), &["init", "--bare"], None).unwrap();
        let remote_url = bare.path().to_string_lossy().to_string();

        let mac = TempDir::new().unwrap();
        let win = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();
        let auth = GitAuth::default();

        // 1. Mac initializes, writes initial task, binds & pushes to bare remote
        save_shard(
            mac.path(),
            "tasks",
            r#"[{"id":"t1","title":"Shared","updatedAt":1000}]"#,
            &tracker,
        )
        .unwrap();
        git_init_bind(mac.path(), &remote_url, "main").unwrap();
        let push1 = git_commit_and_push(mac.path(), "main", Some("init"), &auth).unwrap();
        assert!(push1.committed);
        assert!(push1.pushed);

        // Verify .gitignore ignores .snapshots/
        assert!(mac.path().join(".gitignore").is_file());

        // 2. Windows clones from remote
        let win_repo = win.path().join("data");
        let st_win = git_clone_into_dir(&remote_url, &win_repo, "main", &auth).unwrap();
        assert!(st_win.is_repo);
        let win_loaded = load_workspace(&win_repo).unwrap();
        assert_eq!(win_loaded.tasks.as_array().unwrap().len(), 1);

        // 3. Both Mac and Windows edit tasks.json offline (conflict!) + Windows adds a local attachment
        save_shard(
            mac.path(),
            "tasks",
            r#"[{"id":"t1","title":"Mac edit","updatedAt":2000}]"#,
            &tracker,
        )
        .unwrap();
        git_commit_and_push(mac.path(), "main", Some("mac edit"), &auth).unwrap();

        save_shard(
            &win_repo,
            "tasks",
            r#"[{"id":"t1","title":"Win edit","updatedAt":3000},{"id":"t2","title":"Win new","updatedAt":3000}]"#,
            &tracker,
        )
        .unwrap();
        let win_att = save_attachment_bytes(&win_repo, "win.png", "image/png", &[1, 2, 3]).unwrap();

        // 4. Windows pulls -> detects conflict -> cleanly triggers semantic_merge with BOTH bundles + preserves attachment!
        let pull_res = git_pull_prepare(&win_repo, "main", &auth, &tracker).unwrap();
        assert_eq!(pull_res.outcome, "semantic_merge");
        assert!(pull_res.had_conflict);
        assert_eq!(
            pull_res.local_bundle.unwrap().tasks.as_array().unwrap().len(),
            2
        );
        assert_eq!(
            pull_res.remote_bundle.unwrap().tasks[0]["title"],
            "Mac edit"
        );
        assert!(win_repo.join(&win_att.rel_path).is_file());
    }

    #[test]
    fn preserves_local_data_when_first_binding_to_non_empty_remote() {
        if find_git_binary().is_none() {
            return;
        }
        let bare = TempDir::new().unwrap();
        run_git(Some(bare.path()), &["init", "--bare"], None).unwrap();
        let remote_url = bare.path().to_string_lossy().to_string();
        let tracker = SelfWriteTracker::default();
        let auth = GitAuth::default();

        // Simulate a newly created Gitee/GitHub repo initialized with a README.md
        let seeder = TempDir::new().unwrap();
        git_init_bind(seeder.path(), &remote_url, "main").unwrap();
        fs::write(seeder.path().join("README.md"), "# My Anchor Data\n").unwrap();
        git_commit_and_push(seeder.path(), "main", Some("Initial README"), &auth).unwrap();

        // First-time user adds a local task BEFORE binding the remote repo
        let local_user = TempDir::new().unwrap();
        save_shard(
            local_user.path(),
            "tasks",
            r#"[{"id":"t-local","title":"Local first task","updatedAt":5000}]"#,
            &tracker,
        )
        .unwrap();
        git_init_bind(local_user.path(), &remote_url, "main").unwrap();

        let pull_res = git_pull_prepare(local_user.path(), "main", &auth, &tracker).unwrap();
        assert!(local_user.path().join("README.md").is_file());
        if pull_res.outcome == "semantic_merge" {
            let local_tasks = pull_res.local_bundle.unwrap().tasks;
            assert_eq!(local_tasks.as_array().unwrap().len(), 1);
            assert_eq!(local_tasks[0]["title"], "Local first task");
        } else {
            assert_eq!(pull_res.outcome, "updated");
            let tasks = pull_res.remote_bundle.unwrap().tasks;
            assert_eq!(tasks.as_array().unwrap().len(), 1);
            assert_eq!(tasks[0]["title"], "Local first task");
        }
    }
}
