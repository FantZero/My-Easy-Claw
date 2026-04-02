use crate::SidecarState;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// 启动 Node.js Sidecar 进程，监听其 stdout 获取就绪信号和端口号。
pub async fn start_sidecar(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();

    let sidecar_command = shell.sidecar("sidecar").map_err(|e| {
        tracing::error!("Failed to create sidecar command: {}", e);
        e
    })?;

    let (mut rx, _child) = sidecar_command.spawn().map_err(|e| {
        tracing::error!("Failed to spawn sidecar: {}", e);
        e
    })?;

    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    tracing::info!("[sidecar:stdout] {}", text);

                    // 解析就绪信号: {"status":"ready","port":12345}
                    if let Ok(msg) =
                        serde_json::from_str::<serde_json::Value>(text.trim())
                    {
                        if msg.get("status").and_then(|s| s.as_str()) == Some("ready") {
                            if let Some(port) = msg.get("port").and_then(|p| p.as_u64()) {
                                tracing::info!("Sidecar ready on port {}", port);
                                if let Ok(port_u16) = u16::try_from(port) {
                                    let state = app_handle.state::<SidecarState>();
                                    if let Ok(mut current_port) = state.inner().port.lock() {
                                        *current_port = Some(port_u16);
                                    };
                                }
                                let _ = app_handle.emit(
                                    "sidecar-ready",
                                    serde_json::json!({ "port": port }),
                                );
                            }
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    tracing::warn!("[sidecar:stderr] {}", text);
                }
                CommandEvent::Terminated(status) => {
                    tracing::info!("Sidecar terminated with status: {:?}", status);
                    let state = app_handle.state::<SidecarState>();
                    if let Ok(mut current_port) = state.inner().port.lock() {
                        *current_port = None;
                    };
                    let _ = app_handle.emit(
                        "sidecar-status",
                        serde_json::json!({ "status": "terminated" }),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}
