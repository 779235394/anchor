use crate::storage::{atomic_write_text, ensure_daily_snapshot, SelfWriteTracker};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const STICKY_LABEL_PREFIX: &str = "sticky-";
pub const DEFAULT_STICKY_WIDTH: f64 = 300.0;
pub const DEFAULT_STICKY_HEIGHT: f64 = 320.0;
pub const MIN_STICKY_WIDTH: f64 = 220.0;
pub const MIN_STICKY_HEIGHT: f64 = 180.0;
pub const MIN_STICKY_OPACITY: f64 = 0.65;
pub const MAX_STICKY_OPACITY: f64 = 1.0;

fn default_width() -> f64 {
    DEFAULT_STICKY_WIDTH
}

fn default_height() -> f64 {
    DEFAULT_STICKY_HEIGHT
}

fn default_opacity() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StickyBounds {
    pub x: Option<f64>,
    pub y: Option<f64>,
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default = "default_height")]
    pub height: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

impl Default for StickyBounds {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: DEFAULT_STICKY_WIDTH,
            height: DEFAULT_STICKY_HEIGHT,
            opacity: 1.0,
        }
    }
}

pub struct StickyState {
    bounds_path: PathBuf,
    bounds: Mutex<HashMap<String, StickyBounds>>,
    open_ids: Mutex<HashSet<String>>,
    pub shard_lock: Mutex<()>,
}

impl StickyState {
    pub fn new(config_dir: &Path) -> Self {
        let bounds_path = config_dir.join("sticky-bounds.json");
        let loaded = load_bounds_map(&bounds_path);
        Self {
            bounds_path,
            bounds: Mutex::new(loaded),
            open_ids: Mutex::new(HashSet::new()),
            shard_lock: Mutex::new(()),
        }
    }

    pub fn get_bounds(&self, sticky_id: &str) -> StickyBounds {
        self.bounds
            .lock()
            .ok()
            .and_then(|map| map.get(sticky_id).cloned())
            .unwrap_or_default()
    }

    pub fn update_bounds(&self, sticky_id: &str, update_fn: impl FnOnce(&mut StickyBounds)) -> StickyBounds {
        let mut map = self.bounds.lock().unwrap();
        let entry = map.entry(sticky_id.to_string()).or_default();
        update_fn(entry);
        entry.width = entry.width.max(MIN_STICKY_WIDTH);
        entry.height = entry.height.max(MIN_STICKY_HEIGHT);
        entry.opacity = clamp_opacity(entry.opacity);
        let cloned = entry.clone();
        let _ = save_bounds_map(&self.bounds_path, &map);
        cloned
    }

    pub fn remove_bounds(&self, sticky_id: &str) {
        if let Ok(mut map) = self.bounds.lock() {
            if map.remove(sticky_id).is_some() {
                let _ = save_bounds_map(&self.bounds_path, &map);
            }
        }
    }

    pub fn mark_open(&self, sticky_id: &str) -> Vec<String> {
        let mut set = self.open_ids.lock().unwrap();
        set.insert(sticky_id.to_string());
        let mut list: Vec<String> = set.iter().cloned().collect();
        list.sort();
        list
    }

    pub fn mark_closed(&self, sticky_id: &str) -> Vec<String> {
        let mut set = self.open_ids.lock().unwrap();
        set.remove(sticky_id);
        let mut list: Vec<String> = set.iter().cloned().collect();
        list.sort();
        list
    }

    pub fn list_open(&self) -> Vec<String> {
        let set = self.open_ids.lock().unwrap();
        let mut list: Vec<String> = set.iter().cloned().collect();
        list.sort();
        list
    }

    pub fn is_open(&self, sticky_id: &str) -> bool {
        self.open_ids
            .lock()
            .map(|set| set.contains(sticky_id))
            .unwrap_or(false)
    }
}

pub fn clamp_opacity(val: f64) -> f64 {
    if !val.is_finite() {
        return 1.0;
    }
    val.clamp(MIN_STICKY_OPACITY, MAX_STICKY_OPACITY)
}

