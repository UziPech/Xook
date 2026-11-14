use super::store::{
    self, DecisionHistoryDto, UpsertTaskPayload, record_audit_event_conn,
};
use crate::ai_vault;
use crate::slices::workspace_manager::registry::{
    is_valid_core_file_content, read_business_summary, read_permissions_rule_count,
    scaffold_and_heal_workspace_dir, snapshot_core_file,
};
use crate::slices::workspace_manager::sandbox::{
    WorkspaceZone, is_protected_workspace_rel_path, resolve_inside_workspace, write_string_atomic,
};
use chrono::{DateTime, Duration as ChronoDuration, Local, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_COOLDOWN_HOURS: i64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemDto {
    pub sku: String,
    pub name: String,
    pub category: Option<String>,
    pub current_stock: f64,
    pub unit: String,
    pub avg_daily_sales: f64,
    pub cost_unit: f64,
    pub currency: String,
    pub supplier_id: Option<String>,
    pub min_stock_days: Option<i64>,
    pub source_file: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunDto {
    pub id: String,
    pub review_type: String,
    pub trigger_source: String,
    pub status: String,
    pub sources_scanned: Vec<String>,
    pub findings_count: i64,
    pub summary: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportInventoryResult {
    pub imported_count: usize,
    pub file_path: String,
    pub items: Vec<InventoryItemDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReviewResult {
    pub review_run: ReviewRunDto,
    pub report_path: Option<String>,
    pub analyzed_items_count: usize,
    pub skipped_duplicates_count: usize,
    pub new_tasks_count: usize,
    pub summary: String,
}

#[derive(Debug, Clone)]
struct ParsedInventoryRow {
    sku: String,
    name: String,
    category: Option<String>,
    current_stock: f64,
    unit: String,
    avg_daily_sales: f64,
    cost_unit: f64,
    currency: String,
    supplier_id: Option<String>,
    min_stock_days: Option<i64>,
    source_file: String,
}

fn normalize_header_key(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.trim().to_lowercase().chars() {
        let mapped = match ch {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            ' ' | '-' => '_',
            _ => ch,
        };
        out.push(mapped);
    }
    match out.as_str() {
        "sku" | "codigo" | "code" | "id" => "sku",
        "name" | "nombre" | "producto" | "product" | "product_name" => "name",
        "category" | "categoria" => "category",
        "current_stock" | "stock" | "existencia" | "existencias" | "cantidad" | "qty" => {
            "current_stock"
        }
        "unit" | "unidad" => "unit",
        "avg_daily_sales" | "daily_sales" | "venta_diaria" | "ventas_diarias" | "consumo_diario" => {
            "avg_daily_sales"
        }
        "cost_unit" | "unit_cost" | "costo" | "costo_unitario" | "precio_costo" | "price" => {
            "cost_unit"
        }
        "currency" | "moneda" => "currency",
        "supplier_id" | "supplier" | "proveedor" | "proveedor_id" => "supplier_id",
        "min_stock_days" | "dias_minimos" | "min_days" => "min_stock_days",
        other => other,
    }
    .to_string()
}

fn parse_float_loose(raw: &str, default: f64) -> f64 {
    let cleaned = raw.trim().replace(['$', ','], "");
    if cleaned.is_empty() {
        return default;
    }
    cleaned.parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(default)
}

fn parse_csv_line(line: &str, delimiter: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut curr = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if ch == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                curr.push('"');
                chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == delimiter && !in_quotes {
            fields.push(curr.trim().to_string());
            curr.clear();
        } else {
            curr.push(ch);
        }
    }
    fields.push(curr.trim().to_string());
    fields
}

fn detect_delimiter(first_line: &str, is_tsv: bool) -> char {
    if is_tsv {
        return '\t';
    }
    for delim in [',', ';', '\t', '|'] {
        if first_line.contains(delim) {
            return delim;
        }
    }
    ','
}

fn slug_upper(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_uppercase());
        } else if !out.ends_with('_') && !out.is_empty() {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

fn row_from_map(
    map: &HashMap<String, String>,
    source_file: &str,
    default_currency: &str,
    idx: usize,
) -> Option<ParsedInventoryRow> {
    let mut name = map.get("name").map(|s| s.trim()).unwrap_or("").to_string();
    let mut sku = map.get("sku").map(|s| s.trim()).unwrap_or("").to_string();
    if name.is_empty() && sku.is_empty() {
        return None;
    }
    if name.is_empty() {
        name = sku.clone();
    }
    if sku.is_empty() {
        let base = slug_upper(&name);
        sku = if base.is_empty() {
            format!("ITEM_{}", idx + 1)
        } else {
            format!("{base}_{}", idx + 1)
        };
    }

    let category = map
        .get("category")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let current_stock = map
        .get("current_stock")
        .map(|s| parse_float_loose(s, 0.0).max(0.0))
        .unwrap_or(0.0);
    let unit = map
        .get("unit")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "un.".to_string());
    let avg_daily_sales = map
        .get("avg_daily_sales")
        .map(|s| parse_float_loose(s, 0.0).max(0.0))
        .unwrap_or(0.0);
    let cost_unit = map
        .get("cost_unit")
        .map(|s| parse_float_loose(s, 0.0).max(0.0))
        .unwrap_or(0.0);
    let currency = map
        .get("currency")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_currency.to_string());
    let supplier_id = map
        .get("supplier_id")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let min_stock_days = map
        .get("min_stock_days")
        .and_then(|s| s.trim().parse::<f64>().ok())
        .map(|v| v.round().max(1.0) as i64);

    Some(ParsedInventoryRow {
        sku,
        name,
        category,
        current_stock,
        unit,
        avg_daily_sales,
        cost_unit,
        currency,
        supplier_id,
        min_stock_days,
        source_file: source_file.to_string(),
    })
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => v.to_string(),
    }
}

fn parse_inventory_text(
    content: &str,
    rel_file: &str,
    default_currency: &str,
) -> Result<Vec<ParsedInventoryRow>, String> {
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Err("El archivo de inventario está vacío.".to_string());
    }

    let is_json = rel_file.to_ascii_lowercase().ends_with(".json")
        || trimmed.starts_with('[')
        || trimmed.starts_with('{');
    if is_json {
        let parsed: Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("El JSON de inventario no es válido: {e}"))?;
        let arr = if let Some(list) = parsed.as_array() {
            list.clone()
        } else if let Some(list) = parsed
            .get("items")
            .or_else(|| parsed.get("inventory"))
            .or_else(|| parsed.get("productos"))
            .and_then(|v| v.as_array())
        {
            list.clone()
        } else {
            return Err("El JSON debe ser una lista de productos o incluir la clave 'items'.".to_string());
        };

        let mut rows = Vec::new();
        for (idx, item) in arr.iter().enumerate() {
            let Some(obj) = item.as_object() else { continue };
            let mut map = HashMap::new();
            for (k, v) in obj {
                let canon = normalize_header_key(k);
                map.entry(canon).or_insert_with(|| value_to_string(v));
            }
            if let Some(r) = row_from_map(&map, rel_file, default_currency, idx) {
                rows.push(r);
            }
        }
        return Ok(rows);
    }

    let mut lines_iter = trimmed.lines().filter(|l| !l.trim().is_empty());
    let Some(header_line) = lines_iter.next() else {
        return Err("El archivo CSV no contiene encabezados.".to_string());
    };
    let delimiter = detect_delimiter(header_line, rel_file.to_ascii_lowercase().ends_with(".tsv"));
    let headers: Vec<String> = parse_csv_line(header_line, delimiter)
        .into_iter()
        .map(|h| normalize_header_key(&h))
        .collect();

    if headers.is_empty() {
        return Err("No se detectaron columnas válidas en el CSV.".to_string());
    }

    let mut rows = Vec::new();
    for (idx, line) in lines_iter.enumerate() {
        let cols = parse_csv_line(line, delimiter);
        let mut map = HashMap::new();
        for (col_idx, header) in headers.iter().enumerate() {
            if let Some(val) = cols.get(col_idx) {
                if !header.is_empty() && !map.contains_key(header) {
                    map.insert(header.clone(), val.clone());
                }
            }
        }
        if let Some(r) = row_from_map(&map, rel_file, default_currency, idx) {
            rows.push(r);
        }
    }
    Ok(rows)
}

