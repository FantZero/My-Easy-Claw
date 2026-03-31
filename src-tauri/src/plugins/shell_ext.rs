use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 命令安全性检查
const BLOCKED_PATTERNS: &[&str] = &[
    "rm -rf /",
    "format c:",
    "del /s /q c:",
    "reg delete",
    "shutdown /s",
    "shutdown /r",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn is_command_safe(command: &str) -> bool {
    let lower = command.to_lowercase();
    !BLOCKED_PATTERNS.iter().any(|p| lower.contains(p))
}

/// 执行 Shell 命令并返回结果
pub async fn exec_command(
    command: &str,
    cwd: Option<&str>,
    timeout_ms: u64,
) -> Result<ExecResult, String> {
    if !is_command_safe(command) {
        return Err(format!("Blocked dangerous command: {}", command));
    }

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let child = cmd.spawn().map_err(|e| format!("Spawn error: {}", e))?;

    let output = tokio::time::timeout(
        std::time::Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| "SHELL_TIMEOUT".to_string())?
    .map_err(|e| format!("Execution error: {}", e))?;

    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}