pub fn validate_sticky_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("Invalid sticky id length".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("Unsafe sticky id: {id}"));
    }
    Ok(())
}

pub fn sticky_label(id: &str) -> Result<String, String> {
    validate_sticky_id(id)?;
    Ok(format!("{STICKY_LABEL_PREFIX}{}", id.trim()))
}

pub fn sticky_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(STICKY_LABEL_PREFIX)
}

pub fn load_bounds_map(path: &Path) -> HashMap<String, StickyBounds> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<HashMap<String, StickyBounds>>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_bounds_map(path: &Path, map: &HashMap<String, StickyBounds>) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(map)
        .map_err(|e| format!("Failed to serialize sticky bounds: {e}"))?;
    atomic_write_text(path, &(pretty + "\n"))
}

/// Clamps sticky window geometry into at least one visible screen rectangle.
/// Each screen rect is `(x, y, width, height)` in logical pixels (top-left origin).
pub fn clamp_bounds_to_screens(
    bounds: &StickyBounds,
    screens: &[(f64, f64, f64, f64)],
    cascade_index: usize,
) -> (f64, f64, f64, f64) {
    let fallback = (0.0, 0.0, 1440.0, 900.0);
    let primary = screens.first().copied().unwrap_or(fallback);

    let max_w = (primary.2 * 0.9).max(MIN_STICKY_WIDTH);
    let max_h = (primary.3 * 0.9).max(MIN_STICKY_HEIGHT);
    let w = if bounds.width.is_finite() {
        bounds.width.clamp(MIN_STICKY_WIDTH, max_w)
    } else {
        DEFAULT_STICKY_WIDTH
    };
    let h = if bounds.height.is_finite() {
        bounds.height.clamp(MIN_STICKY_HEIGHT, max_h)
    } else {
        DEFAULT_STICKY_HEIGHT
    };

    if let (Some(x), Some(y)) = (bounds.x, bounds.y) {
        if x.is_finite() && y.is_finite() {
            // Check whether at least 60x34 of the top header is visible on any screen.
            let visible_on_any = screens.iter().any(|&(sx, sy, sw, sh)| {
                let overlap_x = (x + w).min(sx + sw) - x.max(sx);
                let overlap_y = (y + 40.0).min(sy + sh) - y.max(sy);
                overlap_x >= 60.0 && overlap_y >= 24.0
            });
            if visible_on_any || screens.is_empty() {
                return (x, y, w, h);
            }
        }
    }

    // Place cleanly in the upper-right comfort zone of primary screen with gentle cascade
    let step = (cascade_index % 6) as f64 * 28.0;
    let default_x = (primary.0 + primary.2 - w - 36.0 - step).max(primary.0 + 24.0);
    let default_y = (primary.1 + 72.0 + step).min((primary.1 + primary.3 - h - 36.0).max(primary.1 + 24.0));
    (default_x, default_y, w, h)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn generate_sticky_id() -> String {
    let millis = now_millis();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("stk-{millis:x}-{:x}", nanos & 0xFFFF)
}

fn read_stickies_vec(data_dir: &Path) -> Vec<Value> {
    let path = data_dir.join("stickies.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|val| val.as_array().cloned())
        .unwrap_or_default()
}

fn write_stickies_vec(
    data_dir: &Path,
    items: &[Value],
    tracker: &SelfWriteTracker,
) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(&Value::Array(items.to_vec()))
        .map_err(|e| format!("Failed to serialize stickies.json: {e}"))?;
    let _ = ensure_daily_snapshot(data_dir);
    let full_path = data_dir.join("stickies.json");
    tracker.record(&full_path);
    atomic_write_text(&full_path, &(pretty + "\n"))?;
    tracker.record(&full_path);
    Ok(())
}

/// Atomically merges a single StickyNote into `<dataDir>/stickies.json` (LWW by `updatedAt`).
/// Caller must hold `StickyState.shard_lock`.
pub fn upsert_sticky_in_file(
    data_dir: &Path,
    incoming: Value,
    tracker: &SelfWriteTracker,
) -> Result<Value, String> {
    let id = incoming
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Sticky payload missing string id".to_string())?
        .to_string();
    validate_sticky_id(&id)?;

    let incoming_updated = incoming
        .get("updatedAt")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(now_millis);

    let mut items = read_stickies_vec(data_dir);
    let mut stored = incoming.clone();
    let mut replaced = false;

    for existing in items.iter_mut() {
        if existing.get("id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            let existing_updated = existing
                .get("updatedAt")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            if incoming_updated >= existing_updated {
                *existing = incoming.clone();
                stored = incoming.clone();
            } else {
                stored = existing.clone();
            }
            replaced = true;
            break;
        }
    }

    if !replaced {
        items.push(incoming);
    }

    write_stickies_vec(data_dir, &items, tracker)?;
    Ok(stored)
}

/// Updates only the `pinned` flag of a sticky in `<dataDir>/stickies.json`.
/// Caller must hold `StickyState.shard_lock`.
pub fn update_sticky_pinned_in_file(
    data_dir: &Path,
    sticky_id: &str,
    pinned: bool,
    tracker: &SelfWriteTracker,
) -> Result<Option<Value>, String> {
    validate_sticky_id(sticky_id)?;
    let mut items = read_stickies_vec(data_dir);
    let mut updated_item = None;

    for item in items.iter_mut() {
        if item.get("id").and_then(|v| v.as_str()) == Some(sticky_id) {
            if let Some(obj) = item.as_object_mut() {
                obj.insert("pinned".to_string(), Value::Bool(pinned));
                obj.insert("updatedAt".to_string(), Value::from(now_millis()));
                updated_item = Some(Value::Object(obj.clone()));
            }
            break;
        }
    }

    if updated_item.is_some() {
        write_stickies_vec(data_dir, &items, tracker)?;
    }
    Ok(updated_item)
}

pub fn is_sticky_value_empty(val: &Value) -> bool {
    let title = val
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let content = val
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    title.is_empty() && content.is_empty()
}

/// Removes a sticky record completely from `<dataDir>/stickies.json` (used when discarding empty stickies).
/// Caller must hold `StickyState.shard_lock`.
pub fn remove_sticky_from_file(
    data_dir: &Path,
    sticky_id: &str,
    tracker: &SelfWriteTracker,
) -> Result<bool, String> {
    validate_sticky_id(sticky_id)?;
    let mut items = read_stickies_vec(data_dir);
    let before = items.len();
    items.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(sticky_id));
    if items.len() != before {
        write_stickies_vec(data_dir, &items, tracker)?;
        return Ok(true);
    }
    Ok(false)
}