fn upsert_inventory_rows(
    conn: &mut Connection,
    rows: &[ParsedInventoryRow],
    actor: &str,
    source_rel: &str,
    now: DateTime<Utc>,
) -> Result<(), String> {
    if rows.is_empty() {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Error iniciando transacción de inventario: {e}"))?;
    let now_iso = now.to_rfc3339();
    for r in rows {
        tx.execute(
            "INSERT INTO inventory_items (
                sku, name, category, current_stock, unit, avg_daily_sales,
                cost_unit, currency, supplier_id, min_stock_days, source_file, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(sku) DO UPDATE SET
                name = excluded.name,
                category = COALESCE(excluded.category, inventory_items.category),
                current_stock = excluded.current_stock,
                unit = excluded.unit,
                avg_daily_sales = excluded.avg_daily_sales,
                cost_unit = excluded.cost_unit,
                currency = excluded.currency,
                supplier_id = COALESCE(excluded.supplier_id, inventory_items.supplier_id),
                min_stock_days = COALESCE(excluded.min_stock_days, inventory_items.min_stock_days),
                source_file = excluded.source_file,
                updated_at = excluded.updated_at",
            params![
                r.sku,
                r.name,
                r.category,
                r.current_stock,
                r.unit,
                r.avg_daily_sales,
                r.cost_unit,
                r.currency,
                r.supplier_id,
                r.min_stock_days,
                r.source_file,
                now_iso
            ],
        )
        .map_err(|e| format!("Error guardando SKU '{}' en SQLite: {e}", r.sku))?;
    }
    record_audit_event_conn(
        &tx,
        actor,
        "inventory_synced",
        source_rel,
        "datos",
        Some(&format!("{} artículo(s) actualizados", rows.len())),
        now,
    )?;
    tx.commit()
        .map_err(|e| format!("Error confirmando inventario en SQLite: {e}"))
}

pub fn list_inventory_items(conn: &Connection) -> Result<Vec<InventoryItemDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT sku, name, category, current_stock, unit, avg_daily_sales, cost_unit, currency, supplier_id, min_stock_days, source_file, updated_at
             FROM inventory_items
             ORDER BY name ASC",
        )
        .map_err(|e| format!("Error preparando consulta de inventario: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(InventoryItemDto {
                sku: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                current_stock: row.get(3)?,
                unit: row.get(4)?,
                avg_daily_sales: row.get(5)?,
                cost_unit: row.get(6)?,
                currency: row.get(7)?,
                supplier_id: row.get(8)?,
                min_stock_days: row.get(9)?,
                source_file: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Error leyendo inventory_items: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando inventory_items: {e}"))
}

pub fn list_review_runs(conn: &Connection, limit: Option<i64>) -> Result<Vec<ReviewRunDto>, String> {
    let lim = limit.unwrap_or(20).clamp(1, 200);
    let mut stmt = conn
        .prepare(
            "SELECT id, review_type, trigger_source, status, sources_scanned_json, findings_count, summary, started_at, finished_at
             FROM review_runs
             ORDER BY started_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("Error preparando consulta de review_runs: {e}"))?;
    let rows = stmt
        .query_map(params![lim], |row| {
            let sources_raw: String = row.get(4)?;
            let sources_scanned =
                serde_json::from_str::<Vec<String>>(&sources_raw).unwrap_or_default();
            Ok(ReviewRunDto {
                id: row.get(0)?,
                review_type: row.get(1)?,
                trigger_source: row.get(2)?,
                status: row.get(3)?,
                sources_scanned,
                findings_count: row.get(5)?,
                summary: row.get(6)?,
                started_at: row.get(7)?,
                finished_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Error leyendo review_runs: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error mapeando review_runs: {e}"))
}

pub fn import_inventory_file_at(
    conn: &mut Connection,
    workspace_root: &Path,
    filename: Option<&str>,
    content: &str,
    now: DateTime<Utc>,
) -> Result<ImportInventoryResult, String> {
    let summary = read_business_summary(workspace_root, "Xox");
    let raw_name = filename.map(str::trim).filter(|s| !s.is_empty()).unwrap_or("");
    let default_ext = if content.trim_start().starts_with('[') || content.trim_start().starts_with('{') {
        "inventario.json"
    } else {
        "inventario.csv"
    };
    let clean_base = if raw_name.is_empty() {
        default_ext.to_string()
    } else {
        Path::new(raw_name)
            .file_name()
            .and_then(|n| n.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(default_ext)
            .to_string()
    };
    let rel_target = format!("datos/{clean_base}");
    let (abs_path, clean_rel, zone) = resolve_inside_workspace(workspace_root, &rel_target, false)?;
    if zone != WorkspaceZone::Datos {
        return Err("Los archivos de inventario solo pueden importarse dentro de datos/.".to_string());
    }
    let rel_str = clean_rel.to_string_lossy().replace('\\', "/");
    let rows = parse_inventory_text(content, &rel_str, &summary.currency)?;
    if rows.is_empty() {
        return Err("No se encontraron artículos válidos en el archivo proporcionado.".to_string());
    }

    write_string_atomic(&abs_path, content)?;
    upsert_inventory_rows(conn, &rows, "user", &rel_str, now)?;
    let items = list_inventory_items(conn)?;
    Ok(ImportInventoryResult {
        imported_count: rows.len(),
        file_path: rel_str,
        items,
    })
}

fn collect_datos_files(dir: &Path, root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_datos_files(&p, root, out);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let lower = ext.to_ascii_lowercase();
            if matches!(lower.as_str(), "csv" | "tsv" | "json") {
                out.push(p);
            }
        }
    }
}

pub fn sync_datos_files_into_db(
    conn: &mut Connection,
    workspace_root: &Path,
    now: DateTime<Utc>,
) -> Result<usize, String> {
    let datos_dir = workspace_root.join("datos");
    if !datos_dir.is_dir() {
        return Ok(0);
    }
    let summary = read_business_summary(workspace_root, "Xox");
    let mut files = Vec::new();
    collect_datos_files(&datos_dir, workspace_root, &mut files);
    files.sort();

    let mut total = 0usize;
    for file_path in files {
        let Ok(rel) = file_path.strip_prefix(workspace_root) else {
            continue;
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let Ok(raw) = fs::read_to_string(&file_path) else {
            continue;
        };
        if let Ok(rows) = parse_inventory_text(&raw, &rel_str, &summary.currency) {
            if !rows.is_empty() {
                upsert_inventory_rows(conn, &rows, "system", &rel_str, now)?;
                total += rows.len();
            }
        }
    }
    Ok(total)
}

fn collect_dedup_sets(
    conn: &Connection,
    now: DateTime<Utc>,
) -> Result<(Vec<String>, Vec<String>), String> {
    let cutoff_iso = (now - ChronoDuration::hours(DEFAULT_COOLDOWN_HOURS)).to_rfc3339();
    let mut pending = Vec::new();
    let mut recent = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT dedup_key, status, updated_at
             FROM tasks
             WHERE dedup_key IS NOT NULL AND TRIM(dedup_key) != ''",
        )
        .map_err(|e| format!("Error consultando claves de deduplicación: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Error iterando claves de deduplicación: {e}"))?;
    for row in rows.flatten() {
        if row.1 == "pending" {
            pending.push(row.0);
        } else if row.2 >= cutoff_iso {
            recent.push(row.0);
        }
    }
    Ok((pending, recent))
}

fn native_deterministic_review(
    conn: &Connection,
    workspace_root: &Path,
    trigger_source: &str,
    pending_keys: &[String],
    recent_keys: &[String],
    now: DateTime<Utc>,
) -> Result<Value, String> {
    let items = list_inventory_items(conn)?;
    let summary_cfg = read_business_summary(workspace_root, "Xox");
    let pending_set: HashSet<&str> = pending_keys.iter().map(String::as_str).collect();
    let recent_set: HashSet<&str> = recent_keys.iter().map(String::as_str).collect();

    let suppliers_raw = fs::read_to_string(workspace_root.join("empresa/proveedores.json")).ok();
    let suppliers_json: Value = suppliers_raw
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| json!({}));
    let suppliers_arr = suppliers_json
        .get("suppliers")
        .or_else(|| suppliers_json.get("proveedores"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut sources = vec!["empresa/perfil.json".to_string(), "empresa/proveedores.json".to_string()];
    if !items.is_empty() {
        sources.push(".xook/xook.db:inventory_items".to_string());
    }

    let mut tasks = Vec::new();
    let mut skipped_dups = 0usize;
    let ts_tag = Local::now().format("%Y%m%d-%H%M%S").to_string();

    for (idx, item) in items.iter().enumerate() {
        let matched_sup = item.supplier_id.as_deref().and_then(|sid| {
            let sid_l = sid.to_lowercase();
            suppliers_arr.iter().find(|s| {
                s.get("id")
                    .and_then(|v| v.as_str())
                    .map(|x| x.to_lowercase() == sid_l)
                    .unwrap_or(false)
                    || s.get("name")
                        .and_then(|v| v.as_str())
                        .map(|x| x.to_lowercase() == sid_l)
                        .unwrap_or(false)
            })
        });
        let lead_time = matched_sup
            .and_then(|s| s.get("delivery_lead_time_days").and_then(|v| v.as_i64()))
            .unwrap_or(3)
            .max(1);
        let sup_name = matched_sup
            .and_then(|s| s.get("name").and_then(|v| v.as_str()))
            .map(str::to_string)
            .unwrap_or_else(|| {
                item.supplier_id
                    .clone()
                    .unwrap_or_else(|| "Sin proveedor asignado".to_string())
            });

        let threshold = item
            .min_stock_days
            .unwrap_or(i64::from(summary_cfg.stock_threshold_days))
            .max(lead_time);
        let days_left = if item.avg_daily_sales > 0.0 {
            (item.current_stock / item.avg_daily_sales * 10.0).round() / 10.0
        } else if item.current_stock <= 0.0 {
            0.0
        } else {
            999.0
        };

        let needs_reorder = item.current_stock <= 0.0
            || (item.avg_daily_sales > 0.0 && days_left <= threshold as f64);
        if !needs_reorder {
            continue;
        }

        let dedup_key = format!("stock_reorder:{}", item.sku);
        if pending_set.contains(dedup_key.as_str()) || recent_set.contains(dedup_key.as_str()) {
            skipped_dups += 1;
            continue;
        }

        let target_days = (threshold * 2).max(14) as f64;
        let qty = if item.avg_daily_sales > 0.0 {
            ((target_days * item.avg_daily_sales) - item.current_stock)
                .round()
                .max(1.0) as i64
        } else {
            10
        };
        let total = (qty as f64 * item.cost_unit * 100.0).round() / 100.0;
        let urgency = if item.current_stock <= 0.0 || days_left <= lead_time.max(2) as f64 {
            "alta"
        } else {
            "media"
        };
        let card_id = format!("rev_{ts_tag}_{}", idx + 1);

        tasks.push(json!({
            "cardId": card_id,
            "dedupKey": dedup_key,
            "title": format!("Reponer {}", item.name),
            "subtitle": format!("Stock actual: {} {} (~{} días)", item.current_stock, item.unit, days_left),
            "category": "abastecimiento",
            "urgency": urgency,
            "statusChip": if item.current_stock <= 0.0 { "Agotado".to_string() } else { format!("{days_left}d de stock") },
            "defaultExpanded": urgency == "alta",
            "generatedBy": "Revisión operativa",
            "blocks": [
                {
                    "type": "metrics_strip",
                    "items": [
                        { "label": "Stock actual", "value": format!("{} {}", item.current_stock, item.unit), "tone": if urgency == "alta" { "critical" } else { "warning" } },
                        { "label": "Sugerido", "value": format!("+{} {}", qty, item.unit), "tone": "neutral" },
                        { "label": "Total", "value": format!("${:.0} {}", total, item.currency), "tone": "positive", "bindTotalFromParam": "qty" }
                    ]
                },
                {
                    "type": "param_control",
                    "key": "qty",
                    "label": "Cantidad a pedir",
                    "kind": "stepper",
                    "value": qty,
                    "min": 1,
                    "max": (qty * 4).max(50),
                    "step": 1,
                    "unit": item.unit,
                    "unitPrice": item.cost_unit,
                    "currency": item.currency
                },
                {
                    "type": "kv_list",
                    "rows": [
                        { "label": "SKU", "value": item.sku },
                        { "label": "Proveedor", "value": sup_name, "subtle": format!("{lead_time}d entrega") },
                        { "label": "Fuente", "value": item.source_file.clone().unwrap_or_else(|| ".xook/xook.db".to_string()) }
                    ]
                }
            ],
            "intent": {
                "type": "stock_reorder",
                "targetLabel": format!("{} · {}", item.name, sup_name),
                "primaryLabel": "Aprobar orden",
                "quantityParamKey": "qty",
                "unitPrice": item.cost_unit,
                "currency": item.currency,
                "supplierName": sup_name,
                "maxBudgetLimit": summary_cfg.max_budget_per_order
            },
            "paramValues": { "qty": qty },
            "stagingPayload": {
                "kind": "purchase_order",
                "sku": item.sku,
                "productName": item.name,
                "category": item.category,
                "unit": item.unit,
                "currentStock": item.current_stock,
                "recommendedOrder": qty,
                "unitCost": item.cost_unit,
                "estimatedCost": total,
                "currency": item.currency,
                "supplierId": item.supplier_id,
                "supplierName": sup_name,
                "leadTimeDays": lead_time,
                "daysLeft": days_left
            }
        }));
    }

    let summary_text = if items.is_empty() {
        "No hay productos cargados todavía en datos/ ni en inventory_items.".to_string()
    } else {
        format!(
            "Se analizaron {} artículo(s) y se generaron {} propuesta(s) de reposición (duplicadas omitidas: {}).",
            items.len(),
            tasks.len(),
            skipped_dups
        )
    };

    let rel_report = format!("agente/revisiones/rev_{}.md", now.format("%Y%m%d-%H%M%S"));
    let report_abs = workspace_root.join(&rel_report);
    let report_body = format!(
        "# Revisión operativa ({trigger_source})\n\n- **Resumen:** {summary_text}\n- **Evaluados:** {}\n- **Hallazgos nuevos:** {}\n",
        items.len(),
        tasks.len()
    );
    write_string_atomic(&report_abs, &report_body)?;

    Ok(json!({
        "status": "ok",
        "review_type": "inventory_stock",
        "trigger_source": trigger_source,
        "summary": summary_text,
        "sources_scanned": sources,
        "analyzed_items_count": items.len(),
        "skipped_duplicates_count": skipped_dups,
        "findings_count": tasks.len(),
        "report_path": rel_report,
        "tasks": tasks
    }))
}

pub fn execute_workspace_review(
    conn: &mut Connection,
    workspace_root: &Path,
    trigger_source: &str,
    script_path: Option<&PathBuf>,
    now: DateTime<Utc>,
) -> Result<RunReviewResult, String> {
    let _ = sync_datos_files_into_db(conn, workspace_root, now)?;
    let (pending_keys, recent_keys) = collect_dedup_sets(conn, now)?;

    let run_id = format!("run_{}", now.timestamp_millis());
    let started_iso = now.to_rfc3339();
    conn.execute(
        "INSERT INTO review_runs (id, review_type, trigger_source, status, sources_scanned_json, findings_count, summary, started_at, finished_at)
         VALUES (?1, 'inventory_stock', ?2, 'running', '[]', 0, NULL, ?3, NULL)",
        params![run_id, trigger_source, started_iso],
    )
    .map_err(|e| format!("Error iniciando registro de revisión en SQLite: {e}"))?;

    let engine_res = if let Some(script) = script_path {
        ai_vault::call_python_sidecar(
            script,
            "run_business_review",
            json!({
                "workspace_root": workspace_root.to_string_lossy(),
                "trigger_source": trigger_source,
                "pending_dedup_keys": pending_keys,
                "recent_decided_dedup_keys": recent_keys,
            }),
        )
        .or_else(|_| {
            native_deterministic_review(
                conn,
                workspace_root,
                trigger_source,
                &pending_keys,
                &recent_keys,
                now,
            )
        })
    } else {
        native_deterministic_review(
            conn,
            workspace_root,
            trigger_source,
            &pending_keys,
            &recent_keys,
            now,
        )
    };

    let finished_at = Utc::now();
    let finished_iso = finished_at.to_rfc3339();

    let payload = match engine_res {
        Ok(val) => val,
        Err(err) => {
            let _ = conn.execute(
                "UPDATE review_runs SET status = 'error', summary = ?2, finished_at = ?3 WHERE id = ?1",
                params![run_id, err, finished_iso],
            );
            return Err(err);
        }
    };

    let sources: Vec<String> = payload
        .get("sources_scanned")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let sources_json = serde_json::to_string(&sources).unwrap_or_else(|_| "[]".to_string());
    let analyzed_items_count = payload
        .get("analyzed_items_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let skipped_duplicates_count = payload
        .get("skipped_duplicates_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let report_path = payload
        .get("report_path")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let summary_text = payload
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("Revisión operativa completada.")
        .to_string();

    let raw_tasks = payload
        .get("tasks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let upserts: Vec<UpsertTaskPayload> = raw_tasks
        .into_iter()
        .map(|proposal| {
            let dedup_key = proposal
                .get("dedupKey")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let staging_payload = proposal.get("stagingPayload").cloned();
            UpsertTaskPayload {
                proposal,
                dedup_key,
                review_run_id: Some(run_id.clone()),
                status: Some("pending".to_string()),
                staging_payload,
            }
        })
        .collect();

    let saved = if upserts.is_empty() {
        Vec::new()
    } else {
        store::upsert_tasks_batch(conn, upserts, false, finished_at)?
    };
    let findings_count = saved.len() as i64;

    conn.execute(
        "UPDATE review_runs
         SET status = 'completed',
             sources_scanned_json = ?2,
             findings_count = ?3,
             summary = ?4,
             finished_at = ?5
         WHERE id = ?1",
        params![
            run_id,
            sources_json,
            findings_count,
            summary_text,
            finished_iso
        ],
    )
    .map_err(|e| format!("Error cerrando revisión en SQLite: {e}"))?;

    let _ = store::try_record_audit_event_for_root(
        workspace_root,
        "agent",
        "business_review_completed",
        report_path.as_deref().unwrap_or("agente/revisiones"),
        "agente",
        Some(&summary_text),
    );

    let review_run = conn
        .query_row(
            "SELECT id, review_type, trigger_source, status, sources_scanned_json, findings_count, summary, started_at, finished_at
             FROM review_runs WHERE id = ?1",
            params![run_id],
            |row| {
                let s_raw: String = row.get(4)?;
                Ok(ReviewRunDto {
                    id: row.get(0)?,
                    review_type: row.get(1)?,
                    trigger_source: row.get(2)?,
                    status: row.get(3)?,
                    sources_scanned: serde_json::from_str(&s_raw).unwrap_or_default(),
                    findings_count: row.get(5)?,
                    summary: row.get(6)?,
                    started_at: row.get(7)?,
                    finished_at: row.get(8)?,
                })
            },
        )
        .map_err(|e| format!("Error leyendo review_run generado: {e}"))?;

    Ok(RunReviewResult {
        review_run,
        report_path,
        analyzed_items_count,
        skipped_duplicates_count,
        new_tasks_count: saved.len(),
        summary: summary_text,
    })
}

fn sanitize_id_token(raw: &str) -> String {
    let clean: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '-' })
        .collect();
    clean.trim_matches('-').chars().take(48).collect()
}

pub fn recalculate_memory_patterns(
    conn: &Connection,
    workspace_root: &Path,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT decision, category, COUNT(*) FROM decision_history GROUP BY decision, category")
        .map_err(|e| format!("Error consultando estadísticas de decisiones: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("Error iterando estadísticas de decisiones: {e}"))?;

    let mut total_decisions = 0i64;
    let mut approved_or_adj = 0i64;
    let mut adjusted_count = 0i64;
    let mut rejected_count = 0i64;
    let mut category_totals: HashMap<String, (i64, i64, i64)> = HashMap::new();

    for item in rows.flatten() {
        let (decision, category, count) = item;
        total_decisions += count;
        let entry = category_totals.entry(category).or_insert((0, 0, 0));
        entry.0 += count;
        match decision.as_str() {
            "approved" => {
                approved_or_adj += count;
                entry.1 += count;
            }
            "adjusted" => {
                approved_or_adj += count;
                adjusted_count += count;
                entry.1 += count;
            }
            "rejected" => {
                rejected_count += count;
                entry.2 += count;
            }
            "completed" => {
                approved_or_adj += count;
                entry.1 += count;
            }
            _ => {}
        }
    }

    let mut patterns: Vec<Value> = Vec::new();
    if total_decisions > 0 {
        let acceptance_rate = (approved_or_adj as f64 / total_decisions as f64 * 100.0).round() / 100.0;
        let conf = (0.50 + (total_decisions.min(20) as f64 / 40.0)).min(0.98);
        patterns.push(json!({
            "pattern_id": "approval_rate_global",
            "description": format!(
                "Has aceptado {} de {} propuestas registradas ({:.0}% de aprobación, {} con ajuste manual y {} descartadas).",
                approved_or_adj,
                total_decisions,
                acceptance_rate * 100.0,
                adjusted_count,
                rejected_count
            ),
            "confidence": (conf * 100.0).round() / 100.0
        }));

        let mut sorted_cats: Vec<(String, (i64, i64, i64))> = category_totals.into_iter().collect();
        sorted_cats.sort_by(|a, b| b.1.0.cmp(&a.1.0));
        if let Some((top_cat, (cnt, acc, _))) = sorted_cats.first() {
            let cat_conf = (0.55 + ((*cnt).min(15) as f64 / 35.0)).min(0.95);
            patterns.push(json!({
                "pattern_id": format!("top_category_{top_cat}"),
                "description": format!(
                    "Área con mayor actividad: '{top_cat}' ({acc}/{cnt} acciones confirmadas)."
                ),
                "confidence": (cat_conf * 100.0).round() / 100.0
            }));
        }
    }

    let perm_rules = read_permissions_rule_count(workspace_root);
    let body = json!({
        "version": 1,
        "updated_at": now.to_rfc3339(),
        "stats": {
            "total_decisions": total_decisions,
            "approved_or_adjusted": approved_or_adj,
            "adjusted": adjusted_count,
            "rejected": rejected_count,
            "permission_rules": perm_rules
        },
        "patterns": patterns
    });
    let pretty = serde_json::to_string_pretty(&body)
        .map_err(|e| format!("Error serializando memoria/patrones.json: {e}"))?;
    let patrones_path = workspace_root.join("memoria/patrones.json");
    write_string_atomic(&patrones_path, &pretty)?;
    snapshot_core_file(workspace_root, "memoria/patrones.json");
    Ok(())
}

fn read_workspace_identity(workspace_root: &Path) -> (String, String) {
    let raw = fs::read_to_string(workspace_root.join(".xook/workspace.json")).ok();
    let parsed = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let ws_id = parsed
        .as_ref()
        .and_then(|v| v.get("id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("default")
        .to_string();
    let ws_name = parsed
        .as_ref()
        .and_then(|v| v.get("name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Mi Negocio")
        .to_string();
    (ws_id, ws_name)
}

fn normalize_rel_for_compare(raw: &str) -> String {
    raw.trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_string()
}

fn matches_target_rel_or_child(candidate: &str, clean_target: &str, is_dir: bool) -> bool {
    let cand = normalize_rel_for_compare(candidate);
    let target = normalize_rel_for_compare(clean_target);
    if cand.is_empty() || target.is_empty() {
        return false;
    }
    if cand == target {
        return true;
    }
    is_dir && cand.starts_with(&format!("{target}/"))
}

fn check_delete_db_dependencies(
    conn: &Connection,
    clean_target: &str,
    is_dir: bool,
) -> Result<(), String> {
    let mut pending_stmt = conn
        .prepare(
            "SELECT card_id, staging_payload_json FROM tasks \
             WHERE status = 'pending' AND staging_payload_json IS NOT NULL",
        )
        .map_err(|e| format!("Error validando borradores activos: {e}"))?;
    let pending_rows = pending_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Error leyendo borradores activos: {e}"))?;

    for row in pending_rows.flatten() {
        let (card_id, sp_raw) = row;
        if let Ok(sp) = serde_json::from_str::<Value>(&sp_raw) {
            for key in ["draftPath", "draft_path", "targetPath", "target_path"] {
                if let Some(referenced) = sp.get(key).and_then(|v| v.as_str()) {
                    if matches_target_rel_or_child(referenced, clean_target, is_dir) {
                        return Err(format!(
                            "`{clean_target}` está vinculado a la propuesta pendiente `{card_id}` y no puede eliminarse."
                        ));
                    }
                }
            }
        }
    }

    let mut hist_stmt = conn
        .prepare(
            "SELECT id, execution_artifact_path FROM decision_history \
             WHERE execution_artifact_path IS NOT NULL",
        )
        .map_err(|e| format!("Error validando historial de decisiones: {e}"))?;
    let hist_rows = hist_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Error leyendo artefactos históricos: {e}"))?;

    for row in hist_rows.flatten() {
        let (hist_id, art_raw) = row;
        let art_norm = normalize_rel_for_compare(&art_raw);
        if matches_target_rel_or_child(&art_norm, clean_target, is_dir) {
            return Err(format!(
                "`{clean_target}` es evidencia de auditoría de la decisión `{hist_id}` y no puede eliminarse."
            ));
        }
        // Proteger también el par hermano (.json <-> .md) en agente/ordenes/
        if art_norm.ends_with(".json") {
            let md_twin = format!("{}.md", art_norm.trim_end_matches(".json"));
            if matches_target_rel_or_child(&md_twin, clean_target, is_dir) {
                return Err(format!(
                    "`{clean_target}` está vinculado al artefacto de auditoría `{art_norm}` (`{hist_id}`) y no puede eliminarse."
                ));
            }
        } else if art_norm.ends_with(".md") {
            let json_twin = format!("{}.json", art_norm.trim_end_matches(".md"));
            if matches_target_rel_or_child(&json_twin, clean_target, is_dir) {
                return Err(format!(
                    "`{clean_target}` está vinculado al artefacto de auditoría `{art_norm}` (`{hist_id}`) y no puede eliminarse."
                ));
            }
        }
    }

    Ok(())
}

fn allocate_unique_trash_rel(
    workspace_root: &Path,
    now: DateTime<Utc>,
    file_name: &str,
) -> Result<(String, PathBuf), String> {
    let base = format!(
        "agente/.papelera/{}_{}_{}",
        now.timestamp(),
        now.timestamp_subsec_nanos(),
        file_name
    );
    let (candidate, _, _) = resolve_inside_workspace(workspace_root, &base, false)?;
    if !candidate.exists() {
        return Ok((base, candidate));
    }
    for idx in 1..=999 {
        let alt = format!(
            "agente/.papelera/{}_{}_{}_{}",
            now.timestamp(),
            now.timestamp_subsec_nanos(),
            idx,
            file_name
        );
        let (alt_abs, _, _) = resolve_inside_workspace(workspace_root, &alt, false)?;
        if !alt_abs.exists() {
            return Ok((alt, alt_abs));
        }
    }
    Err("No se pudo asignar una ruta única en agente/.papelera/".to_string())
}

/// Auto-repara estructura de carpetas/archivos núcleo y reconstruye `memoria/decisiones.jsonl` y
/// `memoria/patrones.json` de forma determinística desde SQLite si faltan o fueron alterados.
pub fn heal_workspace_from_db(
    conn: &Connection,
    workspace_root: &Path,
    now: DateTime<Utc>,
) -> Result<Vec<String>, String> {
    let (ws_id, ws_name) = read_workspace_identity(workspace_root);
    let mut healed = scaffold_and_heal_workspace_dir(workspace_root, &ws_id, &ws_name)?;

    let db_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM decision_history", [], |row| row.get(0))
        .unwrap_or(0);

    let decisions_path = workspace_root.join("memoria/decisiones.jsonl");
    let existing_decisions = fs::read_to_string(&decisions_path).ok();
    let (valid_line_count, all_lines_valid) = match existing_decisions.as_deref() {
        Some(raw) => {
            let lines: Vec<&str> = raw.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
            let all_ok = lines
                .iter()
                .all(|l| serde_json::from_str::<Value>(l).is_ok());
            (lines.len(), all_ok)
        }
        None => (0, true),
    };

    if db_count > 0 && (!decisions_path.is_file() || !all_lines_valid || valid_line_count < db_count as usize) {
        let mut stmt = conn
            .prepare(
                "SELECT COALESCE(task_card_id, id), title, decision, notes, decided_at \
                 FROM decision_history ORDER BY decided_at ASC, rowid ASC",
            )
            .map_err(|e| format!("Error reconstruyendo memoria/decisiones.jsonl: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| format!("Error leyendo historial de decisiones: {e}"))?;

        let mut lines_out = Vec::new();
        for item in rows.flatten() {
            let (card_id, title, decision, notes, decided_at) = item;
            let entry = json!({
                "timestamp": decided_at,
                "workspace_id": ws_id,
                "card_id": card_id,
                "title": title,
                "decision": decision,
                "adjusted_qty": Value::Null,
                "notes": notes,
            });
            if let Ok(line) = serde_json::to_string(&entry) {
                lines_out.push(line);
            }
        }
        let body = if lines_out.is_empty() {
            String::new()
        } else {
            format!("{}\n", lines_out.join("\n"))
        };
        write_string_atomic(&decisions_path, &body)?;
        snapshot_core_file(workspace_root, "memoria/decisiones.jsonl");
        healed.retain(|entry| !entry.starts_with("memoria/decisiones.jsonl"));
        healed.push("memoria/decisiones.jsonl (reconstruido desde SQLite)".to_string());
    }

    let patrones_path = workspace_root.join("memoria/patrones.json");
    let patrones_raw = fs::read_to_string(&patrones_path).unwrap_or_default();
    let stats_total = serde_json::from_str::<Value>(&patrones_raw)
        .ok()
        .and_then(|v| {
            v.get("stats")
                .and_then(|s| s.get("total_decisions"))
                .and_then(|n| n.as_i64())
                .or_else(|| v.get("total_decisions").and_then(|n| n.as_i64()))
        })
        .unwrap_or(0);

    if !is_valid_core_file_content("memoria/patrones.json", &patrones_raw)
        || (db_count > 0 && stats_total < db_count)
    {
        recalculate_memory_patterns(conn, workspace_root, now)?;
        healed.retain(|entry| !entry.starts_with("memoria/patrones.json"));
        healed.push("memoria/patrones.json (recalculado desde SQLite)".to_string());
    }

    if !healed.is_empty() {
        let joined = healed.join(", ");
        let _ = record_audit_event_conn(
            conn,
            "system",
            "workspace_self_healed",
            &joined,
            "meta",
            Some("Auto-regeneración segura desde respaldo/SQLite"),
            now,
        );
    }

    Ok(healed)
}

fn append_daily_journal(
    workspace_root: &Path,
    title: &str,
    decision_norm: &str,
    summary: &str,
    artifact_path: Option<&str>,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let local_now = now.with_timezone(&Local);
    let date_key = local_now.format("%Y-%m-%d").to_string();
    let time_hhmm = local_now.format("%H:%M").to_string();
    let rel_path = format!("memoria/diario/{date_key}.md");
    let (abs_path, _, _) = resolve_inside_workspace(workspace_root, &rel_path, false)?;

    let label = match decision_norm {
        "approved" => "APROBADA",
        "adjusted" => "AJUSTADA",
        "rejected" => "DESCARTADA",
        _ => "REGISTRADA",
    };

    let artifact_note = artifact_path
        .map(|p| format!(" · Artefacto: `{p}`"))
        .unwrap_or_default();
    let line = format!("- [{time_hhmm}] **{label}** · {title} — {summary}{artifact_note}\n");

    let mut content = if abs_path.exists() {
        fs::read_to_string(&abs_path).unwrap_or_default()
    } else {
        format!("# Diario operativo · {date_key}\n\n")
    };
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&line);
    write_string_atomic(&abs_path, &content)
}

pub struct HitlSideEffectInput<'a> {
    pub card_id: &'a str,
    pub title: &'a str,
    pub category: &'a str,
    pub summary: &'a str,
    pub decided_by: Option<&'a str>,
    pub adjusted_qty: Option<f64>,
    pub verified_cost: Option<f64>,
    pub currency: Option<&'a str>,
    pub notes: Option<&'a str>,
    pub updated_proposal: Option<&'a Value>,
}

struct PreparedHitlWrite {
    abs_target: PathBuf,
    clean_rel: PathBuf,
    clean_str: String,
    zone: WorkspaceZone,
    body: String,
}

fn prepare_hitl_write_item(
    workspace_root: &Path,
    item: &Value,
) -> Result<Option<PreparedHitlWrite>, String> {
    let Some(target_rel) = item
        .get("targetPath")
        .or_else(|| item.get("target_path"))
        .and_then(|v| v.as_str())
    else {
        return Ok(None);
    };
    let (abs_target, clean_rel, zone) =
        resolve_inside_workspace(workspace_root, target_rel, false)?;
    let clean_str = clean_rel.to_string_lossy().replace('\\', "/");
    if zone.is_protected_system() {
        return Err(
            "No está permitido sobrescribir archivos del sistema o la raíz del espacio de trabajo."
                .to_string(),
        );
    }
    if clean_str.eq_ignore_ascii_case("memoria/decisiones.jsonl")
        || clean_str.eq_ignore_ascii_case("memoria/patrones.json")
    {
        return Err(format!(
            "`{clean_str}` es administrado exclusivamente por el motor de auditoría."
        ));
    }
    if abs_target.is_dir() {
        return Err(format!("`{clean_str}` es una carpeta y no puede sobrescribirse."));
    }
    let draft_rel = item
        .get("draftPath")
        .or_else(|| item.get("draft_path"))
        .and_then(|v| v.as_str());
    let new_content = item
        .get("newContent")
        .or_else(|| item.get("new_content"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            draft_rel.and_then(|dr| {
                resolve_inside_workspace(workspace_root, dr, true)
                    .ok()
                    .and_then(|(p, _, _)| fs::read_to_string(p).ok())
            })
        });
    let Some(body) = new_content else {
        return Ok(None);
    };
    if is_protected_workspace_rel_path(&clean_rel).is_some()
        && !is_valid_core_file_content(&clean_str, &body)
    {
        return Err(format!(
            "El contenido propuesto para `{clean_str}` está vacío o tiene estructura inválida."
        ));
    }
    Ok(Some(PreparedHitlWrite {
        abs_target,
        clean_rel,
        clean_str,
        zone,
        body,
    }))
}

fn commit_hitl_write_item(
    workspace_root: &Path,
    prepared: &PreparedHitlWrite,
) -> Result<bool, String> {
    let is_core = is_protected_workspace_rel_path(&prepared.clean_rel).is_some();
    if is_core {
        snapshot_core_file(workspace_root, &prepared.clean_str);
    }
    write_string_atomic(&prepared.abs_target, &prepared.body)?;
    if is_core {
        snapshot_core_file(workspace_root, &prepared.clean_str);
    }
    Ok(prepared.zone == WorkspaceZone::Datos)
}

pub fn apply_post_hitl_side_effects(
    conn: &mut Connection,
    workspace_root: &Path,
    payload: HitlSideEffectInput<'_>,
    decision_norm: &str,
    history_entry: &mut DecisionHistoryDto,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let staging_from_db: Option<Value> = conn
        .query_row(
            "SELECT staging_payload_json FROM tasks WHERE card_id = ?1",
            params![payload.card_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .ok()
        .flatten()
        .flatten()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());

    let staging = staging_from_db.or_else(|| {
        payload
            .updated_proposal
            .and_then(|p| p.get("stagingPayload").cloned())
    });

    let mut generated_artifact: Option<String> = None;

    if matches!(decision_norm, "approved" | "adjusted") {
        let kind = staging
            .as_ref()
            .and_then(|v| v.get("kind").and_then(|k| k.as_str()))
            .unwrap_or(if payload.category == "abastecimiento" {
                "purchase_order"
            } else {
                ""
            });

        if kind == "purchase_order" {
            let sp = staging.clone().unwrap_or_else(|| json!({}));
            let qty_from_param = payload
                .updated_proposal
                .and_then(|p| p.get("paramValues"))
                .and_then(|pv| pv.get("qty"))
                .and_then(|v| v.as_f64());
            let final_qty = payload
                .adjusted_qty
                .or(qty_from_param)
                .or_else(|| sp.get("recommendedOrder").and_then(|v| v.as_f64()))
                .unwrap_or(1.0);
            let unit_cost = sp.get("unitCost").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let total_cost = payload
                .verified_cost
                .unwrap_or_else(|| (final_qty * unit_cost * 100.0).round() / 100.0);
            let currency = payload
                .currency
                .or_else(|| sp.get("currency").and_then(|v| v.as_str()))
                .unwrap_or("MXN");
            let supplier_name = sp
                .get("supplierName")
                .and_then(|v| v.as_str())
                .unwrap_or("Por asignar");
            let sku = sp
                .get("sku")
                .and_then(|v| v.as_str())
                .unwrap_or(payload.card_id);
            let product_name = sp
                .get("productName")
                .and_then(|v| v.as_str())
                .unwrap_or(payload.title);
            let unit = sp.get("unit").and_then(|v| v.as_str()).unwrap_or("un.");

            let token = sanitize_id_token(payload.card_id);
            let order_code = format!("OC-{token}-{}", now.timestamp());
            let rel_json = format!("agente/ordenes/{order_code}.json");
            let rel_md = format!("agente/ordenes/{order_code}.md");

            let order_doc = json!({
                "order_id": order_code,
                "card_id": payload.card_id,
                "status": "authorized",
                "authorized_by": payload.decided_by.unwrap_or("user"),
                "authorized_at": now.to_rfc3339(),
                "sku": sku,
                "product_name": product_name,
                "quantity": final_qty,
                "unit": unit,
                "unit_cost": unit_cost,
                "total_cost": total_cost,
                "currency": currency,
                "supplier_name": supplier_name,
                "decision": decision_norm,
                "notes": payload.notes
            });
            let (abs_json, _, _) = resolve_inside_workspace(workspace_root, &rel_json, false)?;
            write_string_atomic(
                &abs_json,
                &serde_json::to_string_pretty(&order_doc).unwrap_or_default(),
            )?;

            let md_doc = format!(
                "# Orden de Compra {order_code}\n\n- **Estado:** Autorizada ({decision_norm})\n- **Producto:** {product_name} (`{sku}`)\n- **Cantidad:** {final_qty} {unit}\n- **Costo estimado:** ${total_cost:.2} {currency}\n- **Proveedor:** {supplier_name}\n- **Fecha:** {}\n",
                now.to_rfc3339()
            );
            let (abs_md, _, _) = resolve_inside_workspace(workspace_root, &rel_md, false)?;
            write_string_atomic(&abs_md, &md_doc)?;

            let _ = store::try_record_audit_event_for_root(
                workspace_root,
                payload.decided_by.unwrap_or("user"),
                "order_created",
                &rel_json,
                "agente",
                Some(product_name),
            );
            generated_artifact = Some(rel_json);
        } else if kind == "file_edit" {
            if let Some(sp) = staging.as_ref() {
                if let Some(prepared) = prepare_hitl_write_item(workspace_root, sp)? {
                    let touched_datos = commit_hitl_write_item(workspace_root, &prepared)?;
                    if touched_datos {
                        let _ = sync_datos_files_into_db(conn, workspace_root, now);
                    }
                    let _ = store::try_record_audit_event_for_root(
                        workspace_root,
                        payload.decided_by.unwrap_or("user"),
                        "company_file_edited",
                        &prepared.clean_str,
                        prepared.zone.as_str(),
                        Some(payload.title),
                    );
                    generated_artifact = Some(prepared.clean_str);
                }
            }
        } else if kind == "blueprint" {
            if let Some(sp) = staging.as_ref() {
                let raw_changes = sp
                    .get("changes")
                    .or_else(|| sp.get("files"))
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| "El blueprint no contiene una lista de cambios válida.".to_string())?;
                if raw_changes.is_empty() {
                    return Err("El blueprint no contiene cambios para aplicar.".to_string());
                }
                let mut prepared_items = Vec::with_capacity(raw_changes.len());
                for item in raw_changes {
                    let Some(prepared) = prepare_hitl_write_item(workspace_root, item)? else {
                        return Err("Cada cambio del blueprint debe indicar ruta y contenido válido.".to_string());
                    };
                    prepared_items.push(prepared);
                }
                let mut touched_datos = false;
                let mut applied_paths: Vec<String> = Vec::with_capacity(prepared_items.len());
                for prepared in &prepared_items {
                    if commit_hitl_write_item(workspace_root, prepared)? {
                        touched_datos = true;
                    }
                    applied_paths.push(prepared.clean_str.clone());
                }
                if touched_datos {
                    let _ = sync_datos_files_into_db(conn, workspace_root, now);
                }
                let primary_artifact = applied_paths
                    .iter()
                    .find(|p| p.eq_ignore_ascii_case("empresa/perfil.json"))
                    .cloned()
                    .or_else(|| applied_paths.first().cloned());
                if let Some(ref primary) = primary_artifact {
                    let _ = store::try_record_audit_event_for_root(
                        workspace_root,
                        payload.decided_by.unwrap_or("user"),
                        "workspace_blueprint_applied",
                        primary,
                        "empresa",
                        Some(payload.title),
                    );
                }
                generated_artifact = primary_artifact;
            }
        } else if kind == "delete_path" {
            if let Some(sp) = staging.as_ref() {
                if let Some(target_rel) = sp
                    .get("targetPath")
                    .or_else(|| sp.get("target_path"))
                    .and_then(|v| v.as_str())
                {
                    let (abs_target, clean_rel, zone) =
                        resolve_inside_workspace(workspace_root, target_rel, true)?;
                    let clean_str = clean_rel.to_string_lossy().replace('\\', "/");
                    if zone.is_protected_system() {
                        return Err(
                            "No está permitido eliminar la raíz ni archivos internos (.xook) del workspace."
                                .to_string(),
                        );
                    }
                    if clean_str.starts_with("agente/.papelera")
                        || clean_rel.components().any(|c| {
                            matches!(
                                c,
                                std::path::Component::Normal(s)
                                    if s.to_string_lossy().starts_with('.')
                            )
                        })
                    {
                        return Err(format!(
                            "`{clean_str}` es un archivo oculto o interno del sistema y no puede eliminarse."
                        ));
                    }
                    if is_protected_workspace_rel_path(&clean_rel).is_some() {
                        return Err(format!(
                            "`{clean_str}` forma parte de la estructura o archivos protegidos del workspace y no puede eliminarse."
                        ));
                    }
                    check_delete_db_dependencies(conn, &clean_str, abs_target.is_dir())?;

                    let file_name = abs_target
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("archivo");
                    let (trash_rel, abs_trash) =
                        allocate_unique_trash_rel(workspace_root, now, file_name)?;
                    if let Some(parent) = abs_trash.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    fs::rename(&abs_target, &abs_trash).map_err(|e| {
                        format!("No se pudo mover `{clean_str}` a agente/.papelera/: {e}")
                    })?;
                    if zone == WorkspaceZone::Datos {
                        let _ = sync_datos_files_into_db(conn, workspace_root, now);
                    }
                    let _ = store::try_record_audit_event_for_root(
                        workspace_root,
                        payload.decided_by.unwrap_or("user"),
                        "path_trashed",
                        &clean_str,
                        zone.as_str(),
                        Some(&trash_rel),
                    );
                    generated_artifact = Some(trash_rel);
                }
            }
        }
    }

    if let Some(ref art_path) = generated_artifact {
        let _ = conn.execute(
            "UPDATE decision_history SET execution_artifact_path = ?2 WHERE id = ?1",
            params![history_entry.id, art_path],
        );
        history_entry.execution_artifact_path = Some(art_path.clone());
    }

    let _ = append_daily_journal(
        workspace_root,
        payload.title,
        decision_norm,
        payload.summary,
        generated_artifact.as_deref(),
        now,
    );
    let _ = recalculate_memory_patterns(conn, workspace_root, now);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slices::task_ledger::migrations::open_workspace_db;
    use crate::slices::task_ledger::store::{DecideTaskPayload, decide_task_hitl_at};
    use crate::slices::workspace_manager::registry::scaffold_workspace_dir;

    fn temp_ws(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "xook_inv_test_{label}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        fs::create_dir_all(&dir).unwrap();
        scaffold_workspace_dir(&dir, "ws_test", "Café Prueba").unwrap();
        dir
    }

    #[test]
    fn imports_csv_populates_inventory_and_runs_deduped_review() {
        let root = temp_ws("csv");
        let mut conn = open_workspace_db(&root).unwrap();
        let csv_data = "sku,name,category,current_stock,unit,avg_daily_sales,cost_unit,supplier_id\nCAFE-500,Café Chiapas 500g,Insumos,3,bolsas,2,75,sup-1\nLECHE-1L,Leche Entera 1L,Lácteos,40,litros,2,28,sup-1\n";

        let imp = import_inventory_file_at(&mut conn, &root, Some("inventario.csv"), csv_data, Utc::now()).unwrap();
        assert_eq!(imp.imported_count, 2);
        assert_eq!(imp.file_path, "datos/inventario.csv");
        assert!(root.join("datos/inventario.csv").exists());

        let r1 = execute_workspace_review(&mut conn, &root, "manual", None, Utc::now()).unwrap();
        assert_eq!(r1.analyzed_items_count, 2);
        assert_eq!(r1.new_tasks_count, 1);
        assert!(r1.report_path.is_some());
        assert!(root.join(r1.report_path.unwrap()).exists());

        // Segunda corrida inmediata debe deduplicar la alerta pendiente
        let r2 = execute_workspace_review(&mut conn, &root, "manual", None, Utc::now()).unwrap();
        assert_eq!(r2.new_tasks_count, 0);
        assert_eq!(r2.skipped_duplicates_count, 1);

        // Aprobar tarea HITL debe generar OC json/md, diario y patrones reales
        let tasks = store::list_tasks(&conn, Some("pending")).unwrap();
        assert_eq!(tasks.len(), 1);
        let card_id = tasks[0].card_id.clone();

        let dec = decide_task_hitl_at(
            &mut conn,
            &root,
            "ws_test",
            DecideTaskPayload {
                card_id,
                decision_id: None,
                title: tasks[0].title.clone(),
                category: tasks[0].category.clone(),
                decision: "approved".to_string(),
                summary: "Orden aprobada en test".to_string(),
                amount_label: Some("$1,875 MXN".to_string()),
                verified_cost: Some(1875.0),
                currency: Some("MXN".to_string()),
                adjusted_qty: Some(25.0),
                execution_artifact_path: None,
                notes: None,
                decided_by: Some("Uziel".to_string()),
                updated_proposal: Some(tasks[0].proposal.clone()),
                promote_agenda_item: None,
            },
            Utc::now(),
        )
        .unwrap();

        let artifact = dec.history_entry.execution_artifact_path.unwrap();
        assert!(artifact.starts_with("agente/ordenes/OC-"));
        assert!(root.join(&artifact).exists());

        let patterns_raw = fs::read_to_string(root.join("memoria/patrones.json")).unwrap();
        assert!(patterns_raw.contains("approval_rate_global"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn post_hitl_file_edit_in_datos_syncs_inventory_db() {
        let root = temp_ws("datos_sync");
        let mut conn = open_workspace_db(&root).unwrap();
        let proposal = json!({
            "stagingPayload": {
                "kind": "file_edit",
                "targetPath": "datos/extra.csv",
                "newContent": "sku,name,current_stock,avg_daily_sales,cost_unit\nMOKA-1,Moka Pot,9,1,320\n"
            }
        });
        let mut hist = DecisionHistoryDto {
            id: "h1".to_string(),
            task_card_id: Some("card_edit_1".to_string()),
            agenda_item_id: None,
            title: "Crear catálogo extra".to_string(),
            category: "regla".to_string(),
            decision: "approved".to_string(),
            summary: "ok".to_string(),
            amount_label: None,
            verified_cost: None,
            currency: None,
            execution_artifact_path: None,
            notes: None,
            decided_by: Some("Uziel".to_string()),
            decided_at: Utc::now().to_rfc3339(),
            timestamp_label: "ahora".to_string(),
        };
        apply_post_hitl_side_effects(
            &mut conn,
            &root,
            HitlSideEffectInput {
                card_id: "card_edit_1",
                title: "Crear catálogo extra",
                category: "regla",
                summary: "ok",
                decided_by: Some("Uziel"),
                adjusted_qty: None,
                verified_cost: None,
                currency: Some("MXN"),
                notes: None,
                updated_proposal: Some(&proposal),
            },
            "approved",
            &mut hist,
            Utc::now(),
        )
        .unwrap();

        assert_eq!(hist.execution_artifact_path.as_deref(), Some("datos/extra.csv"));
        let items = list_inventory_items(&conn).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].sku, "MOKA-1");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn heal_workspace_from_db_rebuilds_decisions_and_patterns_and_core_files() {
        let root = temp_ws("heal_db");
        let conn = open_workspace_db(&root).unwrap();
        let now = Utc::now();
        scaffold_and_heal_workspace_dir(&root, "heal_db", "Café Xook").unwrap();

        conn.execute(
            "INSERT INTO decision_history (id, task_card_id, title, category, decision, summary, decided_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "dec-1",
                "card-1",
                "Reabastecer café",
                "abastecimiento",
                "approved",
                "Aprobado",
                now.to_rfc3339()
            ],
        )
        .unwrap();

        // Simular eliminación/daño externo de estructura, perfil, decisiones y patrones
        let _ = fs::remove_dir_all(root.join("datos/ventas"));
        let _ = fs::write(root.join("empresa/proveedores.json"), "");
        let _ = fs::remove_file(root.join("memoria/decisiones.jsonl"));
        let _ = fs::write(root.join("memoria/patrones.json"), "{corrupt");

        let healed = heal_workspace_from_db(&conn, &root, now).unwrap();
        assert!(root.join("datos/ventas").is_dir());
        assert!(is_valid_core_file_content(
            "empresa/proveedores.json",
            &fs::read_to_string(root.join("empresa/proveedores.json")).unwrap()
        ));
        let dec_raw = fs::read_to_string(root.join("memoria/decisiones.jsonl")).unwrap();
        assert!(dec_raw.contains("card-1"));
        let pat_raw = fs::read_to_string(root.join("memoria/patrones.json")).unwrap();
        let pat_json: Value = serde_json::from_str(&pat_raw).unwrap();
        assert_eq!(pat_json["stats"]["total_decisions"], 1);
        assert!(healed.iter().any(|h| h.contains("memoria/decisiones.jsonl")));
        assert!(healed.iter().any(|h| h.contains("memoria/patrones.json")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hitl_delete_and_edit_protect_core_structure_while_allowing_company_roles() {
        let root = temp_ws("hitl_guards");
        let mut conn = open_workspace_db(&root).unwrap();
        let now = Utc::now();
        scaffold_and_heal_workspace_dir(&root, "hitl_guards", "Café Xook").unwrap();

        // 1) Bloquea eliminación de carpeta estructural y archivo núcleo
        for forbidden in ["datos/ventas", "empresa/proveedores.json", "agente/ordenes"] {
            let proposal = json!({
                "cardId": "card-del-forbidden",
                "stagingPayload": {
                    "kind": "delete_path",
                    "targetPath": forbidden
                }
            });
            let mut hist = DecisionHistoryDto {
                id: "h1".to_string(),
                task_card_id: Some("card-del-forbidden".to_string()),
                agenda_item_id: None,
                title: "Eliminar".to_string(),
                category: "regla".to_string(),
                decision: "approved".to_string(),
                summary: "Test".to_string(),
                amount_label: None,
                verified_cost: None,
                currency: None,
                execution_artifact_path: None,
                notes: None,
                decided_by: Some("user".to_string()),
                decided_at: now.to_rfc3339(),
                timestamp_label: "ahora".to_string(),
            };
            let res = apply_post_hitl_side_effects(
                &mut conn,
                &root,
                HitlSideEffectInput {
                    card_id: "card-del-forbidden",
                    title: "Eliminar",
                    category: "regla",
                    summary: "Test",
                    decided_by: Some("user"),
                    adjusted_qty: None,
                    verified_cost: None,
                    currency: Some("MXN"),
                    notes: None,
                    updated_proposal: Some(&proposal),
                },
                "approved",
                &mut hist,
                now,
            );
            assert!(res.is_err(), "Debió bloquear eliminación de {forbidden}");
        }

        // 2) Bloquea borrador vinculado a propuesta pendiente y orden vinculada a decision_history
        fs::write(root.join("agente/borradores/activo.draft"), "x").unwrap();
        conn.execute(
            "INSERT INTO tasks (card_id, title, category, urgency, status, staging_payload_json, proposal_json, created_at, updated_at)
             VALUES ('c-pending', 'Edit', 'regla', 'media', 'pending', '{\"draftPath\":\"agente/borradores/activo.draft\"}', '{}', '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        let p_draft = json!({
            "cardId": "del-draft",
            "stagingPayload": {
                "kind": "delete_path",
                "targetPath": "agente/borradores/activo.draft"
            }
        });
        let mut h_draft = DecisionHistoryDto {
            id: "hd".to_string(),
            task_card_id: Some("del-draft".to_string()),
            agenda_item_id: None,
            title: "Del draft".to_string(),
            category: "regla".to_string(),
            decision: "approved".to_string(),
            summary: "".to_string(),
            amount_label: None,
            verified_cost: None,
            currency: None,
            execution_artifact_path: None,
            notes: None,
            decided_by: Some("user".to_string()),
            decided_at: now.to_rfc3339(),
            timestamp_label: "ahora".to_string(),
        };
        assert!(
            apply_post_hitl_side_effects(
                &mut conn,
                &root,
                HitlSideEffectInput {
                    card_id: "del-draft",
                    title: "Del draft",
                    category: "regla",
                    summary: "",
                    decided_by: Some("user"),
                    adjusted_qty: None,
                    verified_cost: None,
                    currency: None,
                    notes: None,
                    updated_proposal: Some(&p_draft),
                },
                "approved",
                &mut h_draft,
                now,
            )
            .is_err()
        );

        fs::write(root.join("agente/ordenes/OC-1.json"), "{}").unwrap();
        fs::write(root.join("agente/ordenes/OC-1.md"), "# OC-1").unwrap();
        conn.execute(
            "INSERT INTO decision_history (id, task_card_id, title, category, decision, summary, execution_artifact_path, decided_at)
             VALUES ('dh-oc1', 'c-oc1', 'OC', 'abastecimiento', 'approved', 'ok', 'agente/ordenes/OC-1.json', '2026-01-01')",
            [],
        ).unwrap();
        assert!(
            check_delete_db_dependencies(&conn, "agente/ordenes/OC-1.md", false).is_err(),
            "Debe proteger el twin .md vinculado a una orden en decision_history"
        );

        // 3) Permite editar empresa/perfil.json agregando roles y rechaza JSON corrupto
        let valid_profile = r#"{"business_name":"Café Xook","roles":[{"role":"Barista","can_approve":false}]}"#;
        let p_edit = json!({
            "cardId": "edit-roles",
            "stagingPayload": {
                "kind": "file_edit",
                "targetPath": "empresa/perfil.json",
                "newContent": valid_profile
            }
        });
        let mut h_edit = DecisionHistoryDto {
            id: "he".to_string(),
            task_card_id: Some("edit-roles".to_string()),
            agenda_item_id: None,
            title: "Agregar roles".to_string(),
            category: "regla".to_string(),
            decision: "approved".to_string(),
            summary: "".to_string(),
            amount_label: None,
            verified_cost: None,
            currency: None,
            execution_artifact_path: None,
            notes: None,
            decided_by: Some("user".to_string()),
            decided_at: now.to_rfc3339(),
            timestamp_label: "ahora".to_string(),
        };
        apply_post_hitl_side_effects(
            &mut conn,
            &root,
            HitlSideEffectInput {
                card_id: "edit-roles",
                title: "Agregar roles",
                category: "regla",
                summary: "",
                decided_by: Some("user"),
                adjusted_qty: None,
                verified_cost: None,
                currency: None,
                notes: None,
                updated_proposal: Some(&p_edit),
            },
            "approved",
            &mut h_edit,
            now,
        )
        .unwrap();
        assert!(fs::read_to_string(root.join("empresa/perfil.json"))
            .unwrap()
            .contains("Barista"));

        let p_bad = json!({
            "cardId": "edit-bad",
            "stagingPayload": {
                "kind": "file_edit",
                "targetPath": "empresa/perfil.json",
                "newContent": ""
            }
        });
        let mut h_bad = h_edit.clone();
        assert!(
            apply_post_hitl_side_effects(
                &mut conn,
                &root,
                HitlSideEffectInput {
                    card_id: "edit-bad",
                    title: "Corrupto",
                    category: "regla",
                    summary: "",
                    decided_by: Some("user"),
                    adjusted_qty: None,
                    verified_cost: None,
                    currency: None,
                    notes: None,
                    updated_proposal: Some(&p_bad),
                },
                "approved",
                &mut h_bad,
                now,
            )
            .is_err()
        );

        // 4) Permite mover archivo no protegido a papelera dos veces en el mismo instante sin colisión
        for idx in 0..2 {
            fs::write(root.join("datos/temporal.csv"), format!("a,b\n1,{idx}\n")).unwrap();
            let p_del = json!({
                "cardId": format!("del-ok-{idx}"),
                "stagingPayload": {
                    "kind": "delete_path",
                    "targetPath": "datos/temporal.csv"
                }
            });
            let mut h_ok = h_edit.clone();
            apply_post_hitl_side_effects(
                &mut conn,
                &root,
                HitlSideEffectInput {
                    card_id: &format!("del-ok-{idx}"),
                    title: "Archivar CSV",
                    category: "regla",
                    summary: "",
                    decided_by: Some("user"),
                    adjusted_qty: None,
                    verified_cost: None,
                    currency: None,
                    notes: None,
                    updated_proposal: Some(&p_del),
                },
                "approved",
                &mut h_ok,
                now,
            )
            .unwrap();
        }
        let trash_count = fs::read_dir(root.join("agente/.papelera")).unwrap().count();
        assert_eq!(trash_count, 2);

        // 5) Blueprint atómico: rechaza lote completo si algún archivo núcleo es inválido
        let bad_bp = json!({
            "cardId": "bp-bad",
            "stagingPayload": {
                "kind": "blueprint",
                "changes": [
                    { "targetPath": "empresa/roles.md", "newContent": "# Roles\n- Arquitecto\n" },
                    { "targetPath": "empresa/perfil.json", "newContent": "{json_roto" }
                ]
            }
        });
        let mut h_bp_bad = h_edit.clone();
        assert!(
            apply_post_hitl_side_effects(
                &mut conn,
                &root,
                HitlSideEffectInput {
                    card_id: "bp-bad",
                    title: "Blueprint inválido",
                    category: "regla",
                    summary: "",
                    decided_by: Some("user"),
                    adjusted_qty: None,
                    verified_cost: None,
                    currency: None,
                    notes: None,
                    updated_proposal: Some(&bad_bp),
                },
                "approved",
                &mut h_bp_bad,
                now,
            )
            .is_err()
        );
        assert!(!root.join("empresa/roles.md").exists(), "no debe crear archivos si otro falla");

        // 6) Blueprint válido: escribe múltiples archivos de empresa/ y datos/ en un solo paso HITL
        let ok_bp = json!({
            "cardId": "bp-ok",
            "stagingPayload": {
                "kind": "blueprint",
                "changes": [
                    {
                        "targetPath": "empresa/perfil.json",
                        "newContent": "{\"company_name\":\"Estudio Nube\",\"agent_name\":\"Xox\",\"currency\":\"MXN\",\"stock_threshold_days\":7,\"max_budget_per_order\":1000,\"preferred_suppliers\":[],\"business_rules\":[],\"domain_type\":\"software\",\"active_role\":\"Arquitecto Técnico\"}"
                    },
                    {
                        "targetPath": "empresa/roles.md",
                        "newContent": "# Roles del Proyecto\n- Arquitecto Técnico\n- QA\n"
                    },
                    {
                        "targetPath": "datos/backlog.csv",
                        "newContent": "tarea,prioridad\nMVP,alta\n"
                    }
                ]
            }
        });
        let mut h_bp_ok = h_edit;
        apply_post_hitl_side_effects(
            &mut conn,
            &root,
            HitlSideEffectInput {
                card_id: "bp-ok",
                title: "Configurar proyecto de software",
                category: "regla",
                summary: "",
                decided_by: Some("user"),
                adjusted_qty: None,
                verified_cost: None,
                currency: None,
                notes: None,
                updated_proposal: Some(&ok_bp),
            },
            "approved",
            &mut h_bp_ok,
            now,
        )
        .unwrap();
        assert!(root.join("empresa/roles.md").is_file());
        assert!(root.join("datos/backlog.csv").is_file());
        assert_eq!(h_bp_ok.execution_artifact_path.as_deref(), Some("empresa/perfil.json"));

        let _ = fs::remove_dir_all(&root);
    }
}
