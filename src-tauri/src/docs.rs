use crate::storage::{atomic_write_text, SelfWriteTracker};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DOCS_DIR_NAME: &str = "docs";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocEntry {
    pub rel_path: String,
    pub name: String,
    pub is_dir: bool,
    pub updated_at: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFileContent {
    pub rel_path: String,
    pub content: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSearchHit {
    pub rel_path: String,
    pub name: String,
    pub snippet: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportResult {
    pub root_folder_rel_path: String,
    pub imported_docs: Vec<DocEntry>,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsImportResult {
    pub imported_docs: Vec<DocEntry>,
    pub imported_folders: Vec<String>,
    pub skipped_count: usize,
}

pub fn docs_root(data_dir: &Path) -> PathBuf {
    data_dir.join(DOCS_DIR_NAME)
}

fn system_time_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_updated_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(system_time_ms)
        .unwrap_or(0)
}

fn is_forbidden_segment(seg: &str) -> bool {
    if seg.is_empty() || seg == "." || seg == ".." || seg.starts_with('.') {
        return true;
    }
    if seg.ends_with(' ') || seg.ends_with('.') {
        return true;
    }
    seg.chars().any(|c| {
        matches!(
            c,
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'
        ) || c.is_control()
    })
}

/// Validates and resolves a forward-slash relative path strictly inside `<dataDir>/docs/`.
pub fn resolve_doc_path(data_dir: &Path, rel_path: &str) -> Result<(String, PathBuf), String> {
    let raw = rel_path.trim();
    if raw.starts_with('/') || raw.starts_with('\\') {
        return Err("文档路径必须是相对路径".to_string());
    }
    let trimmed = raw.replace('\\', "/");
    let stripped = trimmed.trim_end_matches('/');
    if stripped.is_empty() {
        return Err("文档路径不能为空".to_string());
    }

    let mut clean_segments: Vec<&str> = Vec::new();
    for seg in stripped.split('/') {
        if is_forbidden_segment(seg) {
            return Err(format!("包含非法路径或文件名字符：{seg}"));
        }
        clean_segments.push(seg);
    }

    let normalized = clean_segments.join("/");
    let mut full = docs_root(data_dir);
    for seg in &clean_segments {
        full.push(seg);
    }
    Ok((normalized, full))
}

/// Validates and resolves an optional relative folder path (empty string = `<dataDir>/docs/`).
pub fn resolve_doc_dir_path(data_dir: &Path, rel_dir: &str) -> Result<(String, PathBuf), String> {
    let trimmed = rel_dir.trim().replace('\\', "/");
    let stripped = trimmed.trim_matches('/');
    if stripped.is_empty() {
        return Ok((String::new(), docs_root(data_dir)));
    }
    resolve_doc_path(data_dir, stripped)
}

fn ensure_md_extension(rel_path: &str) -> Result<(), String> {
    if !rel_path.to_lowercase().ends_with(".md") {
        return Err("知识库文档仅支持 .md 格式文件".to_string());
    }
    Ok(())
}

fn walk_docs_dir(root: &Path, current: &Path, out: &mut Vec<DocEntry>) -> Result<(), String> {
    let read_dir = match fs::read_dir(current) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("读取知识库目录失败 {}: {e}", current.display())),
    };

    for entry_res in read_dir {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_name_os = entry.file_name();
        let Some(name) = file_name_os.to_str() else {
            continue;
        };
        if name.starts_with('.') || name.ends_with(".tmp") || name.ends_with(".bak") {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let is_dir = meta.is_dir();
        if !is_dir && !name.to_lowercase().ends_with(".md") {
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .map_err(|e| format!("路径解析失败: {e}"))?;
        let rel_path = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        let updated_at = meta.modified().map(system_time_ms).unwrap_or(0);
        let size = if is_dir { 0 } else { meta.len() };

        out.push(DocEntry {
            rel_path,
            name: name.to_string(),
            is_dir,
            updated_at,
            size,
        });

        if is_dir {
            walk_docs_dir(root, &path, out)?;
        }
    }

    Ok(())
}

pub fn list_docs_tree(data_dir: &Path) -> Result<Vec<DocEntry>, String> {
    let root = docs_root(data_dir);
    fs::create_dir_all(&root).map_err(|e| format!("初始化知识库目录失败: {e}"))?;
    let mut entries = Vec::new();
    walk_docs_dir(&root, &root, &mut entries)?;
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.rel_path.to_lowercase().cmp(&b.rel_path.to_lowercase()))
    });
    Ok(entries)
}

