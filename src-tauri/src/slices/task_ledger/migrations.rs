use chrono::Utc;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const SCHEMA_BOOTSTRAP_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);
"#;

const MIGRATION_V1_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS inventory_items (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    current_stock REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'un.',
    avg_daily_sales REAL NOT NULL DEFAULT 0,
    cost_unit REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'MXN',
    supplier_id TEXT,
    min_stock_days INTEGER,
    source_file TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_runs (
    id TEXT PRIMARY KEY,
    review_type TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    status TEXT NOT NULL,
    sources_scanned_json TEXT NOT NULL,
    findings_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
    card_id TEXT PRIMARY KEY,
    dedup_key TEXT,
    review_run_id TEXT REFERENCES review_runs(id),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    urgency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    proposal_json TEXT NOT NULL,
    staging_payload_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_updated
    ON tasks (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_dedup_key
    ON tasks (dedup_key);

CREATE TABLE IF NOT EXISTS agenda_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    time_label TEXT NOT NULL,
    recurrence TEXT,
    auto_scheduled INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    remaining_seconds INTEGER,
    ends_at TEXT,
    is_running INTEGER NOT NULL DEFAULT 0,
    note_content TEXT,
    checklist_json TEXT,
    tags_json TEXT,
    schedule_cron_or_rule TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agenda_kind_running
    ON agenda_items (kind, is_running, updated_at DESC);

CREATE TABLE IF NOT EXISTS decision_history (
    id TEXT PRIMARY KEY,
    task_card_id TEXT,
    agenda_item_id TEXT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    decision TEXT NOT NULL,
    summary TEXT NOT NULL,
    amount_label TEXT,
    verified_cost REAL,
    currency TEXT,
    execution_artifact_path TEXT,
    notes TEXT,
    decided_by TEXT,
    decided_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_history_decided_at
    ON decision_history (decided_at DESC);

CREATE TABLE IF NOT EXISTS workspace_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_path TEXT NOT NULL,
    zone TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
    ON workspace_audit_log (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS command_executions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    tool_call_id TEXT,
    purpose TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd_rel TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    permission_mode TEXT NOT NULL,
    matched_rule TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    duration_ms INTEGER,
    log_path TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_command_executions_status_created
    ON command_executions (status, created_at DESC);
"#;

pub fn db_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".xook").join("xook.db")
}

pub fn open_workspace_db(workspace_root: &Path) -> Result<Connection, String> {
    let meta_dir = workspace_root.join(".xook");
    fs::create_dir_all(&meta_dir)
        .map_err(|e| format!("No se pudo inicializar la carpeta .xook: {e}"))?;

    let path = db_path(workspace_root);
    let mut conn = Connection::open(&path)
        .map_err(|e| format!("No se pudo abrir la base de datos del espacio de trabajo: {e}"))?;

    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("No se pudo configurar el timeout de SQLite: {e}"))?;

    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;",
    )
    .map_err(|e| format!("No se pudo configurar pragmas de SQLite: {e}"))?;

    apply_migrations(&mut conn)?;
    Ok(conn)
}

pub fn apply_migrations(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA_BOOTSTRAP_SQL)
        .map_err(|e| format!("Error creando tabla schema_migrations: {e}"))?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Error consultando versión de migración: {e}"))?;

    if current_version < 1 {
        let tx = conn
            .transaction()
            .map_err(|e| format!("Error iniciando transacción de migración v1: {e}"))?;
        tx.execute_batch(MIGRATION_V1_SQL)
            .map_err(|e| format!("Error aplicando migración v1: {e}"))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![1i64, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Error registrando migración v1: {e}"))?;
        tx.commit()
            .map_err(|e| format!("Error confirmando migración v1: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xook_test_{prefix}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn migrations_create_all_tables_and_are_idempotent() {
        let dir = make_temp_workspace("migrations");
        let conn1 = open_workspace_db(&dir).expect("first open succeeds");
        let mut names: Vec<String> = conn1
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        names.sort();

        assert_eq!(
            names,
            vec![
                "agenda_items",
                "command_executions",
                "decision_history",
                "inventory_items",
                "review_runs",
                "schema_migrations",
                "tasks",
                "workspace_audit_log",
            ]
        );
        drop(conn1);

        let conn2 = open_workspace_db(&dir).expect("second open is idempotent");
        let count: i64 = conn2
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let fk: i64 = conn2
            .query_row("PRAGMA foreign_keys;", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);

        let _ = fs::remove_dir_all(&dir);
    }
}

