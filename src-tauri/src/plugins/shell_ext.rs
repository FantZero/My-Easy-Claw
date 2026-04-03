use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
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

/// 在 Windows 上查找 Git Bash 路径，找不到则返回 None。
/// 查找顺序：
///   1. %ProgramFiles%\Git\bin\bash.exe （标准安装）
///   2. %ProgramFiles(x86)%\Git\bin\bash.exe
///   3. Scoop 安装：%USERPROFILE%\scoop\apps\git\current\bin\bash.exe
///   4. PATH 上的 bash.exe（排除 WSL / System32 的 bash）
#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<String> {
    static CACHED: OnceLock<Option<String>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let mut candidates: Vec<String> = Vec::new();

            for var in &["ProgramFiles", "ProgramFiles(x86)"] {
                if let Ok(dir) = std::env::var(var) {
                    candidates.push(format!(r"{}\Git\bin\bash.exe", dir));
                }
            }

            if let Ok(home) = std::env::var("USERPROFILE") {
                candidates.push(format!(r"{}\scoop\apps\git\current\bin\bash.exe", home));
            }

            for path in &candidates {
                if Path::new(path).exists() {
                    return Some(path.clone());
                }
            }

            if let Ok(output) = std::process::Command::new("where")
                .arg("bash.exe")
                .output()
            {
                if output.status.success() {
                    for line in String::from_utf8_lossy(&output.stdout).lines() {
                        let p = line.trim().to_string();
                        let lower = p.to_lowercase();
                        if lower.contains(r"\system32\")
                            || lower.contains(r"\windowsapps\")
                        {
                            continue;
                        }
                        if Path::new(&p).exists() {
                            return Some(p);
                        }
                    }
                }
            }

            None
        })
        .clone()
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
        match find_git_bash() {
            Some(bash_path) => {
                let mut c = Command::new(bash_path);
                c.args(["-c", command]);
                c
            }
            None => {
                let mut c = Command::new("cmd");
                c.args(["/C", &format!("chcp 65001 >nul && {}", command)]);
                c
            }
        }
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", command]);
        c
    };

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.env("LANG", "en_US.UTF-8");
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