pub fn read_doc_file(data_dir: &Path, rel_path: &str) -> Result<DocFileContent, String> {
    let (norm, full) = resolve_doc_path(data_dir, rel_path)?;
    ensure_md_extension(&norm)?;
    let content = fs::read_to_string(&full)
        .map_err(|e| format!("读取文档 {norm} 失败: {e}"))?;
    let updated_at = file_updated_ms(&full);
    Ok(DocFileContent {
        rel_path: norm,
        content,
        updated_at,
    })
}

pub fn write_doc_file(
    data_dir: &Path,
    rel_path: &str,
    content: &str,
    tracker: &SelfWriteTracker,
) -> Result<DocFileContent, String> {
    let (norm, full) = resolve_doc_path(data_dir, rel_path)?;
    ensure_md_extension(&norm)?;
    tracker.record(&full);
    atomic_write_text(&full, content)?;
    let updated_at = file_updated_ms(&full);
    Ok(DocFileContent {
        rel_path: norm,
        content: content.replace("\r\n", "\n"),
        updated_at,
    })
}

pub fn create_doc_folder(
    data_dir: &Path,
    rel_path: &str,
    tracker: &SelfWriteTracker,
) -> Result<DocEntry, String> {
    let (norm, full) = resolve_doc_path(data_dir, rel_path)?;
    if full.exists() && !full.is_dir() {
        return Err(format!("同名文件已存在：{norm}"));
    }
    tracker.record(&full);
    fs::create_dir_all(&full).map_err(|e| format!("创建文件夹失败 {norm}: {e}"))?;
    let name = full
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&norm)
        .to_string();
    Ok(DocEntry {
        rel_path: norm,
        name,
        is_dir: true,
        updated_at: file_updated_ms(&full),
        size: 0,
    })
}

pub fn rename_doc_entry(
    data_dir: &Path,
    old_rel_path: &str,
    new_rel_path: &str,
    tracker: &SelfWriteTracker,
) -> Result<String, String> {
    let (old_norm, old_full) = resolve_doc_path(data_dir, old_rel_path)?;
    let (new_norm, new_full) = resolve_doc_path(data_dir, new_rel_path)?;

    if !old_full.exists() {
        return Err(format!("源文件或文件夹不存在：{old_norm}"));
    }
    if old_norm == new_norm {
        return Ok(new_norm);
    }
    if old_full.is_file() {
        ensure_md_extension(&new_norm)?;
    }
    if old_full.is_dir()
        && (new_norm == old_norm || new_norm.starts_with(&format!("{old_norm}/")))
    {
        return Err("不能将文件夹移动到自身子目录内".to_string());
    }
    // Allow case-only rename on case-insensitive filesystems (macOS/Windows)
    let case_only_rename = old_norm.to_lowercase() == new_norm.to_lowercase();
    if new_full.exists() && !case_only_rename {
        return Err(format!("目标已存在：{new_norm}"));
    }

    if let Some(parent) = new_full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {e}"))?;
    }

    tracker.record(&old_full);
    tracker.record(&new_full);

    if case_only_rename {
        let tmp = old_full.with_extension(format!("anchor_rename_{}.tmp", std::process::id()));
        fs::rename(&old_full, &tmp).map_err(|e| format!("重命名失败: {e}"))?;
        if let Err(e) = fs::rename(&tmp, &new_full) {
            let _ = fs::rename(&tmp, &old_full);
            return Err(format!("重命名失败: {e}"));
        }
    } else {
        fs::rename(&old_full, &new_full).map_err(|e| format!("移动/重命名失败: {e}"))?;
    }

    Ok(new_norm)
}

