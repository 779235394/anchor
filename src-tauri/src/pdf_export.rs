use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static EXPORT_SEQ: AtomicU64 = AtomicU64::new(1);

struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Verifies that the exported file exists and is a structurally valid, completely flushed PDF.
fn validate_pdf_file(dest_path: &Path) -> Result<(), String> {
    let bytes = fs::read(dest_path)
        .map_err(|e| format!("PDF 文件未生成 ({}): {e}", dest_path.display()))?;
    if bytes.len() < 128 {
        return Err("生成的 PDF 文件内容异常过小".to_string());
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("生成的文件缺少有效 PDF 文件头 (%PDF-)".to_string());
    }
    let tail_start = bytes.len().saturating_sub(4096);
    if !bytes[tail_start..].windows(5).any(|w| w == b"%%EOF") {
        return Err("生成的 PDF 文件未完整写入 (缺少 %%EOF)".to_string());
    }
    Ok(())
}

/// Renders a self-contained HTML document to a paginated A4 vector PDF file using
/// a temporary hidden platform WebView (macOS NSPrintOperation / Windows WebView2 PrintToPdf).
pub async fn export_html_to_pdf(
    app: &AppHandle,
    html: &str,
    dest_path: &Path,
) -> Result<(), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = EXPORT_SEQ.fetch_add(1, Ordering::Relaxed);

    let temp_html_path = std::env::temp_dir().join(format!("anchor-pdf-{ts}-{seq}.html"));
    fs::write(&temp_html_path, html)
        .map_err(|e| format!("无法写入 PDF 临时渲染文件: {e}"))?;
    let _temp_guard = TempFileGuard(temp_html_path.clone());

    let file_url = tauri::Url::from_file_path(&temp_html_path)
        .map_err(|_| "无法构造 PDF 临时文件 URL".to_string())?;

    let label = format!("anchor-pdf-export-{ts}-{seq}");
    let (load_tx, load_rx) = mpsc::channel::<()>();
    let load_tx_slot = Arc::new(Mutex::new(Some(load_tx)));
    let load_tx_cb = Arc::clone(&load_tx_slot);

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(file_url))
        .title("Anchor PDF Export")
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(794.0, 1123.0)
        .on_page_load(move |_win, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                if let Ok(mut guard) = load_tx_cb.lock() {
                    if let Some(tx) = guard.take() {
                        let _ = tx.send(());
                    }
                }
            }
        })
        .build()
        .map_err(|e| format!("无法创建隐藏打印渲染窗口: {e}"))?;

    // Wait for HTML & inline Data URL images to finish loading on a blocking thread
    let load_ok = tauri::async_runtime::spawn_blocking(move || {
        load_rx.recv_timeout(Duration::from_secs(12)).is_ok()
    })
    .await
    .map_err(|e| format!("等待 PDF 渲染加载失败: {e}"))?;

    if !load_ok {
        let _ = window.destroy();
        return Err("PDF 渲染加载超时".to_string());
    }

    // Brief settle window for font metrics and layout paint
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(Duration::from_millis(260));
    })
    .await
    .ok();

    let dest_buf = dest_path.to_path_buf();
    let export_result = run_platform_pdf_export(&window, &dest_buf).await;

    let _ = window.destroy();

    export_result?;
    validate_pdf_file(dest_path)
}

