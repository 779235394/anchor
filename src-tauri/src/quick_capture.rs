use std::str::FromStr;
#[cfg(not(target_os = "macos"))]
use tauri::{Emitter, PhysicalPosition};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const QUICK_CAPTURE_LABEL: &str = "quick-capture";

#[cfg(target_os = "macos")]
mod macos_panel {
    use super::QUICK_CAPTURE_LABEL;
    use objc2_app_kit::{NSScreen, NSWindowCollectionBehavior, NSWindowStyleMask};
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use tauri_nspanel::{tauri_panel, ManagerExt, PanelHandle, PanelLevel, WebviewWindowExt};

    tauri_panel! {
        panel!(QuickCapturePanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true
            }
        })
    }

    fn apply_panel_overlay_style(panel: &PanelHandle<tauri::Wry>) {
        panel.set_floating_panel(true);
        panel.set_hides_on_deactivate(false);
        panel.set_works_when_modal(true);
        panel.set_released_when_closed(false);
        // NonactivatingPanel is required by macOS WindowServer so the panel can float directly
        // over another app's native Fullscreen Space without forcing a Space switch.
        let _ = panel.add_style_mask(NSWindowStyleMask::NonactivatingPanel);
        // NSStatusWindowLevel (25) floats above native fullscreen apps & menu bar while staying
        // below macOS Chinese Pinyin IME candidate windows (101).
        panel.set_level(PanelLevel::Status.value());
        panel.set_collection_behavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    }

    fn position_panel_on_cursor_screen(panel: &PanelHandle<tauri::Wry>) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let mouse = NSEvent::mouseLocation();
        let screens = NSScreen::screens(mtm);
        let mut target_frame = NSScreen::mainScreen(mtm).map(|s| s.visibleFrame());
        for screen in screens.iter() {
            let frame = screen.frame();
            if mouse.x >= frame.origin.x
                && mouse.x <= frame.origin.x + frame.size.width
                && mouse.y >= frame.origin.y
                && mouse.y <= frame.origin.y + frame.size.height
            {
                target_frame = Some(screen.visibleFrame());
                break;
            }
        }

        if let Some(vis) = target_frame {
            let ns_panel = panel.as_panel();
            let win_frame = ns_panel.frame();
            let x = vis.origin.x + (vis.size.width - win_frame.size.width) / 2.0;
            // AppKit origin is bottom-left; place card ~20% down from top of active screen.
            let y = (vis.origin.y + vis.size.height * 0.80 - win_frame.size.height)
                .max(vis.origin.y + 24.0);
            ns_panel.setFrameOrigin(NSPoint::new(x, y));
        }
    }

    pub fn ensure_panel_on_main(
        app: &AppHandle,
        win: &WebviewWindow,
    ) -> Option<PanelHandle<tauri::Wry>> {
        if let Ok(existing) = app.get_webview_panel(QUICK_CAPTURE_LABEL) {
            return Some(existing);
        }
        match win.to_panel::<QuickCapturePanel>() {
            Ok(panel) => {
                apply_panel_overlay_style(&panel);
                Some(panel)
            }
            Err(err) => {
                eprintln!("[Anchor] Failed to convert quick-capture to NSPanel: {err}");
                None
            }
        }
    }

    pub fn toggle_panel_on_main(app: &AppHandle, win: &WebviewWindow) {
        let Some(panel) = ensure_panel_on_main(app, win) else {
            return;
        };

        // Pinned on top: if visible & already key, toggle it away; if visible while user is
        // working in another app, bring key focus straight back to it.
        if panel.is_visible() && panel.as_panel().isKeyWindow() {
            panel.hide();
            return;
        }

        apply_panel_overlay_style(&panel);
        position_panel_on_cursor_screen(&panel);
        panel.order_front_regardless();
        panel.show_and_make_key();
        let _ = app.emit_to(QUICK_CAPTURE_LABEL, "quick-capture://shown", ());
    }

    pub fn hide_panel_on_main(app: &AppHandle, win: &WebviewWindow) {
        if let Ok(panel) = app.get_webview_panel(QUICK_CAPTURE_LABEL) {
            panel.hide();
        } else {
            let _ = win.hide();
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn position_spotlight_window(win: &WebviewWindow) {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());

    if let (Some(mon), Ok(size)) = (monitor, win.outer_size()) {
        let mon_pos = mon.position();
        let mon_size = mon.size();
        let x = mon_pos.x + ((mon_size.width as i32 - size.width as i32) / 2);
        let y = mon_pos.y + ((mon_size.height as f64 * 0.20) as i32);
        let _ = win.set_position(PhysicalPosition::new(x, y));
    } else {
        let _ = win.center();
    }
}

pub fn ensure_quick_capture_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(QUICK_CAPTURE_LABEL) {
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.set_always_on_top(true);
            let _ = win.set_visible_on_all_workspaces(true);
        }
        #[cfg(target_os = "macos")]
        {
            let app_clone = app.clone();
            let win_clone = win.clone();
            let _ = app.run_on_main_thread(move || {
                let _ = macos_panel::ensure_panel_on_main(&app_clone, &win_clone);
            });
        }
        return Ok(win);
    }

    let win = WebviewWindowBuilder::new(
        app,
        QUICK_CAPTURE_LABEL,
        WebviewUrl::App("index.html#quick-capture".into()),
    )
    .title("Anchor Quick Capture")
    .inner_size(560.0, 268.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .center()
    .build()
    .map_err(|e| format!("Failed to create quick-capture window: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        let win_clone = win.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = macos_panel::ensure_panel_on_main(&app_clone, &win_clone);
        });
    }

    Ok(win)
}

