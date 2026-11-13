"""
Contrato declarativo de UI Generativa segura (Zero-Trust) para el motor Python de XOOK.
Refleja 1:1 el esquema TypeScript en `src-ui/features/task-decisions/taskSchema.ts`.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import html
import re
import unicodedata
from typing import Any, Dict, List, Optional

ALLOWED_BLOCK_TYPES = frozenset({
    "metrics_strip",
    "coverage_bar",
    "schedule",
    "checklist",
    "note",
    "comparison",
    "kv_list",
    "param_control",
    "insight",
})

ALLOWED_URGENCY = frozenset({"alta", "media", "baja", "info"})
ALLOWED_CATEGORIES = frozenset({
    "abastecimiento",
    "agenda",
    "reloj",
    "nota",
    "optimizacion",
    "regla",
    "boveda",
})


@dataclass
class TaskProposalSpec:
    cardId: str
    title: str
    category: str
    urgency: str
    blocks: List[Dict[str, Any]]
    intent: Dict[str, Any]
    paramValues: Dict[str, Any] = field(default_factory=dict)
    subtitle: Optional[str] = None
    statusChip: Optional[str] = None
    defaultExpanded: bool = False
    generatedBy: Optional[str] = None


def sanitize_task_proposal(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Valida y filtra cualquier estructura generada por el agente para garantizar
    que sólo existan bloques tipados permitidos (sin código ni HTML libre).
    """
    urgency = raw.get("urgency", "info")
    if urgency not in ALLOWED_URGENCY:
        urgency = "info"

    category = raw.get("category", "abastecimiento")
    if category not in ALLOWED_CATEGORIES:
        category = "abastecimiento"

    safe_blocks: List[Dict[str, Any]] = []
    for blk in raw.get("blocks", []):
        if isinstance(blk, dict) and blk.get("type") in ALLOWED_BLOCK_TYPES:
            safe_blocks.append(blk)

    return {
        "cardId": str(raw.get("cardId", "card_gen_01")),
        "title": str(raw.get("title", "Propuesta de acción")),
        "subtitle": raw.get("subtitle"),
        "category": category,
        "urgency": urgency,
        "statusChip": raw.get("statusChip"),
        "defaultExpanded": bool(raw.get("defaultExpanded", False)),
        "generatedBy": raw.get("generatedBy"),
        "blocks": safe_blocks,
        "intent": dict(raw.get("intent", {})),
        "paramValues": dict(raw.get("paramValues", {})),
    }


ALLOWED_CANVAS_KINDS = frozenset({"comparison", "table", "document"})
ALLOWED_COLUMN_ALIGN = frozenset({"left", "center", "right"})
ALLOWED_COLUMN_KINDS = frozenset({"text", "number", "currency", "badge", "rating"})
ALLOWED_ROW_HIGHLIGHTS = frozenset({"recommended", "warning", "muted"})


def _normalize_col_id(raw_id: str, idx: int, used: set) -> str:
    normalized = unicodedata.normalize("NFD", raw_id or "")
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    slug = re.sub(r"[^a-z0-9]+", "_", stripped.lower()).strip("_")
    base = slug or f"col_{idx + 1}"
    candidate = base
    counter = 2
    while candidate in used:
        candidate = f"{base}_{counter}"
        counter += 1
    used.add(candidate)
    return candidate


def _infer_column_kind(label: str, sample_values: List[str]) -> str:
    lower = label.lower()
    if re.search(r"(precio|costo|margen|total|ingreso|venta|mxn|usd|\$)", lower):
        return "currency"
    if re.search(r"(estado|nivel|prioridad|recomend|etiqueta|categor)", lower):
        return "badge"
    if re.search(r"(calific|puntaje|score|rating|estrella)", lower):
        return "rating"
    non_empty = [v for v in sample_values if v]
    if non_empty and all(
        re.match(r"^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$", v, re.I)
        for v in non_empty
    ):
        return "currency" if any(re.search(r"[$€£]|mxn|usd", v, re.I) for v in non_empty) else "number"
    return "text"


