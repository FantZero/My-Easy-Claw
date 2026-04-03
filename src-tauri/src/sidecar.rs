use crate::SidecarState;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn resolve_sidecar_script(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("binaries").join("sidecar.mjs");
        if candidate.exists() {
            return candidate;
        }
    }

    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("sidecar.mjs");
    dev_path
}

/// 启动 Node.js Sidecar 进程，监听其 stdout 获取就绪信号和端口号。
pub async fn start_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let script_path = resolve_sidecar_script(app);

    if !script_path.exists() {
        return Err(format!("Sidecar script not found: {}", script_path.display()).into());
    }

    tracing::info!("Starting sidecar: node {}", script_path.display());

    let mut cmd = Command::new("node");
    cmd.arg(&script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let mut child = cmd.spawn().map_err(|e| {
        tracing::error!("Failed to spawn node sidecar: {}", e);
        e
    })?;

    let stdout = child.stdout.take().expect("failed to capture stdout");
    let stderr = child.stderr.take().expect("failed to capture stderr");

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            tracing::info!("[sidecar:stdout] {}", line);

            if let Ok(msg) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                if msg.get("status").and_then(|s| s.as_str()) == Some("ready") {
                    if let Some(port) = msg.get("port").and_then(|p| p.as_u64()) {
                        tracing::info!("Sidecar ready on port {}", port);
                        if let Ok(port_u16) = u16::try_from(port) {
                            let state = app_handle.state::<SidecarState>();
                            if let Ok(mut current_port) = state.inner().port.lock() {
                                *current_port = Some(port_u16);
                            }
                        }
                        let _ = app_handle.emit(
                            "sidecar-ready",
                            serde_json::json!({ "port": port }),
                        );
                    }
                }
            }
        }

        let status = child.wait();
        tracing::info!("Sidecar terminated with status: {:?}", status);
        let state = app_handle.state::<SidecarState>();
        if let Ok(mut current_port) = state.inner().port.lock() {
            *current_port = None;
        }
        let _ = app_handle.emit(
            "sidecar-status",
            serde_json::json!({ "status": "terminated" }),
        );
    });

    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => tracing::warn!("[sidecar:stderr] {}", l),
                Err(_) => break,
            }
        }
    });

    Ok(())
}
