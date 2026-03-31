use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// 文件访问安全：目录白名单检查
fn is_path_allowed(path: &PathBuf, allowed_roots: &[PathBuf]) -> bool {
    let canonical = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };

    #[cfg(target_os = "windows")]
    {
        let blocked = [
            PathBuf::from(r"C:\Windows"),
            PathBuf::from(r"C:\Program Files"),
            PathBuf::from(r"C:\Program Files (x86)"),
        ];

        for b in &blocked {
            if canonical.starts_with(b) {
                return false;
            }
        }
    }

    if allowed_roots.is_empty() {
        return true;
    }

    allowed_roots.iter().any(|root| {
        root.canonicalize()
            .map(|r| canonical.starts_with(r))
            .unwrap_or(false)
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadFileResult {
    pub content: String,
    pub path: String,
}

/// 读取文件内容（供内部 HTTP API 使用）
pub fn read_file(path: &str, allowed_roots: &[PathBuf]) -> Result<ReadFileResult, String> {
    let p = PathBuf::from(path);

    if !is_path_allowed(&p, allowed_roots) {
        return Err(format!("Access denied: {}", path));
    }

    let content = std::fs::read_to_string(&p).map_err(|e| format!("Read error: {}", e))?;

    Ok(ReadFileResult {
        content,
        path: p.to_string_lossy().into_owned(),
    })
}

/// 写入文件内容
pub fn write_file(path: &str, content: &str, allowed_roots: &[PathBuf]) -> Result<(), String> {
    let p = PathBuf::from(path);

    if !is_path_allowed(&p, allowed_roots) {
        return Err(format!("Access denied: {}", path));
    }

    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Mkdir error: {}", e))?;
    }

    std::fs::write(&p, content).map_err(|e| format!("Write error: {}", e))?;

    Ok(())
}

/// 列出目录内容
pub fn list_dir(path: &str, allowed_roots: &[PathBuf]) -> Result<Vec<FileInfo>, String> {
    let p = PathBuf::from(path);

    if !is_path_allowed(&p, allowed_roots) {
        return Err(format!("Access denied: {}", path));
    }

    let entries = std::fs::read_dir(&p).map_err(|e| format!("Read dir error: {}", e))?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let metadata = entry.metadata().ok();
        files.push(FileInfo {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false),
            size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            modified: metadata.and_then(|m| {
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
            }),
        });
    }

    Ok(files)
}
