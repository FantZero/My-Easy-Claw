use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use tokio::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

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

#[cfg(target_os = "windows")]
fn push_git_root_candidates(candidates: &mut Vec<PathBuf>, git_root: PathBuf) {
    candidates.push(git_root.join("bin").join("bash.exe"));
    candidates.push(git_root.join("usr").join("bin").join("bash.exe"));
}

#[cfg(target_os = "windows")]
fn infer_git_root_from_executable(path: &Path) -> Option<PathBuf> {
    let parent = path.parent()?;
    let parent_name = parent.file_name()?.to_string_lossy().to_lowercase();

    if parent_name == "bin" {
        if let Some(usr_dir) = parent.parent() {
            let usr_name = usr_dir.file_name()?.to_string_lossy().to_lowercase();
            if usr_name == "usr" {
                return usr_dir.parent().map(Path::to_path_buf);
            }
        }

        return parent.parent().map(Path::to_path_buf);
    }

    if parent_name == "cmd" || parent_name == "usr" {
        return parent.parent().map(Path::to_path_buf);
    }

    None
}

#[cfg(target_os = "windows")]
fn is_disallowed_windows_bash(path: &Path) -> bool {
    let lower = path.to_string_lossy().to_lowercase();
    lower.contains(r"\system32\")
        || lower.contains(r"\windowsapps\")
        || lower.contains(r"\wsl\")
}

fn is_command_safe(command: &str) -> bool {
    let lower = command.to_lowercase();
    !BLOCKED_PATTERNS.iter().any(|p| lower.contains(p))
}

/// 通过 PowerShell `(Get-Command git).Source` 定位 git.exe 的实际路径。
#[cfg(target_os = "windows")]
fn query_git_path_from_powershell() -> Option<PathBuf> {
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NoLogo",
            "-NonInteractive",
            "-Command",
            "(Get-Command git -ErrorAction SilentlyContinue).Source",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_str.is_empty() {
        return None;
    }

    let path = PathBuf::from(&path_str);
    if path.exists() && !is_disallowed_windows_bash(&path) {
        Some(path)
    } else {
        None
    }
}

/// 在 Windows 上查找 Git Bash 路径，找不到则返回 None。
/// 查找顺序：
///   1. 环境变量显式指定（GIT_INSTALL_ROOT 等）
///   2. %ProgramFiles% 常规安装
///   3. Scoop 安装
///   4. PowerShell `(Get-Command git).Source` 动态定位（兼容任意安装路径）
///   5. `where` 命令兜底
#[cfg(target_os = "windows")]
fn find_git_bash() -> Option<PathBuf> {
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            let mut candidates: Vec<PathBuf> = Vec::new();

            for var in &[
                "GIT_INSTALL_ROOT",
                "GIT_HOME",
            ] {
                if let Ok(value) = std::env::var(var) {
                    let path = PathBuf::from(value);
                    if path
                        .file_name()
                        .map(|name| name.to_string_lossy().eq_ignore_ascii_case("bash.exe"))
                        .unwrap_or(false)
                    {
                        candidates.push(path);
                    } else {
                        push_git_root_candidates(&mut candidates, path);
                    }
                }
            }

            for var in &["ProgramFiles", "ProgramFiles(x86)"] {
                if let Ok(dir) = std::env::var(var) {
                    push_git_root_candidates(&mut candidates, PathBuf::from(dir).join("Git"));
                }
            }

            if let Ok(home) = std::env::var("USERPROFILE") {
                push_git_root_candidates(
                    &mut candidates,
                    PathBuf::from(home)
                        .join("scoop")
                        .join("apps")
                        .join("git")
                        .join("current"),
                );
            }

            for path in &candidates {
                if path.exists() && !is_disallowed_windows_bash(path) {
                    return Some(path.clone());
                }
            }

            if let Some(git_exe) = query_git_path_from_powershell() {
                if let Some(git_root) = infer_git_root_from_executable(&git_exe) {
                    for candidate in [
                        git_root.join("bin").join("bash.exe"),
                        git_root.join("usr").join("bin").join("bash.exe"),
                    ] {
                        if candidate.exists() && !is_disallowed_windows_bash(&candidate) {
                            return Some(candidate);
                        }
                    }
                }
            }

            for executable in &["git.exe", "bash.exe"] {
                if let Ok(output) = std::process::Command::new("where")
                    .arg(executable)
                    .output()
                {
                    if output.status.success() {
                        for line in String::from_utf8_lossy(&output.stdout).lines() {
                            let p = PathBuf::from(line.trim());
                            if !p.exists() || is_disallowed_windows_bash(&p) {
                                continue;
                            }

                            if p.file_name()
                                .map(|name| name.to_string_lossy().eq_ignore_ascii_case("bash.exe"))
                                .unwrap_or(false)
                            {
                                return Some(p);
                            }

                            if let Some(git_root) = infer_git_root_from_executable(&p) {
                                for candidate in [
                                    git_root.join("bin").join("bash.exe"),
                                    git_root.join("usr").join("bin").join("bash.exe"),
                                ] {
                                    if candidate.exists() && !is_disallowed_windows_bash(&candidate)
                                    {
                                        return Some(candidate);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            None
        })
        .clone()
}

#[cfg(target_os = "windows")]
fn collect_git_bash_path_entries(bash_path: &Path) -> Vec<PathBuf> {
    let mut entries = Vec::new();

    if let Some(bin_dir) = bash_path.parent() {
        entries.push(bin_dir.to_path_buf());

        if let Some(git_root) = bin_dir.parent() {
            let cmd_dir = git_root.join("cmd");
            if cmd_dir.exists() {
                entries.push(cmd_dir);
            }

            let usr_bin_dir = git_root.join("usr").join("bin");
            if usr_bin_dir.exists() {
                entries.push(usr_bin_dir);
            }
        }
    }

    entries
}

#[cfg(target_os = "windows")]
fn path_contains(existing_paths: &[PathBuf], candidate: &Path) -> bool {
    let candidate = candidate.to_string_lossy();
    existing_paths
        .iter()
        .any(|path| path.to_string_lossy().eq_ignore_ascii_case(&candidate))
}

/// 在应用启动时将 Git Bash 相关目录注入当前进程 PATH。
/// 这样后续 sidecar 和其他子进程都能继承同一套 Shell 环境。
#[cfg(target_os = "windows")]
pub fn initialize_process_shell_path() {
    let Some(bash_path) = find_git_bash() else {
        tracing::warn!("Git Bash not found; process PATH was not modified");
        return;
    };

    let existing = std::env::var_os("PATH").unwrap_or_default();
    let existing_paths: Vec<PathBuf> = std::env::split_paths(&existing).collect();
    let mut prepended_paths = Vec::new();

    for entry in collect_git_bash_path_entries(&bash_path) {
        if entry.exists() && !path_contains(&existing_paths, &entry) {
            prepended_paths.push(entry);
        }
    }

    if prepended_paths.is_empty() {
        tracing::info!("Git Bash PATH entries already present: {}", bash_path.display());
        return;
    }

    let merged = prepended_paths
        .iter()
        .cloned()
        .chain(existing_paths.iter().cloned());

    match std::env::join_paths(merged) {
        Ok(path_value) => {
            // SAFETY: 该函数仅在应用启动早期调用，此时尚未启动 Tauri/Tokio 线程，
            // 避免了 Rust 2024 中全局环境变量并发修改的未定义行为。
            unsafe {
                std::env::set_var("PATH", path_value);
            }

            let injected = prepended_paths
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("; ");
            tracing::info!("Prepended Git Bash directories to PATH: {}", injected);
        }
        Err(error) => {
            tracing::warn!("Failed to update PATH with Git Bash directories: {}", error);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn initialize_process_shell_path() {}

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
