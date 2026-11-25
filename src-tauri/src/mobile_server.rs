use crate::docs::{
    create_doc_folder, delete_doc_entry, list_docs_tree, read_doc_file, rename_doc_entry,
    search_docs, write_doc_file, DocEntry, DocFileContent,
};
use crate::mobile_tunnel::{TunnelHandle, TunnelStatus};
use crate::storage::{
    atomic_write_text, ensure_daily_snapshot, infer_mime_type, load_workspace,
    resolve_attachment_path, save_attachment_bytes, SelfWriteTracker,
};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart, Path as AxumPath, Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, SET_COOKIE, USER_AGENT};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::convert::Infallible;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

const SESSION_COOKIE_NAME: &str = "anchor_mobile_sid";
const CSRF_HEADER_NAME: &str = "x-anchor-client";
const CSRF_HEADER_VALUE: &str = "mobile";
const PAIR_TOKEN_TTL_MS: u64 = 5 * 60 * 1000;
const MAX_IMAGE_UPLOAD_BYTES: usize = 15 * 1024 * 1024;
const ALLOWED_PROJECT_COLORS: &[&str] = &[
    "blue", "indigo", "purple", "pink", "orange", "green", "teal", "slate",
];
const ALLOWED_IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "heic"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSessionInfo {
    pub id: String,
    pub device_name: String,
    pub client_ip: String,
    pub paired_at: u64,
    pub last_seen_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileServerStatus {
    pub running: bool,
    pub port: u16,
    pub base_url: Option<String>,
    pub pair_url: Option<String>,
    pub pair_expires_at: Option<u64>,
    pub pair_consumed: bool,
    pub tunnel: TunnelStatus,
    pub sessions: Vec<MobileSessionInfo>,
    pub auto_stop_minutes: u32,
    pub last_activity_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileShardUpdateEvent {
    pub shard: String,
    pub items: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileUiPrefs {
    pub lang: String,
    pub accent: String,
    pub theme: String,
}

#[derive(Debug, Clone)]
pub struct StaticAsset {
    pub bytes: Vec<u8>,
    pub mime: String,
}

pub type DataDirProvider = Arc<dyn Fn() -> PathBuf + Send + Sync>;
pub type UiPrefsProvider = Arc<dyn Fn() -> MobileUiPrefs + Send + Sync>;
pub type StaticAssetLoader = Arc<dyn Fn(&str) -> Option<StaticAsset> + Send + Sync>;
pub type ShardEventEmitter = Arc<dyn Fn(MobileShardUpdateEvent) + Send + Sync>;
pub type DocsEventEmitter = Arc<dyn Fn() + Send + Sync>;
pub type StatusEventEmitter = Arc<dyn Fn(MobileServerStatus) + Send + Sync>;

struct StoredSession {
    public_id: String,
    device_key: Option<String>,
    device_name: String,
    os_family: String,
    device_model: Option<String>,
    client_ip: String,
    paired_at: u64,
    last_seen_at: u64,
}

struct PairingTicket {
    token: String,
    expires_at: u64,
    consumed: bool,
}

struct ServerInner {
    running: bool,
    port: u16,
    auto_stop_minutes: u32,
    last_activity_at: Option<u64>,
    pairing: Option<PairingTicket>,
    sessions: HashMap<String, StoredSession>,
    tunnel: Option<TunnelHandle>,
    tunnel_status: TunnelStatus,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct MobileHttpContext {
    inner: Mutex<ServerInner>,
    data_dir: DataDirProvider,
    ui_prefs: UiPrefsProvider,
    tracker: SelfWriteTracker,
    shard_lock: Arc<Mutex<()>>,
    asset_loader: StaticAssetLoader,
    on_shard_update: ShardEventEmitter,
    on_docs_update: DocsEventEmitter,
    on_status_change: StatusEventEmitter,
    sse_tx: broadcast::Sender<String>,
}

pub struct MobileServerState {
    ctx: Arc<MobileHttpContext>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn generate_random_hex(num_bytes: usize) -> String {
    let mut buf = vec![0u8; num_bytes];
    if getrandom::getrandom(&mut buf).is_err() {
        // Fallback entropy only if OS CSPRNG fails (should never happen on macOS/Windows)
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for (i, b) in buf.iter_mut().enumerate() {
            *b = ((nanos >> ((i % 16) * 4)) as u8) ^ ((i as u8).wrapping_mul(37));
        }
    }
    let mut out = String::with_capacity(num_bytes * 2);
    for b in buf {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in ab.iter().zip(bb.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn parse_cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get(COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == name {
                let val = v.trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

fn extract_client_ip(headers: &HeaderMap) -> String {
    if let Some(cf) = headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = cf.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    "Local / LAN".to_string()
}

fn is_https_request(headers: &HeaderMap, base_url: Option<&str>) -> bool {
    if let Some(proto) = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
    {
        if proto.eq_ignore_ascii_case("https") {
            return true;
        }
    }
    base_url
        .map(|u| u.starts_with("https://"))
        .unwrap_or(false)
}

fn infer_os_and_model(ua: &str) -> (String, Option<String>) {
    let os = if ua.contains("iPhone") {
        "iPhone"
    } else if ua.contains("iPad") {
        "iPad"
    } else if ua.contains("HarmonyOS") || ua.contains("OpenHarmony") {
        "HarmonyOS"
    } else if ua.contains("Android") {
        "Android"
    } else if ua.contains("Macintosh") {
        "Mac"
    } else if ua.contains("Windows") {
        "Windows"
    } else {
        "Mobile"
    };

    // Best-effort extraction of Android/HarmonyOS hardware model inside `(...)` UA segment
    let model = if matches!(os, "Android" | "HarmonyOS") {
        ua.find('(')
            .and_then(|s| ua[s + 1..].find(')').map(|e| &ua[s + 1..s + 1 + e]))
            .and_then(|inside| {
                inside
                    .split(';')
                    .map(|p| p.trim())
                    .filter(|p| {
                        !p.is_empty()
                            && !p.eq_ignore_ascii_case("linux")
                            && !p.eq_ignore_ascii_case("u")
                            && !p.eq_ignore_ascii_case("k")
                            && !p.starts_with("Android")
                            && !p.starts_with("HarmonyOS")
                            && !p.starts_with("OpenHarmony")
                            && !p.starts_with("zh-")
                            && !p.starts_with("en-")
                    })
                    .last()
                    .map(|raw| raw.split("Build/").next().unwrap_or(raw).trim().to_string())
                    .filter(|m| m.len() >= 2 && m.len() <= 32)
            })
    } else {
        None
    };

    (os.to_string(), model)
}

fn infer_device_name(headers: &HeaderMap, provided: Option<&str>) -> (String, String, Option<String>) {
    let ua = headers
        .get(USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let (os, model) = infer_os_and_model(ua);

    if let Some(raw) = provided {
        let clean: String = raw
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(48)
            .collect();
        if !clean.is_empty() {
            return (clean, os, model);
        }
    }

    let browser = if ua.contains("MicroMessenger") {
        "WeChat"
    } else if ua.contains("Edg") {
        "Edge"
    } else if ua.contains("CriOS") || (ua.contains("Chrome") && !ua.contains("Edg")) {
        "Chrome"
    } else if ua.contains("Firefox") || ua.contains("FxiOS") {
        "Firefox"
    } else if ua.contains("Safari") {
        "Safari"
    } else {
        "Browser"
    };
    (format!("{os} · {browser}"), os, model)
}

fn is_phone_family(os: &str) -> bool {
    matches!(os, "iPhone" | "Android" | "HarmonyOS" | "Mobile")
}

/// Determines whether an incoming pairing session belongs to the same physical phone/browser
/// as an existing session so re-scanning merges cleanly instead of creating duplicate entries.
fn is_same_device_session(
    existing_sid: &str,
    existing: &StoredSession,
    incoming_cookie_sid: Option<&str>,
    incoming_device_key: Option<&str>,
    incoming_device_name: &str,
    incoming_os: &str,
    incoming_model: Option<&str>,
    incoming_ip: &str,
) -> bool {
    if incoming_cookie_sid.is_some_and(|sid| sid == existing_sid) {
        return true;
    }
    if let (Some(a), Some(b)) = (existing.device_key.as_deref(), incoming_device_key) {
        if !a.is_empty() && a == b {
            return true;
        }
    }
    if !incoming_ip.is_empty() && existing.client_ip == incoming_ip {
        if existing.device_name == incoming_device_name {
            return true;
        }
        // Same phone switching between WeChat WebView and system browser (e.g. Chrome/Safari)
        if is_phone_family(&existing.os_family) && is_phone_family(incoming_os) {
            let compatible_os = existing.os_family == incoming_os
                || existing.os_family == "Mobile"
                || incoming_os == "Mobile"
                || (matches!(existing.os_family.as_str(), "Android" | "HarmonyOS")
                    && matches!(incoming_os, "Android" | "HarmonyOS"));
            let compatible_model = match (existing.device_model.as_deref(), incoming_model) {
                (Some(a), Some(b)) => a.eq_ignore_ascii_case(b),
                _ => true,
            };
            if compatible_os && compatible_model {
                return true;
            }
        }
    }
    false
}

fn infer_static_mime(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else {
        "application/octet-stream"
    }
    .to_string()
}

pub fn default_dist_asset_loader() -> StaticAssetLoader {
    Arc::new(|key: &str| {
        let mut candidates = Vec::new();
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            candidates.push(PathBuf::from(manifest_dir).join("..").join("dist").join(key));
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("dist")
                .join(key),
        );
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(cwd.join("dist").join(key));
        }
        for path in candidates {
            if path.is_file() {
                if let Ok(bytes) = fs::read(&path) {
                    return Some(StaticAsset {
                        bytes,
                        mime: infer_static_mime(key),
                    });
                }
            }
        }
        None
    })
}

fn snapshot_status_locked(inner: &ServerInner) -> MobileServerStatus {
    let base_url = if inner.running {
        inner.tunnel_status.public_url.clone()
    } else {
        None
    };

    let now = now_ms();
    let (pair_url, pair_expires_at, pair_consumed) = match &inner.pairing {
        Some(ticket) => {
            let expired = now >= ticket.expires_at;
            let url = if !ticket.consumed && !expired {
                base_url
                    .as_ref()
                    .map(|b| format!("{b}/?pair={}", ticket.token))
            } else {
                None
            };
            (url, Some(ticket.expires_at), ticket.consumed)
        }
        None => (None, None, false),
    };

    let mut sessions: Vec<MobileSessionInfo> = inner
        .sessions
        .values()
        .map(|s| MobileSessionInfo {
            id: s.public_id.clone(),
            device_name: s.device_name.clone(),
            client_ip: s.client_ip.clone(),
            paired_at: s.paired_at,
            last_seen_at: s.last_seen_at,
        })
        .collect();
    sessions.sort_by(|a, b| b.paired_at.cmp(&a.paired_at));

    MobileServerStatus {
        running: inner.running,
        port: inner.port,
        base_url,
        pair_url,
        pair_expires_at,
        pair_consumed,
        tunnel: inner.tunnel_status.clone(),
        sessions,
        auto_stop_minutes: inner.auto_stop_minutes,
        last_activity_at: inner.last_activity_at,
    }
}

impl MobileHttpContext {
    fn status_snapshot(&self) -> MobileServerStatus {
        let guard = self.inner.lock().unwrap();
        snapshot_status_locked(&guard)
    }

    fn emit_status(&self) {
        let st = self.status_snapshot();
        (self.on_status_change)(st);
    }

    fn verify_session(&self, headers: &HeaderMap) -> Result<String, StatusCode> {
        let sid = parse_cookie_value(headers, SESSION_COOKIE_NAME).ok_or(StatusCode::UNAUTHORIZED)?;
        let now = now_ms();
        let mut guard = self.inner.lock().unwrap();
        if let Some(sess) = guard.sessions.get_mut(&sid) {
            sess.last_seen_at = now;
            guard.last_activity_at = Some(now);
            Ok(sid)
        } else {
            Err(StatusCode::UNAUTHORIZED)
        }
    }

    fn verify_csrf(headers: &HeaderMap) -> Result<(), StatusCode> {
        let val = headers
            .get(CSRF_HEADER_NAME)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if val.eq_ignore_ascii_case(CSRF_HEADER_VALUE) {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        }
    }

    fn broadcast_sse(&self, kind: &str) {
        let _ = self.sse_tx.send(kind.to_string());
    }
}

impl MobileServerState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        initial_auto_stop_minutes: u32,
        data_dir: DataDirProvider,
        ui_prefs: UiPrefsProvider,
        tracker: SelfWriteTracker,
        shard_lock: Arc<Mutex<()>>,
        asset_loader: StaticAssetLoader,
        on_shard_update: ShardEventEmitter,
        on_docs_update: DocsEventEmitter,
        on_status_change: StatusEventEmitter,
    ) -> Self {
        let (sse_tx, _) = broadcast::channel::<String>(64);
        let ctx = Arc::new(MobileHttpContext {
            inner: Mutex::new(ServerInner {
                running: false,
                port: 21890,
                auto_stop_minutes: initial_auto_stop_minutes,
                last_activity_at: None,
                pairing: None,
                sessions: HashMap::new(),
                tunnel: None,
                tunnel_status: TunnelStatus::default(),
                shutdown_tx: None,
            }),
            data_dir,
            ui_prefs,
            tracker,
            shard_lock,
            asset_loader,
            on_shard_update,
            on_docs_update,
            on_status_change,
            sse_tx,
        });
        Self { ctx }
    }

    pub fn get_status(&self) -> MobileServerStatus {
        self.ctx.status_snapshot()
    }

    pub fn is_running(&self) -> bool {
        self.ctx.inner.lock().unwrap().running
    }

    pub fn broadcast_external_change(&self, kind: &str) {
        if self.is_running() {
            self.ctx.broadcast_sse(kind);
        }
    }

    pub fn start(&self, auto_stop_minutes: Option<u32>) -> Result<MobileServerStatus, String> {
        {
            let mut guard = self.ctx.inner.lock().unwrap();
            if let Some(mins) = auto_stop_minutes {
                guard.auto_stop_minutes = mins;
            }
            if guard.running {
                return Ok(snapshot_status_locked(&guard));
            }
        }

        let (std_listener, bound_port) = bind_available_port(21890)?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let now = now_ms();

        {
            let mut guard = self.ctx.inner.lock().unwrap();
            guard.running = true;
            guard.port = bound_port;
            guard.last_activity_at = Some(now);
            guard.pairing = Some(PairingTicket {
                token: generate_random_hex(32),
                expires_at: now + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
            guard.shutdown_tx = Some(shutdown_tx);
            guard.tunnel_status = TunnelStatus::default();
        }

        let ctx_for_server = self.ctx.clone();
        tauri::async_runtime::spawn(async move {
            let _ = std_listener.set_nonblocking(true);
            let Ok(listener) = TcpListener::from_std(std_listener) else {
                return;
            };
            let app = build_router(ctx_for_server.clone());

            let ctx_watchdog = ctx_for_server.clone();
            let watchdog = tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(20));
                loop {
                    interval.tick().await;
                    let should_stop = {
                        let guard = ctx_watchdog.inner.lock().unwrap();
                        if !guard.running {
                            break;
                        }
                        if guard.auto_stop_minutes == 0 {
                            false
                        } else if let Some(last) = guard.last_activity_at {
                            let limit_ms = (guard.auto_stop_minutes as u64) * 60 * 1000;
                            now_ms().saturating_sub(last) >= limit_ms
                        } else {
                            false
                        }
                    };
                    if should_stop {
                        stop_context(&ctx_watchdog);
                        break;
                    }
                }
            });

            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await;
            watchdog.abort();
        });

        self.start_tunnel_for_port(bound_port);

        let st = self.ctx.status_snapshot();
        (self.ctx.on_status_change)(st.clone());
        Ok(st)
    }

    fn start_tunnel_for_port(&self, port: u16) {
        let old = {
            let mut guard = self.ctx.inner.lock().unwrap();
            guard.tunnel.take()
        };
        if let Some(t) = old {
            t.stop();
        }

        let ctx_cb = self.ctx.clone();
        let on_change = Arc::new(move |ts: TunnelStatus| {
            let status_snapshot = {
                let mut guard = ctx_cb.inner.lock().unwrap();
                if !guard.running {
                    return;
                }
                guard.tunnel_status = ts;
                snapshot_status_locked(&guard)
            };
            (ctx_cb.on_status_change)(status_snapshot);
        });

        match TunnelHandle::spawn(port, on_change) {
            Ok(handle) => {
                let mut guard = self.ctx.inner.lock().unwrap();
                guard.tunnel_status = handle.current_status();
                guard.tunnel = Some(handle);
            }
            Err(err) => {
                let mut guard = self.ctx.inner.lock().unwrap();
                guard.tunnel_status = TunnelStatus {
                    state: "error".to_string(),
                    public_url: None,
                    error: Some(err),
                    binary_path: None,
                };
            }
        }
    }

    pub fn retry_tunnel(&self) -> MobileServerStatus {
        let now = now_ms();
        let port = {
            let mut guard = self.ctx.inner.lock().unwrap();
            if !guard.running {
                return snapshot_status_locked(&guard);
            }
            guard.pairing = Some(PairingTicket {
                token: generate_random_hex(32),
                expires_at: now + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
            guard.last_activity_at = Some(now);
            guard.port
        };
        self.start_tunnel_for_port(port);
        let st = self.ctx.status_snapshot();
        (self.ctx.on_status_change)(st.clone());
        st
    }

    pub fn set_auto_stop_minutes(&self, minutes: u32) -> MobileServerStatus {
        {
            let mut guard = self.ctx.inner.lock().unwrap();
            guard.auto_stop_minutes = minutes;
            if guard.running {
                guard.last_activity_at = Some(now_ms());
            }
        }
        let st = self.ctx.status_snapshot();
        (self.ctx.on_status_change)(st.clone());
        st
    }

    pub fn stop(&self) -> MobileServerStatus {
        stop_context(&self.ctx)
    }

    pub fn refresh_pairing(&self) -> MobileServerStatus {
        let now = now_ms();
        {
            let mut guard = self.ctx.inner.lock().unwrap();
            if guard.running {
                guard.pairing = Some(PairingTicket {
                    token: generate_random_hex(32),
                    expires_at: now + PAIR_TOKEN_TTL_MS,
                    consumed: false,
                });
                guard.last_activity_at = Some(now);
            }
        }
        let st = self.ctx.status_snapshot();
        (self.ctx.on_status_change)(st.clone());
        st
    }

    pub fn revoke_session(&self, session_id: Option<&str>, revoke_all: bool) -> MobileServerStatus {
        {
            let mut guard = self.ctx.inner.lock().unwrap();
            if revoke_all {
                guard.sessions.clear();
            } else if let Some(pub_id) = session_id {
                guard.sessions.retain(|_, v| v.public_id != pub_id);
            }
        }
        self.ctx.broadcast_sse("auth-revoked");
        let st = self.ctx.status_snapshot();
        (self.ctx.on_status_change)(st.clone());
        st
    }
}

fn stop_context(ctx: &Arc<MobileHttpContext>) -> MobileServerStatus {
    let (shutdown_tx, tunnel) = {
        let mut guard = ctx.inner.lock().unwrap();
        guard.running = false;
        guard.pairing = None;
        guard.sessions.clear();
        guard.last_activity_at = None;
        guard.tunnel_status = TunnelStatus::default();
        (guard.shutdown_tx.take(), guard.tunnel.take())
    };
    if let Some(t) = tunnel {
        t.stop();
    }
    if let Some(tx) = shutdown_tx {
        let _ = tx.send(());
    }
    let st = ctx.status_snapshot();
    (ctx.on_status_change)(st.clone());
    st
}

fn bind_available_port(preferred: u16) -> Result<(std::net::TcpListener, u16), String> {
    let base = if preferred >= 1024 { preferred } else { 21890 };
    for offset in 0..=25u16 {
        let port = base.saturating_add(offset);
        // Bind strictly to loopback 127.0.0.1 so external access flows solely through the encrypted HTTPS tunnel
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        if let Ok(listener) = std::net::TcpListener::bind(addr) {
            return Ok((listener, port));
        }
    }
    Err("无法绑定本地回环端口，请稍后重试。".to_string())
}

// ================= AXUM ROUTER & HANDLERS =================

pub fn build_router(ctx: Arc<MobileHttpContext>) -> Router {
    let upload_route = Router::new()
        .route("/api/attachments/upload", post(api_upload_attachment))
        .layer(DefaultBodyLimit::max(MAX_IMAGE_UPLOAD_BYTES + 1024 * 1024));

    Router::new()
        // Static mobile web bundle (strict allowlist)
        .route("/", get(serve_mobile_index))
        .route("/mobile", get(serve_mobile_index))
        .route("/mobile.html", get(serve_mobile_index))
        .route("/app-icon.png", get(serve_app_icon))
        .route("/assets/{*path}", get(serve_static_asset))
        // Auth & health
        .route("/api/health", get(api_health))
        .route("/api/auth/pair", post(api_pair))
        .route("/api/auth/session", get(api_session))
        .route("/api/auth/logout", post(api_logout))
        // Workspace bootstrap & SSE
        .route("/api/bootstrap", get(api_bootstrap))
        .route("/api/events", get(api_events))
        // Tasks CRUD
        .route("/api/tasks", post(api_create_task))
        .route("/api/tasks/{id}", patch(api_update_task).delete(api_delete_task))
        // Projects CRUD
        .route("/api/projects", post(api_create_project))
        .route(
            "/api/projects/{id}",
            patch(api_update_project).delete(api_delete_project),
        )
        // Notes CRUD
        .route("/api/notes", post(api_create_note))
        .route("/api/notes/{id}", patch(api_update_note).delete(api_delete_note))
        // Knowledge Base Docs
        .route("/api/docs/tree", get(api_docs_tree))
        .route("/api/docs/search", get(api_docs_search))
        .route("/api/docs/file", get(api_docs_read).put(api_docs_write))
        .route("/api/docs/folder", post(api_docs_create_folder))
        .route("/api/docs/rename", post(api_docs_rename))
        .route("/api/docs/entry", delete(api_docs_delete))
        // Attachments read
        .route("/api/attachments/{filename}", get(api_read_attachment))
        .merge(upload_route)
        .with_state(ctx)
}

fn json_error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

// --- Static assets ---

async fn serve_mobile_index(State(ctx): State<Arc<MobileHttpContext>>) -> Response {
    match (ctx.asset_loader)("mobile.html") {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "text/html; charset=utf-8")
            .header(CACHE_CONTROL, "no-store")
            .header("x-content-type-options", "nosniff")
            .body(Body::from(asset.bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        None => Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .header(CONTENT_TYPE, "text/html; charset=utf-8")
            .body(Body::from(
                "<!doctype html><meta charset='utf-8'><title>Anchor Mobile</title><body style='font-family:-apple-system,sans-serif;padding:32px;color:#333'><h3>Anchor 移动端页面尚未构建</h3><p>开发模式下请先在项目目录执行 <code>pnpm build</code>，然后刷新本页。</p></body>",
            ))
            .unwrap(),
    }
}

async fn serve_app_icon(State(ctx): State<Arc<MobileHttpContext>>) -> Response {
    match (ctx.asset_loader)("app-icon.png") {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, "image/png")
            .header(CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(asset.bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn serve_static_asset(
    State(ctx): State<Arc<MobileHttpContext>>,
    AxumPath(subpath): AxumPath<String>,
) -> Response {
    let trimmed = subpath.trim_start_matches('/');
    if trimmed.is_empty()
        || trimmed.contains("..")
        || trimmed.contains('\\')
        || trimmed.starts_with('.')
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let key = format!("assets/{trimmed}");
    match (ctx.asset_loader)(&key) {
        Some(asset) => Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, asset.mime)
            .header(CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header("x-content-type-options", "nosniff")
            .body(Body::from(asset.bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// --- Auth & Health ---

async fn api_health() -> impl IntoResponse {
    Json(json!({ "ok": true, "app": "Anchor" }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    token: String,
    device_name: Option<String>,
    device_key: Option<String>,
}

async fn api_pair(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<PairRequest>,
) -> Response {
    let now = now_ms();
    let client_ip = extract_client_ip(&headers);
    let existing_cookie_sid = parse_cookie_value(&headers, SESSION_COOKIE_NAME);
    let device_key = clean_opt_str(req.device_key).map(|k| k.chars().take(64).collect::<String>());
    let (device_name, os_family, device_model) =
        infer_device_name(&headers, req.device_name.as_deref());

    let (secret_sid, public_id, https) = {
        let mut guard = ctx.inner.lock().unwrap();
        let Some(ticket) = guard.pairing.as_mut() else {
            return json_error(StatusCode::UNAUTHORIZED, "配对码无效，请重新扫描桌面端二维码");
        };
        if ticket.consumed {
            return json_error(StatusCode::UNAUTHORIZED, "配对码已被使用，请在电脑端点击「刷新二维码」后重扫");
        }
        if now >= ticket.expires_at {
            return json_error(StatusCode::UNAUTHORIZED, "配对码已过期，请在电脑端刷新二维码后重扫");
        }
        if !constant_time_eq(ticket.token.trim(), req.token.trim()) {
            return json_error(StatusCode::UNAUTHORIZED, "配对码不匹配，请重新扫描桌面端二维码");
        }

        ticket.consumed = true;

        // Deduplicate & merge any previous session(s) from the same phone/browser
        guard.sessions.retain(|sid, existing| {
            !is_same_device_session(
                sid,
                existing,
                existing_cookie_sid.as_deref(),
                device_key.as_deref(),
                &device_name,
                &os_family,
                device_model.as_deref(),
                &client_ip,
            )
        });

        let secret_sid = generate_random_hex(32);
        let public_id = generate_random_hex(8);
        guard.sessions.insert(
            secret_sid.clone(),
            StoredSession {
                public_id: public_id.clone(),
                device_key,
                device_name: device_name.clone(),
                os_family,
                device_model,
                client_ip,
                paired_at: now,
                last_seen_at: now,
            },
        );
        guard.last_activity_at = Some(now);
        let base_url = snapshot_status_locked(&guard).base_url;
        let https = is_https_request(&headers, base_url.as_deref());
        (secret_sid, public_id, https)
    };

    ctx.emit_status();

    let cookie = if https {
        format!("{SESSION_COOKIE_NAME}={secret_sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400; Secure")
    } else {
        format!("{SESSION_COOKIE_NAME}={secret_sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400")
    };

    let mut resp = Json(json!({
        "ok": true,
        "sessionId": public_id,
        "deviceName": device_name
    }))
    .into_response();
    if let Ok(val) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(SET_COOKIE, val);
    }
    resp
}

async fn api_session(State(ctx): State<Arc<MobileHttpContext>>, headers: HeaderMap) -> Response {
    let Some(sid) = parse_cookie_value(&headers, SESSION_COOKIE_NAME) else {
        return Json(json!({ "authenticated": false })).into_response();
    };
    let now = now_ms();
    let mut guard = ctx.inner.lock().unwrap();
    if let Some(sess) = guard.sessions.get_mut(&sid) {
        sess.last_seen_at = now;
        let name = sess.device_name.clone();
        let pid = sess.public_id.clone();
        guard.last_activity_at = Some(now);
        Json(json!({
            "authenticated": true,
            "sessionId": pid,
            "deviceName": name
        }))
        .into_response()
    } else {
        Json(json!({ "authenticated": false })).into_response()
    }
}

async fn api_logout(State(ctx): State<Arc<MobileHttpContext>>, headers: HeaderMap) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Some(sid) = parse_cookie_value(&headers, SESSION_COOKIE_NAME) {
        let mut guard = ctx.inner.lock().unwrap();
        guard.sessions.remove(&sid);
    }
    ctx.emit_status();
    let mut resp = Json(json!({ "ok": true })).into_response();
    resp.headers_mut().insert(
        SET_COOKIE,
        HeaderValue::from_static("anchor_mobile_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"),
    );
    resp
}

// --- Bootstrap & SSE ---

async fn api_bootstrap(State(ctx): State<Arc<MobileHttpContext>>, headers: HeaderMap) -> Response {
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    let prefs = (ctx.ui_prefs)();

    let workspace = match load_workspace(&dir) {
        Ok(w) => w,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };
    let docs_tree: Vec<DocEntry> = list_docs_tree(&dir).unwrap_or_default();

    Json(json!({
        "prefs": prefs,
        "meta": workspace.meta,
        "tasks": workspace.tasks,
        "projects": workspace.projects,
        "notes": workspace.notes,
        "docsTree": docs_tree,
        "serverTime": now_ms(),
    }))
    .into_response()
}

async fn api_events(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, Response> {
    if let Err(code) = ctx.verify_session(&headers) {
        return Err(json_error(code, "会话未授权或已失效"));
    }
    let rx = ctx.sse_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(kind) => Some(Ok(Event::default().event("sync").data(kind))),
        Err(_) => None,
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("ping")))
}

// --- Atomic JSON Shard Helpers ---

fn read_shard_array(data_dir: &Path, filename: &str) -> Result<Vec<Value>, String> {
    let full = data_dir.join(filename);
    if !full.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&full)
        .map_err(|e| format!("读取 {filename} 失败: {e}"))?;
    let val: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("解析 {filename} 失败: {e}"))?;
    Ok(val.as_array().cloned().unwrap_or_default())
}

fn write_shard_array(
    data_dir: &Path,
    filename: &str,
    items: &[Value],
    tracker: &SelfWriteTracker,
) -> Result<(), String> {
    let pretty = serde_json::to_string_pretty(&Value::Array(items.to_vec()))
        .map_err(|e| format!("序列化 {filename} 失败: {e}"))?;
    let _ = ensure_daily_snapshot(data_dir);
    let full = data_dir.join(filename);
    tracker.record(&full);
    atomic_write_text(&full, &(pretty + "\n"))?;
    tracker.record(&full);
    Ok(())
}

fn valid_status(s: &str) -> Option<&'static str> {
    match s {
        "todo" => Some("todo"),
        "doing" => Some("doing"),
        "confirm" => Some("confirm"),
        "done" => Some("done"),
        _ => None,
    }
}

fn valid_prio(p: u64) -> u64 {
    p.clamp(1, 4)
}

fn normalize_tags(raw: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for tag in raw {
        let clean = tag.trim().trim_start_matches('#').trim().to_string();
        if !clean.is_empty() && !out.contains(&clean) {
            out.push(clean);
            if out.len() >= 6 {
                break;
            }
        }
    }
    out
}

fn clean_opt_str(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn derive_task_title_from_body(note: &str, attachments: &[Value]) -> String {
    for raw_line in note.lines() {
        let mut s = raw_line.trim();
        // Strip common Markdown prefixes for clean single-line summary
        s = s.trim_start_matches('#').trim();
        for prefix in ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "- ", "* ", "> "] {
            if let Some(rest) = s.strip_prefix(prefix) {
                s = rest.trim();
                break;
            }
        }
        let cleaned = s.replace("**", "").replace("__", "").replace('`', "");
        let collapsed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        if !collapsed.is_empty() {
            return collapsed.chars().take(140).collect();
        }
    }
    for att in attachments {
        if let Some(name) = att.get("name").and_then(|v| v.as_str()) {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.chars().take(140).collect();
            }
        }
    }
    String::new()
}

// --- Tasks CRUD ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskPayload {
    id: Option<String>,
    title: Option<String>,
    note: Option<String>,
    prio: Option<u64>,
    status: Option<String>,
    due: Option<String>,
    start_date: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    project_id: Option<String>,
    attachments: Option<Vec<Value>>,
}

async fn api_create_task(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<CreateTaskPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let attachments = req.attachments.unwrap_or_default();
    let raw_note = req.note.unwrap_or_default();
    let explicit_title = req.title.unwrap_or_default().trim().to_string();
    let title = if !explicit_title.is_empty() {
        explicit_title
    } else {
        derive_task_title_from_body(&raw_note, &attachments)
    };
    let final_note = if raw_note.trim().is_empty() {
        title.clone()
    } else {
        raw_note
    };
    if title.is_empty() && final_note.trim().is_empty() && attachments.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "待办内容不能为空");
    }

    let now = now_ms();
    let id = clean_opt_str(req.id).unwrap_or_else(|| format!("m-{}", generate_random_hex(8)));
    let status = req
        .status
        .as_deref()
        .and_then(valid_status)
        .unwrap_or("todo");
    let done = status == "done";
    let done_at = if done { Some(now) } else { None };
    let prio = valid_prio(req.prio.unwrap_or(2));
    let mut due = req.due.unwrap_or_default().trim().to_string();
    let mut start_date = req.start_date.unwrap_or_default().trim().to_string();
    if !start_date.is_empty() && !due.is_empty() && start_date > due {
        due = start_date.clone();
    } else if !start_date.is_empty() && due.is_empty() {
        due = start_date.clone();
        start_date.clear();
    }

    let mut obj = serde_json::Map::new();
    obj.insert("id".into(), json!(id));
    obj.insert("title".into(), json!(title));
    obj.insert("note".into(), json!(final_note));
    obj.insert("prio".into(), json!(prio));
    obj.insert("status".into(), json!(status));
    obj.insert("due".into(), json!(due));
    if !start_date.is_empty() {
        obj.insert("startDate".into(), json!(start_date));
    }
    if let Some(st) = clean_opt_str(req.start_time) {
        obj.insert("startTime".into(), json!(st));
    }
    if let Some(et) = clean_opt_str(req.end_time) {
        obj.insert("endTime".into(), json!(et));
    }
    obj.insert("done".into(), json!(done));
    obj.insert("doneAt".into(), json!(done_at));
    obj.insert(
        "projectId".into(),
        json!(req.project_id.unwrap_or_default().trim().to_string()),
    );
    obj.insert("rolls".into(), json!(0));
    obj.insert("carriedDate".into(), Value::Null);
    obj.insert("attachments".into(), json!(attachments));
    obj.insert("createdAt".into(), json!(now));
    obj.insert("updatedAt".into(), json!(now));
    let item = Value::Object(obj);

    let dir = (ctx.data_dir)();
    let write_res = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "tasks.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        items.insert(0, item.clone());
        write_shard_array(&dir, "tasks.json", &items, &ctx.tracker)
    };
    if let Err(e) = write_res {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
    }

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "tasks".to_string(),
        items: vec![item.clone()],
    });
    ctx.broadcast_sse("tasks");
    (StatusCode::CREATED, Json(item)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskPayload {
    title: Option<String>,
    note: Option<String>,
    prio: Option<u64>,
    status: Option<String>,
    done: Option<bool>,
    due: Option<String>,
    start_date: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    project_id: Option<String>,
    attachments: Option<Vec<Value>>,
}

async fn api_update_task(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<UpdateTaskPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let updated: Value = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "tasks.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = items
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "待办不存在");
        };
        let Some(map) = entry.as_object_mut() else {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, "待办数据结构异常");
        };

        let explicit_title = req.title.map(|t| t.trim().to_string());
        if let Some(attachments) = req.attachments {
            map.insert("attachments".into(), json!(attachments));
        }
        let note_updated = if let Some(note) = req.note {
            map.insert("note".into(), json!(note));
            true
        } else {
            false
        };

        let cur_note = map
            .get("note")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cur_atts = map
            .get("attachments")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if let Some(t) = explicit_title {
            if !t.is_empty() {
                map.insert("title".into(), json!(t));
            } else {
                let derived = derive_task_title_from_body(&cur_note, &cur_atts);
                if derived.is_empty() && cur_atts.is_empty() {
                    return json_error(StatusCode::BAD_REQUEST, "待办内容不能为空");
                }
                map.insert("title".into(), json!(derived));
            }
        } else if note_updated {
            let derived = derive_task_title_from_body(&cur_note, &cur_atts);
            if !derived.is_empty() {
                map.insert("title".into(), json!(derived));
            }
        }
        if let Some(prio) = req.prio {
            map.insert("prio".into(), json!(valid_prio(prio)));
        }
        if let Some(project_id) = req.project_id {
            map.insert("projectId".into(), json!(project_id.trim()));
        }
        if let Some(due) = req.due {
            map.insert("due".into(), json!(due.trim()));
        }
        if let Some(start_date) = req.start_date {
            let trimmed = start_date.trim().to_string();
            if trimmed.is_empty() {
                map.remove("startDate");
            } else {
                map.insert("startDate".into(), json!(trimmed));
            }
        }
        // Keep startDate <= due invariant
        let cur_start = map
            .get("startDate")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let cur_due = map
            .get("due")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !cur_start.is_empty() && !cur_due.is_empty() && cur_start > cur_due {
            map.insert("due".into(), json!(cur_start));
        } else if !cur_start.is_empty() && cur_due.is_empty() {
            map.insert("due".into(), json!(cur_start));
            map.remove("startDate");
        }

        if let Some(st) = req.start_time {
            let trimmed = st.trim().to_string();
            if trimmed.is_empty() {
                map.remove("startTime");
            } else {
                map.insert("startTime".into(), json!(trimmed));
            }
        }
        if let Some(et) = req.end_time {
            let trimmed = et.trim().to_string();
            if trimmed.is_empty() {
                map.remove("endTime");
            } else {
                map.insert("endTime".into(), json!(trimmed));
            }
        }

        // Maintain strict status <-> done synchronization
        let prev_done = map.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
        let prev_done_at = map.get("doneAt").and_then(|v| v.as_u64());
        let prev_status = map
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or(if prev_done { "done" } else { "todo" })
            .to_string();

        if let Some(raw_status) = req.status {
            if let Some(next_status) = valid_status(&raw_status) {
                map.insert("status".into(), json!(next_status));
                if next_status == "done" {
                    map.insert("done".into(), json!(true));
                    map.insert("doneAt".into(), json!(prev_done_at.unwrap_or(now)));
                } else {
                    map.insert("done".into(), json!(false));
                    map.insert("doneAt".into(), Value::Null);
                }
            }
        } else if let Some(next_done) = req.done {
            map.insert("done".into(), json!(next_done));
            if next_done {
                map.insert("status".into(), json!("done"));
                map.insert("doneAt".into(), json!(prev_done_at.unwrap_or(now)));
            } else {
                if prev_status == "done" {
                    map.insert("status".into(), json!("todo"));
                }
                map.insert("doneAt".into(), Value::Null);
            }
        }

        map.insert("updatedAt".into(), json!(now));
        let cloned = entry.clone();
        if let Err(e) = write_shard_array(&dir, "tasks.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        cloned
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "tasks".to_string(),
        items: vec![updated.clone()],
    });
    ctx.broadcast_sse("tasks");
    Json(updated).into_response()
}

async fn api_delete_task(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let deleted = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "tasks.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = items
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "待办不存在");
        };
        if let Some(map) = entry.as_object_mut() {
            map.insert("deletedAt".into(), json!(now));
            map.insert("updatedAt".into(), json!(now));
        }
        let cloned = entry.clone();
        if let Err(e) = write_shard_array(&dir, "tasks.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        cloned
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "tasks".to_string(),
        items: vec![deleted.clone()],
    });
    ctx.broadcast_sse("tasks");
    Json(deleted).into_response()
}

