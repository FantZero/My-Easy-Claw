use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

static DB: std::sync::OnceLock<Mutex<Connection>> = std::sync::OnceLock::new();

fn get_db() -> &'static Mutex<Connection> {
    DB.get().expect("database not initialized")
}

pub fn init_database(path: &Path) -> Result<(), rusqlite::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| rusqlite::Error::InvalidParameterName("DB already initialized".into()))?;

    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '新对话',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
            content TEXT NOT NULL,
            tool_calls TEXT,
            timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);

        CREATE TABLE IF NOT EXISTS provider_config (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            base_url TEXT,
            is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tool_logs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            tool_name TEXT NOT NULL,
            input TEXT,
            output TEXT,
            duration_ms INTEGER,
            status TEXT NOT NULL CHECK(status IN ('success', 'error', 'cancelled')),
            timestamp INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

// ── Tauri Commands ──

#[derive(Debug, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

#[tauri::command]
pub fn cmd_list_sessions() -> Result<Vec<Session>, String> {
    let conn = get_db().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let sessions = stmt
        .query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}

#[tauri::command]
pub fn cmd_create_session(session: Session) -> Result<(), String> {
    let conn = get_db().lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            session.id,
            session.title,
            session.created_at,
            session.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn cmd_get_messages(session_id: String) -> Result<Vec<Message>, String> {
    let conn = get_db().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, tool_calls, timestamp \
             FROM messages WHERE session_id = ?1 ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;

    let messages = stmt
        .query_map(params![session_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_calls: row.get(4)?,
                timestamp: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(messages)
}

#[tauri::command]
pub fn cmd_get_default_provider() -> Result<Option<ProviderConfig>, String> {
    let conn = get_db().lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT provider, model, base_url FROM provider_config WHERE is_default = 1 LIMIT 1")
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row([], |row| {
            Ok(ProviderConfig {
                provider: row.get(0)?,
                model: row.get(1)?,
                base_url: row.get(2)?,
            })
        })
        .ok();

    Ok(result)
}

#[tauri::command]
pub fn cmd_set_default_provider(config: ProviderConfig) -> Result<(), String> {
    let conn = get_db().lock().map_err(|e| e.to_string())?;

    conn.execute("UPDATE provider_config SET is_default = 0", [])
        .map_err(|e| e.to_string())?;

    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR REPLACE INTO provider_config (id, provider, model, base_url, is_default) \
         VALUES (?1, ?2, ?3, ?4, 1)",
        params![id, config.provider, config.model, config.base_url],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
