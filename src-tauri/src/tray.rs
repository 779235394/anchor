use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

pub const TRAY_ID: &str = "anchor-main-tray";
const MENU_OPEN: &str = "tray-open";
const MENU_STATUS: &str = "tray-status";
const MENU_QUIT: &str = "tray-quit";

pub struct TrayState {
    pub open_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    pub status_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    pub quit_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn setup_tray(app: &AppHandle<tauri::Wry>) -> Result<TrayState, Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "打开 Anchor 锚点", true, None::<&str>)?;
    let status_item = MenuItem::with_id(app, MENU_STATUS, "今日待办：0", false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "退出 Anchor", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_item, &status_item, &sep, &quit_item])?;

    // macOS uses monochrome template icon (adapts automatically to Light/Dark menu bar);
    // Windows/Linux use crisp colorful Porcelain Stack 32x32 icon so it stays legible on Dark Taskbar!
    #[cfg(target_os = "macos")]
    let icon_bytes: &[u8] = include_bytes!("../icons/tray-icon.png");
    #[cfg(not(target_os = "macos"))]
    let icon_bytes: &[u8] = include_bytes!("../icons/32x32.png");

    let tray_icon = Image::from_bytes(icon_bytes)?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .tooltip("Anchor 锚点")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_QUIT => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        show_main_window(app);
                    }
                }
            }
        });

    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);

    builder.build(app)?;

    Ok(TrayState {
        open_item: Mutex::new(Some(open_item)),
        status_item: Mutex::new(Some(status_item)),
        quit_item: Mutex::new(Some(quit_item)),
    })
}

pub fn update_tray_badge(app: &AppHandle<tauri::Wry>, open_today: usize, overdue: usize, lang: &str) {
    let en = lang == "en";
    let open_label = if en { "Open Anchor" } else { "打开 Anchor 锚点" };
    let quit_label = if en { "Quit Anchor" } else { "退出 Anchor" };
    let status_text = if en {
        if overdue > 0 {
            format!("Today: {open_today} · Overdue: {overdue}")
        } else {
            format!("Today: {open_today}")
        }
    } else if overdue > 0 {
        format!("今日待办：{open_today} · 逾期：{overdue}")
    } else {
        format!("今日待办：{open_today}")
    };

    if let Some(state) = app.try_state::<TrayState>() {
        if let Ok(guard) = state.open_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(open_label);
            }
        }
        if let Ok(guard) = state.status_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(&status_text);
            }
        }
        if let Ok(guard) = state.quit_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(quit_label);
            }
        }
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let prefix = if en { "Anchor" } else { "Anchor 锚点" };
        let tooltip = format!("{prefix} · {status_text}");
        let _ = tray.set_tooltip(Some(tooltip));

        #[cfg(target_os = "macos")]
        {
            if open_today > 0 {
                let _ = tray.set_title(Some(format!("{open_today}")));
            } else {
                let _ = tray.set_title(Option::<&str>::None);
            }
        }
    }
}
