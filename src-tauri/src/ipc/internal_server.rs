use axum::{extract::Json, routing::post, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tauri::AppHandle;

use crate::plugins::{fs_ext, shell_ext};

/// JSON-RPC 2.0 请求
#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: serde_json::Value,
    method: String,
    params: Option<serde_json::Value>,
}

/// JSON-RPC 2.0 响应
#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
}

impl JsonRpcResponse {
    fn success(id: serde_json::Value, result: serde_json::Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    fn error(id: serde_json::Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message,
                data: None,
            }),
        }
    }
}

/// 启动仅绑定 127.0.0.1 的内部 HTTP server
pub async fn start(app_handle: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new().route("/rpc", post(handle_rpc));

    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;

    tracing::info!(
        "Internal HTTP server listening on http://{}",
        local_addr
    );

    // 将端口传给 sidecar（通过环境变量或其他方式）
    // 当前实现中 sidecar 通过命令行参数获取端口

    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_rpc(Json(req): Json<JsonRpcRequest>) -> Json<JsonRpcResponse> {
    let response = match req.method.as_str() {
        "file.read" => handle_file_read(req.id.clone(), req.params),
        "file.write" => handle_file_write(req.id.clone(), req.params),
        "file.list" => handle_file_list(req.id.clone(), req.params),
        "shell.exec" => handle_shell_exec(req.id.clone(), req.params).await,
        _ => JsonRpcResponse::error(req.id, -32601, format!("Method not found: {}", req.method)),
    };

    Json(response)
}

fn handle_file_read(
    id: serde_json::Value,
    params: Option<serde_json::Value>,
) -> JsonRpcResponse {
    let path = params
        .as_ref()
        .and_then(|p| p.get("path"))
        .and_then(|p| p.as_str())
        .unwrap_or("");

    match fs_ext::read_file(path, &[]) {
        Ok(result) => JsonRpcResponse::success(id, serde_json::to_value(result).unwrap()),
        Err(e) => JsonRpcResponse::error(id, -32000, e),
    }
}

fn handle_file_write(
    id: serde_json::Value,
    params: Option<serde_json::Value>,
) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => return JsonRpcResponse::error(id, -32602, "Missing params".into()),
    };

    let path = params.get("path").and_then(|p| p.as_str()).unwrap_or("");
    let content = params
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("");

    match fs_ext::write_file(path, content, &[]) {
        Ok(()) => JsonRpcResponse::success(id, serde_json::json!({"ok": true})),
        Err(e) => JsonRpcResponse::error(id, -32000, e),
    }
}

fn handle_file_list(
    id: serde_json::Value,
    params: Option<serde_json::Value>,
) -> JsonRpcResponse {
    let path = params
        .as_ref()
        .and_then(|p| p.get("path"))
        .and_then(|p| p.as_str())
        .unwrap_or(".");

    match fs_ext::list_dir(path, &[]) {
        Ok(files) => JsonRpcResponse::success(id, serde_json::to_value(files).unwrap()),
        Err(e) => JsonRpcResponse::error(id, -32000, e),
    }
}

async fn handle_shell_exec(
    id: serde_json::Value,
    params: Option<serde_json::Value>,
) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => return JsonRpcResponse::error(id, -32602, "Missing params".into()),
    };

    let command = params
        .get("command")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let cwd = params.get("cwd").and_then(|c| c.as_str());
    let timeout = params
        .get("timeout_ms")
        .and_then(|t| t.as_u64())
        .unwrap_or(30_000);

    match shell_ext::exec_command(command, cwd, timeout).await {
        Ok(result) => JsonRpcResponse::success(id, serde_json::to_value(result).unwrap()),
        Err(e) => JsonRpcResponse::error(id, -32000, e),
    }
}
