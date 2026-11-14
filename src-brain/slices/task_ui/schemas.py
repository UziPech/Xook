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


def _recover_spread_text(obj: Dict[str, Any]) -> str:
    """Recupera texto si un string fue propagado accidentalmente como dict {'0':'A','1':'b',...}."""
    numeric_keys = [k for k in obj.keys() if isinstance(k, str) and k.isdigit()]
    if len(numeric_keys) < 2:
        return ""
    numeric_keys.sort(key=lambda k: int(k))
    joined = "".join(str(obj.get(k, "")) for k in numeric_keys).strip()
    return joined


def _normalize_checklist_block(blk: Dict[str, Any]) -> Dict[str, Any]:
    raw_items = blk.get("items") or blk.get("steps") or blk.get("checklist") or []
    if not isinstance(raw_items, list):
        raw_items = []

    clean_items: List[Dict[str, Any]] = []
    seen_ids = set()
    for idx, it in enumerate(raw_items):
        raw_id = ""
        label = ""
        done = False
        if isinstance(it, str):
            label = it.strip()
        elif isinstance(it, dict):
            raw_id = str(it.get("id") or "").strip()
            for k in ("label", "text", "title", "name", "description", "task"):
                val = it.get(k)
                if isinstance(val, str) and val.strip():
                    label = val.strip()
                    break
            if not label:
                label = _recover_spread_text(it)
            done = bool(it.get("done") if "done" in it else it.get("checked", False))

        if not label:
            continue

        item_id = raw_id or f"chk_{idx + 1}"
        if item_id in seen_ids:
            item_id = f"chk_{idx + 1}_{len(seen_ids) + 1}"
        seen_ids.add(item_id)
        clean_items.append({
            "id": item_id,
            "label": label,
            "done": done,
        })

    out: Dict[str, Any] = {"type": "checklist", "items": clean_items}
    title = _as_str(blk.get("title"))
    if title:
        out["title"] = title
    return out


def _normalize_schedule_block(blk: Dict[str, Any], raw_task: Dict[str, Any]) -> Dict[str, Any]:
    mode = _as_str(blk.get("mode")).lower()
    time_label = _as_str(
        blk.get("timeLabel")
        or blk.get("time_label")
        or blk.get("time")
        or blk.get("startTime")
        or blk.get("hour")
    )
    date_label = _as_str(
        blk.get("dateLabel")
        or blk.get("date_label")
        or blk.get("date")
        or blk.get("day")
    )
    recurrence = _as_str(blk.get("recurrence") or blk.get("repeat"))
    auto_trigger = _as_str(blk.get("autoTriggerLabel") or blk.get("auto_trigger_label"))
    duration_seconds = blk.get("durationSeconds")
    if duration_seconds is None and isinstance(blk.get("durationMinutes"), (int, float)):
        duration_seconds = int(blk["durationMinutes"]) * 60

    raw_items = blk.get("items")
    if isinstance(raw_items, list) and raw_items:
        step_parts: List[str] = []
        last_time = ""
        for entry in raw_items:
            if isinstance(entry, dict):
                t = _as_str(entry.get("time") or entry.get("hour") or entry.get("timeLabel"))
                lbl = _as_str(entry.get("label") or entry.get("text") or entry.get("title"))
                if t:
                    last_time = t
                if t and lbl:
                    step_parts.append(f"{t} {lbl}")
                elif lbl:
                    step_parts.append(lbl)
            elif isinstance(entry, str) and entry.strip():
                step_parts.append(entry.strip())

        if not time_label:
            time_label = last_time or _as_str(raw_task.get("statusChip")) or _as_str(blk.get("title"))
        if not date_label:
            date_label = _as_str(blk.get("title"))
        if not auto_trigger and step_parts:
            auto_trigger = " · ".join(step_parts)

    if not time_label:
        time_label = _as_str(raw_task.get("statusChip")) or "Por confirmar"

    if mode not in ("timer", "alarm", "recurring", "auto"):
        if isinstance(duration_seconds, (int, float)) and raw_task.get("category") == "reloj":
            mode = "timer"
        elif recurrence:
            mode = "recurring"
        elif blk.get("autoSchedule"):
            mode = "auto"
        else:
            mode = "alarm"

    out: Dict[str, Any] = {
        "type": "schedule",
        "mode": mode,
        "timeLabel": time_label,
    }
    if date_label:
        out["dateLabel"] = date_label
    if isinstance(duration_seconds, (int, float)):
        out["durationSeconds"] = int(duration_seconds)
    if recurrence:
        out["recurrence"] = recurrence
    if "autoSchedule" in blk:
        out["autoSchedule"] = bool(blk["autoSchedule"])
    if auto_trigger:
        out["autoTriggerLabel"] = auto_trigger
    return out


