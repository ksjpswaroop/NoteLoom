//! Midscene computer-use runtime (optional Automations).
//!
//! Installs `@midscene/computer` under app_data/local-services/midscene and
//! runs a Node runner from bundled resources. Never bundled into the Next/WebView
//! webpack graph — native input binaries stay in the Node sidecar.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

const RUNTIME_DIR_NAME: &str = "midscene";
const PACKAGE_SPEC: &str = "@midscene/computer@1.10.8";
const INSTALL_TIMEOUT_SECS: u64 = 600;
const DEFAULT_RUN_TIMEOUT_SECS: u64 = 300;
const MAX_RUN_TIMEOUT_SECS: u64 = 900;
const STATUS_TIMEOUT_SECS: u64 = 60;

#[derive(Default)]
pub struct MidsceneProcessManager {
    processes: Mutex<HashMap<String, RunningProcess>>,
}

#[derive(Clone)]
struct RunningProcess {
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneModelEnv {
    pub api_key: String,
    pub model_name: String,
    pub base_url: String,
    pub family: String,
    #[serde(default)]
    pub reasoning_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneStatus {
    pub supported_platform: bool,
    pub platform: String,
    pub node_available: bool,
    pub node_path: Option<String>,
    pub npm_available: bool,
    pub package_ready: bool,
    pub runtime_dir: String,
    pub accessibility_ok: bool,
    pub screen_recording_ok: bool,
    pub model_configured: bool,
    pub busy: bool,
    pub state: String,
    pub message: String,
    pub detail: Option<String>,
    pub displays: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneEnsureResult {
    pub success: bool,
    pub status: MidsceneStatus,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneRunRequest {
    pub command: String,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub steps: Option<Value>,
    #[serde(default)]
    pub output_dir: Option<String>,
    #[serde(default)]
    pub note_file_name: Option<String>,
    #[serde(default)]
    pub display_id: Option<String>,
    #[serde(default)]
    pub ai_action_context: Option<String>,
    #[serde(default)]
    pub stop_on_failure: Option<bool>,
    #[serde(default)]
    pub continue_on_error: Option<bool>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    pub model: MidsceneModelEnv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneRunResult {
    pub ok: bool,
    pub execution_id: String,
    pub command: String,
    pub data: Value,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidsceneProgressEvent {
    pub stage: String,
    pub message: String,
    pub execution_id: Option<String>,
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, execution_id: Option<&str>) {
    let _ = app.emit(
        "midscene-progress",
        MidsceneProgressEvent {
            stage: stage.to_string(),
            message: message.to_string(),
            execution_id: execution_id.map(|s| s.to_string()),
        },
    );
}

fn services_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(app_data.join("local-services"))
}

fn runtime_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(services_root(app_handle)?.join(RUNTIME_DIR_NAME))
}

fn npm_cache_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    Ok(services_root(app_handle)?.join("npm-cache"))
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

    if let Ok(home) = env::var("HOME") {
        search_dirs.extend([
            PathBuf::from(&home).join(".volta").join("bin"),
            PathBuf::from(&home).join(".nvm").join("current").join("bin"),
            PathBuf::from(&home).join(".fnm").join("current").join("bin"),
            PathBuf::from(&home)
                .join(".local")
                .join("share")
                .join("fnm")
                .join("current")
                .join("bin"),
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
        "Node.js was not found. Install Node.js 20+ (https://nodejs.org or Volta), then restart NoteLoom."
            .to_string()
    })
}

fn resolve_npm() -> Result<PathBuf, String> {
    find_command_path("npm").ok_or_else(|| {
        "npm was not found alongside Node.js. Install a complete Node.js toolchain, then restart NoteLoom."
            .to_string()
    })
}

fn package_ready(runtime: &Path) -> bool {
    runtime
        .join("node_modules")
        .join("@midscene")
        .join("computer")
        .join("package.json")
        .is_file()
}

fn resolve_runner_script(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("midscene").join("runner.mjs"));
        candidates.push(
            resource_dir
                .join("resources")
                .join("midscene")
                .join("runner.mjs"),
        );
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(
        manifest_dir
            .join("resources")
            .join("midscene")
            .join("runner.mjs"),
    );

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Midscene runner.mjs was not found in app resources.".into())
}

fn is_supported_desktop() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows", target_os = "linux"))
}

fn model_configured(model: &MidsceneModelEnv) -> bool {
    !model.api_key.trim().is_empty()
        && !model.model_name.trim().is_empty()
        && !model.base_url.trim().is_empty()
        && !model.family.trim().is_empty()
}

async fn ensure_dir(path: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(path)
        .await
        .map_err(|e| format!("Failed to create directory {}: {e}", path.display()))
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

async fn install_package(app_handle: &AppHandle) -> Result<(String, String), String> {
    let runtime = runtime_root(app_handle)?;
    let cache = npm_cache_dir(app_handle)?;
    ensure_dir(&runtime).await?;
    ensure_dir(&cache).await?;

    if package_ready(&runtime) {
        return Ok((String::new(), String::new()));
    }

    let npm = resolve_npm()?;
    emit_progress(
        app_handle,
        "installing",
        &format!("Installing {PACKAGE_SPEC} into NoteLoom app data…"),
        None,
    );

    let mut command = Command::new(&npm);
    command
        .args([
            "install",
            PACKAGE_SPEC,
            "--no-fund",
            "--no-audit",
            "--prefix",
        ])
        .arg(&runtime)
        .current_dir(&runtime)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("NPM_CONFIG_CACHE", &cache)
        .env("npm_config_cache", &cache)
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false");
    configure_process_group(&mut command);

    let output = tokio::time::timeout(Duration::from_secs(INSTALL_TIMEOUT_SECS), command.output())
        .await
        .map_err(|_| "Timed out while installing Midscene".to_string())?
        .map_err(|e| format!("Failed to run npm install: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = [stderr.trim(), stdout.trim()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!(
            "Failed to install {PACKAGE_SPEC}. {}",
            if detail.is_empty() {
                "npm exited with an error.".to_string()
            } else {
                detail.chars().take(1200).collect::<String>()
            }
        ));
    }

    if !package_ready(&runtime) {
        return Err(format!(
            "Installed {PACKAGE_SPEC} but package.json was not found under {}",
            runtime.display()
        ));
    }

    Ok((stdout, stderr))
}

fn apply_model_env(command: &mut Command, model: &MidsceneModelEnv) {
    command
        .env("MIDSCENE_MODEL_API_KEY", model.api_key.trim())
        .env("MIDSCENE_MODEL_NAME", model.model_name.trim())
        .env("MIDSCENE_MODEL_BASE_URL", model.base_url.trim())
        .env("MIDSCENE_MODEL_FAMILY", model.family.trim());
    if let Some(enabled) = model.reasoning_enabled {
        command.env(
            "MIDSCENE_MODEL_REASONING_ENABLED",
            if enabled { "true" } else { "false" },
        );
    }
}

async fn run_runner_json(
    app_handle: &AppHandle,
    manager: &MidsceneProcessManager,
    request_body: &Value,
    model: &MidsceneModelEnv,
    timeout_secs: u64,
    execution_id: &str,
) -> Result<(Value, String, String, bool, bool), String> {
    let runtime = runtime_root(app_handle)?;
    if !package_ready(&runtime) {
        return Err(
            "Midscene runtime is not installed. Open Settings → Automations and click Install Runtime."
                .into(),
        );
    }
    let node = resolve_node()?;
    let runner = resolve_runner_script(app_handle)?;

    let mut command = Command::new(&node);
    command
        .arg(&runner)
        .arg("--stdin")
        .current_dir(&runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("MIDSCENE_MODULE_ROOT", &runtime)
        .env("PATH", env::var("PATH").unwrap_or_default());
    apply_model_env(&mut command, model);
    configure_process_group(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start Midscene runner: {e}"))?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to determine Midscene process ID".to_string())?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut processes = manager.processes.lock().await;
        processes.insert(
            execution_id.to_string(),
            RunningProcess {
                pid,
                cancelled: cancelled.clone(),
            },
        );
    }

    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::to_vec(request_body)
            .map_err(|e| format!("Failed to serialize Midscene request: {e}"))?;
        stdin
            .write_all(&payload)
            .await
            .map_err(|e| format!("Failed to write Midscene request: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("Failed to close Midscene stdin: {e}"))?;
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(stdout) = stdout {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => buf.push_str(&line),
                    Err(_) => break,
                }
            }
        }
        buf
    });