pub fn delete_doc_entry(
    data_dir: &Path,
    rel_path: &str,
    tracker: &SelfWriteTracker,
) -> Result<(), String> {
    let (norm, full) = resolve_doc_path(data_dir, rel_path)?;
    if !full.exists() {
        return Ok(());
    }
    tracker.record(&full);
    if full.is_dir() {
        fs::remove_dir_all(&full).map_err(|e| format!("删除文件夹 {norm} 失败: {e}"))?;
    } else {
        fs::remove_file(&full).map_err(|e| format!("删除文档 {norm} 失败: {e}"))?;
    }
    Ok(())
}

pub fn import_md_file_into_dir(
    data_dir: &Path,
    source: &Path,
    target_dir_rel: &str,
    tracker: &SelfWriteTracker,
) -> Result<DocEntry, String> {
    if !source.exists() || !source.is_file() {
        return Err(format!("源文件不存在：{}", source.display()));
    }
    let raw_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法识别导入文件名".to_string())?;
    let stem = if let Some(s) = raw_name.strip_suffix(".md").or_else(|| raw_name.strip_suffix(".MD")) {
        s
    } else if raw_name.to_lowercase().ends_with(".markdown") {
        &raw_name[..raw_name.len() - ".markdown".len()]
    } else if raw_name.to_lowercase().ends_with(".md") {
        &raw_name[..raw_name.len() - ".md".len()]
    } else {
        raw_name
    };
    let clean_stem: String = stem
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0')
                || c.is_control()
            {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string();
    let base_stem = if clean_stem.is_empty() {
        "imported-doc".to_string()
    } else {
        clean_stem
    };

    let (dir_norm, dir_full) = resolve_doc_dir_path(data_dir, target_dir_rel)?;
    fs::create_dir_all(&dir_full).map_err(|e| format!("创建目标目录失败: {e}"))?;

    let mut candidate_name = format!("{base_stem}.md");
    let mut counter = 1usize;
    while dir_full.join(&candidate_name).exists() {
        candidate_name = format!("{base_stem}-{counter}.md");
        counter += 1;
    }

    let rel_path = if dir_norm.is_empty() {
        candidate_name.clone()
    } else {
        format!("{dir_norm}/{candidate_name}")
    };
    let content = fs::read_to_string(source)
        .map_err(|e| format!("读取导入文件 {} 失败（仅支持 UTF-8 文本）: {e}", source.display()))?;
    let saved = write_doc_file(data_dir, &rel_path, &content, tracker)?;
    Ok(DocEntry {
        rel_path: saved.rel_path,
        name: candidate_name,
        is_dir: false,
        updated_at: saved.updated_at,
        size: saved.content.len() as u64,
    })
}

fn sanitize_segment_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0')
                || c.is_control()
            {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .trim_end_matches('.')
        .trim()
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn is_skipped_import_dir(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "build" | "__pycache__"
        )
}

fn collect_md_files_recursive(
    root: &Path,
    current: &Path,
    rel_dirs: &mut Vec<String>,
    out_files: &mut Vec<(Vec<String>, PathBuf)>,
    skipped_count: &mut usize,
) {
    let Ok(read_dir) = fs::read_dir(current) else {
        return;
    };
    let mut entries: Vec<fs::DirEntry> = read_dir.flatten().collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() {
            *skipped_count += 1;
            continue;
        }
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if ft.is_dir() {
            if is_skipped_import_dir(name) {
                continue;
            }
            let safe_dir = sanitize_segment_name(name, "folder");
            rel_dirs.push(safe_dir);
            collect_md_files_recursive(root, &path, rel_dirs, out_files, skipped_count);
            rel_dirs.pop();
        } else if ft.is_file() {
            if name.starts_with('.') {
                continue;
            }
            let lower = name.to_lowercase();
            if lower.ends_with(".md") || lower.ends_with(".markdown") {
                out_files.push((rel_dirs.clone(), path));
            } else {
                *skipped_count += 1;
            }
        }
    }
}