// --- Projects CRUD ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectPayload {
    id: Option<String>,
    name: String,
    color: Option<String>,
}

async fn api_create_project(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<CreateProjectPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "项目名称不能为空");
    }
    let color = req
        .color
        .as_deref()
        .filter(|c| ALLOWED_PROJECT_COLORS.contains(c))
        .unwrap_or("blue")
        .to_string();

    let now = now_ms();
    let id = clean_opt_str(req.id).unwrap_or_else(|| format!("p-{}", generate_random_hex(8)));
    let item = json!({
        "id": id,
        "name": name,
        "color": color,
        "createdAt": now,
        "updatedAt": now,
    });

    let dir = (ctx.data_dir)();
    {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "projects.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        items.push(item.clone());
        if let Err(e) = write_shard_array(&dir, "projects.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
    }

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "projects".to_string(),
        items: vec![item.clone()],
    });
    ctx.broadcast_sse("projects");
    (StatusCode::CREATED, Json(item)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProjectPayload {
    name: Option<String>,
    color: Option<String>,
}

async fn api_update_project(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<UpdateProjectPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let updated = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "projects.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = items
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "项目不存在");
        };
        if let Some(map) = entry.as_object_mut() {
            if let Some(name) = req.name {
                let trimmed = name.trim().to_string();
                if trimmed.is_empty() {
                    return json_error(StatusCode::BAD_REQUEST, "项目名称不能为空");
                }
                map.insert("name".into(), json!(trimmed));
            }
            if let Some(color) = req.color {
                if ALLOWED_PROJECT_COLORS.contains(&color.as_str()) {
                    map.insert("color".into(), json!(color));
                }
            }
            map.insert("updatedAt".into(), json!(now));
        }
        let cloned = entry.clone();
        if let Err(e) = write_shard_array(&dir, "projects.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        cloned
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "projects".to_string(),
        items: vec![updated.clone()],
    });
    ctx.broadcast_sse("projects");
    Json(updated).into_response()
}

