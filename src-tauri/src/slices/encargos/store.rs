use crate::slices::desktop_control::policy::fold_ascii_spanish;
use crate::slices::workspace_manager::sandbox::{
    WorkspaceZone, resolve_inside_workspace, write_string_atomic,
};
use chrono::{DateTime, Duration as ChronoDuration, Local, Utc};
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const ENCARGOS_DIR: &str = "agente/encargos";
const MAX_NAME_CHARS: usize = 80;
const MAX_STEPS: usize = 20;
const MAX_FILES: usize = 10;
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Acciones finales que un encargo nunca hace solo, aunque la instrucción lo pida.
/// Se revisan con las pruebas reales (claude/DECISIONES.md, 2026-11-23).
const BLOCKED_FINAL_ACTION_PHRASES: &[&str] = &[
    "pagar",
    "pay",
    "comprar",
    "buy",
    "transferir",
    "transfer",
    "eliminar",
    "borrar",
    "delete",
    "remove",
    "vaciar papelera",
    "empty trash",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncargoDto {
    pub id: String,
    pub name: String,
    pub instruction: String,
    pub steps: Vec<String>,
    pub files: Vec<String>,
    pub folder: String,
    pub next_run_at: Option<String>,
    pub recurrence: Option<String>,
    pub target_app: Option<String>,
    pub may_finish: bool,
    pub final_action: Option<String>,
    pub status: String,
    pub source_card_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn str_field<'a>(sp: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| sp.get(*k).and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn str_list(sp: &Value, key: &str) -> Vec<String> {
    sp.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn blocked_final_action_phrase(raw: &str) -> Option<&'static str> {
    let padded = format!(" {} ", fold_ascii_spanish(raw).trim());
    BLOCKED_FINAL_ACTION_PHRASES
        .iter()
        .find(|phrase| padded.contains(&format!(" {phrase} ")))
        .copied()
}

fn slugify(raw: &str) -> String {
    let folded = fold_ascii_spanish(raw);
    let mut slug = folded.split_whitespace().collect::<Vec<_>>().join("-");
    if slug.len() > 48 {
        slug.truncate(48);
        slug = slug.trim_end_matches('-').to_string();
    }
    if slug.is_empty() {
        "pendiente".to_string()
    } else {
        slug
    }
}

fn normalize_recurrence(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    let lower = value.to_lowercase();
    if lower.is_empty() || lower == "una vez" || lower == "unico" || lower == "único" {
        None
    } else {
        Some(value.to_string())
    }
}

fn local_label(rfc3339: &str) -> String {
    DateTime::parse_from_rfc3339(rfc3339)
        .map(|dt| {
            dt.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| rfc3339.to_string())
}

/// Elige `agente/encargos/<slug>` sin pisar la carpeta de otro encargo.
fn allocate_folder(workspace_root: &Path, slug: &str) -> Result<String, String> {
    for n in 1..=50 {
        let rel = if n == 1 {
            format!("{ENCARGOS_DIR}/{slug}")
        } else {
            format!("{ENCARGOS_DIR}/{slug}-{n}")
        };
        let (abs, _, _) = resolve_inside_workspace(workspace_root, &rel, false)?;
        if !abs.exists() {
            return Ok(rel);
        }
    }
    Err(format!("Ya hay demasiados pendientes llamados \"{slug}\"."))
}

struct SourceFile {
    original: String,
    abs: PathBuf,
    file_name: String,
}

fn check_source_file(workspace_root: &Path, src_rel: &str) -> Result<SourceFile, String> {
    let (abs, clean, zone) = resolve_inside_workspace(workspace_root, src_rel, false)?;
    if matches!(zone, WorkspaceZone::Meta) {
        return Err(format!(
            "No se pueden usar archivos internos de XOOK: {src_rel}"
        ));
    }
    let meta = fs::metadata(&abs)
        .map_err(|_| format!("No encontré el archivo \"{src_rel}\" en el espacio de trabajo."))?;
    if !meta.is_file() {
        return Err(format!("\"{src_rel}\" no es un archivo."));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("\"{src_rel}\" pesa más de 50 MB."));
    }
    let file_name = clean
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| format!("Ruta de archivo inválida: {src_rel}"))?;
    Ok(SourceFile {
        original: src_rel.to_string(),
        abs,
        file_name,
    })
}