    let app_for_stderr = app_handle.clone();
    let execution_for_stderr = execution_id.to_string();
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(stderr) = stderr {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        buf.push_str(&line);
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            emit_progress(
                                &app_for_stderr,
                                "running",
                                trimmed,
                                Some(&execution_for_stderr),
                            );
                        }
                    }
                    Err(_) => break,
                }
            }
        }
        buf
    });

    let wait = tokio::time::timeout(Duration::from_secs(timeout_secs), child.wait()).await;
    let timed_out = wait.is_err();
    if timed_out {
        terminate_pid(pid);
    }
    let status = match wait {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            manager.processes.lock().await.remove(execution_id);
            return Err(format!("Midscene runner failed: {e}"));
        }
        Err(_) => {
            manager.processes.lock().await.remove(execution_id);
            let stdout = stdout_task.await.unwrap_or_default();
            let stderr = stderr_task.await.unwrap_or_default();
            return Ok((
                serde_json::json!({
                    "ok": false,
                    "error": format!("Midscene command timed out after {timeout_secs}s"),
                }),
                stdout,
                stderr,
                true,
                cancelled.load(Ordering::SeqCst),
            ));
        }
    };

    let was_cancelled = cancelled.load(Ordering::SeqCst);
    manager.processes.lock().await.remove(execution_id);

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();

    let last_line = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    let parsed: Value = if last_line.is_empty() {
        serde_json::json!({
            "ok": status.success(),
            "error": if status.success() {
                "Empty Midscene runner response"
            } else {
                "Midscene runner failed without JSON output"
            },
            "stderr": stderr.chars().take(800).collect::<String>(),
        })
    } else {
        serde_json::from_str(last_line).unwrap_or_else(|error| {
            serde_json::json!({
                "ok": false,
                "error": format!("Failed to parse Midscene JSON: {error}"),
                "raw": last_line.chars().take(800).collect::<String>(),
            })
        })
    };

    Ok((parsed, stdout, stderr, false, was_cancelled))
}