async fn api_delete_project(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let (deleted_proj, affected_tasks) = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut projects = match read_shard_array(&dir, "projects.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = projects
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "项目不存在");
        };
        if let Some(map) = entry.as_object_mut() {
            map.insert("deletedAt".into(), json!(now));
            map.insert("updatedAt".into(), json!(now));
        }
        let deleted_proj = entry.clone();
        if let Err(e) = write_shard_array(&dir, "projects.json", &projects, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }

        // Clear projectId on all active tasks belonging to this project
        let mut tasks = match read_shard_array(&dir, "tasks.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let mut changed_tasks = Vec::new();
        for t in tasks.iter_mut() {
            let is_active = t.get("deletedAt").map(|v| v.is_null()).unwrap_or(true);
            let belongs = t.get("projectId").and_then(|v| v.as_str()) == Some(id.as_str());
            if is_active && belongs {
                if let Some(map) = t.as_object_mut() {
                    map.insert("projectId".into(), json!(""));
                    map.insert("updatedAt".into(), json!(now));
                    changed_tasks.push(t.clone());
                }
            }
        }
        if !changed_tasks.is_empty() {
            if let Err(e) = write_shard_array(&dir, "tasks.json", &tasks, &ctx.tracker) {
                return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
            }
        }
        (deleted_proj, changed_tasks)
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "projects".to_string(),
        items: vec![deleted_proj.clone()],
    });
    if !affected_tasks.is_empty() {
        (ctx.on_shard_update)(MobileShardUpdateEvent {
            shard: "tasks".to_string(),
            items: affected_tasks,
        });
        ctx.broadcast_sse("tasks");
    }
    ctx.broadcast_sse("projects");
    Json(deleted_proj).into_response()
}

