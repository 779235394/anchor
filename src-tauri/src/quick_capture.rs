use std::str::FromStr;
#[cfg(not(target_os = "macos"))]
use tauri::PhysicalPosition;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const QUICK_CAPTURE_LABEL: &str = "quick-capture";

#[cfg(target_os = "macos")]
fn configure_macos_overlay_window(win: &WebviewWindow) {
    use objc2_app_kit::{NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};

    if let Ok(ptr) = win.ns_window() {
        if !ptr.is_null() {
            unsafe {
                let ns_win = &*(ptr as *const NSWindow);
                let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle;
                ns_win.setCollectionBehavior(behavior);
                // NSStatusWindowLevel (25) floats above normal & fullscreen apps and Dock,
                // while staying below macOS IME candidate popups (101) so Chinese Pinyin works cleanly.
                ns_win.setLevel(NSStatusWindowLevel);
                ns_win.setHidesOnDeactivate(false);
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn position_macos_on_cursor_screen(win: &WebviewWindow) {
    use objc2_app_kit::{NSEvent, NSScreen, NSWindow};
    use objc2_foundation::{MainThreadMarker, NSPoint};

    let Some(mtm) = MainThreadMarker::new() else {
        let _ = win.center();
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

    if let (Some(vis), Ok(ptr)) = (target_frame, win.ns_window()) {
        if !ptr.is_null() {
            unsafe {
                let ns_win = &*(ptr as *const NSWindow);
                let win_frame = ns_win.frame();
                let x = vis.origin.x + (vis.size.width - win_frame.size.width) / 2.0;
                // AppKit coordinates start at bottom-left; place card ~20% down from top.
                let y = (vis.origin.y + vis.size.height * 0.80 - win_frame.size.height)
                    .max(vis.origin.y + 24.0);
                ns_win.setFrameOrigin(NSPoint::new(x, y));
            }
            return;
        }
    }
    let _ = win.center();
}

#[cfg(target_os = "macos")]
mod macos_state {
    use objc2::rc::Retained;
    use objc2_app_kit::NSRunningApplication;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;

    /// App that was frontmost (e.g. a fullscreen browser/IDE) before Quick Capture was summoned.
    pub static PREV_APP: Mutex<Option<Retained<NSRunningApplication>>> = Mutex::new(None);
    /// Whether we temporarily switched Anchor to Accessory policy for this overlay session.
    pub static SWITCHED_POLICY: AtomicBool = AtomicBool::new(false);
}

#[cfg(target_os = "macos")]
fn show_macos_overlay(win: &WebviewWindow) {
    use objc2_app_kit::{NSApp, NSApplicationActivationPolicy, NSWindow, NSWorkspace};
    use objc2_foundation::MainThreadMarker;
    use std::sync::atomic::Ordering;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_app = NSApp(mtm);

    // When another app is frontmost (possibly in its own native Fullscreen Space), a Regular
    // Dock app activating itself makes macOS jump back to the Space holding its main window.
    // Switch to Accessory *synchronously* (Tauri's set_activation_policy is queued to the event
    // loop and would land after activation) so the overlay opens on the current Space instead.
    if !ns_app.isActive() {
        let prev = NSWorkspace::sharedWorkspace().frontmostApplication();
        if let Ok(mut guard) = macos_state::PREV_APP.lock() {
            *guard = prev;
        }
        if ns_app.activationPolicy() == NSApplicationActivationPolicy::Regular {
            ns_app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
            macos_state::SWITCHED_POLICY.store(true, Ordering::SeqCst);
        }
    } else if let Ok(mut guard) = macos_state::PREV_APP.lock() {
        *guard = None;
    }

    configure_macos_overlay_window(win);
    position_macos_on_cursor_screen(win);

    if let Ok(ptr) = win.ns_window() {
        if !ptr.is_null() {
            unsafe {
                let ns_win = &*(ptr as *const NSWindow);
                ns_win.orderFrontRegardless();
                ns_win.makeKeyAndOrderFront(None);
            }
        }
    }
    #[allow(deprecated)]
    ns_app.activateIgnoringOtherApps(true);
}

#[cfg(target_os = "macos")]
fn hide_macos_overlay(app: &AppHandle, win: &WebviewWindow) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSWindow};
    use std::sync::atomic::Ordering;

    if let Ok(ptr) = win.ns_window() {
        if !ptr.is_null() {
            unsafe {
                let ns_win = &*(ptr as *const NSWindow);
                ns_win.orderOut(None);
            }
        }
    }

    // Hand focus straight back to the app the user was in (keeps them inside its Fullscreen Space).
    let prev = macos_state::PREV_APP.lock().ok().and_then(|mut g| g.take());
    if let Some(prev) = prev {
        #[allow(deprecated)]
        let _ = prev.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
    }

    // Restore the Dock icon only after the previous app has regained focus; flipping back to
    // Regular while Anchor is still active would drag the user to the main window's Space.
    if macos_state::SWITCHED_POLICY.load(Ordering::SeqCst) {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let inner = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || restore_regular_policy(&inner));
        });
    }
}