/// Recursively imports all UTF-8 `.md`/`.markdown` files from `source_dir` into
/// `<dataDir>/docs/<target_dir_rel>/<source_dir_name>/`, preserving nested folder hierarchy.
pub fn import_md_folder_into_dir(
    data_dir: &Path,
    source_dir: &Path,
    target_dir_rel: &str,
    tracker: &SelfWriteTracker,
) -> Result<FolderImportResult, String> {
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!("源文件夹不存在：{}", source_dir.display()));
    }

    // Prevent importing `<dataDir>/docs` into itself (or ancestor/descendant overlap)
    let docs_dir = docs_root(data_dir);
    if let (Ok(src_canon), Ok(docs_canon)) = (fs::canonicalize(source_dir), fs::canonicalize(&docs_dir)) {
        if src_canon.starts_with(&docs_canon) || docs_canon.starts_with(&src_canon) {
            return Err("不能将知识库工作区目录本身或其父级目录直接导入".to_string());
        }
    }

    let mut md_files: Vec<(Vec<String>, PathBuf)> = Vec::new();
    let mut rel_dirs: Vec<String> = Vec::new();
    let mut skipped_count = 0usize;
    collect_md_files_recursive(
        source_dir,
        source_dir,
        &mut rel_dirs,
        &mut md_files,
        &mut skipped_count,
    );

    if md_files.is_empty() {
        return Ok(FolderImportResult {
            root_folder_rel_path: String::new(),
            imported_docs: Vec::new(),
            skipped_count,
        });
    }

    let raw_folder_name = source_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("imported-folder");
    let base_folder = sanitize_segment_name(raw_folder_name, "imported-folder");

    let (parent_norm, parent_full) = resolve_doc_dir_path(data_dir, target_dir_rel)?;
    fs::create_dir_all(&parent_full).map_err(|e| format!("创建目标目录失败: {e}"))?;

    let mut folder_name = base_folder.clone();
    let mut counter = 1usize;
    while parent_full.join(&folder_name).exists() {
        folder_name = format!("{base_folder}-{counter}");
        counter += 1;
    }

    let root_folder_rel = if parent_norm.is_empty() {
        folder_name.clone()
    } else {
        format!("{parent_norm}/{folder_name}")
    };
    create_doc_folder(data_dir, &root_folder_rel, tracker)?;

    let mut imported_docs = Vec::new();
    for (sub_dirs, file_path) in md_files {
        let dest_dir_rel = if sub_dirs.is_empty() {
            root_folder_rel.clone()
        } else {
            format!("{root_folder_rel}/{}", sub_dirs.join("/"))
        };
        match import_md_file_into_dir(data_dir, &file_path, &dest_dir_rel, tracker) {
            Ok(entry) => imported_docs.push(entry),
            Err(_) => skipped_count += 1,
        }
    }

    Ok(FolderImportResult {
        root_folder_rel_path: root_folder_rel,
        imported_docs,
        skipped_count,
    })
}