#[cfg(target_os = "macos")]
mod macos_pdf {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, ProtocolObject};
    use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSWindow,
    };
    use objc2_foundation::{NSCopying, NSObject, NSPoint, NSRect, NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;
    use std::sync::mpsc::{self, Sender};
    use std::time::Duration;

    struct PrintDelegateIvars {
        tx: RefCell<Option<Sender<Result<(), String>>>>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = PrintDelegateIvars]
        struct AnchorPrintDelegate;

        impl AnchorPrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(
                &self,
                _op: &NSPrintOperation,
                success: Bool,
                _ctx: *mut c_void,
            ) {
                if let Some(tx) = self.ivars().tx.borrow_mut().take() {
                    let res = if success.as_bool() {
                        Ok(())
                    } else {
                        Err("macOS 原生打印引擎导出 PDF 失败".to_string())
                    };
                    let _ = tx.send(res);
                }
            }
        }
    );

    impl AnchorPrintDelegate {
        fn new(mtm: MainThreadMarker, tx: Sender<Result<(), String>>) -> Retained<Self> {
            let this = mtm.alloc::<Self>().set_ivars(PrintDelegateIvars {
                tx: RefCell::new(Some(tx)),
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    pub async fn run(window: &tauri::WebviewWindow, dest_path: &Path) -> Result<(), String> {
        let (done_tx, done_rx) = mpsc::channel::<Result<(), String>>();
        let (ptr_tx, ptr_rx) = mpsc::channel::<Result<usize, String>>();
        let dest_str = dest_path.to_string_lossy().to_string();

        window
            .with_webview(move |webview| {
                let start_res = (|| -> Result<usize, String> {
                    let mtm = MainThreadMarker::new()
                        .ok_or_else(|| "PDF 导出必须在 macOS 主线程执行".to_string())?;
                    let wk_ptr = webview.inner() as *const WKWebView;
                    let win_ptr = webview.ns_window() as *const NSWindow;
                    if wk_ptr.is_null() || win_ptr.is_null() {
                        return Err("无法获取 WKWebView 或 NSWindow 实例".to_string());
                    }
                    let wk_webview: &WKWebView = unsafe { &*wk_ptr };
                    let ns_window: &NSWindow = unsafe { &*win_ptr };

                    unsafe {
                        // Clone sharedPrintInfo dictionary so printer/PDF defaults are properly populated
                        let shared = NSPrintInfo::sharedPrintInfo();
                        let shared_dict = shared.dictionary();
                        let print_info =
                            NSPrintInfo::initWithDictionary(NSPrintInfo::alloc(), &shared_dict);

                        // Standard A4 portrait in PDF points (210mm x 297mm)
                        let paper_size = NSSize::new(595.28, 841.89);
                        print_info.setPaperSize(paper_size);
                        // CSS @page controls exact page margins cleanly
                        print_info.setLeftMargin(0.0);
                        print_info.setRightMargin(0.0);
                        print_info.setTopMargin(0.0);
                        print_info.setBottomMargin(0.0);
                        print_info.setHorizontallyCentered(false);
                        print_info.setVerticallyCentered(false);
                        print_info.setJobDisposition(NSPrintSaveJob);

                        let dict = print_info.dictionary();
                        let ns_path = NSString::from_str(&dest_str);
                        let ns_url = NSURL::fileURLWithPath(&ns_path);
                        let url_obj: &AnyObject =
                            &*(Retained::as_ptr(&ns_url) as *const AnyObject);
                        let key_obj: &ProtocolObject<dyn NSCopying> =
                            ProtocolObject::from_ref(NSPrintJobSavingURL);
                        dict.setObject_forKey(url_obj, key_obj);

                        let op = wk_webview.printOperationWithPrintInfo(&print_info);
                        // Ensure print view has full A4 frame before WKWebView starts async pagination
                        if let Some(view) = op.view() {
                            view.setFrame(NSRect::new(NSPoint::new(0.0, 0.0), paper_size));
                        }
                        op.setShowsPrintPanel(false);
                        op.setShowsProgressPanel(false);

                        let delegate = AnchorPrintDelegate::new(mtm, done_tx);
                        let raw_delegate = Retained::into_raw(delegate);
                        let delegate_obj: &AnyObject = &*(raw_delegate as *const AnyObject);

                        // WKWebView's _WKPrintOperation requires async runOperationModalForWindow
                        // so WebContent IPC finishes writing all PDF pages & %%EOF before callback fires.
                        op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                            ns_window,
                            Some(delegate_obj),
                            Some(sel!(printOperationDidRun:success:contextInfo:)),
                            std::ptr::null_mut(),
                        );

                        Ok(raw_delegate as usize)
                    }
                })();
                let _ = ptr_tx.send(start_res);
            })
            .map_err(|e| format!("调度 macOS PDF 导出失败: {e}"))?;

        let raw_delegate = tauri::async_runtime::spawn_blocking(move || {
            ptr_rx
                .recv_timeout(Duration::from_secs(10))
                .map_err(|_| "启动 macOS PDF 导出超时".to_string())?
        })
        .await
        .map_err(|e| format!("启动 macOS PDF 导出任务失败: {e}"))??;

        let wait_res = tauri::async_runtime::spawn_blocking(move || {
            done_rx
                .recv_timeout(Duration::from_secs(25))
                .map_err(|_| "macOS PDF 导出超时".to_string())?
        })
        .await
        .map_err(|e| format!("等待 macOS PDF 导出任务失败: {e}"))?;

        // Release delegate cleanly on the main thread after callback finishes (or on timeout)
        let _ = window.with_webview(move |_| unsafe {
            let _ = Retained::from_raw(raw_delegate as *mut AnchorPrintDelegate);
        });

        wait_res
    }
}

#[cfg(target_os = "macos")]
async fn run_platform_pdf_export(
    window: &tauri::WebviewWindow,
    dest_path: &Path,
) -> Result<(), String> {
    macos_pdf::run(window, dest_path).await
}

#[cfg(target_os = "windows")]
async fn run_platform_pdf_export(
    window: &tauri::WebviewWindow,
    dest_path: &Path,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, PCWSTR};

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let dest_utf16: Vec<u16> = dest_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    window
        .with_webview(move |webview| {
            let tx_err = tx.clone();
            let init_res = (|| -> Result<(), String> {
                let controller = webview.controller();
                let env = webview.environment();
                unsafe {
                    let core = controller
                        .CoreWebView2()
                        .map_err(|e| format!("获取 CoreWebView2 失败: {e}"))?;
                    let wv7: ICoreWebView2_7 = core
                        .cast()
                        .map_err(|e| format!("当前 WebView2 不支持 PrintToPdf: {e}"))?;
                    let env6: ICoreWebView2Environment6 = env
                        .cast()
                        .map_err(|e| format!("当前 WebView2 环境不支持 PrintSettings: {e}"))?;

                    let settings = env6
                        .CreatePrintSettings()
                        .map_err(|e| format!("创建 PrintSettings 失败: {e}"))?;
                    // Standard A4 portrait in inches (210mm x 297mm)
                    let _ = settings.SetPageWidth(8.27);
                    let _ = settings.SetPageHeight(11.69);
                    let _ = settings.SetMarginTop(0.0);
                    let _ = settings.SetMarginBottom(0.0);
                    let _ = settings.SetMarginLeft(0.0);
                    let _ = settings.SetMarginRight(0.0);
                    let _ = settings.SetShouldPrintBackgrounds(true);
                    let _ = settings.SetShouldPrintHeaderAndFooter(false);

                    let handler = PrintToPdfCompletedHandler::create(Box::new(
                        move |hr, is_successful| {
                            let res = match hr {
                                Ok(()) if is_successful => Ok(()),
                                Ok(()) => Err("WebView2 PrintToPdf 未能生成文件".to_string()),
                                Err(e) => Err(format!("WebView2 PrintToPdf 失败: {e}")),
                            };
                            let _ = tx.send(res);
                            Ok(())
                        },
                    ));

                    wv7.PrintToPdf(PCWSTR(dest_utf16.as_ptr()), &settings, &handler)
                        .map_err(|e| format!("调用 PrintToPdf 失败: {e}"))?;
                }
                Ok(())
            })();

            if let Err(err) = init_res {
                let _ = tx_err.send(Err(err));
            }
        })
        .map_err(|e| format!("调度 Windows PDF 导出失败: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(25))
            .map_err(|_| "Windows PDF 导出超时".to_string())?
    })
    .await
    .map_err(|e| format!("等待 Windows PDF 导出任务失败: {e}"))?
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn run_platform_pdf_export(
    _window: &tauri::WebviewWindow,
    _dest_path: &Path,
) -> Result<(), String> {
    Err("当前平台暂不支持静默直出 PDF，已切换系统打印预览".to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_pdf_file;
    use tempfile::TempDir;

    #[test]
    fn validates_pdf_header_and_eof_marker() {
        let tmp = TempDir::new().unwrap();
        let bad = tmp.path().join("bad.pdf");
        std::fs::write(&bad, b"not a pdf file at all").unwrap();
        assert!(validate_pdf_file(&bad).is_err());

        let truncated = tmp.path().join("trunc.pdf");
        std::fs::write(&truncated, format!("%PDF-1.4\n{}", "x".repeat(200))).unwrap();
        assert!(validate_pdf_file(&truncated).is_err());

        let good = tmp.path().join("good.pdf");
        std::fs::write(&good, format!("%PDF-1.4\n{}\n%%EOF\n", "x".repeat(200))).unwrap();
        assert!(validate_pdf_file(&good).is_ok());
    }
}