/// Copia los archivos del encargo a su carpeta para que no cambien antes de la hora.
/// Devuelve las rutas copiadas, relativas al workspace.
fn copy_files_into(
    workspace_root: &Path,
    folder_rel: &str,
    sources: &[SourceFile],
) -> Result<Vec<String>, String> {
    let mut copied = Vec::with_capacity(sources.len());
    for src in sources {
        let mut dst_rel = format!("{folder_rel}/archivos/{}", src.file_name);
        let mut n = 2;
        while copied.contains(&dst_rel) {
            dst_rel = format!("{folder_rel}/archivos/{n}-{}", src.file_name);
            n += 1;
        }
        let (abs_dst, _, _) = resolve_inside_workspace(workspace_root, &dst_rel, false)?;
        if let Some(parent) = abs_dst.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("No se pudo crear la carpeta del pendiente: {e}"))?;
        }
        fs::copy(&src.abs, &abs_dst)
            .map_err(|e| format!("No se pudo copiar \"{}\": {e}", src.original))?;
        copied.push(dst_rel);
    }
    Ok(copied)
}

fn render_encargo_md(encargo: &EncargoDto, original_files: &[String]) -> String {
    let when = encargo
        .next_run_at
        .as_deref()
        .map(local_label)
        .unwrap_or_else(|| "sin hora".to_string());
    let repeat = encargo.recurrence.as_deref().unwrap_or("una vez");
    let finish = if encargo.may_finish {
        format!(
            "lo dejo hecho: {}",
            encargo.final_action.as_deref().unwrap_or("acción final")
        )
    } else {
        "lo dejo listo, sin el último clic".to_string()
    };

    let mut md = format!(
        "# {}\n\n- **Cuándo:** {when} ({repeat})\n- **App:** {}\n- **Al final:** {finish}\n\n## Instrucción\n\n> {}\n",
        encargo.name,
        encargo.target_app.as_deref().unwrap_or("—"),
        encargo.instruction.replace('\n', "\n> "),
    );
    if !encargo.steps.is_empty() {
        md.push_str("\n## Pasos\n\n");
        for (i, step) in encargo.steps.iter().enumerate() {
            md.push_str(&format!("{}. {step}\n", i + 1));
        }
    }
    if !encargo.files.is_empty() {
        md.push_str("\n## Archivos\n\n");
        for (copy, original) in encargo.files.iter().zip(original_files) {
            let local = copy
                .strip_prefix(&format!("{}/", encargo.folder))
                .unwrap_or(copy);
            md.push_str(&format!("- `{local}` (copiado de `{original}`)\n"));
        }
    }
    md
}

struct ParsedEncargo {
    name: String,
    instruction: String,
    steps: Vec<String>,
    sources: Vec<SourceFile>,
    next_run: DateTime<Utc>,
    recurrence: Option<String>,
    target_app: Option<String>,
    may_finish: bool,
    final_action: Option<String>,
}