/// Imports a mixed batch of external OS paths (`.md`/`.markdown` files and/or folders)
/// into `<dataDir>/docs/<target_dir_rel>/`. Non-Markdown files are safely skipped.
pub fn import_doc_paths_into_dir(
    data_dir: &Path,
    sources: &[PathBuf],
    target_dir_rel: &str,
    tracker: &SelfWriteTracker,
) -> Result<PathsImportResult, String> {
    let mut imported_docs = Vec::new();
    let mut imported_folders = Vec::new();
    let mut skipped_count = 0usize;

    for src in sources {
        if !src.exists() {
            skipped_count += 1;
            continue;
        }
        if src.is_dir() {
            let res = import_md_folder_into_dir(data_dir, src, target_dir_rel, tracker)?;
            skipped_count += res.skipped_count;
            if !res.root_folder_rel_path.is_empty() {
                imported_folders.push(res.root_folder_rel_path);
            }
            imported_docs.extend(res.imported_docs);
        } else if src.is_file() {
            let is_md = src
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| {
                    let lower = n.to_lowercase();
                    lower.ends_with(".md") || lower.ends_with(".markdown")
                })
                .unwrap_or(false);
            if !is_md {
                skipped_count += 1;
                continue;
            }
            match import_md_file_into_dir(data_dir, src, target_dir_rel, tracker) {
                Ok(entry) => imported_docs.push(entry),
                Err(_) => skipped_count += 1,
            }
        } else {
            skipped_count += 1;
        }
    }

    Ok(PathsImportResult {
        imported_docs,
        imported_folders,
        skipped_count,
    })
}

