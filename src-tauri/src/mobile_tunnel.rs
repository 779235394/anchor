use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    /// `"idle"` | `"starting"` | `"connected"` | `"error"`
    pub state: String,
    pub public_url: Option<String>,
    pub error: Option<String>,
    pub binary_path: Option<String>,
}

impl Default for TunnelStatus {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            public_url: None,
            error: None,
            binary_path: None,
        }
    }
}

/// Extracts `https://<subdomain>.trycloudflare.com` from a cloudflared log line.
pub fn extract_trycloudflare_url(line: &str) -> Option<String> {
    let marker = "https://";
    let mut search_from = 0usize;
    while let Some(rel_idx) = line[search_from..].find(marker) {
        let start = search_from + rel_idx;
        let rest = &line[start..];
        let end = rest
            .find(|c: char| {
                c.is_whitespace() || matches!(c, '|' | '"' | '\'' | ')' | ']' | '>' | ',' | ';')
            })
            .unwrap_or(rest.len());
        let candidate = rest[..end].trim_end_matches('/');
        if let Some(host) = candidate.strip_prefix("https://") {
            if host.ends_with(".trycloudflare.com")
                && host.len() > ".trycloudflare.com".len()
                && host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            {
                return Some(candidate.to_string());
            }
        }
        search_from = start + marker.len();
    }
    None
}

/// Returns true when `cloudflared` logs that at least one HA edge connection is registered.
pub fn is_tunnel_registered_line(line: &str) -> bool {
    line.contains("Registered tunnel connection")
}

/// Checks whether a `https://<host>` URL's hostname resolves via DNS.
fn is_tunnel_host_resolvable(url: &str) -> bool {
    let Some(host) = url.strip_prefix("https://") else {
        return false;
    };
    let host = host.split('/').next().unwrap_or("").trim();
    if host.is_empty() {
        return false;
    }
    (host, 443)
        .to_socket_addrs()
        .map(|mut addrs| addrs.next().is_some())
        .unwrap_or(false)
}

#[derive(Default)]
struct ReadinessState {
    pending_url: Option<String>,
    url_seen_at: Option<Instant>,
    edge_registered: bool,
    published: bool,
}

fn current_sidecar_filename() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "cloudflared-aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "cloudflared-x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "cloudflared-x86_64-pc-windows-msvc.exe"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "x86_64")
    )))]
    {
        "cloudflared"
    }
}

fn bundled_exe_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "cloudflared.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "cloudflared"
    }
}

fn is_usable_file(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
}