/// Removes any active empty stickies left on disk so empty cards never accumulate.
/// Caller must hold `StickyState.shard_lock`.
pub fn prune_empty_stickies_in_file(
    data_dir: &Path,
    tracker: &SelfWriteTracker,
) -> Result<Vec<String>, String> {
    let mut items = read_stickies_vec(data_dir);
    let mut removed_ids = Vec::new();
    items.retain(|item| {
        let deleted = item.get("deletedAt").is_some_and(|v| !v.is_null());
        if !deleted && is_sticky_value_empty(item) {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                removed_ids.push(id.to_string());
            }
            return false;
        }
        true
    });
    if !removed_ids.is_empty() {
        write_stickies_vec(data_dir, &items, tracker)?;
    }
    Ok(removed_ids)
}

pub fn normalize_sticky_color(color: Option<&str>) -> &'static str {
    match color.unwrap_or("yellow") {
        "yellow" => "yellow",
        "blue" => "blue",
        "green" => "green",
        "pink" => "pink",
        "purple" => "purple",
        "graphite" => "graphite",
        _ => "yellow",
    }
}

pub fn find_sticky_in_file(data_dir: &Path, sticky_id: &str) -> Option<Value> {
    let items = read_stickies_vec(data_dir);
    items
        .into_iter()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(sticky_id))
}