#[cfg(target_os = "macos")]
fn restore_regular_policy(app: &AppHandle) {
    use objc2_app_kit::{NSApp, NSApplicationActivationPolicy};
    use objc2_foundation::MainThreadMarker;
    use std::sync::atomic::Ordering;

    // Skip if Quick Capture was summoned again in the meantime.
    let overlay_visible = app
        .get_webview_window(QUICK_CAPTURE_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if overlay_visible {
        return;
    }
    if let Some(mtm) = MainThreadMarker::new() {
        if macos_state::SWITCHED_POLICY.swap(false, Ordering::SeqCst) {
            NSApp(mtm).setActivationPolicy(NSApplicationActivationPolicy::Regular);
        }
    }
}

/// Called before the main window is shown (tray / Dock) so the Dock icon is always restored.
#[cfg(target_os = "macos")]
pub fn reset_macos_activation_state() {
    use std::sync::atomic::Ordering;
    macos_state::SWITCHED_POLICY.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = macos_state::PREV_APP.lock() {
        *guard = None;
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
        let _ = win.set_always_on_top(true);
        let _ = win.set_visible_on_all_workspaces(true);
        #[cfg(target_os = "macos")]
        {
            let win_clone = win.clone();
            let _ = app.run_on_main_thread(move || {
                configure_macos_overlay_window(&win_clone);
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
        let win_clone = win.clone();
        let _ = app.run_on_main_thread(move || {
            configure_macos_overlay_window(&win_clone);
        });
    }

    Ok(win)
}

pub fn toggle_quick_capture_window(app: &AppHandle) -> Result<(), String> {
    let win = ensure_quick_capture_window(app)?;
    // Pinned on top: if visible but the user is typing elsewhere, the shortcut re-focuses it
    // instead of hiding; only a visible + focused card is toggled away.
    if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
        return hide_quick_capture_window(app);
    }

    #[cfg(target_os = "macos")]
    {
        let app_clone = app.clone();
        let win_clone = win.clone();
        let _ = app.run_on_main_thread(move || {
            show_macos_overlay(&win_clone);
            let _ = app_clone.emit_to(QUICK_CAPTURE_LABEL, "quick-capture://shown", ());
        });
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
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
                hide_macos_overlay(&app_clone, &win_clone);
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
                let _ = toggle_quick_capture_window(app_handle);
            }
        })
        .map_err(|e| format!("快捷键「{trimmed}」注册失败，可能已被系统或其他应用占用：{e}"))
}

/// Atomically updates the registered global shortcut, rolling back to the previous
/// shortcut automatically if the OS rejects the new combination.
pub fn apply_shortcut_update(
    app: &AppHandle,
    prev_shortcut: &str,
    prev_enabled: bool,
    new_shortcut: &str,
    new_enabled: bool,
) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();

    if !new_enabled {
        return Ok(());
    }

    match register_global_shortcut(app, new_shortcut) {
        Ok(()) => Ok(()),
        Err(err) => {
            if prev_enabled && !prev_shortcut.trim().is_empty() {
                let _ = register_global_shortcut(app, prev_shortcut);
            }
            Err(err)
        }
    }
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