// --- Notes CRUD ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotePayload {
    id: Option<String>,
    text: String,
    tags: Option<Vec<String>>,
    attachments: Option<Vec<Value>>,
}

async fn api_create_note(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<CreateNotePayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let atts = req.attachments.unwrap_or_default();
    if req.text.trim().is_empty() && atts.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "灵感内容不能为空");
    }

    let now = now_ms();
    let id = clean_opt_str(req.id).unwrap_or_else(|| format!("n-{}", generate_random_hex(8)));
    let tags = normalize_tags(req.tags.unwrap_or_default());
    let item = json!({
        "id": id,
        "text": req.text,
        "tags": tags,
        "attachments": atts,
        "createdAt": now,
        "updatedAt": now,
    });

    let dir = (ctx.data_dir)();
    {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "notes.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        items.insert(0, item.clone());
        if let Err(e) = write_shard_array(&dir, "notes.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
    }

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "notes".to_string(),
        items: vec![item.clone()],
    });
    ctx.broadcast_sse("notes");
    (StatusCode::CREATED, Json(item)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateNotePayload {
    text: Option<String>,
    tags: Option<Vec<String>>,
    attachments: Option<Vec<Value>>,
}

async fn api_update_note(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(req): Json<UpdateNotePayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let updated = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "notes.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = items
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "灵感不存在");
        };
        if let Some(map) = entry.as_object_mut() {
            if let Some(text) = req.text {
                map.insert("text".into(), json!(text));
            }
            if let Some(tags) = req.tags {
                map.insert("tags".into(), json!(normalize_tags(tags)));
            }
            if let Some(atts) = req.attachments {
                map.insert("attachments".into(), json!(atts));
            }
            map.insert("updatedAt".into(), json!(now));
        }
        let cloned = entry.clone();
        if let Err(e) = write_shard_array(&dir, "notes.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        cloned
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "notes".to_string(),
        items: vec![updated.clone()],
    });
    ctx.broadcast_sse("notes");
    Json(updated).into_response()
}