pub fn list_auto_open_stickies(data_dir: &Path) -> Vec<(String, bool)> {
    read_stickies_vec(data_dir)
        .into_iter()
        .filter_map(|item| {
            let deleted = item.get("deletedAt").is_some_and(|v| !v.is_null());
            if deleted || is_sticky_value_empty(&item) {
                return None;
            }
            let auto_open = item.get("autoOpen").and_then(|v| v.as_bool()).unwrap_or(false);
            if !auto_open {
                return None;
            }
            let id = item.get("id").and_then(|v| v.as_str())?.to_string();
            validate_sticky_id(&id).ok()?;
            let pinned = item.get("pinned").and_then(|v| v.as_bool()).unwrap_or(true);
            Some((id, pinned))
        })
        .collect()
}

#[cfg(target_os = "macos")]
mod macos_sticky_panel {
    use super::clamp_opacity;
    use objc2_app_kit::{NSWindowCollectionBehavior, NSWindowStyleMask};
    use tauri::{AppHandle, Manager, WebviewWindow};
    use tauri_nspanel::{tauri_panel, ManagerExt, PanelHandle, PanelLevel, WebviewWindowExt};

    tauri_panel! {
        panel!(StickyNotePanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true
            }
        })
    }

    pub fn apply_panel_style(panel: &PanelHandle<tauri::Wry>, pinned: bool, opacity: f64) {
        panel.set_hides_on_deactivate(false);
        panel.set_released_when_closed(false);
        panel.set_transparent(true);
        panel.set_has_shadow(true);
        panel.set_alpha_value(clamp_opacity(opacity));

        if pinned {
            panel.set_floating_panel(true);
            panel.set_works_when_modal(true);
            let _ = panel.add_style_mask(NSWindowStyleMask::NonactivatingPanel);
            panel.set_level(PanelLevel::Status.value());
            panel.set_collection_behavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
        } else {
            panel.set_floating_panel(false);
            panel.set_works_when_modal(false);
            let cur_mask = panel.as_panel().styleMask();
            let next_mask = cur_mask & !NSWindowStyleMask::NonactivatingPanel;
            let _ = panel.set_style_mask(next_mask);
            panel.set_level(PanelLevel::Normal.value());
            panel.set_collection_behavior(NSWindowCollectionBehavior::Default);
        }
    }

    pub fn ensure_and_show_on_main(
        app: &AppHandle,
        win: &WebviewWindow,
        label: &str,
        pinned: bool,
        opacity: f64,
        focus: bool,
    ) {
        let panel = match app.get_webview_panel(label) {
            Ok(existing) => Some(existing),
            Err(_) => match win.to_panel::<StickyNotePanel>() {
                Ok(created) => Some(created),
                Err(err) => {
                    eprintln!("[Anchor] Failed to convert sticky {label} to NSPanel: {err}");
                    None
                }
            },
        };

        if let Some(panel) = panel {
            apply_panel_style(&panel, pinned, opacity);
            if pinned {
                panel.order_front_regardless();
            }
            if focus {
                panel.show_and_make_key();
            } else {
                panel.show();
            }
        } else {
            let _ = win.set_always_on_top(pinned);
            let _ = win.show();
            if focus {
                let _ = win.set_focus();
            }
        }
    }

    pub fn update_pin_on_main(app: &AppHandle, label: &str, pinned: bool, opacity: f64) {
        if let Ok(panel) = app.get_webview_panel(label) {
            apply_panel_style(&panel, pinned, opacity);
            if pinned {
                panel.order_front_regardless();
            }
        }
    }

    pub fn update_opacity_on_main(app: &AppHandle, label: &str, opacity: f64) {
        if let Ok(panel) = app.get_webview_panel(label) {
            panel.set_alpha_value(clamp_opacity(opacity));
        }
    }

    pub fn hide_panel_on_main(app: &AppHandle, label: &str) {
        if let Ok(panel) = app.get_webview_panel(label) {
            panel.hide();
        } else if let Some(win) = app.get_webview_window(label) {
            let _ = win.hide();
        }
    }

    pub fn destroy_panel_on_main(app: &AppHandle, label: &str) {
        // IMPORTANT: Do NOT call `app.remove_webview_panel(label)` before `panel.to_window()`.
        // `to_window()` itself removes the panel from `WebviewPanelManager`, clears its delegate,
        // sets `releasedWhenClosed = false`, and restores the original Tao NSWindow ObjC class.
        // Calling `remove_webview_panel` first caused `to_window()` to return `None`, leaving the
        // window swizzled as `NSPanel` and crashing AppKit on subsequent `win.destroy()`.
        let win_to_destroy = if let Ok(panel) = app.get_webview_panel(label) {
            panel.hide();
            let converted = panel.to_window();
            drop(panel);
            converted
        } else {
            app.get_webview_window(label)
        };

        if let Some(win) = win_to_destroy {
            let _ = win.hide();
            let _ = win.destroy();
        }
    }
}

