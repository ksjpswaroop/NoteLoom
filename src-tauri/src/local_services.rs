//! Managed local sidecars (Wigolo and similar daemons).
//!
//! Flow for each registered service:
//! 1. Health-check the loopback URL / port
//! 2. If healthy → connect / reuse (do not spawn a duplicate)
//! 3. If not → install into app_data (when allowed) and start a secluded process
//! 4. Track ownership so Exit only kills processes NoteLoom started

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use url::Url;

const WIGOLO_SERVICE_ID: &str = "wigolo";
const WIGOLO_PACKAGE_SPEC: &str = "wigolo@0.2.1";
const WIGOLO_DEFAULT_HOST: &str = "127.0.0.1";
const WIGOLO_DEFAULT_PORT: u16 = 3333;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const START_WAIT_TIMEOUT: Duration = Duration::from_secs(90);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
const POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LocalServiceState {
    Stopped,
    Starting,
    Running,
    ConnectedExternal,
    Error,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceStatus {
    pub id: String,
    pub label: String,
    pub state: LocalServiceState,
    pub managed: bool,
    pub owned: bool,
    pub base_url: Option<String>,
    pub pid: Option<u32>,
    pub message: String,
    pub detail: Option<String>,
    pub data_dir: Option<String>,
    pub package_ready: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceEnsureOptions {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_token: Option<String>,
    /// When false, skip npm install (used by search hot-path).
    #[serde(default = "default_true")]
    pub install_if_needed: bool,
    #[serde(default = "default_true")]
    pub start_if_needed: bool,
}

fn default_true() -> bool {
    true
}

impl Default for LocalServiceEnsureOptions {
    fn default() -> Self {
        Self {
            base_url: None,
            api_token: None,
            install_if_needed: true,
            start_if_needed: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalServiceProgressEvent {
    pub service_id: String,
    pub stage: String,
    pub message: String,
}

struct OwnedProcess {
    pid: u32,
    child: Child,
}

struct ServiceRuntime {
    owned: Option<OwnedProcess>,
    last_error: Option<String>,
    starting: bool,
}

impl Default for ServiceRuntime {
    fn default() -> Self {
        Self {
            owned: None,
            last_error: None,
            starting: false,
        }
    }
}

#[derive(Default)]
pub struct LocalServiceManager {
    services: Mutex<HashMap<String, ServiceRuntime>>,
    ensure_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl LocalServiceManager {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Drop for LocalServiceManager {
    fn drop(&mut self) {
        stop_owned_services_sync(self);
    }
}

fn services_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(app_data.join("local-services"))
}

fn wigolo_install_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(services_root(app_handle)?.join("wigolo"))
}

fn wigolo_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(wigolo_install_dir(app_handle)?.join("data"))
}

fn npm_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(services_root(app_handle)?.join("npm-cache"))
}

fn normalize_base_url(value: Option<&str>) -> Result<(String, String, u16), String> {
    let raw = value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("http://127.0.0.1:3333");
    let parsed = Url::parse(raw).map_err(|e| format!("Invalid local service URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Local service URL must use http or https".to_string());
    }
    let host = parsed
        .host_str()
        .unwrap_or(WIGOLO_DEFAULT_HOST)
        .to_string();
    let port = parsed.port().unwrap_or(WIGOLO_DEFAULT_PORT);
    let base = format!("{}://{}:{}", parsed.scheme(), host, port);
    Ok((base, host, port))
}

fn find_command_path(command: &str) -> Option<PathBuf> {
    let mut search_dirs = Vec::new();
    if let Ok(path_var) = env::var("PATH") {
        let separator = if cfg!(target_os = "windows") { ';' } else { ':' };
        for dir in path_var.split(separator) {
            if !dir.is_empty() {
                search_dirs.push(PathBuf::from(dir));
            }
        }
    }

    // Common user installs that GUI apps often miss from PATH.
    if let Ok(home) = env::var("HOME") {
        search_dirs.extend([
            PathBuf::from(&home).join(".volta").join("bin"),
            PathBuf::from(&home).join(".nvm").join("current").join("bin"),
            PathBuf::from(&home).join(".fnm").join("current").join("bin"),
            PathBuf::from(&home).join(".local").join("share").join("fnm").join("current").join("bin"),
            PathBuf::from(&home).join(".asdf").join("shims"),
            PathBuf::from(&home).join(".bun").join("bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
    }

    let candidates: Vec<String> = if cfg!(target_os = "windows") {
        vec![
            command.to_string(),
            format!("{command}.cmd"),
            format!("{command}.exe"),
            format!("{command}.bat"),
        ]
    } else {
        vec![command.to_string()]
    };

    for dir in search_dirs {
        for candidate in &candidates {
            let path = dir.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn resolve_node() -> Result<PathBuf, String> {
    find_command_path("node").ok_or_else(|| {
        "Node.js was not found. Install Node.js 20+ (for example via https://nodejs.org or Volta), then restart NoteLoom.".to_string()
    })
}

fn resolve_npm() -> Result<PathBuf, String> {
    find_command_path("npm").ok_or_else(|| {
        "npm was not found alongside Node.js. Install a complete Node.js toolchain, then restart NoteLoom.".to_string()
    })
}

fn wigolo_entry_js(install_dir: &Path) -> PathBuf {
    install_dir.join("node_modules").join("wigolo").join("dist").join("index.js")
}

fn wigolo_package_ready(install_dir: &Path) -> bool {
    wigolo_entry_js(install_dir).is_file()
}

async fn ensure_dir(path: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
}

async fn probe_health(base_url: &str, api_token: Option<&str>) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(HEALTH_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut request = client
        .get(format!("{base_url}/health"))
        .header("Accept", "application/json");
    if let Some(token) = api_token.map(str::trim).filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Health check failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Health check HTTP {}", response.status()));
    }

    let body = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or(serde_json::Value::Null);
    if let Some(status) = body.get("status").and_then(|v| v.as_str()) {
        let normalized = status.trim().to_ascii_lowercase();
        if !normalized.is_empty()
            && normalized != "healthy"
            && normalized != "ok"
            && normalized != "degraded"
            && normalized != "up"
        {
            return Err(format!("Unexpected health status: {status}"));
        }
    }
    Ok(())
}

fn emit_progress(app_handle: &AppHandle, service_id: &str, stage: &str, message: &str) {
    let _ = app_handle.emit(
        "local-service-progress",
        LocalServiceProgressEvent {
            service_id: service_id.to_string(),
            stage: stage.to_string(),
            message: message.to_string(),
        },
    );
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    command.process_group(0);
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_pid(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-TERM", &format!("-{pid}")])
        .status();
    std::thread::sleep(Duration::from_millis(300));
    let _ = std::process::Command::new("kill")
        .args(["-KILL", &format!("-{pid}")])
        .status();
}

#[cfg(windows)]
fn terminate_pid(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_pid(_pid: u32) {}

async fn wait_until_healthy(
    base_url: &str,
    api_token: Option<&str>,
    timeout: Duration,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let mut last_error = "Service did not become healthy".to_string();
    while started.elapsed() < timeout {
        match probe_health(base_url, api_token).await {
            Ok(()) => return Ok(()),
            Err(error) => last_error = error,
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    Err(last_error)
}

async fn install_wigolo_package(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let install_dir = wigolo_install_dir(app_handle)?;
    let cache_dir = npm_cache_dir(app_handle)?;
    ensure_dir(&install_dir).await?;
    ensure_dir(&cache_dir).await?;

    if wigolo_package_ready(&install_dir) {
        return Ok(install_dir);
    }

    let npm = resolve_npm()?;
    emit_progress(
        app_handle,
        WIGOLO_SERVICE_ID,
        "installing",
        &format!("Installing {WIGOLO_PACKAGE_SPEC} into NoteLoom app data…"),
    );

    let mut command = Command::new(&npm);
    command
        .args([
            "install",
            WIGOLO_PACKAGE_SPEC,
            "--no-fund",
            "--no-audit",
            "--prefix",
        ])
        .arg(&install_dir)
        .current_dir(&install_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("NPM_CONFIG_CACHE", &cache_dir)
        .env("npm_config_cache", &cache_dir)
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false");
    configure_process_group(&mut command);

    let output = tokio::time::timeout(INSTALL_TIMEOUT, command.output())
        .await
        .map_err(|_| "Timed out while installing wigolo".to_string())?
        .map_err(|e| format!("Failed to run npm install: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = [stderr, stdout]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!(
            "Failed to install {WIGOLO_PACKAGE_SPEC}. {}",
            if detail.is_empty() {
                "npm exited with an error.".to_string()
            } else {
                detail.chars().take(800).collect::<String>()
            }
        ));
    }

    if !wigolo_package_ready(&install_dir) {
        return Err(format!(
            "Installed {WIGOLO_PACKAGE_SPEC} but could not find dist/index.js under {}",
            install_dir.display()
        ));
    }

    Ok(install_dir)
}

async fn spawn_wigolo(
    app_handle: &AppHandle,
    host: &str,
    port: u16,
    base_url: &str,
) -> Result<OwnedProcess, String> {
    let install_dir = wigolo_install_dir(app_handle)?;
    let data_dir = wigolo_data_dir(app_handle)?;
    ensure_dir(&data_dir).await?;

    if !wigolo_package_ready(&install_dir) {
        return Err("Wigolo package is not installed in NoteLoom app data yet.".to_string());
    }

    let node = resolve_node()?;
    let entry = wigolo_entry_js(&install_dir);

    emit_progress(
        app_handle,
        WIGOLO_SERVICE_ID,
        "starting",
        &format!("Starting wigolo on {base_url}…"),
    );

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .args(["serve", "--host", host, "--port", &port.to_string()])
        .current_dir(&install_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(false)
        .env("WIGOLO_DATA_DIR", &data_dir)
        .env("WIGOLO_DAEMON_HOST", host)
        .env("WIGOLO_DAEMON_PORT", port.to_string())
        .env("PATH", env::var("PATH").unwrap_or_default());
    configure_process_group(&mut command);

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start wigolo: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to determine wigolo process ID".to_string())?;

    Ok(OwnedProcess { pid, child })
}

async fn reclaim_exited_child(runtime: &mut ServiceRuntime) {
    if let Some(owned) = runtime.owned.as_mut() {
        match owned.child.try_wait() {
            Ok(Some(_)) => {
                runtime.owned = None;
            }
            Ok(None) => {}
            Err(_) => {
                runtime.owned = None;
            }
        }
    }
}

fn status_for_wigolo(
    state: LocalServiceState,
    owned: bool,
    base_url: &str,
    pid: Option<u32>,
    message: impl Into<String>,
    detail: Option<String>,
    data_dir: Option<String>,
    package_ready: bool,
) -> LocalServiceStatus {
    LocalServiceStatus {
        id: WIGOLO_SERVICE_ID.to_string(),
        label: "Wigolo".to_string(),
        state,
        managed: true,
        owned,
        base_url: Some(base_url.to_string()),
        pid,
        message: message.into(),
        detail,
        data_dir,
        package_ready,
    }
}

async fn status_wigolo(
    app_handle: &AppHandle,
    manager: &LocalServiceManager,
    options: &LocalServiceEnsureOptions,
) -> LocalServiceStatus {
    let (base_url, _host, _port) = match normalize_base_url(options.base_url.as_deref()) {
        Ok(value) => value,
        Err(error) => {
            return status_for_wigolo(
                LocalServiceState::Error,
                false,
                "http://127.0.0.1:3333",
                None,
                error,
                None,
                wigolo_data_dir(app_handle).ok().map(|p| p.display().to_string()),
                false,
            );
        }
    };

    let install_dir = wigolo_install_dir(app_handle).ok();
    let package_ready = install_dir
        .as_ref()
        .map(|dir| wigolo_package_ready(dir))
        .unwrap_or(false);
    let data_dir = wigolo_data_dir(app_handle)
        .ok()
        .map(|p| p.display().to_string());

    let mut services = manager.services.lock().await;
    let runtime = services
        .entry(WIGOLO_SERVICE_ID.to_string())
        .or_default();
    reclaim_exited_child(runtime).await;

    if runtime.starting {
        return status_for_wigolo(
            LocalServiceState::Starting,
            runtime.owned.is_some(),
            &base_url,
            runtime.owned.as_ref().map(|o| o.pid),
            "Starting wigolo…",
            runtime.last_error.clone(),
            data_dir,
            package_ready,
        );
    }

    let owned_pid = runtime.owned.as_ref().map(|o| o.pid);
    let owned = owned_pid.is_some();
    drop(services);

    match probe_health(&base_url, options.api_token.as_deref()).await {
        Ok(()) if owned => status_for_wigolo(
            LocalServiceState::Running,
            true,
            &base_url,
            owned_pid,
            "Running (managed by NoteLoom)",
            None,
            data_dir,
            package_ready,
        ),
        Ok(()) => status_for_wigolo(
            LocalServiceState::ConnectedExternal,
            false,
            &base_url,
            None,
            "Connected to an already-running daemon",
            None,
            data_dir,
            package_ready,
        ),
        Err(error) => {
            let mut services = manager.services.lock().await;
            let runtime = services
                .entry(WIGOLO_SERVICE_ID.to_string())
                .or_default();
            if let Some(message) = runtime.last_error.clone() {
                status_for_wigolo(
                    LocalServiceState::Error,
                    runtime.owned.is_some(),
                    &base_url,
                    runtime.owned.as_ref().map(|o| o.pid),
                    message,
                    Some(error),
                    data_dir,
                    package_ready,
                )
            } else if package_ready {
                status_for_wigolo(
                    LocalServiceState::Stopped,
                    false,
                    &base_url,
                    None,
                    "Stopped — NoteLoom can start wigolo on demand",
                    Some(error),
                    data_dir,
                    package_ready,
                )
            } else {
                status_for_wigolo(
                    LocalServiceState::Stopped,
                    false,
                    &base_url,
                    None,
                    "Not running — NoteLoom can install and start wigolo",
                    Some(error),
                    data_dir,
                    package_ready,
                )
            }
        }
    }
}

async fn ensure_lock_for(
    manager: &LocalServiceManager,
    service_id: &str,
) -> Arc<Mutex<()>> {
    let mut locks = manager.ensure_locks.lock().await;
    locks
        .entry(service_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

async fn ensure_wigolo(
    app_handle: &AppHandle,
    manager: &LocalServiceManager,
    options: LocalServiceEnsureOptions,
) -> Result<LocalServiceStatus, String> {
    let lock = ensure_lock_for(manager, WIGOLO_SERVICE_ID).await;
    let _guard = lock.lock().await;

    let (base_url, host, port) = normalize_base_url(options.base_url.as_deref())?;
    let api_token = options.api_token.clone();

    emit_progress(
        app_handle,
        WIGOLO_SERVICE_ID,
        "checking",
        "Checking for a running wigolo daemon…",
    );

    // Fast path: already healthy.
    if probe_health(&base_url, api_token.as_deref()).await.is_ok() {
        let mut services = manager.services.lock().await;
        let runtime = services
            .entry(WIGOLO_SERVICE_ID.to_string())
            .or_default();
        reclaim_exited_child(runtime).await;
        runtime.last_error = None;
        let owned = runtime.owned.is_some();
        let pid = runtime.owned.as_ref().map(|o| o.pid);
        drop(services);

        let package_ready = wigolo_install_dir(app_handle)
            .map(|dir| wigolo_package_ready(&dir))
            .unwrap_or(false);
        return Ok(status_for_wigolo(
            if owned {
                LocalServiceState::Running
            } else {
                LocalServiceState::ConnectedExternal
            },
            owned,
            &base_url,
            pid,
            if owned {
                "Running (managed by NoteLoom)"
            } else {
                "Connected to an already-running daemon"
            },
            None,
            wigolo_data_dir(app_handle).ok().map(|p| p.display().to_string()),
            package_ready,
        ));
    }

    if !options.start_if_needed {
        return Ok(status_wigolo(app_handle, manager, &options).await);
    }

    {
        let mut services = manager.services.lock().await;
        let runtime = services
            .entry(WIGOLO_SERVICE_ID.to_string())
            .or_default();
        reclaim_exited_child(runtime).await;
        runtime.starting = true;
        runtime.last_error = None;
    }

    let result = async {
        if options.install_if_needed {
            install_wigolo_package(app_handle).await?;
        } else {
            let install_dir = wigolo_install_dir(app_handle)?;
            if !wigolo_package_ready(&install_dir) {
                return Err(
                    "Wigolo is not installed yet. Open Settings → Web Search and start the managed service once."
                        .to_string(),
                );
            }
            // Node is still required to launch the cached package.
            let _ = resolve_node()?;
        }

        // Another client may have filled the port while we installed.
        if probe_health(&base_url, api_token.as_deref()).await.is_ok() {
            return Ok(());
        }

        let owned = spawn_wigolo(app_handle, &host, port, &base_url).await?;
        {
            let mut services = manager.services.lock().await;
            let runtime = services
                .entry(WIGOLO_SERVICE_ID.to_string())
                .or_default();
            // Replace any stale owned handle.
            if let Some(previous) = runtime.owned.take() {
                terminate_pid(previous.pid);
            }
            runtime.owned = Some(owned);
        }

        if let Err(error) =
            wait_until_healthy(&base_url, api_token.as_deref(), START_WAIT_TIMEOUT).await
        {
            // Roll back a failed start so we don't leave a half-dead child.
            let mut services = manager.services.lock().await;
            if let Some(runtime) = services.get_mut(WIGOLO_SERVICE_ID) {
                if let Some(owned) = runtime.owned.take() {
                    terminate_pid(owned.pid);
                }
            }
            return Err(format!(
                "Wigolo started but never became healthy: {error}"
            ));
        }
        Ok(())
    }
    .await;

    {
        let mut services = manager.services.lock().await;
        let runtime = services
            .entry(WIGOLO_SERVICE_ID.to_string())
            .or_default();
        runtime.starting = false;
        match &result {
            Ok(()) => {
                runtime.last_error = None;
                emit_progress(app_handle, WIGOLO_SERVICE_ID, "ready", "Wigolo is ready");
            }
            Err(error) => {
                runtime.last_error = Some(error.clone());
                emit_progress(app_handle, WIGOLO_SERVICE_ID, "error", error);
            }
        }
    }

    result?;
    Ok(status_wigolo(app_handle, manager, &options).await)
}

async fn stop_wigolo(
    app_handle: &AppHandle,
    manager: &LocalServiceManager,
    options: &LocalServiceEnsureOptions,
) -> Result<LocalServiceStatus, String> {
    let lock = ensure_lock_for(manager, WIGOLO_SERVICE_ID).await;
    let _guard = lock.lock().await;

    let mut services = manager.services.lock().await;
    let runtime = services
        .entry(WIGOLO_SERVICE_ID.to_string())
        .or_default();
    reclaim_exited_child(runtime).await;

    if let Some(owned) = runtime.owned.take() {
        terminate_pid(owned.pid);
        runtime.last_error = None;
        drop(services);
        // Brief wait so the port frees before status probe.
        tokio::time::sleep(Duration::from_millis(400)).await;
        return Ok(status_wigolo(app_handle, manager, options).await);
    }

    drop(services);
    let status = status_wigolo(app_handle, manager, options).await;
    if status.state == LocalServiceState::ConnectedExternal {
        return Err(
            "Wigolo is running outside NoteLoom. Stop that process yourself if you want to shut it down."
                .to_string(),
        );
    }
    Ok(status)
}

/// Kill only processes NoteLoom spawned. Safe to call from Exit.
pub fn stop_owned_services_sync(manager: &LocalServiceManager) {
    if let Ok(mut services) = manager.services.try_lock() {
        for runtime in services.values_mut() {
            if let Some(owned) = runtime.owned.take() {
                terminate_pid(owned.pid);
            }
            runtime.starting = false;
        }
    }
}

fn unknown_service(service_id: &str) -> LocalServiceStatus {
    LocalServiceStatus {
        id: service_id.to_string(),
        label: service_id.to_string(),
        state: LocalServiceState::Unavailable,
        managed: false,
        owned: false,
        base_url: None,
        pid: None,
        message: format!("Unknown local service: {service_id}"),
        detail: Some(
            "Managed daemon: wigolo. Parakeet STT and Midscene use the same local-services TypeScript facade with their own ensure APIs."
                .to_string(),
        ),
        data_dir: None,
        package_ready: false,
    }
}

#[tauri::command]
pub async fn local_service_list() -> Result<Vec<&'static str>, String> {
    Ok(vec![WIGOLO_SERVICE_ID])
}

#[tauri::command]
pub async fn local_service_status(
    app_handle: AppHandle,
    manager: State<'_, LocalServiceManager>,
    service_id: String,
    options: Option<LocalServiceEnsureOptions>,
) -> Result<LocalServiceStatus, String> {
    let options = options.unwrap_or_default();
    match service_id.as_str() {
        WIGOLO_SERVICE_ID => Ok(status_wigolo(&app_handle, &manager, &options).await),
        _ => Ok(unknown_service(&service_id)),
    }
}

#[tauri::command]
pub async fn local_service_ensure(
    app_handle: AppHandle,
    manager: State<'_, LocalServiceManager>,
    service_id: String,
    options: Option<LocalServiceEnsureOptions>,
) -> Result<LocalServiceStatus, String> {
    let options = options.unwrap_or_default();
    match service_id.as_str() {
        WIGOLO_SERVICE_ID => ensure_wigolo(&app_handle, &manager, options).await,
        _ => Err(format!(
            "Unknown local service '{service_id}'. Managed daemons: wigolo."
        )),
    }
}

#[tauri::command]
pub async fn local_service_stop(
    app_handle: AppHandle,
    manager: State<'_, LocalServiceManager>,
    service_id: String,
    options: Option<LocalServiceEnsureOptions>,
) -> Result<LocalServiceStatus, String> {
    let options = options.unwrap_or_default();
    match service_id.as_str() {
        WIGOLO_SERVICE_ID => stop_wigolo(&app_handle, &manager, &options).await,
        _ => Err(format!(
            "Unknown local service '{service_id}'. Managed daemons: wigolo."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_default_url() {
        let (base, host, port) = normalize_base_url(None).unwrap();
        assert_eq!(base, "http://127.0.0.1:3333");
        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, 3333);
    }

    #[test]
    fn normalizes_custom_url() {
        let (base, host, port) = normalize_base_url(Some("http://127.0.0.1:4444/")).unwrap();
        assert_eq!(base, "http://127.0.0.1:4444");
        assert_eq!(host, "127.0.0.1");
        assert_eq!(port, 4444);
    }
}
