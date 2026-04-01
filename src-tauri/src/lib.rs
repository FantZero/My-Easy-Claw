mod ipc;
mod plugins;
mod sidecar;

use plugins::db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            db::cmd_list_sessions,
            db::cmd_create_session,
            db::cmd_get_messages,
            db::cmd_get_default_provider,
            db::cmd_set_default_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