fn collect_logical_screens(app: &AppHandle) -> Vec<(f64, f64, f64, f64)> {
    let mut rects = Vec::new();
    if let Ok(monitors) = app.available_monitors() {
        for m in monitors {
            let sf = m.scale_factor();
            let pos = m.position();
            let size = m.size();
            rects.push((
                pos.x as f64 / sf,
                pos.y as f64 / sf,
                size.width as f64 / sf,
                size.height as f64 / sf,
            ));
        }
    }
    rects
}

fn emit_open_ids(app: &AppHandle, open_ids: &[String]) {
    let _ = app.emit("workspace://sticky-windows-changed", open_ids.to_vec());
}

pub fn capture_window_bounds(app: &AppHandle, win: &WebviewWindow, sticky_id: &str) {
    let Some(state) = app.try_state::<StickyState>() else {
        return;
    };
    if !state.is_open(sticky_id) {
        return;
    }
    let sf = win.scale_factor().unwrap_or(1.0);
    let pos = win.outer_position().ok();
    let size = win.inner_size().ok();
    if pos.is_none() && size.is_none() {
        return;
    }
    state.update_bounds(sticky_id, |b| {
        if let Some(p) = pos {
            b.x = Some((p.x as f64 / sf).round());
            b.y = Some((p.y as f64 / sf).round());
        }
        if let Some(s) = size {
            let w = (s.width as f64 / sf).round();
            let h = (s.height as f64 / sf).round();
            if w >= MIN_STICKY_WIDTH && h >= MIN_STICKY_HEIGHT {
                b.width = w;
                b.height = h;
            }
        }
    });
}

pub fn open_sticky_window(
    app: &AppHandle,
    sticky_id: &str,
    pinned: bool,
    offset_from_id: Option<&str>,
    focus: bool,
) -> Result<StickyBounds, String> {
    open_sticky_window_inner(app, sticky_id, pinned, offset_from_id, focus, false, None)
}

/// Opens a brand-new empty draft sticky window WITHOUT writing an empty entry to `stickies.json`.
/// The sticky is persisted only once the user types actual content.
pub fn open_new_draft_sticky_window(
    app: &AppHandle,
    color: Option<&str>,
    offset_from_id: Option<&str>,
) -> Result<String, String> {
    let id = generate_sticky_id();
    let valid_color = normalize_sticky_color(color);
    open_sticky_window_inner(app, &id, true, offset_from_id, true, true, Some(valid_color))?;
    Ok(id)
}