fn parse_staging(
    workspace_root: &Path,
    sp: &Value,
    now: DateTime<Utc>,
) -> Result<ParsedEncargo, String> {
    let name: String = str_field(sp, &["name"])
        .ok_or("El pendiente no tiene nombre.")?
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let instruction = str_field(sp, &["instruction"])
        .ok_or("El pendiente no tiene instrucción.")?
        .to_string();
    let steps: Vec<String> = str_list(sp, "steps").into_iter().take(MAX_STEPS).collect();
    let raw_sources = str_list(sp, "files");
    if raw_sources.len() > MAX_FILES {
        return Err(format!("Un pendiente admite hasta {MAX_FILES} archivos."));
    }
    let sources = raw_sources
        .iter()
        .map(|src| check_source_file(workspace_root, src))
        .collect::<Result<Vec<_>, _>>()?;

    let next_run_raw =
        str_field(sp, &["nextRunAt", "next_run_at"]).ok_or("El pendiente no tiene hora.")?;
    let next_run = DateTime::parse_from_rfc3339(next_run_raw)
        .map_err(|_| format!("Hora inválida: {next_run_raw}"))?
        .with_timezone(&Utc);
    if next_run < now - ChronoDuration::minutes(1) {
        return Err(format!(
            "La hora del pendiente ya pasó ({}). Pídele a Xox que lo programe de nuevo.",
            local_label(next_run_raw)
        ));
    }

    let may_finish = sp
        .get("mayFinish")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let final_action = str_field(sp, &["finalAction", "final_action"]).map(str::to_string);
    if may_finish {
        let action = final_action
            .as_deref()
            .ok_or("Falta decir cuál es el último clic (por ejemplo, \"Entregar\").")?;
        if let Some(phrase) = blocked_final_action_phrase(action) {
            return Err(format!(
                "Xox todavía no puede \"{phrase}\" por su cuenta. Pídele que lo deje listo y tú das el último clic."
            ));
        }
    }

    Ok(ParsedEncargo {
        name,
        instruction,
        steps,
        sources,
        next_run,
        recurrence: normalize_recurrence(str_field(sp, &["recurrence"])),
        target_app: str_field(sp, &["targetApp", "target_app"]).map(str::to_string),
        may_finish,
        final_action,
    })
}

/// Revisa la tarjeta antes de registrar la decisión, para que una aprobación que no se
/// puede cumplir (hora pasada, archivo borrado) deje la tarjeta pendiente y no a medias.
pub fn validate_staging(
    workspace_root: &Path,
    sp: &Value,
    now: DateTime<Utc>,
) -> Result<(), String> {
    parse_staging(workspace_root, sp, now).map(|_| ())
}

/// Crea el encargo que el usuario aprobó en la tarjeta: valida, crea su carpeta con
/// `encargo.md` y la copia de los archivos, y lo guarda como `programado`.
pub fn create_from_staging(
    conn: &Connection,
    workspace_root: &Path,
    sp: &Value,
    source_card_id: &str,
    now: DateTime<Utc>,
) -> Result<EncargoDto, String> {
    let ParsedEncargo {
        name,
        instruction,
        steps,
        sources,
        next_run,
        recurrence,
        target_app,
        may_finish,
        final_action,
    } = parse_staging(workspace_root, sp, now)?;

    let folder = allocate_folder(workspace_root, &slugify(&name))?;
    let files = match copy_files_into(workspace_root, &folder, &sources) {
        Ok(files) => files,
        Err(e) => {
            remove_folder(workspace_root, &folder);
            return Err(e);
        }
    };
    let now_iso = now.to_rfc3339();
    let folder_slug = folder.rsplit('/').next().unwrap_or("pendiente").to_string();

    let encargo = EncargoDto {
        id: format!("enc_{}_{folder_slug}", now.timestamp_millis()),
        name,
        instruction,
        steps,
        files,
        folder,
        next_run_at: Some(next_run.to_rfc3339()),
        recurrence,
        target_app,
        may_finish,
        final_action,
        status: "programado".to_string(),
        source_card_id: Some(source_card_id.to_string()),
        created_at: now_iso.clone(),
        updated_at: now_iso,
    };

    let md_written = resolve_inside_workspace(
        workspace_root,
        &format!("{}/encargo.md", encargo.folder),
        false,
    )
    .and_then(|(abs_md, _, _)| {
        let originals: Vec<String> = sources.iter().map(|s| s.original.clone()).collect();
        write_string_atomic(&abs_md, &render_encargo_md(&encargo, &originals))
    });
    if let Err(e) = md_written {
        remove_folder(workspace_root, &encargo.folder);
        return Err(e);
    }

    let inserted = conn.execute(
        "INSERT INTO encargos (
            id, name, instruction, steps_json, files_json, folder, next_run_at, recurrence,
            target_app, may_finish, final_action, status, source_card_id, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            encargo.id,
            encargo.name,
            encargo.instruction,
            serde_json::to_string(&encargo.steps).unwrap_or_else(|_| "[]".to_string()),
            serde_json::to_string(&encargo.files).unwrap_or_else(|_| "[]".to_string()),
            encargo.folder,
            encargo.next_run_at,
            encargo.recurrence,
            encargo.target_app,
            encargo.may_finish,
            encargo.final_action,
            encargo.status,
            encargo.source_card_id,
            encargo.created_at,
            encargo.updated_at,
        ],
    );
    if let Err(e) = inserted {
        remove_folder(workspace_root, &encargo.folder);
        return Err(format!("No se pudo guardar el pendiente: {e}"));
    }
    Ok(encargo)
}