def _infer_column_align(col_kind: str, explicit: Optional[str]) -> str:
    if explicit in ALLOWED_COLUMN_ALIGN:
        return explicit
    if col_kind in ("number", "currency"):
        return "right"
    if col_kind in ("badge", "rating"):
        return "center"
    return "left"


def _norm_lookup_key(raw_key: str) -> str:
    normalized = unicodedata.normalize("NFD", raw_key or "")
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", stripped.lower())


def _as_str(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return "Sí" if value else "No"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dict):
        for k in ("value", "text", "label", "display", "content", "nombre"):
            if k in value:
                nested = _as_str(value[k])
                if nested:
                    return nested
    return ""


def _strip_html_cell_text(raw_html: str) -> str:
    cleaned = re.sub(r"<br\s*/?>", " ", raw_html, flags=re.I)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    return re.sub(r"\s+", " ", html.unescape(cleaned)).strip()


def _parse_html_table_fragment(fragment: str) -> Optional[Dict[str, Any]]:
    row_matches = re.findall(r"<tr\b[^>]*>([\s\S]*?)</tr>", fragment, flags=re.I)
    if not row_matches:
        return None

    parsed_rows: List[List[str]] = []
    first_has_th = False
    for r_idx, row_inner in enumerate(row_matches):
        cell_matches = re.findall(r"<(th|td)\b[^>]*>([\s\S]*?)</\1>", row_inner, flags=re.I)
        if not cell_matches:
            continue
        if r_idx == 0 and any(tag.lower() == "th" for tag, _ in cell_matches):
            first_has_th = True
        parsed_rows.append([_strip_html_cell_text(content) for _, content in cell_matches])

    if len(parsed_rows) < 2 and not (first_has_th and parsed_rows):
        return None
    headers = parsed_rows[0]
    if len(headers) < 2 or all(not h for h in headers):
        return None

    data_rows = parsed_rows[1:]
    if not data_rows:
        return None

    normalized_rows = [
        [row[c] if c < len(row) else "" for c in range(len(headers))]
        for row in data_rows
    ]
    alignments = [
        "right"
        if all(
            not r[idx] or re.match(r"^\s*[$€£]?\s*-?\d[\d.,]*\s*(?:%|mxn|usd)?\s*$", r[idx], re.I)
            for r in normalized_rows
        )
        else "left"
        for idx in range(len(headers))
    ]
    return {"headers": headers, "alignments": alignments, "rows": normalized_rows}


def _extract_html_table(text: str) -> Optional[Dict[str, Any]]:
    if not text or ("<tr" not in text.lower() and "<table" not in text.lower()):
        return None
    table_blocks = re.findall(r"<table\b[^>]*>[\s\S]*?</table>", text, flags=re.I)
    for blk in table_blocks:
        parsed = _parse_html_table_fragment(blk)
        if parsed:
            return parsed
    tr_seq = re.search(r"(?:<tr\b[^>]*>[\s\S]*?</tr>\s*)+", text, flags=re.I)
    if tr_seq:
        return _parse_html_table_fragment(tr_seq.group(0))
    return None


def _table_dict_to_markdown(tbl: Dict[str, Any]) -> str:
    headers = [str(h).replace("|", "\\|") for h in tbl["headers"]]
    aligns = tbl.get("alignments") or ["left"] * len(headers)
    sep = [
        "---:" if a == "right" else ":---:" if a == "center" else "---"
        for a in aligns
    ]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(sep) + " |",
    ]
    for row in tbl["rows"]:
        vals = [str(row[idx] if idx < len(row) else "").replace("|", "\\|").replace("\n", " ") for idx in range(len(headers))]
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines)