fn open_sticky_window_inner(
    app: &AppHandle,
    sticky_id: &str,
    pinned: bool,
    offset_from_id: Option<&str>,
    focus: bool,
    is_draft: bool,
    draft_color: Option<&str>,
) -> Result<StickyBounds, String> {
    let label = sticky_label(sticky_id)?;
    let state = app.state::<StickyState>();

    // If already open, focus & ensure pin/opacity state
    if let Some(win) = app.get_webview_window(&label) {
        let bounds = state.get_bounds(sticky_id);
        let open_ids = state.mark_open(sticky_id);
        emit_open_ids(app, &open_ids);

        #[cfg(target_os = "macos")]
        {
            let app_c = app.clone();
            let win_c = win.clone();
            let label_c = label.clone();
            let opacity = bounds.opacity;
            let _ = app.run_on_main_thread(move || {
                macos_sticky_panel::ensure_and_show_on_main(
                    &app_c, &win_c, &label_c, pinned, opacity, focus,
                );
            });
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.set_always_on_top(pinned);
            let _ = win.unminimize();
            let _ = win.show();
            if focus {
                let _ = win.set_focus();
            }
        }
        return Ok(bounds);
    }

    let mut bounds = state.get_bounds(sticky_id);
    if bounds.x.is_none() || bounds.y.is_none() {
        if let Some(ref_id) = offset_from_id {
            let ref_bounds = state.get_bounds(ref_id);
            if let (Some(rx), Some(ry)) = (ref_bounds.x, ref_bounds.y) {
                bounds.x = Some(rx + 28.0);
                bounds.y = Some(ry + 28.0);
                bounds.width = ref_bounds.width;
                bounds.height = ref_bounds.height;
            }
        }
    }

    let screens = collect_logical_screens(app);
    let cascade_idx = state.list_open().len();
    let (x, y, w, h) = clamp_bounds_to_screens(&bounds, &screens, cascade_idx);
    let saved = state.update_bounds(sticky_id, |b| {
        b.x = Some(x);
        b.y = Some(y);
        b.width = w;
        b.height = h;
    });

    let url = if is_draft {
        format!(
            "index.html#sticky/{sticky_id}?draft=1&color={}",
            draft_color.unwrap_or("yellow")
        )
    } else {
        format!("index.html#sticky/{sticky_id}")
    };
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Anchor Sticky")
        .inner_size(w, h)
        .min_inner_size(MIN_STICKY_WIDTH, MIN_STICKY_HEIGHT)
        .position(x, y)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(pinned)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| format!("Failed to create sticky window {label}: {e}"))?;

    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.set_position(LogicalPosition::new(x, y));

    let open_ids = state.mark_open(sticky_id);
    emit_open_ids(app, &open_ids);

    #[cfg(target_os = "macos")]
    {
        let app_c = app.clone();
        let win_c = win.clone();
        let label_c = label.clone();
        let opacity = saved.opacity;
        let _ = app.run_on_main_thread(move || {
            macos_sticky_panel::ensure_and_show_on_main(
                &app_c, &win_c, &label_c, pinned, opacity, focus,
            );
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = win.set_always_on_top(pinned);
        let _ = win.show();
        if focus {
            let _ = win.set_focus();
        }
    }

    Ok(saved)
}

pub fn close_sticky_window(
    app: &AppHandle,
    sticky_id: &str,
    data_dir: Option<&Path>,
    tracker: Option<&SelfWriteTracker>,
) -> Result<(), String> {
    let label = sticky_label(sticky_id)?;
    let mut discarded_empty = false;

    if let (Some(dir), Some(trk), Some(state)) = (data_dir, tracker, app.try_state::<StickyState>())
    {
        let _guard = state.shard_lock.lock().unwrap();
        match find_sticky_in_file(dir, sticky_id) {
            None => {
                // Draft that was never saved — discard its temporary bounds too
                discarded_empty = true;
            }
            Some(existing) => {
                let deleted = existing.get("deletedAt").is_some_and(|v| !v.is_null());
                if !deleted && is_sticky_value_empty(&existing) {
                    let _ = remove_sticky_from_file(dir, sticky_id, trk);
                    discarded_empty = true;
                }
            }
        }
    }

    if !discarded_empty {
        if let Some(win) = app.get_webview_window(&label) {
            capture_window_bounds(app, &win, sticky_id);
        }
    }

    if let Some(state) = app.try_state::<StickyState>() {
        if discarded_empty {
            state.remove_bounds(sticky_id);
            let _ = app.emit("workspace://sticky-removed", sticky_id.to_string());
        }
        let open_ids = state.mark_closed(sticky_id);
        emit_open_ids(app, &open_ids);
    }

    let has_window = app.get_webview_window(&label).is_some();
    if !has_window {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let app_hide = app.clone();
        let label_hide = label.clone();
        let _ = app.run_on_main_thread(move || {
            macos_sticky_panel::hide_panel_on_main(&app_hide, &label_hide);
        });

        // Defer native NSPanel -> NSWindow restoration + destroy slightly so any in-flight
        // WKWebView IPC reply originating from this window finishes cleanly before teardown.
        let app_destroy = app.clone();
        let label_destroy = label.clone();
        let sid_owned = sticky_id.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let still_closed = app_destroy
                .try_state::<StickyState>()
                .map(|s| !s.is_open(&sid_owned))
                .unwrap_or(true);
            if still_closed {
                let app_main = app_destroy.clone();
                let _ = app_destroy.run_on_main_thread(move || {
                    macos_sticky_panel::destroy_panel_on_main(&app_main, &label_destroy);
                });
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.hide();
        }
        let app_destroy = app.clone();
        let label_destroy = label.clone();
        let sid_owned = sticky_id.to_string();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let still_closed = app_destroy
                .try_state::<StickyState>()
                .map(|s| !s.is_open(&sid_owned))
                .unwrap_or(true);
            if still_closed {
                if let Some(win) = app_destroy.get_webview_window(&label_destroy) {
                    let _ = win.destroy();
                }
            }
        });
    }

    Ok(())
}

