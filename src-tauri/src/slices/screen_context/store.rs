use crate::slices::task_ledger::migrations::open_workspace_db;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const MAX_STORED_SCREEN_OBSERVATIONS: i64 = 120;
const SIMILARITY_DEDUP_THRESHOLD: f64 = 0.90;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenContextConfig {
    pub rolling_enabled: bool,
    pub retention_minutes: i64,
    pub capture_mode: String,
}

impl Default for ScreenContextConfig {
    fn default() -> Self {
        Self {
            rolling_enabled: true,
            retention_minutes: 10,
            capture_mode: "display".to_string(),
        }
    }
}

impl ScreenContextConfig {
    pub fn normalized(mut self) -> Self {
        self.retention_minutes = self.retention_minutes.clamp(2, 30);
        if !self.capture_mode.eq_ignore_ascii_case("window") {
            self.capture_mode = "display".to_string();
        } else {
            self.capture_mode = "window".to_string();
        }
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenObservationRecord {
    pub id: String,
    pub app_name: String,
    pub bundle_id: String,
    pub window_title: String,
    pub content_text: String,
    pub capture_mode: String,
    pub captured_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryItem {
    pub id: String,
    pub kind: String,
    pub category: String,
    pub title: String,
    pub content: String,
    pub source_ref: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct NewScreenObservation<'a> {
    pub app_name: &'a str,
    pub bundle_id: &'a str,
    pub window_title: &'a str,
    pub content_text: &'a str,
    pub capture_mode: &'a str,
}

fn config_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No se pudo resolver app_config_dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Error creando app_config_dir: {e}"))?;
    Ok(dir.join("screen-reader-config.json"))
}

pub fn load_screen_config<R: Runtime>(app: &AppHandle<R>) -> ScreenContextConfig {
    let Ok(path) = config_file_path(app) else {
        return ScreenContextConfig::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return ScreenContextConfig::default();
    };
    serde_json::from_str::<ScreenContextConfig>(&raw)
        .map(ScreenContextConfig::normalized)
        .unwrap_or_default()
}

pub fn save_screen_config<R: Runtime>(
    app: &AppHandle<R>,
    cfg: &ScreenContextConfig,
) -> Result<ScreenContextConfig, String> {
    let normalized = cfg.clone().normalized();
    let path = config_file_path(app)?;
    let raw = serde_json::to_string_pretty(&normalized)
        .map_err(|e| format!("Error serializando configuración de pantalla: {e}"))?;
    fs::write(path, raw)
        .map_err(|e| format!("Error guardando configuración de pantalla: {e}"))?;
    Ok(normalized)
}

pub fn fnv1a_hex(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn next_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}_{nanos:x}")
}

fn normalize_text_for_storage(raw: &str) -> String {
    let lines: Vec<String> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            let mut out = String::with_capacity(l.len());
            let mut prev_space = false;
            for ch in l.chars() {
                if ch.is_whitespace() {
                    if !prev_space {
                        out.push(' ');
                        prev_space = true;
                    }
                } else {
                    out.push(ch);
                    prev_space = false;
                }
            }
            out
        })
        .collect();
    let joined = lines.join("\n");
    if joined.len() <= 10_000 {
        joined
    } else {
        joined.chars().take(10_000).collect()
    }
}

fn line_overlap_similarity(a: &str, b: &str) -> f64 {
    let set_a: HashSet<&str> = a.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let set_b: HashSet<&str> = b.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if set_a.is_empty() && set_b.is_empty() {
        return 1.0;
    }
    if set_a.is_empty() || set_b.is_empty() {
        return 0.0;
    }
    let inter = set_a.intersection(&set_b).count();
    let denom = set_a.len().max(set_b.len());
    inter as f64 / denom as f64
}

pub fn prune_expired_observations(conn: &Connection, now: DateTime<Utc>) -> Result<usize, String> {
    let now_iso = now.to_rfc3339();
    conn.execute(
        "DELETE FROM screen_observations_fts
         WHERE observation_id IN (SELECT id FROM screen_observations WHERE expires_at <= ?1)",
        params![now_iso],
    )
    .map_err(|e| format!("Error limpiando índice FTS de pantalla: {e}"))?;

    let deleted = conn
        .execute(
            "DELETE FROM screen_observations WHERE expires_at <= ?1",
            params![now_iso],
        )
        .map_err(|e| format!("Error limpiando observaciones expiradas: {e}"))?;

    // También acotar total máximo por higiene
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM screen_observations", [], |r| r.get(0))
        .unwrap_or(0);
    if count > MAX_STORED_SCREEN_OBSERVATIONS {
        let excess = count - MAX_STORED_SCREEN_OBSERVATIONS;
        let _ = conn.execute(
            "DELETE FROM screen_observations_fts
             WHERE observation_id IN (
                 SELECT id FROM screen_observations ORDER BY captured_at ASC LIMIT ?1
             )",
            params![excess],
        );
        let _ = conn.execute(
            "DELETE FROM screen_observations
             WHERE id IN (
                 SELECT id FROM screen_observations ORDER BY captured_at ASC LIMIT ?1
             )",
            params![excess],
        );
    }

    Ok(deleted)
}