def _has_explicit_countdown_text(text: str) -> bool:
    return bool(
        re.search(
            r"\b\d+\s*(?:min|mins|minuto|minutos|seg|segs|segundo|segundos)\b",
            text,
            re.IGNORECASE,
        )
    )


def _has_calendar_or_clock_cue(text: str) -> bool:
    return bool(
        re.search(
            r"\b(?:mañana|pasado\s+mañana|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b|\ba\s+las\s+\d{1,2}\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}\s*(?:hrs|a\.m\.|p\.m\.|am|pm)\b",
            text,
            re.IGNORECASE,
        )
    )


def _normalize_task_block(blk: Dict[str, Any], raw_task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    btype = blk.get("type")
    if btype not in ALLOWED_BLOCK_TYPES:
        return None
    if btype == "checklist":
        return _normalize_checklist_block(blk)
    if btype == "schedule":
        return _normalize_schedule_block(blk, raw_task)
    if btype == "note":
        content = _as_str(blk.get("content") or blk.get("text") or blk.get("body"))
        tags = blk.get("tags") if isinstance(blk.get("tags"), list) else []
        out: Dict[str, Any] = {"type": "note", "content": content}
        clean_tags = [str(t).strip() for t in tags if str(t).strip()]
        if clean_tags:
            out["tags"] = clean_tags
        return out
    if btype == "insight":
        text = _as_str(blk.get("text") or blk.get("content") or blk.get("summary"))
        return {"type": "insight", "text": text}
    return blk


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
        if isinstance(blk, dict):
            normalized_blk = _normalize_task_block(blk, raw)
            if normalized_blk is not None:
                safe_blocks.append(normalized_blk)

    title = str(raw.get("title", "Propuesta de acción"))
    raw_intent = dict(raw.get("intent", {})) if isinstance(raw.get("intent"), dict) else {}
    if not raw_intent.get("type"):
        raw_intent["type"] = "schedule_event" if category == "agenda" else "apply_rule"
    if not raw_intent.get("primaryLabel"):
        raw_intent["primaryLabel"] = "Autorizar"
    if not raw_intent.get("targetLabel"):
        raw_intent["targetLabel"] = title

    param_values = dict(raw.get("paramValues", {})) if isinstance(raw.get("paramValues"), dict) else {}
    if raw_intent.get("type") == "start_timer":
        param_mins = param_values.get("duration_min")
        sched_blk = next((b for b in safe_blocks if b.get("type") == "schedule"), None)
        block_secs = sched_blk.get("durationSeconds") if isinstance(sched_blk, dict) else None
        has_positive_duration = (isinstance(param_mins, (int, float)) and param_mins > 0) or (
            isinstance(block_secs, (int, float)) and block_secs > 0
        )
        combined_text = " ".join(
            [
                title,
                _as_str(raw.get("subtitle")),
                _as_str(raw.get("statusChip")),
                _as_str(sched_blk.get("timeLabel") if isinstance(sched_blk, dict) else ""),
                _as_str(sched_blk.get("dateLabel") if isinstance(sched_blk, dict) else ""),
            ]
        )
        looks_like_calendar_event = _has_calendar_or_clock_cue(combined_text) and not _has_explicit_countdown_text(combined_text)
        sched_mode = _as_str(sched_blk.get("mode")) if isinstance(sched_blk, dict) else ""
        if not has_positive_duration or sched_mode in ("alarm", "recurring", "auto") or looks_like_calendar_event:
            raw_intent["type"] = "schedule_event"
            category = "agenda"
            if "reloj" in _as_str(raw_intent.get("primaryLabel")).lower() or "timer" in _as_str(raw_intent.get("primaryLabel")).lower():
                raw_intent["primaryLabel"] = "Agendar recordatorio"
            for b in safe_blocks:
                if b.get("type") == "schedule":
                    b["mode"] = "recurring" if b.get("recurrence") else "alarm"
                    b.pop("durationSeconds", None)

    out: Dict[str, Any] = {
        "cardId": str(raw.get("cardId", "card_gen_01")),
        "title": title,
        "subtitle": raw.get("subtitle"),
        "category": category,
        "urgency": urgency,
        "statusChip": raw.get("statusChip"),
        "defaultExpanded": bool(raw.get("defaultExpanded", False)),
        "generatedBy": raw.get("generatedBy"),
        "blocks": safe_blocks,
        "intent": raw_intent,
        "paramValues": param_values,
    }
    if isinstance(raw.get("dedupKey"), str) and raw.get("dedupKey").strip():
        out["dedupKey"] = raw["dedupKey"].strip()
    if isinstance(raw.get("stagingPayload"), dict):
        out["stagingPayload"] = raw["stagingPayload"]
    return out


ALLOWED_QUESTION_KINDS = frozenset({"choice_or_text", "single", "multi", "text"})


def _infer_fallback_options(prompt: str) -> List[str]:
    low = (prompt or "").lower()
    if any(k in low for k in ("hora", "horario", "cuándo", "cuando", "día", "dia", "fecha")):
        return [
            "Hoy más tarde",
            "Mañana a las 9:00 AM",
            "Esta semana (sugerir horario)",
        ]
    if any(k in low for k in ("actividad", "evento", "incluir", "agenda", "tarea", "pendiente", "reunión", "reunion")):
        return [
            "Revisión de inventario y pedidos",
            "Seguimiento a proveedores y pendientes",
            "Agenda operativa sugerida por Xox",
        ]
    if any(k in low for k in ("formato", "tipo", "dónde", "donde", "canal", "medio")):
        return [
            "En XOOK (Tareas y Agenda)",
            "En Calendario / Notas de Mac",
            "En un documento o tabla",
        ]
    if any(k in low for k in ("proveedor", "compra", "stock", "producto", "inventario", "orden")):
        return [
            "Productos con stock crítico",
            "Proveedor principal habitual",
            "Comparar opciones disponibles",
        ]
    return [
        "Opción recomendada por Xox",
        "Versión rápida y directa",
        "Detallar paso a paso",
    ]


def sanitize_clarification(raw: Any) -> Optional[Dict[str, Any]]:
    """Valida una solicitud estructurada de preguntas abiertas (Open Question) para aclaración HITL."""
    if not isinstance(raw, dict):
        return None
    raw_questions = raw.get("questions") or raw.get("preguntas") or []
    if not isinstance(raw_questions, list):
        return None

    clean_questions: List[Dict[str, Any]] = []
    for idx, q in enumerate(raw_questions[:5]):
        if not isinstance(q, dict):
            continue
        prompt = _as_str(q.get("prompt") or q.get("question") or q.get("label") or q.get("pregunta"))
        if not prompt:
            continue
        q_kind = _as_str(q.get("kind") or q.get("type")).lower()
        raw_opts = q.get("options") or q.get("opciones") or []
        clean_opts: List[str] = []
        if isinstance(raw_opts, list):
            for opt in raw_opts[:6]:
                if isinstance(opt, dict):
                    s = _as_str(opt.get("label") or opt.get("text") or opt.get("value"))
                else:
                    s = _as_str(opt)
                if s and s not in clean_opts:
                    clean_opts.append(s)

        if len(clean_opts) < 2:
            for fallback_opt in _infer_fallback_options(prompt):
                if fallback_opt not in clean_opts:
                    clean_opts.append(fallback_opt)
                if len(clean_opts) >= 3:
                    break

        if q_kind != "multi":
            q_kind = "choice_or_text"

        q_id = _as_str(q.get("id")) or f"q_{idx + 1}"
        placeholder = _as_str(q.get("placeholder")) or "Escribe tu propia respuesta..."
        clean_questions.append({
            "id": q_id,
            "prompt": prompt,
            "kind": q_kind,
            "options": clean_opts,
            "placeholder": placeholder,
            "required": bool(q.get("required", True)),
        })

    if not clean_questions:
        return None

    title = _as_str(raw.get("title") or raw.get("titulo")) or "Aclaremos algunos detalles"
    subtitle = _as_str(raw.get("subtitle") or raw.get("subtitulo") or raw.get("description"))
    original_query = _as_str(raw.get("originalQuery") or raw.get("original_query"))
    submit_label = _as_str(raw.get("submitLabel") or raw.get("submit_label")) or "Enviar respuestas a Xox"

    out: Dict[str, Any] = {
        "id": _as_str(raw.get("id")) or f"clarify_{int(datetime.now(timezone.utc).timestamp())}",
        "title": title,
        "submitLabel": submit_label,
        "questions": clean_questions,
    }
    if subtitle:
        out["subtitle"] = subtitle
    if original_query:
        out["originalQuery"] = original_query
    return out


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


_FENCE_OPEN_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*)$")
_INLINE_CODE_RE = re.compile(r"(`+)(?:(?!\1)[^\n])+\1|`[^`\n]+`")