/// Deshace la carpeta de un encargo que no se pudo terminar de crear.
fn remove_folder(workspace_root: &Path, folder_rel: &str) {
    if let Ok((abs_folder, _, _)) = resolve_inside_workspace(workspace_root, folder_rel, false) {
        let _ = fs::remove_dir_all(abs_folder);
    }
}

fn row_to_encargo(row: &Row<'_>) -> rusqlite::Result<EncargoDto> {
    let steps_raw: String = row.get(3)?;
    let files_raw: String = row.get(4)?;
    Ok(EncargoDto {
        id: row.get(0)?,
        name: row.get(1)?,
        instruction: row.get(2)?,
        steps: serde_json::from_str(&steps_raw).unwrap_or_default(),
        files: serde_json::from_str(&files_raw).unwrap_or_default(),
        folder: row.get(5)?,
        next_run_at: row.get(6)?,
        recurrence: row.get(7)?,
        target_app: row.get(8)?,
        may_finish: row.get(9)?,
        final_action: row.get(10)?,
        status: row.get(11)?,
        source_card_id: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

/// Encargos ordenados por la hora de su próxima ejecución.
pub fn list_encargos(conn: &Connection) -> Result<Vec<EncargoDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, instruction, steps_json, files_json, folder, next_run_at, recurrence,
                    target_app, may_finish, final_action, status, source_card_id, created_at, updated_at
             FROM encargos
             ORDER BY next_run_at IS NULL, next_run_at ASC",
        )
        .map_err(|e| format!("Error consultando pendientes: {e}"))?;
    let rows = stmt
        .query_map([], row_to_encargo)
        .map_err(|e| format!("Error leyendo pendientes: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error leyendo pendientes: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;
    use serde_json::json;
    use std::path::PathBuf;

    fn temp_ws(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xook_encargos_test_{label}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        scaffold_workspace_dir(&dir, "ws_test", "Prueba").unwrap();
        dir
    }

    fn staging(next_run: DateTime<Utc>) -> Value {
        json!({
            "kind": "encargo",
            "name": "Práctica 3 · Física",
            "instruction": "Entrega reporte.pdf a las 4 en Teams, actividad Práctica 3",
            "steps": ["Abrir Teams", "Entrar a Tareas › Práctica 3", "Adjuntar reporte.pdf", "Comprobar el archivo", "Entregar"],
            "files": ["datos/reporte.pdf"],
            "nextRunAt": next_run.to_rfc3339(),
            "recurrence": "Una vez",
            "targetApp": "Microsoft Teams",
            "mayFinish": true,
            "finalAction": "Entregar · Práctica 3"
        })
    }

    #[test]
    fn creates_encargo_with_folder_md_and_copied_files() {
        let root = temp_ws("create");
        let conn = open_workspace_db(&root).unwrap();
        fs::write(root.join("datos/reporte.pdf"), b"%PDF-1.4 prueba").unwrap();
        let now = Utc::now();

        let enc = create_from_staging(
            &conn,
            &root,
            &staging(now + ChronoDuration::hours(2)),
            "card_1",
            now,
        )
        .unwrap();

        assert_eq!(enc.folder, "agente/encargos/practica-3-fisica");
        assert_eq!(
            enc.files,
            vec!["agente/encargos/practica-3-fisica/archivos/reporte.pdf"]
        );
        assert_eq!(enc.recurrence, None);
        assert!(enc.may_finish);
        assert_eq!(enc.status, "programado");
        assert!(root.join(&enc.files[0]).is_file());

        let md = fs::read_to_string(root.join(&enc.folder).join("encargo.md")).unwrap();
        assert!(md.contains("# Práctica 3 · Física"));
        assert!(md.contains("lo dejo hecho: Entregar · Práctica 3"));
        assert!(md.contains("3. Adjuntar reporte.pdf"));
        assert!(md.contains("(copiado de `datos/reporte.pdf`)"));

        let listed = list_encargos(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].steps.len(), 5);
        assert_eq!(listed[0].source_card_id.as_deref(), Some("card_1"));

        // Un segundo pendiente con el mismo nombre no pisa la carpeta del primero.
        let second = create_from_staging(
            &conn,
            &root,
            &staging(now + ChronoDuration::hours(3)),
            "card_2",
            now,
        )
        .unwrap();
        assert_eq!(second.folder, "agente/encargos/practica-3-fisica-2");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_past_time_missing_file_and_money_final_action() {
        let root = temp_ws("reject");
        let conn = open_workspace_db(&root).unwrap();
        fs::write(root.join("datos/reporte.pdf"), b"%PDF-1.4 prueba").unwrap();
        let now = Utc::now();

        let past = create_from_staging(
            &conn,
            &root,
            &staging(now - ChronoDuration::hours(1)),
            "c",
            now,
        );
        assert!(past.unwrap_err().contains("ya pasó"));

        let mut missing = staging(now + ChronoDuration::hours(1));
        missing["files"] = json!(["datos/no-existe.pdf"]);
        assert!(create_from_staging(&conn, &root, &missing, "c", now).is_err());

        let mut pay = staging(now + ChronoDuration::hours(1));
        pay["finalAction"] = json!("Pagar factura");
        assert!(
            create_from_staging(&conn, &root, &pay, "c", now)
                .unwrap_err()
                .contains("pagar")
        );

        let mut no_action = staging(now + ChronoDuration::hours(1));
        no_action["finalAction"] = Value::Null;
        assert!(create_from_staging(&conn, &root, &no_action, "c", now).is_err());

        let mut outside = staging(now + ChronoDuration::hours(1));
        outside["files"] = json!(["../fuera.pdf"]);
        assert!(create_from_staging(&conn, &root, &outside, "c", now).is_err());

        // Nada de lo rechazado deja filas en la base de datos.
        assert!(list_encargos(&conn).unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn without_may_finish_the_final_action_is_not_checked() {
        let root = temp_ws("ready_only");
        let conn = open_workspace_db(&root).unwrap();
        let now = Utc::now();
        let mut sp = staging(now + ChronoDuration::hours(1));
        sp["files"] = json!([]);
        sp["mayFinish"] = json!(false);
        sp["finalAction"] = Value::Null;

        let enc = create_from_staging(&conn, &root, &sp, "c", now).unwrap();
        assert!(!enc.may_finish);
        let md = fs::read_to_string(root.join(&enc.folder).join("encargo.md")).unwrap();
        assert!(md.contains("lo dejo listo, sin el último clic"));
        let _ = fs::remove_dir_all(&root);
    }
}
