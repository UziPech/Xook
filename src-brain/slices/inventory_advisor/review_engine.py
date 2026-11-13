"""
Motor determinístico de revisión operativa (Fase 2 / Parte 3).

Reglas de diseño (Modelo Guardián Estricto):
- Python lee exclusivamente dentro del `workspace_root` validado y consulta `.xook/xook.db` en modo solo lectura.
- No inventa datos ni usa productos mock: si no hay inventario cargado en `inventory_items` ni archivos en `datos/`, reporta estado limpio sin hallazgos.
- Escribe únicamente reportes legibles en `<workspace_root>/agente/revisiones/` (zona autónoma) y devuelve propuestas estructuradas para firma HITL en Rust.
"""

from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_COOLDOWN_HOURS = 24
SUPPORTED_INVENTORY_EXTENSIONS = {".csv", ".tsv", ".json"}

_HEADER_ALIASES = {
    "sku": "sku",
    "codigo": "sku",
    "code": "sku",
    "id": "sku",
    "name": "name",
    "nombre": "name",
    "producto": "name",
    "product": "name",
    "product_name": "name",
    "category": "category",
    "categoria": "category",
    "current_stock": "current_stock",
    "stock": "current_stock",
    "existencia": "current_stock",
    "existencias": "current_stock",
    "cantidad": "current_stock",
    "qty": "current_stock",
    "unit": "unit",
    "unidad": "unit",
    "avg_daily_sales": "avg_daily_sales",
    "daily_sales": "avg_daily_sales",
    "venta_diaria": "avg_daily_sales",
    "ventas_diarias": "avg_daily_sales",
    "consumo_diario": "avg_daily_sales",
    "cost_unit": "cost_unit",
    "unit_cost": "cost_unit",
    "costo": "cost_unit",
    "costo_unitario": "cost_unit",
    "precio_costo": "cost_unit",
    "price": "cost_unit",
    "currency": "currency",
    "moneda": "currency",
    "supplier_id": "supplier_id",
    "supplier": "supplier_id",
    "proveedor": "supplier_id",
    "proveedor_id": "supplier_id",
    "min_stock_days": "min_stock_days",
    "dias_minimos": "min_stock_days",
    "min_days": "min_stock_days",
}


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    raw = str(val).strip().replace("$", "").replace(",", "")
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _safe_int_opt(val: Any) -> Optional[int]:
    if val is None or str(val).strip() == "":
        return None
    try:
        return max(1, int(round(float(str(val).strip()))))
    except ValueError:
        return None


def _normalize_header(raw: str) -> str:
    clean = (
        str(raw or "")
        .strip()
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
    )
    return _HEADER_ALIASES.get(clean, clean)


def _slugify(raw: str) -> str:
    out = []
    prev_sep = False
    for ch in raw.strip().lower():
        if ch.isalnum():
            out.append(ch)
            prev_sep = False
        elif not prev_sep and out:
            out.append("-")
            prev_sep = True
    return "".join(out).strip("-") or "item"


def _resolve_inside_workspace(workspace_root: Path, rel_path: str) -> Path:
    root = workspace_root.resolve()
    rel = Path(rel_path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"Ruta fuera del workspace no permitida: {rel_path}")
    target = (root / rel).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Ruta fuera del workspace no permitida: {rel_path}")
    return target


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def _read_json_any(path: Path) -> Any:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_json_dict(path: Path) -> Dict[str, Any]:
    parsed = _read_json_any(path)
    return parsed if isinstance(parsed, dict) else {}


def _map_raw_record(raw: Dict[str, Any], source_file: str, idx: int) -> Optional[Dict[str, Any]]:
    norm: Dict[str, Any] = {}
    for k, v in raw.items():
        canon = _normalize_header(str(k))
        if canon and canon not in norm:
            norm[canon] = v

    name = str(norm.get("name") or "").strip()
    sku = str(norm.get("sku") or "").strip()
    if not name and not sku:
        return None
    if not name:
        name = sku
    if not sku:
        sku = f"{_slugify(name).upper()}_{idx + 1}"

    category = str(norm.get("category") or "general").strip() or "general"
    unit = str(norm.get("unit") or "un.").strip() or "un."
    currency = str(norm.get("currency") or "").strip() or None
    supplier_id = str(norm.get("supplier_id") or "").strip() or None

    return {
        "sku": sku,
        "name": name,
        "category": category,
        "current_stock": max(0.0, _safe_float(norm.get("current_stock"), 0.0)),
        "unit": unit,
        "avg_daily_sales": max(0.0, _safe_float(norm.get("avg_daily_sales"), 0.0)),
        "cost_unit": max(0.0, _safe_float(norm.get("cost_unit"), 0.0)),
        "currency": currency,
        "supplier_id": supplier_id,
        "min_stock_days": _safe_int_opt(norm.get("min_stock_days")),
        "source_file": source_file,
    }