pub fn toggle_quick_capture_window(app: &AppHandle) -> Result<(), String> {
    let win = ensure_quick_capture_window(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        let win_clone = win.clone();
        let _ = app.run_on_main_thread(move || {
            macos_panel::toggle_panel_on_main(&app_clone, &win_clone);
        });
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
            return hide_quick_capture_window(app);
        }
        let _ = win.set_visible_on_all_workspaces(true);
        let _ = win.set_always_on_top(true);
        position_spotlight_window(&win);
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
        let _ = app.emit_to(QUICK_CAPTURE_LABEL, "quick-capture://shown", ());
        Ok(())
    }
}

pub fn hide_quick_capture_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(QUICK_CAPTURE_LABEL) {
        #[cfg(target_os = "macos")]
        {
            let app_clone = app.clone();
            let win_clone = win.clone();
            let _ = app.run_on_main_thread(move || {
                macos_panel::hide_panel_on_main(&app_clone, &win_clone);
            });
            return Ok(());
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = win.hide();
        }
    }
    Ok(())
}

pub fn register_global_shortcut(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let trimmed = shortcut_str.trim();
    if trimmed.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let parsed = Shortcut::from_str(trimmed)
        .map_err(|e| format!("快捷键格式无效（{trimmed}）：{e}"))?;

    app.global_shortcut()
        .on_shortcut(parsed, move |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let app_c = app_handle.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = toggle_quick_capture_window(&app_c);
                });
            }
        })
        .map_err(|e| format!("快捷键「{trimmed}」注册失败，可能已被系统或其他应用占用：{e}"))
}

pub fn register_sticky_global_shortcut(app: &AppHandle, shortcut_str: &str) -> Result<(), String> {
    let trimmed = shortcut_str.trim();
    if trimmed.is_empty() {
        return Err("快捷键不能为空".to_string());
    }

    let parsed = Shortcut::from_str(trimmed)
        .map_err(|e| format!("快捷键格式无效（{trimmed}）：{e}"))?;

    app.global_shortcut()
        .on_shortcut(parsed, move |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                crate::create_and_open_sticky_from_tray(app_handle);
            }
        })
        .map_err(|e| format!("快捷键「{trimmed}」注册失败，可能已被系统或其他应用占用：{e}"))
}

fn normalize_shortcut_key(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

/// Atomically reconciles BOTH global shortcuts (Quick Capture + New Sticky Note),
/// rejecting duplicates and rolling back cleanly if OS registration fails.
pub fn sync_all_global_shortcuts(
    app: &AppHandle,
    prev_qc: (&str, bool),
    prev_sticky: (&str, bool),
    next_qc: (&str, bool),
    next_sticky: (&str, bool),
) -> Result<(), String> {
    if next_qc.1
        && next_sticky.1
        && !next_qc.0.trim().is_empty()
        && normalize_shortcut_key(next_qc.0) == normalize_shortcut_key(next_sticky.0)
    {
        return Err("快捷记录与桌面便签的全局快捷键不能相同，请换一个组合键".to_string());
    }

    // Validate syntax before touching currently registered hotkeys
    if next_qc.1 && !next_qc.0.trim().is_empty() {
        Shortcut::from_str(next_qc.0.trim())
            .map_err(|e| format!("快捷键格式无效（{}）：{e}", next_qc.0.trim()))?;
    }
    if next_sticky.1 && !next_sticky.0.trim().is_empty() {
        Shortcut::from_str(next_sticky.0.trim())
            .map_err(|e| format!("快捷键格式无效（{}）：{e}", next_sticky.0.trim()))?;
    }

    let _ = app.global_shortcut().unregister_all();

    let mut register_err: Option<String> = None;
    if next_qc.1 && !next_qc.0.trim().is_empty() {
        if let Err(err) = register_global_shortcut(app, next_qc.0) {
            register_err = Some(err);
        }
    }
    if register_err.is_none() && next_sticky.1 && !next_sticky.0.trim().is_empty() {
        if let Err(err) = register_sticky_global_shortcut(app, next_sticky.0) {
            register_err = Some(err);
        }
    }

    if let Some(err) = register_err {
        let _ = app.global_shortcut().unregister_all();
        if prev_qc.1 && !prev_qc.0.trim().is_empty() {
            let _ = register_global_shortcut(app, prev_qc.0);
        }
        if prev_sticky.1 && !prev_sticky.0.trim().is_empty() {
            let _ = register_sticky_global_shortcut(app, prev_sticky.0);
        }
        return Err(err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_frontend_shortcut_recorder_formats() {
        for combo in [
            "Alt+Space",
            "Alt+Shift+Space",
            "CommandOrControl+Shift+N",
            "Control+Alt+K",
            "CommandOrControl+Alt+Space",
            "Super+Shift+I",
            "Alt+F2",
        ] {
            assert!(
                Shortcut::from_str(combo).is_ok(),
                "Expected valid Tauri shortcut string: {combo}"
            );
        }
    }
}