def clean_visible_reply(text: str, *, strip_tables: bool = False) -> str:
    """
    Convierte cualquier tabla HTML (<table> / <tr> huérfano) en Markdown GFM limpio
    y elimina etiquetas residuales como </pdf> o wrappers de streaming antes de enviar a UI.
    """
    out = (text or "").strip()
    if not out:
        return ""

    def _replace_html_block(match: re.Match[str]) -> str:
        parsed = _parse_html_table_fragment(match.group(0))
        if not parsed:
            return ""
        return "" if strip_tables else f"\n{_table_dict_to_markdown(parsed)}\n"

    out = re.sub(r"<table\b[^>]*>[\s\S]*?</table>", _replace_html_block, out, flags=re.I)
    out = re.sub(
        r"(?:<tr\b[^>]*>[\s\S]*?</tr>\s*)+(?:\s*</table>)?",
        _replace_html_block,
        out,
        flags=re.I,
    )
    out = re.sub(
        r"</?(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|table|thead|tbody|tfoot|tr|th|td)\b[^>]*>",
        "",
        out,
        flags=re.I,
    )
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def canvas_has_cell_data(canvas: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(canvas, dict):
        return False
    cols = canvas.get("columns") or []
    rows = canvas.get("rows") or []
    if cols:
        if not rows:
            return False
        for row in rows:
            if not isinstance(row, dict):
                continue
            cells = row.get("cells")
            if isinstance(cells, dict) and any(_as_str(v) for v in cells.values()):
                return True
        return False
    return bool(_as_str(canvas.get("markdown")) or _as_str(canvas.get("summary")))


def _split_md_row(line: str) -> List[str]:
    trimmed = line.strip()
    if trimmed.startswith("|"):
        trimmed = trimmed[1:]
    if trimmed.endswith("|"):
        trimmed = trimmed[:-1]
    return [cell.strip() for cell in re.split(r"(?<!\\)\|", trimmed)]


def _extract_markdown_table(markdown: str) -> Optional[Dict[str, Any]]:
    lines = markdown.splitlines()
    for i in range(len(lines) - 1):
        hdr = lines[i].strip()
        sep = lines[i + 1].strip()
        if "|" not in hdr or "|" not in sep or "-" not in sep:
            continue
        sep_cells = _split_md_row(sep)
        if not sep_cells or not all(re.match(r"^:?-{2,}:?$", c.strip()) for c in sep_cells):
            continue
        headers = _split_md_row(hdr)
        if len(headers) < 2:
            continue
        alignments: List[str] = []
        for idx in range(len(headers)):
            sc = sep_cells[idx].strip() if idx < len(sep_cells) else ""
            if sc.startswith(":") and sc.endswith(":"):
                alignments.append("center")
            elif sc.endswith(":"):
                alignments.append("right")
            else:
                alignments.append("left")
        rows: List[List[str]] = []
        for j in range(i + 2, len(lines)):
            row_line = lines[j].strip()
            if not row_line or "|" not in row_line:
                break
            parsed_row = _split_md_row(row_line)
            rows.append([parsed_row[k] if k < len(parsed_row) else "" for k in range(len(headers))])
        return {"headers": headers, "alignments": alignments, "rows": rows}
    return None


def sanitize_canvas_artifact(raw: Any, fallback_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Valida y normaliza un artefacto Canvas (tabla comparativa, tabla o documento)
    generado por el agente mediante tool calling o bloque <canvas>.
    """
    if not isinstance(raw, dict):
        return None

    title = _as_str(raw.get("title") or raw.get("titulo")) or "Tabla en Canvas"
    subtitle = _as_str(raw.get("subtitle") or raw.get("subtitulo")) or None
    summary = _as_str(raw.get("summary") or raw.get("resumen")) or None
    markdown = _as_str(raw.get("markdown") or raw.get("contenido")) or None

    raw_kind = _as_str(raw.get("kind") or raw.get("tipo")).lower()
    if raw_kind in ("comparison", "comparativa"):
        kind = "comparison"
    elif raw_kind in ("document", "documento"):
        kind = "document"
    elif re.search(r"compar|vs|alternativ|opci", title, re.I):
        kind = "comparison"
    else:
        kind = "table"

    raw_cols = (
        raw.get("columns")
        if isinstance(raw.get("columns"), list)
        else raw.get("columnas")
        if isinstance(raw.get("columnas"), list)
        else raw.get("headers")
        if isinstance(raw.get("headers"), list)
        else raw.get("encabezados")
    )
    raw_rows = (
        raw.get("rows")
        if isinstance(raw.get("rows"), list)
        else raw.get("filas")
        if isinstance(raw.get("filas"), list)
        else raw.get("data")
        if isinstance(raw.get("data"), list)
        else raw.get("datos")
        if isinstance(raw.get("datos"), list)
        else raw.get("items")
    )
    raw_cols = raw_cols if isinstance(raw_cols, list) else []
    raw_rows = raw_rows if isinstance(raw_rows, list) else []

    if not raw_cols and not raw_rows and markdown:
        md_tbl = _extract_markdown_table(markdown) or _extract_html_table(markdown)
        if md_tbl:
            raw_cols = [
                {"label": h.replace("**", "").strip() or f"Columna {idx + 1}", "align": md_tbl["alignments"][idx]}
                for idx, h in enumerate(md_tbl["headers"])
            ]
            raw_rows = md_tbl["rows"]
            markdown = None

    used_ids: set = set()
    col_meta: List[Dict[str, Any]] = []
    if raw_cols:
        for idx, col in enumerate(raw_cols):
            if isinstance(col, str):
                label = col.strip() or f"Columna {idx + 1}"
                col_meta.append({"source_keys": [col, label], "label": label, "align": None, "kind": None})
            elif isinstance(col, dict):
                raw_id = _as_str(
                    col.get("id")
                    or col.get("key")
                    or col.get("accessorKey")
                    or col.get("accessor")
                    or col.get("field")
                    or col.get("dataIndex")
                    or col.get("clave")
                    or col.get("slug")
                )
                label = _as_str(
                    col.get("label")
                    or col.get("header")
                    or col.get("title")
                    or col.get("titulo")
                    or col.get("encabezado")
                    or col.get("name")
                    or col.get("nombre")
                    or col.get("text")
                    or col.get("texto")
                ) or raw_id or f"Columna {idx + 1}"
                c_kind = _as_str(col.get("kind") or col.get("type")).lower()
                c_align = _as_str(col.get("align")).lower()
                col_meta.append({
                    "source_keys": list(dict.fromkeys([k for k in (raw_id, label) if k])),
                    "label": label,
                    "align": c_align if c_align in ALLOWED_COLUMN_ALIGN else None,
                    "kind": c_kind if c_kind in ALLOWED_COLUMN_KINDS else None,
                })
    elif raw_rows and isinstance(raw_rows[0], dict):
        first = raw_rows[0]
        cell_src = first.get("cells") if isinstance(first.get("cells"), dict) else first
        for key in cell_src.keys():
            if key in ("id", "highlight", "badge", "destacado", "etiqueta"):
                continue
            col_meta.append({"source_keys": [str(key)], "label": str(key), "align": None, "kind": None})

    now_iso = _as_str(raw.get("updatedAt")) or datetime.now(timezone.utc).isoformat()
    canvas_id = _as_str(raw.get("id")) or fallback_id or f"canvas_{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    if not col_meta:
        if markdown or summary:
            cleaned_md = clean_visible_reply(markdown or summary or "")
            return {
                "id": canvas_id,
                "title": title,
                "subtitle": subtitle,
                "kind": "document",
                "columns": [],
                "rows": [],
                "summary": summary,
                "markdown": cleaned_md or summary,
                "updatedAt": now_iso,
            }
        return None

    col_ids = [_normalize_col_id(m["source_keys"][0] if m["source_keys"] else m["label"], idx, used_ids) for idx, m in enumerate(col_meta)]

    rec_row_raw = raw.get("recommended_row") if raw.get("recommended_row") is not None else raw.get("recommendedRow")
    rec_row_idx: Optional[int] = None
    if isinstance(rec_row_raw, int) and not isinstance(rec_row_raw, bool):
        rec_row_idx = rec_row_raw
    elif isinstance(rec_row_raw, str) and rec_row_raw.strip().lstrip("-").isdigit():
        rec_row_idx = int(rec_row_raw.strip())
    rec_badge_default = _as_str(raw.get("recommended_badge") or raw.get("recommendedBadge")) or "Recomendado"

    normalized_rows: List[Dict[str, Any]] = []
    for r_idx, row in enumerate(raw_rows[:120]):
        cells: Dict[str, str] = {}
        row_id = f"row_{r_idx + 1}"
        highlight: Optional[str] = None
        badge: Optional[str] = None

        if isinstance(row, list):
            for c_idx, cid in enumerate(col_ids):
                cells[cid] = _as_str(row[c_idx]) if c_idx < len(row) else ""
        elif isinstance(row, dict):
            if _as_str(row.get("id")):
                row_id = _as_str(row.get("id"))
            hl = _as_str(row.get("highlight") or row.get("destacado")).lower()
            if hl in ALLOWED_ROW_HIGHLIGHTS:
                highlight = hl
            b = _as_str(row.get("badge") or row.get("etiqueta"))
            if b:
                badge = b

            list_src = None
            for list_key in ("cells", "celdas", "values", "valores", "data", "columns", "cols"):
                if isinstance(row.get(list_key), list):
                    list_src = row[list_key]
                    break

            if list_src is not None:
                for c_idx, cid in enumerate(col_ids):
                    cells[cid] = _as_str(list_src[c_idx]) if c_idx < len(list_src) else ""
            else:
                cell_src = (
                    row.get("cells")
                    if isinstance(row.get("cells"), dict)
                    else row.get("celdas")
                    if isinstance(row.get("celdas"), dict)
                    else row
                )
                norm_map: Dict[str, str] = {}
                for k, v in cell_src.items():
                    nk = _norm_lookup_key(str(k))
                    if nk and nk not in norm_map:
                        norm_map[nk] = _as_str(v)

                for c_idx, cid in enumerate(col_ids):
                    meta = col_meta[c_idx]
                    val = ""
                    # 1. Búsqueda exacta por clave
                    for candidate_key in [cid, *meta["source_keys"], meta["label"]]:
                        if candidate_key in cell_src:
                            val = _as_str(cell_src[candidate_key])
                            if val or cell_src[candidate_key] == 0:
                                break
                    # 2. Búsqueda tolerante normalizada (mayúsculas, acentos, símbolos)
                    if not val:
                        for candidate_key in [cid, *meta["source_keys"], meta["label"]]:
                            nk = _norm_lookup_key(candidate_key)
                            if nk and nk in norm_map and norm_map[nk]:
                                val = norm_map[nk]
                                break
                    cells[cid] = val

                # 3. Respaldo posicional si el modelo usó nombres arbitrarios de clave en cell_src
                if not any(cells.values()):
                    meta_skip = {"id", "highlight", "badge", "destacado", "etiqueta"}
                    ordered_vals = [
                        _as_str(v)
                        for k, v in cell_src.items()
                        if str(k) not in meta_skip
                    ]
                    if any(ordered_vals):
                        for c_idx, cid in enumerate(col_ids):
                            cells[cid] = ordered_vals[c_idx] if c_idx < len(ordered_vals) else ""
        else:
            continue

        if not highlight and rec_row_idx is not None and r_idx == rec_row_idx:
            highlight = "recommended"
            if not badge:
                badge = rec_badge_default

        row_obj: Dict[str, Any] = {"id": row_id, "cells": cells}
        if highlight:
            row_obj["highlight"] = highlight
        if badge:
            row_obj["badge"] = badge
        normalized_rows.append(row_obj)

    columns: List[Dict[str, Any]] = []
    for idx, meta in enumerate(col_meta):
        cid = col_ids[idx]
        samples = [r["cells"].get(cid, "") for r in normalized_rows]
        col_kind = meta["kind"] or _infer_column_kind(meta["label"], samples)
        align = _infer_column_align(col_kind, meta["align"])
        columns.append({
            "id": cid,
            "label": meta["label"],
            "align": align,
            "kind": col_kind,
        })

    out: Dict[str, Any] = {
        "id": canvas_id,
        "title": title,
        "kind": kind if kind in ALLOWED_CANVAS_KINDS else "table",
        "columns": columns,
        "rows": normalized_rows,
        "updatedAt": now_iso,
    }
    if subtitle:
        out["subtitle"] = subtitle
    if summary:
        out["summary"] = summary
    if markdown:
        out["markdown"] = markdown
    return out