def _parse_inventory_file(path: Path, rel_path: str) -> List[Dict[str, Any]]:
    ext = path.suffix.lower()
    if ext not in SUPPORTED_INVENTORY_EXTENSIONS:
        return []
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    if not text.strip():
        return []

    records: List[Dict[str, Any]] = []
    if ext == ".json":
        parsed = json.loads(text)
        raw_items: Any = parsed
        if isinstance(parsed, dict):
            raw_items = parsed.get("items") or parsed.get("inventory") or parsed.get("productos") or []
        if isinstance(raw_items, list):
            for idx, item in enumerate(raw_items):
                if isinstance(item, dict):
                    mapped = _map_raw_record(item, rel_path, idx)
                    if mapped:
                        records.append(mapped)
        return records

    delimiter = "\t" if ext == ".tsv" else ","
    try:
        dialect = csv.Sniffer().sniff(text[:2048], delimiters=",;\t|")
        delimiter = dialect.delimiter
    except Exception:
        pass
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    for idx, row in enumerate(reader):
        if not row:
            continue
        mapped = _map_raw_record(row, rel_path, idx)
        if mapped:
            records.append(mapped)
    return records


def _load_db_readonly(
    db_path: Path,
    default_currency: str,
) -> Tuple[List[Dict[str, Any]], set[str], set[str]]:
    items: List[Dict[str, Any]] = []
    pending_keys: set[str] = set()
    recent_decided_keys: set[str] = set()

    if not db_path.is_file():
        return items, pending_keys, recent_decided_keys

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT sku, name, category, current_stock, unit, avg_daily_sales, cost_unit, currency, supplier_id, min_stock_days, source_file "
            "FROM inventory_items ORDER BY name ASC"
        )
        for row in cur.fetchall():
            items.append({
                "sku": row["sku"],
                "name": row["name"],
                "category": row["category"] or "general",
                "current_stock": float(row["current_stock"] or 0.0),
                "unit": row["unit"] or "un.",
                "avg_daily_sales": float(row["avg_daily_sales"] or 0.0),
                "cost_unit": float(row["cost_unit"] or 0.0),
                "currency": row["currency"] or default_currency,
                "supplier_id": row["supplier_id"],
                "min_stock_days": row["min_stock_days"],
                "source_file": row["source_file"] or ".xook/xook.db",
            })

        cur.execute(
            "SELECT dedup_key, status, updated_at FROM tasks WHERE dedup_key IS NOT NULL AND TRIM(dedup_key) != ''"
        )
        cutoff = datetime.now(timezone.utc) - timedelta(hours=DEFAULT_COOLDOWN_HOURS)
        for row in cur.fetchall():
            dk = str(row["dedup_key"])
            status = str(row["status"] or "")
            if status == "pending":
                pending_keys.add(dk)
            else:
                try:
                    updated_at = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00"))
                    if updated_at >= cutoff:
                        recent_decided_keys.add(dk)
                except Exception:
                    pass
    finally:
        conn.close()

    return items, pending_keys, recent_decided_keys


def _build_supplier_index(proveedores_json: Any) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}
    if isinstance(proveedores_json, list):
        raw_list = proveedores_json
    elif isinstance(proveedores_json, dict):
        raw_list = (
            proveedores_json.get("suppliers")
            or proveedores_json.get("proveedores")
            or proveedores_json.get("items")
            or []
        )
    else:
        raw_list = []
    if not isinstance(raw_list, list):
        return index
    for entry in raw_list:
        if not isinstance(entry, dict):
            continue
        sid = str(entry.get("id") or entry.get("supplier_id") or "").strip()
        name = str(entry.get("name") or entry.get("nombre") or "").strip()
        if sid:
            index[sid.lower()] = entry
        if name:
            index[name.lower()] = entry
    return index


def _format_money(amount: float, currency: str) -> str:
    rounded = int(round(amount)) if abs(amount - round(amount)) < 0.01 else round(amount, 2)
    if isinstance(rounded, int):
        return f"${rounded:,} {currency}"
    return f"${rounded:,.2f} {currency}"