pub fn record_screen_observation_at(
    conn: &mut Connection,
    obs: &NewScreenObservation<'_>,
    retention_minutes: i64,
    now: DateTime<Utc>,
) -> Result<Option<ScreenObservationRecord>, String> {
    prune_expired_observations(conn, now)?;

    let cleaned = normalize_text_for_storage(obs.content_text);
    if cleaned.trim().is_empty() {
        return Ok(None);
    }

    let app_name = obs.app_name.trim();
    let bundle_id = obs.bundle_id.trim();
    let window_title = obs.window_title.trim();
    let capture_mode = if obs.capture_mode.eq_ignore_ascii_case("window") {
        "window"
    } else {
        "display"
    };

    let ttl_mins = retention_minutes.clamp(2, 30);
    let now_iso = now.to_rfc3339();
    let expires_iso = (now + ChronoDuration::minutes(ttl_mins)).to_rfc3339();
    let content_hash = fnv1a_hex(&format!("{app_name}|{window_title}|{cleaned}"));

    // Verificar última observación para evitar duplicados continuos
    let latest: Option<(String, String, String, String, String)> = conn
        .query_row(
            "SELECT id, app_name, window_title, content_text, content_hash
             FROM screen_observations
             ORDER BY captured_at DESC
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Error consultando última observación de pantalla: {e}"))?;

    if let Some((last_id, last_app, last_title, last_text, last_hash)) = latest {
        let same_surface = last_app == app_name && last_title == window_title;
        let similar = same_surface
            && (last_hash == content_hash
                || line_overlap_similarity(&last_text, &cleaned) >= SIMILARITY_DEDUP_THRESHOLD);
        if similar {
            conn.execute(
                "UPDATE screen_observations
                 SET expires_at = ?1, captured_at = ?2
                 WHERE id = ?3",
                params![expires_iso, now_iso, last_id],
            )
            .map_err(|e| format!("Error renovando vigencia de observación: {e}"))?;
            return Ok(None);
        }
    }

    let id = next_id("scr");
    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de pantalla: {e}"))?;

    tx.execute(
        "INSERT INTO screen_observations
            (id, app_name, bundle_id, window_title, content_text, content_hash, capture_mode, captured_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id,
            app_name,
            bundle_id,
            window_title,
            cleaned,
            content_hash,
            capture_mode,
            now_iso,
            expires_iso
        ],
    )
    .map_err(|e| format!("Error insertando observación de pantalla: {e}"))?;

    tx.execute(
        "INSERT INTO screen_observations_fts (observation_id, app_name, window_title, content_text)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, app_name, window_title, cleaned],
    )
    .map_err(|e| format!("Error indexando FTS5 de pantalla: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Error confirmando observación de pantalla: {e}"))?;

    Ok(Some(ScreenObservationRecord {
        id,
        app_name: app_name.to_string(),
        bundle_id: bundle_id.to_string(),
        window_title: window_title.to_string(),
        content_text: cleaned,
        capture_mode: capture_mode.to_string(),
        captured_at: now_iso,
        expires_at: expires_iso,
    }))
}

pub fn clear_all_screen_observations(conn: &Connection) -> Result<usize, String> {
    let _ = conn.execute("DELETE FROM screen_observations_fts", []);
    conn.execute("DELETE FROM screen_observations", [])
        .map_err(|e| format!("Error limpiando memoria de pantalla: {e}"))
}

pub fn count_active_observations(conn: &Connection, now: DateTime<Utc>) -> usize {
    let _ = prune_expired_observations(conn, now);
    conn.query_row("SELECT COUNT(*) FROM screen_observations", [], |r| {
        r.get::<_, i64>(0)
    })
    .unwrap_or(0)
    .max(0) as usize
}

pub fn list_recent_screen_observations(
    conn: &Connection,
    limit: usize,
    now: DateTime<Utc>,
) -> Result<Vec<ScreenObservationRecord>, String> {
    let _ = prune_expired_observations(conn, now);
    let capped = (limit.clamp(1, 30)) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, app_name, bundle_id, window_title, content_text, capture_mode, captured_at, expires_at
             FROM screen_observations
             ORDER BY captured_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error preparando consulta de pantalla: {e}"))?;
    let rows = stmt
        .query_map(params![capped], |row| {
            Ok(ScreenObservationRecord {
                id: row.get(0)?,
                app_name: row.get(1)?,
                bundle_id: row.get(2)?,
                window_title: row.get(3)?,
                content_text: row.get(4)?,
                capture_mode: row.get(5)?,
                captured_at: row.get(6)?,
                expires_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Error leyendo observaciones de pantalla: {e}"))?;

    let mut items = Vec::new();
    for r in rows {
        if let Ok(item) = r {
            items.push(item);
        }
    }
    Ok(items)
}

fn build_fts_query(raw: &str) -> Option<String> {
    const STOPWORDS: &[&str] = &[
        "que", "qué", "los", "las", "una", "uno", "unos", "unas", "con", "por", "para", "del",
        "como", "cómo", "esta", "está", "esto", "ese", "esa", "sobre", "pantalla", "ahora",
        "aquí", "aqui", "dime", "puedes", "puedo", "leer", "lee", "mira", "ves", "tengo",
        "the", "and", "for", "with", "this", "that", "from", "what", "screen",
    ];
    let mut seen = HashSet::new();
    let mut tokens = Vec::new();

    let mut cur = String::new();
    for ch in raw.chars() {
        if ch.is_alphanumeric() {
            for lc in ch.to_lowercase() {
                cur.push(lc);
            }
        } else if !cur.is_empty() {
            if cur.chars().count() >= 2 && !STOPWORDS.contains(&cur.as_str()) && seen.insert(cur.clone()) {
                tokens.push(format!("\"{}\"*", cur.replace('"', "")));
            }
            cur.clear();
        }
    }
    if !cur.is_empty()
        && cur.chars().count() >= 2
        && !STOPWORDS.contains(&cur.as_str())
        && seen.insert(cur.clone())
    {
        tokens.push(format!("\"{}\"*", cur.replace('"', "")));
    }

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.into_iter().take(8).collect::<Vec<_>>().join(" OR "))
    }
}

pub fn query_screen_observations_fts(
    conn: &Connection,
    query: &str,
    limit: usize,
    now: DateTime<Utc>,
) -> Result<Vec<ScreenObservationRecord>, String> {
    let _ = prune_expired_observations(conn, now);
    let capped = (limit.clamp(1, 20)) as i64;

    if let Some(fts_expr) = build_fts_query(query) {
        let mut stmt = conn
            .prepare(
                "SELECT o.id, o.app_name, o.bundle_id, o.window_title, o.content_text, o.capture_mode, o.captured_at, o.expires_at
                 FROM screen_observations_fts f
                 JOIN screen_observations o ON o.id = f.observation_id
                 WHERE screen_observations_fts MATCH ?1
                 ORDER BY bm25(screen_observations_fts), o.captured_at DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("Error preparando FTS de pantalla: {e}"))?;

        if let Ok(rows) = stmt.query_map(params![fts_expr, capped], |row| {
            Ok(ScreenObservationRecord {
                id: row.get(0)?,
                app_name: row.get(1)?,
                bundle_id: row.get(2)?,
                window_title: row.get(3)?,
                content_text: row.get(4)?,
                capture_mode: row.get(5)?,
                captured_at: row.get(6)?,
                expires_at: row.get(7)?,
            })
        }) {
            let mut matched = Vec::new();
            for r in rows.flatten() {
                matched.push(r);
            }
            if !matched.is_empty() {
                return Ok(matched);
            }
        }
    }

    list_recent_screen_observations(conn, limit, now)
}

pub fn format_relative_age(iso_ts: &str, now: DateTime<Utc>) -> String {
    let Ok(parsed) = DateTime::parse_from_rfc3339(iso_ts) else {
        return "reciente".to_string();
    };
    let secs = (now - parsed.with_timezone(&Utc)).num_seconds().max(0);
    if secs < 45 {
        "hace unos segundos".to_string()
    } else if secs < 3600 {
        let mins = (secs / 60).max(1);
        format!("hace {mins} min")
    } else {
        let hrs = (secs / 3600).max(1);
        format!("hace {hrs} h")
    }
}

pub fn build_screen_memory_summary(
    conn: &Connection,
    query: &str,
    limit: usize,
    now: DateTime<Utc>,
) -> String {
    let mut items = query_screen_observations_fts(conn, query, limit, now).unwrap_or_default();
    let recent = list_recent_screen_observations(conn, 2, now).unwrap_or_default();
    for r in recent {
        if !items.iter().any(|existing| existing.id == r.id) {
            items.push(r);
        }
    }
    if items.is_empty() {
        return String::new();
    }

    let mut out = Vec::new();
    let mut total_chars = 0usize;
    for obs in items.into_iter().take(limit.clamp(1, 6)) {
        let age = format_relative_age(&obs.captured_at, now);
        let header = if obs.window_title.is_empty() {
            format!("[{age} · {}]", obs.app_name)
        } else {
            format!("[{age} · {} — {}]", obs.app_name, obs.window_title)
        };
        let snippet: String = obs.content_text.chars().take(750).collect();
        let entry = format!("{header}\n{snippet}");
        if total_chars + entry.len() > 2600 && !out.is_empty() {
            break;
        }
        total_chars += entry.len();
        out.push(entry);
    }
    out.join("\n---\n")
}

pub fn sync_business_facts_from_workspace(
    conn: &mut Connection,
    workspace_root: &Path,
) -> Result<usize, String> {
    let hechos_path = workspace_root.join("memoria").join("hechos.md");
    let raw = fs::read_to_string(&hechos_path).unwrap_or_default();
    let items: Vec<(String, String, String)> = raw
        .lines()
        .map(str::trim)
        .filter(|&line| !line.is_empty() && !line.starts_with('#') && line != "---")
        .map(|line| {
            let clean = line.trim_start_matches(['-', '*', '•', ' ']).trim();
            // Extraer posible etiqueta [categoria] si existe
            let (cat, body) = if clean.starts_with('[') {
                if let Some(end) = clean.find(']') {
                    (
                        clean[1..end].trim().to_string(),
                        clean[end + 1..].trim().to_string(),
                    )
                } else {
                    ("negocio".to_string(), clean.to_string())
                }
            } else {
                ("negocio".to_string(), clean.to_string())
            };
            let title: String = body.chars().take(72).collect();
            (cat, title, body)
        })
        .filter(|(_, _, body)| !body.is_empty())
        .collect();

    let source_ref = "memoria/hechos.md";
    let now_iso = Utc::now().to_rfc3339();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Error sincronizando memoria de negocio: {e}"))?;

    tx.execute(
        "DELETE FROM agent_memory_fts
         WHERE memory_id IN (SELECT id FROM agent_memory_items WHERE source_ref = ?1)",
        params![source_ref],
    )
    .map_err(|e| format!("Error limpiando FTS de hechos: {e}"))?;

    tx.execute(
        "DELETE FROM agent_memory_items WHERE source_ref = ?1",
        params![source_ref],
    )
    .map_err(|e| format!("Error limpiando hechos previos: {e}"))?;

    let mut count = 0usize;
    for (idx, (cat, title, content)) in items.iter().enumerate() {
        let id = format!("fact_{}_{}", fnv1a_hex(content), idx);
        tx.execute(
            "INSERT OR REPLACE INTO agent_memory_items
                (id, kind, category, title, content, source_ref, created_at, updated_at)
             VALUES (?1, 'fact', ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, cat, title, content, source_ref, now_iso],
        )
        .map_err(|e| format!("Error guardando hecho en SQLite: {e}"))?;

        tx.execute(
            "INSERT INTO agent_memory_fts (memory_id, kind, category, title, content)
             VALUES (?1, 'fact', ?2, ?3, ?4)",
            params![id, cat, title, content],
        )
        .map_err(|e| format!("Error indexando hecho FTS5: {e}"))?;
        count += 1;
    }

    tx.commit()
        .map_err(|e| format!("Error confirmando sincronización de hechos: {e}"))?;
    Ok(count)
}

pub fn query_agent_memory_fts(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<AgentMemoryItem>, String> {
    let capped = (limit.clamp(1, 30)) as i64;
    if let Some(fts_expr) = build_fts_query(query) {
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.kind, m.category, m.title, m.content, m.source_ref, m.created_at, m.updated_at
                 FROM agent_memory_fts f
                 JOIN agent_memory_items m ON m.id = f.memory_id
                 WHERE agent_memory_fts MATCH ?1
                 ORDER BY bm25(agent_memory_fts), m.updated_at DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("Error preparando búsqueda FTS de memoria: {e}"))?;

        if let Ok(rows) = stmt.query_map(params![fts_expr, capped], |row| {
            Ok(AgentMemoryItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                category: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                source_ref: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        }) {
            let mut found = Vec::new();
            for r in rows.flatten() {
                found.push(r);
            }
            if !found.is_empty() {
                return Ok(found);
            }
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, kind, category, title, content, source_ref, created_at, updated_at
             FROM agent_memory_items
             ORDER BY updated_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error listando memoria reciente: {e}"))?;
    let rows = stmt
        .query_map(params![capped], |row| {
            Ok(AgentMemoryItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                category: row.get(2)?,
                title: row.get(3)?,
                content: row.get(4)?,
                source_ref: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Error iterando memoria reciente: {e}"))?;

    let mut items = Vec::new();
    for r in rows.flatten() {
        items.push(r);
    }
    Ok(items)
}

pub fn build_unified_memory_for_workspace(
    workspace_root: Option<&Path>,
    query: &str,
) -> (Vec<AgentMemoryItem>, String) {
    let Some(root) = workspace_root else {
        return (Vec::new(), String::new());
    };
    let Ok(mut conn) = open_workspace_db(root) else {
        return (Vec::new(), String::new());
    };
    let _ = sync_business_facts_from_workspace(&mut conn, root);
    let facts = query_agent_memory_fts(&conn, query, 12).unwrap_or_default();
    let screen_summary = build_screen_memory_summary(&conn, query, 4, Utc::now());
    (facts, screen_summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_ws(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("xook_scr_test_{prefix}_{nanos}"));
        fs::create_dir_all(dir.join("memoria")).unwrap();
        dir
    }

    #[test]
    fn deduplicates_similar_frames_and_expires_old_ones() {
        let dir = temp_ws("dedup_ttl");
        let mut conn = open_workspace_db(&dir).unwrap();
        let t0 = Utc::now();

        let first = record_screen_observation_at(
            &mut conn,
            &NewScreenObservation {
                app_name: "Google Chrome",
                bundle_id: "com.google.Chrome",
                window_title: "Cotización Proveedor #42",
                content_text: "Proveedor Norte\nProducto: Harina 25kg\nPrecio: $480 MXN\nStock: 12 sacos",
                capture_mode: "display",
            },
            10,
            t0,
        )
        .unwrap();
        assert!(first.is_some());

        // Mismo texto 4 segundos después -> se deduplica (None) y renueva TTL
        let second = record_screen_observation_at(
            &mut conn,
            &NewScreenObservation {
                app_name: "Google Chrome",
                bundle_id: "com.google.Chrome",
                window_title: "Cotización Proveedor #42",
                content_text: "Proveedor Norte\nProducto: Harina 25kg\nPrecio: $480 MXN\nStock: 12 sacos",
                capture_mode: "display",
            },
            10,
            t0 + ChronoDuration::seconds(4),
        )
        .unwrap();
        assert!(second.is_none());
        assert_eq!(count_active_observations(&conn, t0 + ChronoDuration::seconds(5)), 1);

        // Búsqueda FTS5 sin tildes encuentra "Cotización" / "Harina"
        let hits = query_screen_observations_fts(
            &conn,
            "cotizacion harina precio",
            5,
            t0 + ChronoDuration::seconds(10),
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].content_text.contains("$480 MXN"));

        // Después de expirar TTL (+15 min), se purga automáticamente
        assert_eq!(
            count_active_observations(&conn, t0 + ChronoDuration::minutes(15)),
            0
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn syncs_and_queries_hechos_md_beyond_1500_chars() {
        let dir = temp_ws("facts_fts");
        let filler = "Dato histórico relleno del negocio sobre operaciones anteriores. ".repeat(40);
        let hechos = format!(
            "# Hechos del Negocio\n- [general] {filler}\n- [precios] El envío exprés en Monterrey cuesta $190 MXN con proveedor Paquetexpress.\n"
        );
        fs::write(dir.join("memoria/hechos.md"), hechos).unwrap();

        let (facts, _) = build_unified_memory_for_workspace(Some(&dir), "precio envio Monterrey Paquetexpress");
        assert!(!facts.is_empty());
        assert!(facts.iter().any(|f| f.content.contains("Paquetexpress")));

        let _ = fs::remove_dir_all(&dir);
    }
}