async fn probe_status_via_runner(
    app_handle: &AppHandle,
    manager: &MidsceneProcessManager,
    model: &MidsceneModelEnv,
) -> Option<Value> {
    if !package_ready(&runtime_root(app_handle).ok()?) {
        return None;
    }
    let execution_id = Uuid::new_v4().to_string();
    let body = serde_json::json!({ "command": "status" });
    match run_runner_json(
        app_handle,
        manager,
        &body,
        model,
        STATUS_TIMEOUT_SECS,
        &execution_id,
    )
    .await
    {
        Ok((value, _, _, _, _)) if value.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
            Some(value)
        }
        _ => None,
    }
}

fn build_status(
    app_handle: &AppHandle,
    package_is_ready: bool,
    node_path: Option<PathBuf>,
    npm_available: bool,
    busy: bool,
    runner_status: Option<&Value>,
    model: Option<&MidsceneModelEnv>,
    detail: Option<String>,
) -> MidsceneStatus {
    let runtime = runtime_root(app_handle)
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let supported = is_supported_desktop();

    let accessibility_ok = runner_status
        .and_then(|v| v.pointer("/accessibility/hasPermission"))
        .and_then(|v| v.as_bool())
        .unwrap_or(cfg!(not(target_os = "macos")));
    let screen_recording_ok = runner_status
        .and_then(|v| v.pointer("/screenRecording/hasPermission"))
        .and_then(|v| v.as_bool())
        .unwrap_or(cfg!(not(target_os = "macos")));
    let model_ok = model.map(model_configured).unwrap_or(
        runner_status
            .and_then(|v| v.get("modelConfigured"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    );
    let displays = runner_status
        .and_then(|v| v.get("displays"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let (state, message) = if !supported {
        (
            "unavailable".to_string(),
            "Midscene computer use is only available on macOS, Windows, and Linux desktop builds."
                .to_string(),
        )
    } else if busy {
        (
            "running".to_string(),
            "A Midscene automation is currently running.".to_string(),
        )
    } else if node_path.is_none() {
        (
            "error".to_string(),
            "Node.js is required. Install Node.js 20+, then restart NoteLoom.".to_string(),
        )
    } else if !package_is_ready {
        (
            "stopped".to_string(),
            "Midscene runtime is not installed yet. Click Install Runtime.".to_string(),
        )
    } else if cfg!(target_os = "macos") && !accessibility_ok {
        (
            "needs_accessibility".to_string(),
            "macOS Accessibility permission is required for mouse and keyboard control.".to_string(),
        )
    } else if cfg!(target_os = "macos") && !screen_recording_ok {
        (
            "needs_screen_recording".to_string(),
            "macOS Screen Recording permission is required to capture screenshots for the model."
                .to_string(),
        )
    } else if !model_ok {
        (
            "ready".to_string(),
            "Runtime is installed. Configure a vision-capable Midscene model before running automations."
                .to_string(),
        )
    } else {
        (
            "ready".to_string(),
            "Midscene is ready for optional computer use, testing, and documentation."
                .to_string(),
        )
    };

    MidsceneStatus {
        supported_platform: supported,
        platform,
        node_available: node_path.is_some(),
        node_path: node_path.map(|p| p.display().to_string()),
        npm_available,
        package_ready: package_is_ready,
        runtime_dir: runtime,
        accessibility_ok,
        screen_recording_ok,
        model_configured: model_ok,
        busy,
        state,
        message,
        detail,
        displays,
    }
}

#[tauri::command]
pub async fn inspect_midscene(
    app_handle: AppHandle,
    manager: State<'_, MidsceneProcessManager>,
    model: Option<MidsceneModelEnv>,
) -> Result<MidsceneStatus, String> {
    let runtime = runtime_root(&app_handle)?;
    let package_is_ready = package_ready(&runtime);
    let node_path = resolve_node().ok();
    let npm_available = resolve_npm().is_ok();
    let busy = !manager.processes.lock().await.is_empty();

    let model_env = model.unwrap_or(MidsceneModelEnv {
        api_key: String::new(),
        model_name: String::new(),
        base_url: String::new(),
        family: String::new(),
        reasoning_enabled: None,
    });

    let runner_status = if package_is_ready && node_path.is_some() {
        probe_status_via_runner(&app_handle, manager.inner(), &model_env).await
    } else {
        None
    };

    Ok(build_status(
        &app_handle,
        package_is_ready,
        node_path,
        npm_available,
        busy,
        runner_status.as_ref(),
        Some(&model_env),
        None,
    ))
}

#[tauri::command]
pub async fn ensure_midscene(
    app_handle: AppHandle,
    manager: State<'_, MidsceneProcessManager>,
    model: Option<MidsceneModelEnv>,
) -> Result<MidsceneEnsureResult, String> {
    if !is_supported_desktop() {
        let status = inspect_midscene(app_handle, manager, model).await?;
        let stderr = status.message.clone();
        return Ok(MidsceneEnsureResult {
            success: false,
            status,
            stdout: String::new(),
            stderr,
        });
    }

    emit_progress(&app_handle, "preparing", "Preparing Midscene runtime…", None);
    let _ = resolve_node()?;
    let _ = resolve_npm()?;

    let (stdout, stderr) = match install_package(&app_handle).await {
        Ok(pair) => pair,
        Err(error) => {
            emit_progress(&app_handle, "failed", &error, None);
            let status = inspect_midscene(app_handle, manager, model).await?;
            return Ok(MidsceneEnsureResult {
                success: false,
                status,
                stdout: String::new(),
                stderr: error,
            });
        }
    };

    emit_progress(&app_handle, "verifying", "Verifying Midscene runtime…", None);
    let status = inspect_midscene(app_handle.clone(), manager, model).await?;
    let success = status.package_ready && status.node_available;
    emit_progress(
        &app_handle,
        if success { "completed" } else { "failed" },
        &status.message,
        None,
    );

    Ok(MidsceneEnsureResult {
        success,
        status,
        stdout,
        stderr,
    })
}

#[tauri::command]
pub async fn run_midscene(
    app_handle: AppHandle,
    manager: State<'_, MidsceneProcessManager>,
    request: MidsceneRunRequest,
) -> Result<MidsceneRunResult, String> {
    if !is_supported_desktop() {
        return Err(
            "Midscene computer use is only available in the NoteLoom desktop app.".into(),
        );
    }
    if !model_configured(&request.model)
        && matches!(
            request.command.as_str(),
            "act" | "query" | "assert" | "test" | "document"
        )
    {
        return Err(
            "Configure MIDSCENE model settings (API key, model name, base URL, family) before running automations."
                .into(),
        );
    }

    let execution_id = Uuid::new_v4().to_string();
    let timeout_secs = request
        .timeout_secs
        .unwrap_or(DEFAULT_RUN_TIMEOUT_SECS)
        .clamp(30, MAX_RUN_TIMEOUT_SECS);

    let mut body = serde_json::Map::new();
    body.insert("command".into(), Value::String(request.command.clone()));
    if let Some(prompt) = request.prompt {
        body.insert("prompt".into(), Value::String(prompt));
    }
    if let Some(message) = request.message {
        body.insert("message".into(), Value::String(message));
    }
    if let Some(title) = request.title {
        body.insert("title".into(), Value::String(title));
    }
    if let Some(steps) = request.steps {
        body.insert("steps".into(), steps);
    }
    if let Some(output_dir) = request.output_dir {
        body.insert("outputDir".into(), Value::String(output_dir));
    }
    if let Some(note_file_name) = request.note_file_name {
        body.insert("noteFileName".into(), Value::String(note_file_name));
    }
    if let Some(display_id) = request.display_id {
        body.insert("displayId".into(), Value::String(display_id));
    }
    if let Some(ai_action_context) = request.ai_action_context {
        body.insert("aiActionContext".into(), Value::String(ai_action_context));
    }
    if let Some(stop_on_failure) = request.stop_on_failure {
        body.insert("stopOnFailure".into(), Value::Bool(stop_on_failure));
    }
    if let Some(continue_on_error) = request.continue_on_error {
        body.insert("continueOnError".into(), Value::Bool(continue_on_error));
    }

    emit_progress(
        &app_handle,
        "running",
        &format!("Running Midscene {}…", request.command),
        Some(&execution_id),
    );

    let (data, stdout, stderr, timed_out, cancelled) = run_runner_json(
        &app_handle,
        manager.inner(),
        &Value::Object(body),
        &request.model,
        timeout_secs,
        &execution_id,
    )
    .await?;

    let ok = data.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(MidsceneRunResult {
        ok,
        execution_id,
        command: request.command,
        data,
        stdout,
        stderr,
        timed_out,
        cancelled,
    })
}

#[tauri::command]
pub async fn cancel_midscene(
    manager: State<'_, MidsceneProcessManager>,
    execution_id: String,
) -> Result<bool, String> {
    let mut processes = manager.processes.lock().await;
    if let Some(process) = processes.remove(&execution_id) {
        process.cancelled.store(true, Ordering::SeqCst);
        terminate_pid(process.pid);
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub async fn prompt_midscene_permissions() -> Result<Value, String> {
    // Permission prompts only work when the Node Midscene package is loaded.
    // Frontend should call run_midscene({ command: "status" }) after ensure.
    // This command opens macOS System Settings deep links as a convenience.
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .status();
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .status();
        Ok(serde_json::json!({
            "ok": true,
            "message": "Opened macOS Privacy settings for Accessibility and Screen Recording."
        }))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(serde_json::json!({
            "ok": true,
            "message": "No extra OS permission prompts are required on this platform."
        }))
    }
}
