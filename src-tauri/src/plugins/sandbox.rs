use serde::{Deserialize, Serialize};

/// Windows Job Object 沙箱配置
#[derive(Debug, Serialize, Deserialize)]
pub struct SandboxConfig {
    pub memory_limit_mb: u64,
    pub cpu_time_limit_ms: u64,
    pub allow_network: bool,
    pub allowed_paths: Vec<String>,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            memory_limit_mb: 512,
            cpu_time_limit_ms: 30_000,
            allow_network: false,
            allowed_paths: Vec::new(),
        }
    }
}

/// 在沙箱中执行命令（Windows Job Objects 骨架实现）
///
/// 完整实现需要调用 Windows API：
/// - CreateJobObject
/// - SetInformationJobObject (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
/// - AssignProcessToJobObject
#[cfg(target_os = "windows")]
pub async fn exec_sandboxed(
    command: &str,
    config: &SandboxConfig,
) -> Result<super::shell_ext::ExecResult, String> {
    // TODO: 接入 Windows Job Object API
    // 当前降级为普通执行 + 超时限制
    tracing::warn!("Sandbox not yet implemented, falling back to timeout-only execution");
    super::shell_ext::exec_command(command, None, config.cpu_time_limit_ms).await
}

#[cfg(not(target_os = "windows"))]
pub async fn exec_sandboxed(
    command: &str,
    config: &SandboxConfig,
) -> Result<super::shell_ext::ExecResult, String> {
    tracing::warn!("Sandbox only supported on Windows, falling back to timeout-only execution");
    super::shell_ext::exec_command(command, None, config.cpu_time_limit_ms).await
}