fn find_in_path(bin_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(bin_name);
        if is_usable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Resolves the embedded `cloudflared` sidecar binary:
/// 1. Adjacent to the current Anchor executable (production Tauri `externalBin` bundle)
/// 2. Development binaries directory (`src-tauri/binaries/cloudflared-<triple>`)
/// 3. Fallback to system `PATH`
pub fn resolve_cloudflared_binary() -> Result<PathBuf, String> {
    let exe_name = bundled_exe_name();
    let triple_name = current_sidecar_filename();

    if let Ok(cur_exe) = std::env::current_exe() {
        if let Some(exe_dir) = cur_exe.parent() {
            let direct = exe_dir.join(exe_name);
            if is_usable_file(&direct) {
                return Ok(direct);
            }
            let triple_adjacent = exe_dir.join(triple_name);
            if is_usable_file(&triple_adjacent) {
                return Ok(triple_adjacent);
            }
            for ancestor in exe_dir.ancestors().take(4) {
                let dev_bin = ancestor.join("binaries").join(triple_name);
                if is_usable_file(&dev_bin) {
                    return Ok(dev_bin);
                }
            }
        }
    }

    let manifest_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(triple_name);
    if is_usable_file(&manifest_bin) {
        return Ok(manifest_bin);
    }

    if let Some(from_path) = find_in_path(exe_name) {
        return Ok(from_path);
    }

    Err("未找到内嵌的安全通道组件（cloudflared），请重新安装 Anchor。".to_string())
}

pub struct TunnelHandle {
    child: Arc<Mutex<Option<Child>>>,
    stop_flag: Arc<AtomicBool>,
    status: Arc<Mutex<TunnelStatus>>,
}

impl TunnelHandle {
    pub fn spawn(
        local_port: u16,
        on_change: Arc<dyn Fn(TunnelStatus) + Send + Sync>,
    ) -> Result<Self, String> {
        let bin_path = resolve_cloudflared_binary()?;
        let bin_str = bin_path.to_string_lossy().to_string();

        let mut cmd = Command::new(&bin_path);
        cmd.args([
            "tunnel",
            "--no-autoupdate",
            "--protocol",
            "http2",
            "--url",
            &format!("http://127.0.0.1:{local_port}"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut spawned = cmd
            .spawn()
            .map_err(|e| format!("启动安全通道进程失败（{bin_str}）: {e}"))?;

        let stderr = spawned.stderr.take();
        let stdout = spawned.stdout.take();

        let initial_status = TunnelStatus {
            state: "starting".to_string(),
            public_url: None,
            error: None,
            binary_path: Some(bin_str),
        };

        let child = Arc::new(Mutex::new(Some(spawned)));
        let stop_flag = Arc::new(AtomicBool::new(false));
        let status = Arc::new(Mutex::new(initial_status.clone()));
        on_change(initial_status);

        let last_err_line = Arc::new(Mutex::new(String::new()));
        let readiness = Arc::new(Mutex::new(ReadinessState::default()));

        if let Some(out) = stdout {
            let stop_c = stop_flag.clone();
            let ready_c = readiness.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().map_while(Result::ok) {
                    if stop_c.load(Ordering::SeqCst) {
                        break;
                    }
                    let maybe_url = extract_trycloudflare_url(&line);
                    let registered = is_tunnel_registered_line(&line);
                    if maybe_url.is_some() || registered {
                        let mut r = ready_c.lock().unwrap();
                        if let Some(url) = maybe_url {
                            if r.pending_url.is_none() {
                                r.pending_url = Some(url);
                                r.url_seen_at = Some(Instant::now());
                            }
                        }
                        if registered {
                            r.edge_registered = true;
                        }
                    }
                }
            });
        }

        if let Some(err_stream) = stderr {
            let stop_c = stop_flag.clone();
            let last_err_c = last_err_line.clone();
            let ready_c = readiness.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err_stream);
                for line in reader.lines().map_while(Result::ok) {
                    if stop_c.load(Ordering::SeqCst) {
                        break;
                    }
                    let trimmed = line.trim();
                    if trimmed.contains("ERR") || trimmed.contains("failed") || trimmed.contains("error") {
                        if let Ok(mut guard) = last_err_c.lock() {
                            *guard = trimmed.chars().take(180).collect();
                        }
                    }
                    let maybe_url = extract_trycloudflare_url(&line);
                    let registered = is_tunnel_registered_line(&line);
                    if maybe_url.is_some() || registered {
                        let mut r = ready_c.lock().unwrap();
                        if let Some(url) = maybe_url {
                            if r.pending_url.is_none() {
                                r.pending_url = Some(url);
                                r.url_seen_at = Some(Instant::now());
                            }
                        }
                        if registered {
                            r.edge_registered = true;
                        }
                    }
                }
            });
        }

        {
            let child_c = child.clone();
            let status_c = status.clone();
            let stop_c = stop_flag.clone();
            let cb_c = on_change.clone();
            let last_err_c = last_err_line.clone();
            let ready_c = readiness.clone();
            thread::spawn(move || {
                let started = Instant::now();
                let timeout = Duration::from_secs(35);
                // Minimum DNS propagation settling window after cloudflared prints the new
                // random *.trycloudflare.com URL so phones don't cache NXDOMAIN on immediate scan.
                let min_dns_settle = Duration::from_millis(4500);
                let max_dns_wait = Duration::from_secs(12);
                let mut warned_timeout = false;

                loop {
                    thread::sleep(Duration::from_millis(350));
                    if stop_c.load(Ordering::SeqCst) {
                        break;
                    }

                    // Publish `connected` ONLY after both:
                    // 1. `cloudflared` printed the quick tunnel URL AND registered >= 1 edge connection
                    // 2. DNS settling window has elapsed and the hostname resolves (or fallback ceiling reached)
                    let ready_candidate: Option<(String, bool)> = {
                        let r = ready_c.lock().unwrap();
                        if !r.published {
                            if let (Some(ref url), Some(seen_at)) = (&r.pending_url, r.url_seen_at) {
                                let elapsed = seen_at.elapsed();
                                if r.edge_registered && elapsed >= min_dns_settle {
                                    Some((url.clone(), elapsed >= max_dns_wait))
                                } else if !r.edge_registered && elapsed >= Duration::from_secs(15) {
                                    // Fallback if future cloudflared changes its log wording
                                    Some((url.clone(), true))
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    };

                    if let Some((url, force_publish)) = ready_candidate {
                        if force_publish || is_tunnel_host_resolvable(&url) {
                            let next = {
                                let mut r = ready_c.lock().unwrap();
                                r.published = true;
                                let mut st = status_c.lock().unwrap();
                                if st.public_url.as_deref() != Some(url.as_str()) {
                                    st.state = "connected".to_string();
                                    st.public_url = Some(url);
                                    st.error = None;
                                    Some(st.clone())
                                } else {
                                    None
                                }
                            };
                            if let Some(s) = next {
                                cb_c(s);
                            }
                        }
                    }

                    let exited = {
                        let mut guard = child_c.lock().unwrap();
                        if let Some(proc) = guard.as_mut() {
                            match proc.try_wait() {
                                Ok(Some(code)) => {
                                    *guard = None;
                                    Some(code.to_string())
                                }
                                Ok(None) => None,
                                Err(_) => None,
                            }
                        } else {
                            break;
                        }
                    };

                    if let Some(code) = exited {
                        if !stop_c.load(Ordering::SeqCst) {
                            let clue = last_err_c
                                .lock()
                                .map(|s| s.clone())
                                .unwrap_or_default();
                            let msg = if clue.is_empty() {
                                format!("访问通道进程意外退出（{code}），请点击重试。")
                            } else {
                                format!("访问通道连接失败：{clue}")
                            };
                            let next = {
                                let mut st = status_c.lock().unwrap();
                                st.state = "error".to_string();
                                st.public_url = None;
                                st.error = Some(msg);
                                st.clone()
                            };
                            cb_c(next);
                        }
                        break;
                    }

                    if !warned_timeout && started.elapsed() >= timeout {
                        let maybe_err = {
                            let mut st = status_c.lock().unwrap();
                            if st.state == "starting" && st.public_url.is_none() {
                                st.state = "error".to_string();
                                st.error = Some(
                                    "访问通道建立超时（35 秒未就绪），请检查网络连接后重试。"
                                        .to_string(),
                                );
                                Some(st.clone())
                            } else {
                                None
                            }
                        };
                        if let Some(s) = maybe_err {
                            warned_timeout = true;
                            cb_c(s);
                        }
                    }
                }
            });
        }

        Ok(Self {
            child,
            stop_flag,
            status,
        })
    }

    pub fn current_status(&self) -> TunnelStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut proc) = guard.take() {
                let _ = proc.kill();
                let _ = proc.wait();
            }
        }
        if let Ok(mut st) = self.status.lock() {
            st.state = "idle".to_string();
            st.public_url = None;
            st.error = None;
        }
    }
}

impl Drop for TunnelHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_trycloudflare_url_from_banner_lines() {
        let line1 = "2026-11-26T00:10:00Z INF |  https://silver-maple-anchor-99.trycloudflare.com  |";
        assert_eq!(
            extract_trycloudflare_url(line1).as_deref(),
            Some("https://silver-maple-anchor-99.trycloudflare.com")
        );

        let line2 = "Your quick Tunnel has been created! Visit it at: https://my-test.trycloudflare.com/";
        assert_eq!(
            extract_trycloudflare_url(line2).as_deref(),
            Some("https://my-test.trycloudflare.com")
        );

        assert_eq!(extract_trycloudflare_url("https://example.com/foo"), None);
        assert_eq!(extract_trycloudflare_url("https://.trycloudflare.com"), None);
    }

    #[test]
    fn detects_tunnel_edge_registration_log_line() {
        assert!(is_tunnel_registered_line(
            "2026-11-26T00:10:02Z INF Registered tunnel connection connIndex=0 event=0 ip=198.41.192.7 location=kix03 protocol=http2"
        ));
        assert!(!is_tunnel_registered_line(
            "2026-11-26T00:10:00Z INF |  https://silver-maple-anchor-99.trycloudflare.com  |"
        ));
    }
}