def _format_qty(val: float, unit: str) -> str:
    if abs(val - round(val)) < 0.01:
        return f"{int(round(val))} {unit}"
    return f"{val:.1f} {unit}"


def run_workspace_review(
    workspace_root: str | Path,
    *,
    trigger_source: str = "manual",
    db_path: Optional[str | Path] = None,
    pending_dedup_keys: Optional[Iterable[str]] = None,
    recent_decided_dedup_keys: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """
    Ejecuta una revisión determinística completa sobre el workspace real.
    Retorna `{ status, review_type, trigger_source, summary, sources_scanned,
               analyzed_items_count, skipped_duplicates_count, findings_count,
               report_path, tasks }`.
    """
    root = Path(workspace_root).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Workspace no encontrado: {root}")

    resolved_db = Path(db_path).resolve() if db_path else (root / ".xook" / "xook.db")
    profile = _read_json_dict(root / "empresa" / "perfil.json")
    proveedores = _read_json_any(root / "empresa" / "proveedores.json")

    default_currency = str(profile.get("currency") or "MXN").strip() or "MXN"
    raw_thresh = profile.get("stock_threshold_days")
    if raw_thresh is None:
        raw_thresh = profile.get("minStockDaysDefault")
    default_threshold_days = max(1, int(raw_thresh or 7))
    raw_budget = profile.get("max_budget_per_order")
    if raw_budget is None:
        raw_budget = profile.get("maxBudgetPerOrder")
    max_budget_per_order = max(100.0, float(raw_budget or 25000.0))

    sources_scanned: List[str] = []
    if (root / "empresa" / "perfil.json").is_file():
        sources_scanned.append("empresa/perfil.json")
    if (root / "empresa" / "proveedores.json").is_file():
        sources_scanned.append("empresa/proveedores.json")
    reglas_dir = root / "empresa" / "reglas"
    if reglas_dir.is_dir():
        for rule_file in sorted(reglas_dir.glob("*.md")):
            sources_scanned.append(f"empresa/reglas/{rule_file.name}")
    if (root / "memoria" / "hechos.md").is_file():
        sources_scanned.append("memoria/hechos.md")

    items, db_pending, db_recent = _load_db_readonly(resolved_db, default_currency)
    if items:
        sources_scanned.append(".xook/xook.db:inventory_items")

    # Respaldo / sincronización desde archivos reales en datos/ si inventory_items aún está vacío
    datos_dir = root / "datos"
    if datos_dir.is_dir():
        known_skus = {str(it["sku"]).lower(): idx for idx, it in enumerate(items)}
        for candidate in sorted(datos_dir.rglob("*")):
            if not candidate.is_file() or candidate.suffix.lower() not in SUPPORTED_INVENTORY_EXTENSIONS:
                continue
            rel = candidate.relative_to(root).as_posix()
            if rel not in sources_scanned:
                sources_scanned.append(rel)
            if not items:
                for rec in _parse_inventory_file(candidate, rel):
                    key = rec["sku"].lower()
                    if key not in known_skus:
                        rec["currency"] = rec.get("currency") or default_currency
                        items.append(rec)
                        known_skus[key] = len(items) - 1

    active_pending = set(db_pending)
    if pending_dedup_keys:
        active_pending.update(str(k) for k in pending_dedup_keys if k)

    active_cooldown = set(db_recent)
    if recent_decided_dedup_keys:
        active_cooldown.update(str(k) for k in recent_decided_dedup_keys if k)

    supplier_index = _build_supplier_index(proveedores)
    tasks: List[Dict[str, Any]] = []
    skipped_duplicates = 0
    now_dt = datetime.now().astimezone()
    ts_tag = now_dt.strftime("%Y%m%d-%H%M%S")

    for idx, item in enumerate(items):
        sku = str(item["sku"])
        name = str(item["name"])
        category_name = str(item.get("category") or "general")
        stock = float(item.get("current_stock") or 0.0)
        unit = str(item.get("unit") or "un.")
        avg_sales = float(item.get("avg_daily_sales") or 0.0)
        cost_unit = float(item.get("cost_unit") or 0.0)
        currency = str(item.get("currency") or default_currency)
        supplier_raw = str(item.get("supplier_id") or "").strip()
        min_days = item.get("min_stock_days")

        supplier_obj = supplier_index.get(supplier_raw.lower()) if supplier_raw else None
        supplier_name = (
            str(supplier_obj.get("name") or supplier_obj.get("nombre"))
            if isinstance(supplier_obj, dict) and (supplier_obj.get("name") or supplier_obj.get("nombre"))
            else (supplier_raw or "Sin proveedor asignado")
        )
        lead_time_days = 3
        if isinstance(supplier_obj, dict):
            raw_lead = (
                supplier_obj.get("delivery_lead_time_days")
                if supplier_obj.get("delivery_lead_time_days") is not None
                else supplier_obj.get("leadTimeDays")
                if supplier_obj.get("leadTimeDays") is not None
                else supplier_obj.get("lead_time_days")
            )
            if raw_lead is not None:
                lead_time_days = max(1, int(round(float(raw_lead))))

        effective_threshold = max(int(min_days or default_threshold_days), lead_time_days)
        if avg_sales > 0:
            days_left = round(stock / avg_sales, 1)
        else:
            days_left = 0.0 if stock <= 0 else 999.0

        needs_reorder = stock <= 0 or (avg_sales > 0 and days_left <= effective_threshold)
        if not needs_reorder:
            continue

        dedup_key = f"stock_reorder:{sku}"
        if dedup_key in active_pending or dedup_key in active_cooldown:
            skipped_duplicates += 1
            continue

        target_horizon = max(effective_threshold * 2, 14)
        if avg_sales > 0:
            raw_qty = max(1.0, (target_horizon * avg_sales) - stock)
        else:
            raw_qty = 10.0
        recommended_qty = max(1, int(round(raw_qty)))
        estimated_cost = round(recommended_qty * cost_unit, 2)

        if stock <= 0 or days_left <= max(2, lead_time_days):
            urgency = "alta"
            tone = "critical"
            status_chip = "Agotado" if stock <= 0 else f"{days_left:g}d de stock"
        elif days_left <= effective_threshold:
            urgency = "media"
            tone = "warning"
            status_chip = f"{days_left:g}d de stock"
        else:
            urgency = "baja"
            tone = "ok"
            status_chip = f"{days_left:g}d de stock"

        coverage_ratio = min(100, max(0, int(round((days_left / max(1, target_horizon)) * 100))))
        marker_ratio = min(100, max(5, int(round((lead_time_days / max(1, target_horizon)) * 100))))
        budget_note = (
            f" Excede el límite por orden ({_format_money(max_budget_per_order, currency)})."
            if estimated_cost > max_budget_per_order
            else ""
        )

        card_id = f"rev_{ts_tag}_{_slugify(sku)[:24]}_{idx + 1}"
        if avg_sales > 0:
            subtitle = f"Quedan {_format_qty(stock, unit)} (~{days_left:g} días a {avg_sales:g} {unit}/día)."
        else:
            subtitle = f"Stock actual en {_format_qty(stock, unit)}."

        kv_rows = [
            {"label": "SKU", "value": sku},
            {"label": "Categoría", "value": category_name},
            {"label": "Proveedor", "value": supplier_name, "subtle": f"{lead_time_days}d entrega"},
            {"label": "Fuente", "value": str(item.get("source_file") or ".xook/xook.db")},
        ]
        if supplier_obj and supplier_obj.get("contact"):
            kv_rows.append({"label": "Contacto", "value": str(supplier_obj["contact"])})

        insight_text = (
            f"Cobertura de {days_left:g} días frente a umbral mínimo de {effective_threshold} días "
            f"(entrega estimada: {lead_time_days}d). Se sugiere reponer {target_horizon} días.{budget_note}"
        )

        max_qty = max(recommended_qty * 4, 50)
        proposal = {
            "cardId": card_id,
            "dedupKey": dedup_key,
            "title": f"Reponer {name}",
            "subtitle": subtitle,
            "category": "abastecimiento",
            "urgency": urgency,
            "statusChip": status_chip,
            "defaultExpanded": urgency == "alta",
            "generatedBy": "Revisión operativa",
            "blocks": [
                {
                    "type": "metrics_strip",
                    "items": [
                        {"label": "Stock actual", "value": _format_qty(stock, unit), "tone": "critical" if urgency == "alta" else "warning"},
                        {"label": "Sugerido", "value": f"+{recommended_qty} {unit}", "tone": "neutral"},
                        {
                            "label": "Total",
                            "value": _format_money(estimated_cost, currency),
                            "tone": "positive" if estimated_cost <= max_budget_per_order else "warning",
                            "bindTotalFromParam": "qty",
                        },
                    ],
                },
                {
                    "type": "coverage_bar",
                    "currentLabel": f"Cobertura: {days_left:g}d",
                    "targetLabel": f"Entrega proveedor: {lead_time_days}d",
                    "ratio": coverage_ratio,
                    "markerRatio": marker_ratio,
                    "tone": tone,
                    "caption": "Basado en consumo diario y reglas de empresa/perfil.json",
                },
                {
                    "type": "param_control",
                    "key": "qty",
                    "label": "Cantidad a pedir",
                    "kind": "stepper",
                    "value": recommended_qty,
                    "min": 1,
                    "max": max_qty,
                    "step": 1,
                    "unit": unit,
                    "unitPrice": cost_unit,
                    "currency": currency,
                },
                {"type": "kv_list", "rows": kv_rows},
                {
                    "type": "insight",
                    "text": insight_text,
                    "source": "Revisión determinística",
                },
            ],
            "intent": {
                "type": "stock_reorder",
                "targetLabel": f"{name} · {supplier_name}",
                "primaryLabel": "Aprobar orden",
                "quantityParamKey": "qty",
                "unitPrice": cost_unit,
                "currency": currency,
                "supplierName": supplier_name,
                "maxBudgetLimit": max_budget_per_order,
            },
            "paramValues": {"qty": recommended_qty},
            "stagingPayload": {
                "kind": "purchase_order",
                "sku": sku,
                "productName": name,
                "category": category_name,
                "unit": unit,
                "currentStock": stock,
                "recommendedOrder": recommended_qty,
                "unitCost": cost_unit,
                "estimatedCost": estimated_cost,
                "currency": currency,
                "supplierId": supplier_raw or None,
                "supplierName": supplier_name,
                "leadTimeDays": lead_time_days,
                "daysLeft": days_left,
            },
        }
        tasks.append(proposal)

    findings_count = len(tasks)
    if not items:
        summary = (
            "No hay productos cargados todavía en datos/ ni en inventory_items. "
            "Importa un CSV o JSON para iniciar análisis automáticos."
        )
    elif findings_count == 0 and skipped_duplicates == 0:
        summary = f"Se analizaron {len(items)} artículo(s) sin hallazgos críticos ni reposiciones pendientes."
    elif findings_count == 0 and skipped_duplicates > 0:
        summary = (
            f"Se analizaron {len(items)} artículo(s). {skipped_duplicates} alerta(s) ya tenían "
            "tarjeta pendiente o decisión reciente."
        )
    else:
        summary = (
            f"Se analizaron {len(items)} artículo(s) y se generaron {findings_count} propuesta(s) "
            f"de reposición (duplicadas omitidas: {skipped_duplicates})."
        )

    rel_report = f"agente/revisiones/rev_{ts_tag}.md"
    report_abs = _resolve_inside_workspace(root, rel_report)
    lines = [
        f"# Revisión operativa ({trigger_source})",
        "",
        f"- **Fecha:** {now_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}",
        f"- **Resumen:** {summary}",
        f"- **Artículos evaluados:** {len(items)}",
        f"- **Hallazgos nuevos:** {findings_count}",
        f"- **Omitidos por deduplicación:** {skipped_duplicates}",
        "",
        "## Fuentes escaneadas",
    ]
    for src in sources_scanned:
        lines.append(f"- `{src}`")
    lines.append("")
    if tasks:
        lines.append("## Propuestas generadas")
        for t in tasks:
            sp = t["stagingPayload"]
            lines.append(
                f"- **{t['title']}** (`{sp['sku']}`) · Stock: {sp['currentStock']} {sp['unit']} · "
                f"Orden sugerida: +{sp['recommendedOrder']} {sp['unit']} ({_format_money(sp['estimatedCost'], sp['currency'])})"
            )
    else:
        lines.append("## Propuestas generadas")
        lines.append("- Ninguna acción requerida en esta ejecución.")

    _write_atomic(report_abs, "\n".join(lines) + "\n")

    return {
        "status": "ok",
        "review_type": "inventory_stock",
        "trigger_source": trigger_source,
        "summary": summary,
        "sources_scanned": sources_scanned,
        "analyzed_items_count": len(items),
        "skipped_duplicates_count": skipped_duplicates,
        "findings_count": findings_count,
        "report_path": rel_report,
        "tasks": tasks,
    }