async fn api_delete_note(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let now = now_ms();
    let dir = (ctx.data_dir)();
    let deleted = {
        let _guard = ctx.shard_lock.lock().unwrap();
        let mut items = match read_shard_array(&dir, "notes.json") {
            Ok(v) => v,
            Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
        };
        let Some(entry) = items
            .iter_mut()
            .find(|v| v.get("id").and_then(|x| x.as_str()) == Some(id.as_str()))
        else {
            return json_error(StatusCode::NOT_FOUND, "灵感不存在");
        };
        if let Some(map) = entry.as_object_mut() {
            map.insert("deletedAt".into(), json!(now));
            map.insert("updatedAt".into(), json!(now));
        }
        let cloned = entry.clone();
        if let Err(e) = write_shard_array(&dir, "notes.json", &items, &ctx.tracker) {
            return json_error(StatusCode::INTERNAL_SERVER_ERROR, e);
        }
        cloned
    };

    (ctx.on_shard_update)(MobileShardUpdateEvent {
        shard: "notes".to_string(),
        items: vec![deleted.clone()],
    });
    ctx.broadcast_sse("notes");
    Json(deleted).into_response()
}

// --- Knowledge Base Docs ---

async fn api_docs_tree(State(ctx): State<Arc<MobileHttpContext>>, headers: HeaderMap) -> Response {
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    match list_docs_tree(&dir) {
        Ok(tree) => Json(tree).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn api_docs_search(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Query(query): Query<SearchQuery>,
) -> Response {
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let q = query.q.unwrap_or_default();
    let dir = (ctx.data_dir)();
    match search_docs(&dir, &q, 30) {
        Ok(hits) => Json(hits).into_response(),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    }
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

async fn api_docs_read(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    match read_doc_file(&dir, &query.path) {
        Ok(doc) => Json(doc).into_response(),
        Err(e) => {
            if e.contains("非法") || e.contains("相对路径") || e.contains(".md") {
                json_error(StatusCode::BAD_REQUEST, e)
            } else {
                json_error(StatusCode::NOT_FOUND, e)
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteDocPayload {
    rel_path: String,
    content: String,
    expected_updated_at: Option<u64>,
    #[serde(default)]
    force: bool,
}

async fn api_docs_write(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<WriteDocPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let dir = (ctx.data_dir)();
    let saved: DocFileContent = {
        let _guard = ctx.shard_lock.lock().unwrap();
        if !req.force {
            if let Some(expected) = req.expected_updated_at {
                if let Ok(disk_doc) = read_doc_file(&dir, &req.rel_path) {
                    if disk_doc.updated_at > expected {
                        return (
                            StatusCode::CONFLICT,
                            Json(json!({
                                "error": "conflict",
                                "message": "桌面端已修改此文档，请选择加载最新版本或强制覆盖",
                                "disk": disk_doc
                            })),
                        )
                            .into_response();
                    }
                }
            }
        }
        match write_doc_file(&dir, &req.rel_path, &req.content, &ctx.tracker) {
            Ok(doc) => doc,
            Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
        }
    };

    (ctx.on_docs_update)();
    ctx.broadcast_sse("docs");
    Json(saved).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFolderPayload {
    rel_path: String,
}

async fn api_docs_create_folder(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<CreateFolderPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    let res = {
        let _guard = ctx.shard_lock.lock().unwrap();
        create_doc_folder(&dir, &req.rel_path, &ctx.tracker)
    };
    match res {
        Ok(entry) => {
            (ctx.on_docs_update)();
            ctx.broadcast_sse("docs");
            (StatusCode::CREATED, Json(entry)).into_response()
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameDocPayload {
    old_rel_path: String,
    new_rel_path: String,
}

async fn api_docs_rename(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Json(req): Json<RenameDocPayload>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    let res = {
        let _guard = ctx.shard_lock.lock().unwrap();
        rename_doc_entry(&dir, &req.old_rel_path, &req.new_rel_path, &ctx.tracker)
    };
    match res {
        Ok(new_path) => {
            (ctx.on_docs_update)();
            ctx.broadcast_sse("docs");
            Json(json!({ "relPath": new_path })).into_response()
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

async fn api_docs_delete(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    Query(query): Query<PathQuery>,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    let res = {
        let _guard = ctx.shard_lock.lock().unwrap();
        delete_doc_entry(&dir, &query.path, &ctx.tracker)
    };
    match res {
        Ok(()) => {
            (ctx.on_docs_update)();
            ctx.broadcast_sse("docs");
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => json_error(StatusCode::BAD_REQUEST, e),
    }
}

// --- Attachments ---

async fn api_read_attachment(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    AxumPath(filename): AxumPath<String>,
) -> Response {
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }
    let dir = (ctx.data_dir)();
    let rel = format!("attachments/{filename}");
    let full = match resolve_attachment_path(&dir, &rel) {
        Ok(p) => p,
        Err(e) => return json_error(StatusCode::BAD_REQUEST, e),
    };
    if !full.is_file() {
        return json_error(StatusCode::NOT_FOUND, "附件不存在");
    }
    let bytes = match fs::read(&full) {
        Ok(b) => b,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("读取附件失败: {e}")),
    };
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mime = infer_mime_type(ext);

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, mime)
        .header(CACHE_CONTROL, "private, max-age=3600")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn api_upload_attachment(
    State(ctx): State<Arc<MobileHttpContext>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Response {
    if let Err(code) = MobileHttpContext::verify_csrf(&headers) {
        return json_error(code, "Missing client header");
    }
    if let Err(code) = ctx.verify_session(&headers) {
        return json_error(code, "会话未授权或已失效");
    }

    let mut file_name = String::new();
    let mut mime_type = String::new();
    let mut bytes: Vec<u8> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("file") {
            continue;
        }
        file_name = field.file_name().unwrap_or("photo.jpg").to_string();
        mime_type = field.content_type().unwrap_or("").to_string();
        match field.bytes().await {
            Ok(data) => {
                if data.len() > MAX_IMAGE_UPLOAD_BYTES {
                    return json_error(StatusCode::PAYLOAD_TOO_LARGE, "单张图片大小不能超过 15 MB");
                }
                bytes = data.to_vec();
            }
            Err(e) => {
                return json_error(StatusCode::BAD_REQUEST, format!("上传读取失败: {e}"));
            }
        }
        break;
    }

    if bytes.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "未收到有效的图片文件");
    }

    let ext = Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime_is_image = mime_type.to_lowercase().starts_with("image/");
    if !ALLOWED_IMAGE_EXTS.contains(&ext.as_str()) && !mime_is_image {
        return json_error(
            StatusCode::BAD_REQUEST,
            "移动端仅支持上传图片（PNG / JPG / WEBP / GIF / HEIC）",
        );
    }

    let final_name = if ALLOWED_IMAGE_EXTS.contains(&ext.as_str()) {
        file_name
    } else if mime_type.contains("png") {
        "photo.png".to_string()
    } else if mime_type.contains("webp") {
        "photo.webp".to_string()
    } else if mime_type.contains("gif") {
        "photo.gif".to_string()
    } else {
        "photo.jpg".to_string()
    };

    let dir = (ctx.data_dir)();
    let stored = match save_attachment_bytes(&dir, &final_name, &mime_type, &bytes) {
        Ok(meta) => meta,
        Err(e) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, e),
    };

    (
        StatusCode::CREATED,
        Json(json!({
            "id": stored.id,
            "kind": "image",
            "name": stored.name,
            "relPath": stored.rel_path,
            "mimeType": stored.mime_type,
            "size": stored.size,
            "createdAt": now_ms(),
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::Request;
    use tempfile::TempDir;
    use tower::ServiceExt;

    fn make_test_context(tmp: &TempDir) -> (Arc<MobileHttpContext>, String) {
        let dir = tmp.path().to_path_buf();
        let token = "test-one-time-pair-token-abcdef123456".to_string();
        let (sse_tx, _) = broadcast::channel::<String>(16);
        let ctx = Arc::new(MobileHttpContext {
            inner: Mutex::new(ServerInner {
                running: true,
                port: 21890,
                auto_stop_minutes: 120,
                last_activity_at: Some(now_ms()),
                pairing: Some(PairingTicket {
                    token: token.clone(),
                    expires_at: now_ms() + PAIR_TOKEN_TTL_MS,
                    consumed: false,
                }),
                sessions: HashMap::new(),
                tunnel: None,
                tunnel_status: TunnelStatus::default(),
                shutdown_tx: None,
            }),
            data_dir: Arc::new(move || dir.clone()),
            ui_prefs: Arc::new(|| MobileUiPrefs {
                lang: "zh".into(),
                accent: "blue".into(),
                theme: "system".into(),
            }),
            tracker: SelfWriteTracker::default(),
            shard_lock: Arc::new(Mutex::new(())),
            asset_loader: Arc::new(|key| {
                if key == "mobile.html" {
                    Some(StaticAsset {
                        bytes: b"<html>mobile</html>".to_vec(),
                        mime: "text/html; charset=utf-8".into(),
                    })
                } else {
                    None
                }
            }),
            on_shard_update: Arc::new(|_| {}),
            on_docs_update: Arc::new(|| {}),
            on_status_change: Arc::new(|_| {}),
            sse_tx,
        });
        (ctx, token)
    }

    async fn pair_and_get_cookie(router: &Router, token: &str) -> String {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header(USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .body(Body::from(json!({ "token": token }).to_string()))
            .unwrap();
        let resp = router.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let set_cookie = resp
            .headers()
            .get(SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        set_cookie.split(';').next().unwrap().to_string()
    }

    #[tokio::test]
    async fn pairing_is_one_time_and_protects_apis_and_csrf() {
        let tmp = TempDir::new().unwrap();
        let (ctx, token) = make_test_context(&tmp);
        let app = build_router(ctx);

        // Unauthenticated bootstrap fails
        let unauth = app
            .clone()
            .oneshot(Request::builder().uri("/api/bootstrap").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

        // First pair succeeds
        let cookie = pair_and_get_cookie(&app, &token).await;

        // Replaying the same one-time token fails
        let replay = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/auth/pair")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "token": token }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(replay.status(), StatusCode::UNAUTHORIZED);

        // Authenticated bootstrap succeeds
        let boot = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/bootstrap")
                    .header(COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(boot.status(), StatusCode::OK);

        // Mutating request without CSRF header fails with 403
        let no_csrf = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tasks")
                    .header(COOKIE, &cookie)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "title": "Blocked" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(no_csrf.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn tasks_projects_notes_crud_and_project_delete_clears_task_links() {
        let tmp = TempDir::new().unwrap();
        let (ctx, token) = make_test_context(&tmp);
        let app = build_router(ctx);
        let cookie = pair_and_get_cookie(&app, &token).await;

        // Create project
        let proj_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/projects")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "name": "Mobile", "color": "teal" }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(proj_resp.status(), StatusCode::CREATED);
        let proj: Value =
            serde_json::from_slice(&to_bytes(proj_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let proj_id = proj["id"].as_str().unwrap().to_string();

        // Create task linked to project
        let task_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tasks")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "title": "Ship v0.9.4",
                            "projectId": proj_id,
                            "prio": 1,
                            "due": "2026-11-30"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(task_resp.status(), StatusCode::CREATED);
        let task: Value =
            serde_json::from_slice(&to_bytes(task_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        let task_id = task["id"].as_str().unwrap().to_string();

        // Mark done -> status becomes "done" and doneAt is populated
        let patch_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/tasks/{task_id}"))
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "done": true }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(patch_resp.status(), StatusCode::OK);
        let patched: Value =
            serde_json::from_slice(&to_bytes(patch_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(patched["status"], "done");
        assert!(patched["doneAt"].is_u64());

        // Delete project -> task's projectId must be cleared
        let del_proj = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/projects/{proj_id}"))
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(del_proj.status(), StatusCode::OK);

        let tasks_on_disk = read_shard_array(tmp.path(), "tasks.json").unwrap();
        assert_eq!(tasks_on_disk[0]["projectId"], "");

        // Create note with normalized tags
        let note_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/notes")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "text": "灵感内容", "tags": ["#想法", "想法", "产品"] }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(note_resp.status(), StatusCode::CREATED);
        let note: Value =
            serde_json::from_slice(&to_bytes(note_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(note["tags"], json!(["想法", "产品"]));
    }

    #[tokio::test]
    async fn docs_optimistic_locking_returns_409_and_blocks_traversal() {
        let tmp = TempDir::new().unwrap();
        let (ctx, token) = make_test_context(&tmp);
        let app = build_router(ctx);
        let cookie = pair_and_get_cookie(&app, &token).await;

        // Create doc
        let w1 = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/docs/file")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({ "relPath": "notes/hello.md", "content": "# V1\n" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(w1.status(), StatusCode::OK);
        let doc1: Value =
            serde_json::from_slice(&to_bytes(w1.into_body(), usize::MAX).await.unwrap()).unwrap();
        let ts1 = doc1["updatedAt"].as_u64().unwrap();

        // Stale expectedUpdatedAt (older than disk) must trigger 409 Conflict
        let w_conflict = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/docs/file")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "relPath": "notes/hello.md",
                            "content": "# Stale\n",
                            "expectedUpdatedAt": ts1.saturating_sub(5000)
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(w_conflict.status(), StatusCode::CONFLICT);

        // Force write bypasses conflict
        let w_force = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/docs/file")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "relPath": "notes/hello.md",
                            "content": "# V2\n",
                            "expectedUpdatedAt": 1,
                            "force": true
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(w_force.status(), StatusCode::OK);

        // Traversal must be rejected
        let bad = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/docs/file?path=../tasks.json")
                    .header(COOKIE, &cookie)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn rescanning_from_same_phone_merges_existing_session() {
        let tmp = TempDir::new().unwrap();
        let (ctx, token1) = make_test_context(&tmp);
        let app = build_router(ctx.clone());

        // First scan from Android Chrome
        let req1 = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header("cf-connecting-ip", "183.251.29.184")
            .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14; K) Chrome/130.0.0.0 Mobile Safari/537.36")
            .body(Body::from(json!({ "token": token1, "deviceKey": "dev-abc" }).to_string()))
            .unwrap();
        assert_eq!(app.clone().oneshot(req1).await.unwrap().status(), StatusCode::OK);
        assert_eq!(ctx.status_snapshot().sessions.len(), 1);

        // Issue second pairing token and scan again from same phone's Chrome -> still 1 session
        let token2 = "second-pair-token-abcdef1234567890";
        {
            let mut g = ctx.inner.lock().unwrap();
            g.pairing = Some(PairingTicket {
                token: token2.to_string(),
                expires_at: now_ms() + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
        }
        let req2 = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header("cf-connecting-ip", "183.251.29.184")
            .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14; K) Chrome/130.0.0.0 Mobile Safari/537.36")
            .body(Body::from(json!({ "token": token2 }).to_string()))
            .unwrap();
        assert_eq!(app.clone().oneshot(req2).await.unwrap().status(), StatusCode::OK);
        assert_eq!(ctx.status_snapshot().sessions.len(), 1);

        // Issue third token and scan from WeChat on the same phone -> merges into 1 session
        let token3 = "third-pair-token-abcdef1234567890";
        {
            let mut g = ctx.inner.lock().unwrap();
            g.pairing = Some(PairingTicket {
                token: token3.to_string(),
                expires_at: now_ms() + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
        }
        let req3 = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header("cf-connecting-ip", "183.251.29.184")
            .header(USER_AGENT, "Mozilla/5.0 MicroMessenger/8.0.50")
            .body(Body::from(json!({ "token": token3 }).to_string()))
            .unwrap();
        assert_eq!(app.clone().oneshot(req3).await.unwrap().status(), StatusCode::OK);
        let st = ctx.status_snapshot();
        assert_eq!(st.sessions.len(), 1);
        assert_eq!(st.sessions[0].device_name, "Mobile · WeChat");

        // A genuinely different device (iPhone on same IP) stays separate -> 2 sessions
        let token4 = "fourth-pair-token-abcdef1234567890";
        {
            let mut g = ctx.inner.lock().unwrap();
            g.pairing = Some(PairingTicket {
                token: token4.to_string(),
                expires_at: now_ms() + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
        }
        let req4 = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header("cf-connecting-ip", "183.251.29.184")
            .header(USER_AGENT, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1")
            .body(Body::from(json!({ "token": token4 }).to_string()))
            .unwrap();
        assert_eq!(app.clone().oneshot(req4).await.unwrap().status(), StatusCode::OK);
        // Note: Mobile · WeChat had os_family="Mobile" (unknown OS), so let's verify iPhone + Android stay separate:
        let token5 = "fifth-pair-token-abcdef1234567890";
        {
            let mut g = ctx.inner.lock().unwrap();
            g.pairing = Some(PairingTicket {
                token: token5.to_string(),
                expires_at: now_ms() + PAIR_TOKEN_TTL_MS,
                consumed: false,
            });
        }
        let req5 = Request::builder()
            .method("POST")
            .uri("/api/auth/pair")
            .header(CONTENT_TYPE, "application/json")
            .header("cf-connecting-ip", "183.251.29.184")
            .header(USER_AGENT, "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0")
            .body(Body::from(json!({ "token": token5 }).to_string()))
            .unwrap();
        assert_eq!(app.clone().oneshot(req5).await.unwrap().status(), StatusCode::OK);
        assert_eq!(ctx.status_snapshot().sessions.len(), 2);
    }

    #[tokio::test]
    async fn titleless_task_creation_and_note_patch_auto_derive_title() {
        let tmp = TempDir::new().unwrap();
        let (ctx, token) = make_test_context(&tmp);
        let app = build_router(ctx);
        let cookie = pair_and_get_cookie(&app, &token).await;

        // 1. Create task with body only (no title field) -> title auto-derived from first line
        let resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tasks")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "note": "- [ ] **跟进发布**\n补充验收细节"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        let created: Value =
            serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
        assert_eq!(created["title"], "跟进发布");
        assert_eq!(created["note"], "- [ ] **跟进发布**\n补充验收细节");
        let task_id = created["id"].as_str().unwrap().to_string();

        // 2. Patch note only -> title automatically tracks new first line
        let patch_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/api/tasks/{task_id}"))
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "note": "## 新首行标题\n第二行补充"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(patch_resp.status(), StatusCode::OK);
        let patched: Value =
            serde_json::from_slice(&to_bytes(patch_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(patched["title"], "新首行标题");
        assert_eq!(patched["note"], "## 新首行标题\n第二行补充");

        // 3. Attachment-only task without text -> derives filename as title
        let att_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tasks")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "note": "",
                            "attachments": [{ "id": "a1", "kind": "file", "name": "方案.pdf", "relPath": "attachments/方案.pdf", "addedAt": 1 }]
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(att_resp.status(), StatusCode::CREATED);
        let att_task: Value =
            serde_json::from_slice(&to_bytes(att_resp.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(att_task["title"], "方案.pdf");

        // 4. Empty task without attachments -> 400 Bad Request
        let empty_resp = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tasks")
                    .header(COOKIE, &cookie)
                    .header(CSRF_HEADER_NAME, CSRF_HEADER_VALUE)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "note": "   " }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(empty_resp.status(), StatusCode::BAD_REQUEST);
    }
}