pub fn search_docs(data_dir: &Path, raw_query: &str, limit: usize) -> Result<Vec<DocSearchHit>, String> {
    let q = raw_query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let entries = list_docs_tree(data_dir)?;
    let root = docs_root(data_dir);
    let mut hits = Vec::new();

    for entry in entries.into_iter().filter(|e| !e.is_dir) {
        let full = root.join(entry.rel_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let content = fs::read_to_string(&full).unwrap_or_default();
        let name_lower = entry.name.to_lowercase();
        let path_lower = entry.rel_path.to_lowercase();
        let content_lower = content.to_lowercase();

        if name_lower.contains(&q) || path_lower.contains(&q) || content_lower.contains(&q) {
            let snippet = extract_snippet(&content, &q);
            hits.push(DocSearchHit {
                rel_path: entry.rel_path,
                name: entry.name,
                snippet,
                updated_at: entry.updated_at,
            });
            if hits.len() >= limit {
                break;
            }
        }
    }

    Ok(hits)
}

fn extract_snippet(content: &str, query_lower: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_lowercase().contains(query_lower) {
            return trimmed.chars().take(100).collect();
        }
    }
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(100)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir(name: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "anchor_docs_test_{}_{}_{}",
            name,
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_path_traversal_and_non_md_writes() {
        let dir = temp_dir("sandbox");
        let tracker = SelfWriteTracker::default();
        assert!(resolve_doc_path(&dir, "../secret.md").is_err());
        assert!(resolve_doc_path(&dir, "/etc/passwd").is_err());
        assert!(resolve_doc_path(&dir, ".hidden/note.md").is_err());
        assert!(write_doc_file(&dir, "note.txt", "hi", &tracker).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn creates_lists_renames_searches_and_deletes_docs() {
        let dir = temp_dir("lifecycle");
        let tracker = SelfWriteTracker::default();

        create_doc_folder(&dir, "工作/方案", &tracker).unwrap();
        write_doc_file(
            &dir,
            "工作/方案/架构设计.md",
            "# 架构设计\n\n支持本地知识库与 Git 同步。\n",
            &tracker,
        )
        .unwrap();

        let tree = list_docs_tree(&dir).unwrap();
        assert!(tree.iter().any(|e| e.is_dir && e.rel_path == "工作"));
        assert!(tree.iter().any(|e| e.is_dir && e.rel_path == "工作/方案"));
        assert!(tree
            .iter()
            .any(|e| !e.is_dir && e.rel_path == "工作/方案/架构设计.md"));

        let loaded = read_doc_file(&dir, "工作/方案/架构设计.md").unwrap();
        assert!(loaded.content.contains("本地知识库"));

        let hits = search_docs(&dir, "知识库", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rel_path, "工作/方案/架构设计.md");

        let moved = rename_doc_entry(
            &dir,
            "工作/方案/架构设计.md",
            "工作/架构设计-v2.md",
            &tracker,
        )
        .unwrap();
        assert_eq!(moved, "工作/架构设计-v2.md");
        assert!(read_doc_file(&dir, "工作/架构设计-v2.md").is_ok());

        // Cannot move folder into itself
        assert!(rename_doc_entry(&dir, "工作", "工作/子目录", &tracker).is_err());

        delete_doc_entry(&dir, "工作", &tracker).unwrap();
        assert!(list_docs_tree(&dir).unwrap().is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn imports_markdown_folder_recursively_preserving_structure_and_skipping_hidden() {
        let data = std::env::temp_dir().join(format!("anchor_docs_folder_data_{}", std::process::id()));
        let ext = std::env::temp_dir().join(format!("anchor_docs_folder_src_{}", std::process::id()));
        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&ext);

        let src_folder = ext.join("项目资料");
        fs::create_dir_all(src_folder.join("子目录")).unwrap();
        fs::create_dir_all(src_folder.join(".git")).unwrap();
        fs::create_dir_all(src_folder.join("纯二进制")).unwrap();
        fs::write(src_folder.join("总览.md"), "# 总览\n").unwrap();
        fs::write(src_folder.join("子目录").join("接口.markdown"), "# 接口\n").unwrap();
        fs::write(src_folder.join(".git").join("ignore.md"), "ignored").unwrap();
        fs::write(src_folder.join("纯二进制").join("a.bin"), &[0u8, 1, 2]).unwrap();

        let tracker = SelfWriteTracker::default();
        let res = import_md_folder_into_dir(&data, &src_folder, "工作", &tracker).unwrap();
        assert_eq!(res.root_folder_rel_path, "工作/项目资料");
        assert_eq!(res.imported_docs.len(), 2);
        assert!(res
            .imported_docs
            .iter()
            .any(|d| d.rel_path == "工作/项目资料/总览.md"));
        assert!(res
            .imported_docs
            .iter()
            .any(|d| d.rel_path == "工作/项目资料/子目录/接口.md"));

        let tree = list_docs_tree(&data).unwrap();
        assert!(!tree.iter().any(|e| e.rel_path.contains("纯二进制")));
        assert!(!tree.iter().any(|e| e.rel_path.contains(".git")));

        let res2 = import_md_folder_into_dir(&data, &src_folder, "工作", &tracker).unwrap();
        assert_eq!(res2.root_folder_rel_path, "工作/项目资料-1");
        assert_eq!(res2.imported_docs.len(), 2);

        assert!(import_md_folder_into_dir(&data, &docs_root(&data), "", &tracker).is_err());

        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&ext);
    }

    #[test]
    fn imports_mixed_dropped_files_and_folders_while_skipping_non_markdown() {
        let data = temp_dir("drop_data");
        let ext = temp_dir("drop_ext");
        let tracker = SelfWriteTracker::default();

        let md_file = ext.join("会议纪要.md");
        let txt_file = ext.join("ignore.txt");
        let sub_folder = ext.join("调研");
        fs::create_dir_all(&sub_folder).unwrap();
        fs::write(&md_file, "# 会议\n").unwrap();
        fs::write(&txt_file, "plain text").unwrap();
        fs::write(sub_folder.join("报告.markdown"), "# 报告\n").unwrap();

        let res = import_doc_paths_into_dir(
            &data,
            &[md_file, txt_file, sub_folder],
            "工作",
            &tracker,
        )
        .unwrap();

        assert_eq!(res.imported_docs.len(), 2);
        assert_eq!(res.imported_folders, vec!["工作/调研".to_string()]);
        assert_eq!(res.skipped_count, 1);
        assert!(res
            .imported_docs
            .iter()
            .any(|d| d.rel_path == "工作/会议纪要.md"));
        assert!(res
            .imported_docs
            .iter()
            .any(|d| d.rel_path == "工作/调研/报告.md"));

        let _ = fs::remove_dir_all(&data);
        let _ = fs::remove_dir_all(&ext);
    }
}