pub fn close_all_sticky_windows(
    app: &AppHandle,
    data_dir: Option<&Path>,
    tracker: Option<&SelfWriteTracker>,
) {
    let ids = app
        .try_state::<StickyState>()
        .map(|s| s.list_open())
        .unwrap_or_default();
    for id in ids {
        let _ = close_sticky_window(app, &id, data_dir, tracker);
    }
}

pub fn apply_sticky_pinned(app: &AppHandle, sticky_id: &str, pinned: bool) -> Result<(), String> {
    let label = sticky_label(sticky_id)?;
    let opacity = app
        .try_state::<StickyState>()
        .map(|s| s.get_bounds(sticky_id).opacity)
        .unwrap_or(1.0);

    if let Some(win) = app.get_webview_window(&label) {
        #[cfg(target_os = "macos")]
        {
            let app_c = app.clone();
            let label_c = label.clone();
            let _ = win;
            let _ = app.run_on_main_thread(move || {
                macos_sticky_panel::update_pin_on_main(&app_c, &label_c, pinned, opacity);
            });
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.set_always_on_top(pinned);
        }
    }
    Ok(())
}

pub fn apply_sticky_opacity(app: &AppHandle, sticky_id: &str, opacity: f64) -> Result<f64, String> {
    let label = sticky_label(sticky_id)?;
    let clamped = clamp_opacity(opacity);
    if let Some(state) = app.try_state::<StickyState>() {
        state.update_bounds(sticky_id, |b| {
            b.opacity = clamped;
        });
    }

    #[cfg(target_os = "macos")]
    {
        if app.get_webview_window(&label).is_some() {
            let app_c = app.clone();
            let label_c = label.clone();
            let _ = app.run_on_main_thread(move || {
                macos_sticky_panel::update_opacity_on_main(&app_c, &label_c, clamped);
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = label;
    }

    Ok(clamped)
}

/// Prunes any leftover empty stickies on startup, then opens ONLY non-empty stickies
/// explicitly marked `autoOpen: true` (default is false).
pub fn open_auto_open_stickies(app: &AppHandle, data_dir: &Path, tracker: &SelfWriteTracker) {
    if let Some(state) = app.try_state::<StickyState>() {
        let removed = {
            let _guard = state.shard_lock.lock().unwrap();
            prune_empty_stickies_in_file(data_dir, tracker).unwrap_or_default()
        };
        for id in removed {
            state.remove_bounds(&id);
        }
    }
    let to_open = list_auto_open_stickies(data_dir);
    for (id, pinned) in to_open {
        let _ = open_sticky_window(app, &id, pinned, None, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn validates_sticky_ids_strictly() {
        assert!(validate_sticky_id("stk-123_abc").is_ok());
        assert!(validate_sticky_id("").is_err());
        assert!(validate_sticky_id("../evil").is_err());
        assert!(validate_sticky_id("a/b").is_err());
        assert!(validate_sticky_id("space bad").is_err());
    }

    #[test]
    fn clamps_offscreen_bounds_back_to_primary_monitor() {
        let screens = vec![(0.0, 0.0, 1440.0, 900.0)];
        let offscreen = StickyBounds {
            x: Some(3200.0),
            y: Some(120.0),
            width: 300.0,
            height: 320.0,
            opacity: 1.0,
        };
        let (x, y, w, h) = clamp_bounds_to_screens(&offscreen, &screens, 0);
        assert!(x >= 0.0 && x + w <= 1440.0);
        assert!(y >= 0.0 && y + h <= 900.0);

        let onscreen = StickyBounds {
            x: Some(200.0),
            y: Some(150.0),
            width: 280.0,
            height: 260.0,
            opacity: 0.9,
        };
        assert_eq!(
            clamp_bounds_to_screens(&onscreen, &screens, 0),
            (200.0, 150.0, 280.0, 260.0)
        );
    }

    #[test]
    fn saves_and_loads_sticky_bounds_map() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("sticky-bounds.json");
        let mut map = HashMap::new();
        map.insert(
            "stk-1".to_string(),
            StickyBounds {
                x: Some(120.0),
                y: Some(80.0),
                width: 310.0,
                height: 340.0,
                opacity: 0.88,
            },
        );
        save_bounds_map(&path, &map).unwrap();
        let loaded = load_bounds_map(&path);
        assert_eq!(loaded.get("stk-1").unwrap().opacity, 0.88);
        assert_eq!(loaded.get("stk-1").unwrap().x, Some(120.0));
    }

    #[test]
    fn upsert_sticky_respects_lww_and_filters_auto_open() {
        let tmp = TempDir::new().unwrap();
        let tracker = SelfWriteTracker::default();

        upsert_sticky_in_file(
            tmp.path(),
            json!({
                "id": "stk-a",
                "title": "v1",
                "content": "hello",
                "color": "yellow",
                "pinned": true,
                "autoOpen": false,
                "createdAt": 100,
                "updatedAt": 200
            }),
            &tracker,
        )
        .unwrap();

        // Older write must NOT clobber newer write
        let kept = upsert_sticky_in_file(
            tmp.path(),
            json!({
                "id": "stk-a",
                "title": "stale",
                "content": "stale",
                "color": "blue",
                "pinned": false,
                "autoOpen": true,
                "createdAt": 100,
                "updatedAt": 150
            }),
            &tracker,
        )
        .unwrap();
        assert_eq!(kept["title"], "v1");

        // Second sticky with autoOpen = true, third deleted with autoOpen = true
        upsert_sticky_in_file(
            tmp.path(),
            json!({
                "id": "stk-b",
                "title": "keep open",
                "content": "",
                "color": "blue",
                "pinned": false,
                "autoOpen": true,
                "createdAt": 100,
                "updatedAt": 300
            }),
            &tracker,
        )
        .unwrap();
        upsert_sticky_in_file(
            tmp.path(),
            json!({
                "id": "stk-c",
                "title": "deleted",
                "content": "",
                "color": "pink",
                "pinned": true,
                "autoOpen": true,
                "createdAt": 100,
                "updatedAt": 350,
                "deletedAt": 350
            }),
            &tracker,
        )
        .unwrap();

        let auto_list = list_auto_open_stickies(tmp.path());
        assert_eq!(auto_list, vec![("stk-b".to_string(), false)]);

        // Empty active stickies are pruned cleanly while non-empty ones remain intact
        upsert_sticky_in_file(
            tmp.path(),
            json!({
                "id": "stk-empty",
                "title": "   ",
                "content": "\n  ",
                "color": "yellow",
                "pinned": true,
                "autoOpen": true,
                "createdAt": 400,
                "updatedAt": 400
            }),
            &tracker,
        )
        .unwrap();
        assert_eq!(list_auto_open_stickies(tmp.path()), vec![("stk-b".to_string(), false)]);
        let pruned = prune_empty_stickies_in_file(tmp.path(), &tracker).unwrap();
        assert_eq!(pruned, vec!["stk-empty".to_string()]);
        assert!(find_sticky_in_file(tmp.path(), "stk-empty").is_none());
        assert!(find_sticky_in_file(tmp.path(), "stk-a").is_some());
    }
}