def _stash_markdown_code(text: str) -> tuple[str, list[str]]:
    stash: list[str] = []

    def _push(raw: str) -> str:
        idx = len(stash)
        stash.append(raw)
        return f"\ue000XOOKCODE_{idx}\ue001"

    lines = text.split("\n")
    out_lines: list[str] = []
    i = 0
    total = len(lines)

    while i < total:
        line = lines[i]
        m = _FENCE_OPEN_RE.match(line)
        fence_char = m.group(2)[0] if m else ""
        fence_len = len(m.group(2)) if m else 0
        info = m.group(3) if m else ""
        valid_open = bool(m and not (fence_char == "`" and "`" in info))

        if valid_open:
            block_lines = [line]
            i += 1
            close_re = re.compile(rf"^\s*{re.escape(fence_char)}{{{fence_len},}}\s*$")
            while i < total:
                block_lines.append(lines[i])
                if close_re.match(lines[i]):
                    i += 1
                    break
                i += 1
            out_lines.append(_push("\n".join(block_lines)))
            continue

        out_lines.append(_INLINE_CODE_RE.sub(lambda match: _push(match.group(0)), line))
        i += 1

    return "\n".join(out_lines), stash


def clean_visible_reply(text: str, *, strip_tables: bool = False) -> str:
    """
    Convierte cualquier tabla HTML (<table> / <tr> huérfano) en Markdown GFM limpio
    y elimina etiquetas residuales como </pdf> o wrappers de streaming antes de enviar a UI.
    Preserva intactos los bloques de código (cerrados o abiertos en streaming).
    """
    out = (text or "").strip()
    if not out:
        return ""

    out, code_stash = _stash_markdown_code(out)

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
        r"<\s*(?:/\s*)?(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|table|thead|tbody|tfoot|tr|th|td)\b[^>]*>",
        "",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"(?:^\s*<\s*(?:res|answer|output|final)\s*>|<\s*/\s*(?:res|answer|output|final)\s*>\s*$|(?:^|\n)[ \t]*<\s*(?:/\s*)?(?:res|answer|output|final)\s*>[ \t]*(?=\n|$))",
        lambda m: "\n" if m.group(0).startswith("\n") else "",
        out,
        flags=re.I,
    )
    out = re.sub(
        r"<\s*/\s*(?:pdf|doc|document|response|respuesta|analysis|analisis|canvas|lienzo|acciones|actions|posta|reply|resp|res|answer|output|final)\s*$",
        "",
        out,
        flags=re.I,
    )
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    if code_stash:
        out = re.sub(
            r"\ue000XOOKCODE_(\d+)\ue001",
            lambda m: code_stash[int(m.group(1))],
            out,
        )
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

