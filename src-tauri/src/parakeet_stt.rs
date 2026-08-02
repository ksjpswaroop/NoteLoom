//! Local NVIDIA Parakeet ASR via a managed Python + parakeet-mlx runtime (macOS Apple Silicon).

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, Manager};
use tokio::process::Command;

const DEFAULT_MODEL: &str = "mlx-community/parakeet-tdt-0.6b-v2";
const RUNTIME_DIR_NAME: &str = "parakeet-stt";
const INSTALL_TIMEOUT_SECS: u64 = 600;
const TRANSCRIBE_TIMEOUT_SECS: u64 = 600;
const STATUS_TIMEOUT_SECS: u64 = 60;

const ALLOWED_MODELS: &[&str] = &[
    "mlx-community/parakeet-tdt-0.6b-v2",
    "mlx-community/parakeet-tdt-0.6b-v3",
    "mlx-community/parakeet-ctc-0.6b",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetModelInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub languages: String,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetStatus {
    pub supported_platform: bool,
    pub platform: String,
    pub python_available: bool,
    pub python_version: Option<String>,
    pub python_path: Option<String>,
    pub runtime_ready: bool,
    pub model: String,
    pub model_cached: bool,
    pub cache_dir: String,
    pub ffmpeg_available: bool,
    pub message: String,
    pub models: Vec<ParakeetModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetEnsureResult {
    pub success: bool,
    pub status: ParakeetStatus,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetTranscribeRequest {
    pub audio_bytes: Vec<u8>,
    pub file_name: String,
    pub model: Option<String>,
    pub language: Option<String>,
    pub local_attention: Option<bool>,
    pub chunk_duration: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetTranscribeResult {
    pub text: String,
    pub model: String,
    pub language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetProgressEvent {
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarStatusPayload {
    ok: bool,
    #[serde(default)]
    mlx_available: bool,
    #[serde(default)]
    parakeet_available: bool,
    #[serde(default)]
    model_cached: bool,
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    python_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarTranscribePayload {
    ok: bool,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

fn catalog_models() -> Vec<ParakeetModelInfo> {
    vec![
        ParakeetModelInfo {
            id: "mlx-community/parakeet-tdt-0.6b-v2".into(),
            label: "Parakeet TDT 0.6B v2 (English)".into(),
            description: "Best default for English voice notes on Apple Silicon.".into(),
            languages: "English".into(),
            default: true,
        },
        ParakeetModelInfo {
            id: "mlx-community/parakeet-tdt-0.6b-v3".into(),
            label: "Parakeet TDT 0.6B v3 (Multilingual)".into(),
            description: "English plus many European languages. Larger download.".into(),
            languages: "English + European".into(),
            default: false,
        },
        ParakeetModelInfo {
            id: "mlx-community/parakeet-ctc-0.6b".into(),
            label: "Parakeet CTC 0.6B (English)".into(),
            description: "CTC variant. Often faster; English-focused.".into(),
            languages: "English".into(),
            default: false,
        },
    ]
}

fn normalize_model(model: Option<&str>) -> Result<String, String> {
    let value = model.unwrap_or(DEFAULT_MODEL).trim();
    if value.is_empty() {
        return Ok(DEFAULT_MODEL.to_string());
    }
    if ALLOWED_MODELS.contains(&value) {
        return Ok(value.to_string());
    }
    Err(format!(
        "Unsupported Parakeet model: {value}. Choose one of: {}",
        ALLOWED_MODELS.join(", ")
    ))
}

fn is_apple_silicon_macos() -> bool {
    cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")
}

fn current_platform_tag() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn runtime_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    Ok(app_data.join(RUNTIME_DIR_NAME))
}

fn cache_dir(runtime: &Path) -> PathBuf {
    runtime.join("hf-cache")
}

fn venv_python(runtime: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        runtime.join("python-env").join("Scripts").join("python.exe")
    }
    #[cfg(not(windows))]
    {
        runtime.join("python-env").join("bin").join("python3")
    }
}

fn resolve_sidecar_script(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("parakeet-stt").join("transcribe.py"));
        candidates.push(
            resource_dir
                .join("resources")
                .join("parakeet-stt")
                .join("transcribe.py"),
        );
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(
        manifest_dir
            .join("resources")
            .join("parakeet-stt")
            .join("transcribe.py"),
    );

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("Parakeet sidecar script was not found in app resources.".into())
}

fn resolve_requirements(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let script = resolve_sidecar_script(app_handle)?;
    let requirements = script
        .parent()
        .ok_or("Invalid sidecar path")?
        .join("requirements.txt");
    if requirements.is_file() {
        Ok(requirements)
    } else {
        Err("Parakeet requirements.txt was not found.".into())
    }
}

async fn python_version(candidate: &Path) -> Option<String> {
    let output = Command::new(candidate)
        .args([
            "-I",
            "-c",
            "import sys; print('.'.join(map(str, sys.version_info[:3])))",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

fn parse_python_version(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

fn python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for name in [
        "python3.12",
        "python3.13",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        candidates.push(PathBuf::from(name));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for root in [
            home.join(".local/share/uv/python"),
            home.join(".pyenv/versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(root) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    for name in ["python3.12", "python3.13", "python3.11", "python3.10", "python3"]
                    {
                        let candidate = bin.join(name);
                        if candidate.is_file() {
                            candidates.push(candidate);
                        }
                    }
                }
            }
        }
    }
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        for name in ["python3.12", "python3.13", "python3.11", "python3.10", "python3"] {
            let candidate = Path::new(prefix).join(name);
            if candidate.is_file() {
                candidates.push(candidate);
            }
        }
    }
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.clone()))
        .collect()
}

async fn resolve_base_python() -> Result<(PathBuf, String), String> {
    let mut available = Vec::new();
    for candidate in python_candidates() {
        if let Some(version) = python_version(&candidate).await {
            if let Some((major, minor)) = parse_python_version(&version) {
                // mlx / parakeet-mlx are happiest on 3.10–3.13
                if major == 3 && (10..=13).contains(&minor) {
                    available.push(((major, minor), candidate, version));
                }
            }
        }
    }
    // Prefer 3.12, then newest.
    available.sort_by(|left, right| {
        let left_score = if left.0 == (3, 12) { 100 } else { left.0 .1 };
        let right_score = if right.0 == (3, 12) { 100 } else { right.0 .1 };
        right_score.cmp(&left_score)
    });
    available
        .into_iter()
        .next()
        .map(|(_, path, version)| (path, version))
        .ok_or_else(|| {
            "Python 3.10–3.13 is required for local Parakeet. Install Python from python.org or Homebrew, then try again.".into()
        })
}

async fn command_on_path(name: &str) -> bool {
    Command::new(name)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
        || Command::new(name)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false)
}

async fn ensure_venv(runtime: &Path) -> Result<(PathBuf, String), String> {
    let managed = venv_python(runtime);
    if managed.is_file() {
        if let Some(version) = python_version(&managed).await {
            return Ok((managed, version));
        }
    }

    let (base, _) = resolve_base_python().await?;
    let env_dir = runtime.join("python-env");
    tokio::fs::create_dir_all(runtime)
        .await
        .map_err(|e| format!("Failed to create Parakeet runtime directory: {e}"))?;
    if env_dir.exists() {
        tokio::fs::remove_dir_all(&env_dir)
            .await
            .map_err(|e| format!("Failed to reset Parakeet Python environment: {e}"))?;
    }

    let output = tokio::time::timeout(
        Duration::from_secs(120),
        Command::new(&base)
            .args(["-I", "-m", "venv"])
            .arg(&env_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Timed out while creating the Parakeet Python environment".to_string())?
    .map_err(|e| format!("Failed to create the Parakeet Python environment: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to create the Parakeet Python environment: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let version = python_version(&managed)
        .await
        .ok_or_else(|| "Managed Parakeet Python environment is not usable".to_string())?;
    Ok((managed, version))
}

async fn install_dependencies(
    python: &Path,
    requirements: &Path,
) -> Result<(String, String), String> {
    let output = tokio::time::timeout(
        Duration::from_secs(INSTALL_TIMEOUT_SECS),
        Command::new(python)
            .args([
                "-I",
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--no-input",
                "--disable-pip-version-check",
                "-r",
            ])
            .arg(requirements)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONNOUSERSITE", "1")
            .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| {
        "Parakeet dependency installation timed out. Check your network and try again.".to_string()
    })?
    .map_err(|e| format!("Failed to install Parakeet dependencies: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!(
            "Parakeet dependency installation failed: {stderr}"
        ));
    }
    Ok((stdout, stderr))
}

async fn run_sidecar_json(
    python: &Path,
    script: &Path,
    args: &[&str],
    timeout_secs: u64,
    cache: &Path,
) -> Result<(serde_json::Value, String, String), String> {
    let output = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        Command::new(python)
            .arg("-I")
            .arg(script)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("HF_HOME", cache)
            .env("HUGGINGFACE_HUB_CACHE", cache.join("hub"))
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Parakeet sidecar timed out".to_string())?
    .map_err(|e| format!("Failed to run Parakeet sidecar: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim().starts_with('{'))
        .unwrap_or("")
        .trim();
    if line.is_empty() {
        return Err(format!(
            "Parakeet sidecar returned no JSON. stderr: {stderr}"
        ));
    }
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| format!("Failed to parse Parakeet sidecar output: {e}. raw={line}"))?;
    Ok((value, stdout, stderr))
}

async fn build_status(app_handle: &AppHandle, model: &str) -> Result<ParakeetStatus, String> {
    let supported = is_apple_silicon_macos();
    let runtime = runtime_root(app_handle)?;
    let cache = cache_dir(&runtime);
    let models = catalog_models();
    let ffmpeg_available = command_on_path("ffmpeg").await;

    if !supported {
        return Ok(ParakeetStatus {
            supported_platform: false,
            platform: current_platform_tag(),
            python_available: false,
            python_version: None,
            python_path: None,
            runtime_ready: false,
            model: model.to_string(),
            model_cached: false,
            cache_dir: cache.to_string_lossy().to_string(),
            ffmpeg_available,
            message: "Local Parakeet (MLX) requires macOS on Apple Silicon (arm64).".into(),
            models,
        });
    }

    let managed = venv_python(&runtime);
    let (python_path, python_version, python_available) = if managed.is_file() {
        match python_version(&managed).await {
            Some(version) => (Some(managed.to_string_lossy().to_string()), Some(version), true),
            None => (None, None, false),
        }
    } else {
        match resolve_base_python().await {
            Ok((path, version)) => (Some(path.to_string_lossy().to_string()), Some(version), true),
            Err(_) => (None, None, false),
        }
    };

    let mut runtime_ready = false;
    let mut model_cached = false;
    let mut message = if !python_available {
        "Python 3.10–3.13 is required. Install Python, then click Install Local Parakeet.".to_string()
    } else if !managed.is_file() {
        "Local Parakeet runtime is not installed yet. Click Install Local Parakeet.".to_string()
    } else {
        "Checking Parakeet runtime…".to_string()
    };

    if managed.is_file() {
        if let Ok(script) = resolve_sidecar_script(app_handle) {
            match run_sidecar_json(
                &managed,
                &script,
                &[
                    "status",
                    "--model",
                    model,
                    "--cache-dir",
                    &cache.join("hub").to_string_lossy(),
                ],
                STATUS_TIMEOUT_SECS,
                &cache,
            )
            .await
            {
                Ok((value, _, _)) => {
                    if let Ok(payload) = serde_json::from_value::<SidecarStatusPayload>(value) {
                        runtime_ready = payload.ok && payload.ready && payload.mlx_available && payload.parakeet_available;
                        model_cached = payload.model_cached;
                        message = if runtime_ready {
                            if model_cached {
                                "Local Parakeet is ready.".into()
                            } else {
                                "Local Parakeet runtime is ready. The selected model will download on first transcription.".into()
                            }
                        } else {
                            payload
                                .error
                                .unwrap_or_else(|| "Parakeet packages are missing. Click Install Local Parakeet.".into())
                        };
                        if payload.python_version.is_some() {
                            // keep managed version already set
                        }
                    }
                }
                Err(err) => {
                    message = format!("Parakeet runtime check failed: {err}");
                }
            }
        }
    }

    if runtime_ready && !ffmpeg_available {
        message.push_str(" Warning: ffmpeg was not found on PATH; non-WAV inputs may fail.");
    }

    Ok(ParakeetStatus {
        supported_platform: true,
        platform: current_platform_tag(),
        python_available,
        python_version,
        python_path,
        runtime_ready,
        model: model.to_string(),
        model_cached,
        cache_dir: cache.to_string_lossy().to_string(),
        ffmpeg_available,
        message,
        models,
    })
}

fn emit_progress(app_handle: &AppHandle, stage: &str, message: &str) {
    let _ = app_handle.emit(
        "parakeet-stt-progress",
        ParakeetProgressEvent {
            stage: stage.to_string(),
            message: message.to_string(),
        },
    );
}

#[command]
pub async fn list_parakeet_models() -> Result<Vec<ParakeetModelInfo>, String> {
    Ok(catalog_models())
}

#[command]
pub async fn inspect_parakeet_stt(
    app_handle: AppHandle,
    model: Option<String>,
) -> Result<ParakeetStatus, String> {
    let model = normalize_model(model.as_deref())?;
    build_status(&app_handle, &model).await
}

#[command]
pub async fn ensure_parakeet_stt(
    app_handle: AppHandle,
    model: Option<String>,
) -> Result<ParakeetEnsureResult, String> {
    let model = normalize_model(model.as_deref())?;
    if !is_apple_silicon_macos() {
        let status = build_status(&app_handle, &model).await?;
        let message = status.message.clone();
        return Ok(ParakeetEnsureResult {
            success: false,
            status,
            stdout: String::new(),
            stderr: message,
        });
    }

    emit_progress(
        &app_handle,
        "preparing",
        "Creating isolated Python environment for Parakeet…",
    );
    let runtime = runtime_root(&app_handle)?;
    tokio::fs::create_dir_all(&runtime)
        .await
        .map_err(|e| format!("Failed to create Parakeet runtime directory: {e}"))?;
    let cache = cache_dir(&runtime);
    tokio::fs::create_dir_all(cache.join("hub"))
        .await
        .map_err(|e| format!("Failed to create Parakeet model cache: {e}"))?;

    let (python, _) = ensure_venv(&runtime).await?;
    let requirements = resolve_requirements(&app_handle)?;
    emit_progress(
        &app_handle,
        "installing",
        "Installing parakeet-mlx and dependencies (this can take several minutes)…",
    );
    let (stdout, stderr) = install_dependencies(&python, &requirements).await?;

    // Warm/check selected model metadata via status
    emit_progress(
        &app_handle,
        "verifying",
        "Verifying Parakeet runtime…",
    );
    let status = build_status(&app_handle, &model).await?;
    emit_progress(
        &app_handle,
        if status.runtime_ready {
            "completed"
        } else {
            "failed"
        },
        &status.message,
    );

    Ok(ParakeetEnsureResult {
        success: status.runtime_ready,
        status,
        stdout,
        stderr,
    })
}

#[command]
pub async fn transcribe_with_parakeet(
    app_handle: AppHandle,
    request: ParakeetTranscribeRequest,
) -> Result<ParakeetTranscribeResult, String> {
    if !is_apple_silicon_macos() {
        return Err("Local Parakeet (MLX) requires macOS on Apple Silicon (arm64).".into());
    }
    if request.audio_bytes.is_empty() {
        return Err("No audio data was provided for transcription.".into());
    }

    let model = normalize_model(request.model.as_deref())?;
    let language = request
        .language
        .as_deref()
        .unwrap_or("en")
        .trim()
        .to_string();
    let runtime = runtime_root(&app_handle)?;
    let python = venv_python(&runtime);
    if !python.is_file() {
        return Err(
            "Local Parakeet runtime is not installed. Open Settings → Audio and install Local Parakeet."
                .into(),
        );
    }
    let script = resolve_sidecar_script(&app_handle)?;
    let cache = cache_dir(&runtime);
    tokio::fs::create_dir_all(cache.join("hub"))
        .await
        .map_err(|e| format!("Failed to create Parakeet model cache: {e}"))?;

    let safe_name = Path::new(&request.file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("audio.webm");
    let temp_dir = runtime.join("tmp");
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temp audio directory: {e}"))?;
    let audio_path = temp_dir.join(format!(
        "parakeet-{}-{}",
        uuid::Uuid::new_v4(),
        safe_name
    ));
    tokio::fs::write(&audio_path, &request.audio_bytes)
        .await
        .map_err(|e| format!("Failed to write temp audio file: {e}"))?;

    let cache_hub = cache.join("hub").to_string_lossy().to_string();
    let mut args = vec![
        "transcribe".to_string(),
        "--audio".to_string(),
        audio_path.to_string_lossy().to_string(),
        "--model".to_string(),
        model.clone(),
        "--cache-dir".to_string(),
        cache_hub,
        "--language".to_string(),
        language.clone(),
    ];
    if request.local_attention.unwrap_or(false) {
        args.push("--local-attention".to_string());
    }
    if let Some(chunk) = request.chunk_duration {
        if chunk > 0.0 {
            args.push("--chunk-duration".to_string());
            args.push(chunk.to_string());
        }
    }

    emit_progress(
        &app_handle,
        "transcribing",
        "Running local Parakeet transcription…",
    );

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let result = run_sidecar_json(
        &python,
        &script,
        &arg_refs,
        TRANSCRIBE_TIMEOUT_SECS,
        &cache,
    )
    .await;
    let _ = tokio::fs::remove_file(&audio_path).await;

    let (value, _, stderr) = result?;
    let payload: SidecarTranscribePayload = serde_json::from_value(value)
        .map_err(|e| format!("Invalid Parakeet transcription response: {e}"))?;
    if !payload.ok {
        return Err(payload
            .message
            .or(payload.error)
            .unwrap_or_else(|| format!("Parakeet transcription failed. {stderr}")));
    }

    Ok(ParakeetTranscribeResult {
        text: payload.text.unwrap_or_default().trim().to_string(),
        model: payload.model.unwrap_or(model),
        language: payload.language.unwrap_or(language),
    })
}
