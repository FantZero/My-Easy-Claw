mod ipc;
mod plugins;
mod sidecar;

use plugins::db;
use plugins::shell_ext;
use tauri::Manager;
use std::sync::Mutex;

pub struct SidecarState {
    pub port: Mutex<Option<u16>>,
}

#[tauri::command]
fn cmd_get_sidecar_status(state: tauri::State<'_, SidecarState>) -> serde_json::Value {
    let port = *state.port.lock().expect("sidecar state mutex poisoned");
    serde_json::json!({
        "ready": port.is_some(),
        "port": port,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    shell_ext::initialize_process_shell_path();
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            port: Mutex::new(None),
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 初始化 SQLite
            let db_path = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("my-easy-claw.db");

            db::init_database(&db_path).expect("failed to init database");

            // 启动 Node.js Sidecar
            let handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sidecar::start_sidecar(&handle).await {
                    tracing::error!("Failed to start sidecar: {}", e);
                }
            });

            // 启动内部 HTTP server（供 Node sidecar 调用 Rust 能力）
            let handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ipc::internal_server::start(&handle).await {
                    tracing::error!("Failed to start internal HTTP server: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_get_sidecar_status,
            db::cmd_list_sessions,
            db::cmd_create_session,
            db::cmd_get_messages,
            db::cmd_upsert_message,
            db::cmd_get_default_provider,
            db::cmd_set_default_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
