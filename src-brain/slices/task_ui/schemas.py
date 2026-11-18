"""
Contrato declarativo de UI Generativa segura (Zero-Trust) para el motor Python de XOOK.
Refleja 1:1 el esquema TypeScript en `src-ui/features/task-decisions/taskSchema.ts`.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
import html
import json
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


ALLOWED_CANVAS_KINDS = frozenset({
    "comparison",
    "table",
    "document",
    "diagram",
    "plan",
    "dashboard",
    "form",
    "composite",
    "interactive",
    "custom_app",
})
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
    diagram = canvas.get("diagram")
    if isinstance(diagram, dict) and (
        (isinstance(diagram.get("nodes"), list) and len(diagram["nodes"]) > 0)
        or bool(_as_str(diagram.get("mermaid")))
    ):
        return True
    plan = canvas.get("plan")
    if isinstance(plan, dict) and (
        (isinstance(plan.get("phases"), list) and len(plan["phases"]) > 0)
        or bool(_as_str(plan.get("goal")))
    ):
        return True
    dashboard = canvas.get("dashboard")
    if isinstance(dashboard, dict) and (
        (isinstance(dashboard.get("kpis"), list) and len(dashboard["kpis"]) > 0)
        or (isinstance(dashboard.get("charts"), list) and len(dashboard["charts"]) > 0)
        or (isinstance(dashboard.get("insights"), list) and len(dashboard["insights"]) > 0)
    ):
        return True
    form = canvas.get("form")
    if isinstance(form, dict) and isinstance(form.get("fields"), list) and len(form["fields"]) > 0:
        return True
    interactive = canvas.get("interactive")
    if isinstance(interactive, dict) and (
        (isinstance(interactive.get("controls"), list) and len(interactive["controls"]) > 0)
        or (isinstance(interactive.get("computed"), list) and len(interactive["computed"]) > 0)
    ):
        return True
    custom_app = canvas.get("customApp") or canvas.get("custom_app")
    if isinstance(custom_app, dict) and (
        bool(_as_str(custom_app.get("html")))
        or bool(_as_str(custom_app.get("js")))
        or bool(_as_str(custom_app.get("css")))
    ):
        return True
    blocks = canvas.get("blocks")
    if isinstance(blocks, list) and len(blocks) > 0:
        return True
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


def _sanitize_diagram_node_shape(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("pill", "start", "end", "oval", "circle"):
        return "pill"
    if low in ("diamond", "decision", "condicion", "branch"):
        return "diamond"
    if low in ("cylinder", "db", "database", "storage"):
        return "cylinder"
    if low in ("note", "doc", "document"):
        return "note"
    return "rounded"


def _sanitize_diagram_node_tone(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("accent", "primary", "highlight", "info"):
        return "accent"
    if low in ("success", "ok", "done", "positive"):
        return "success"
    if low in ("warning", "warn", "media", "decision"):
        return "warning"
    if low in ("critical", "danger", "error", "alta"):
        return "critical"
    return "neutral"


def _sanitize_diagram_spec(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, str):
        cleaned = raw.strip()
        if not cleaned:
            return None
        return {
            "diagramType": "flowchart",
            "direction": "TD",
            "nodes": [],
            "edges": [],
            "mermaid": cleaned,
        }
    if not isinstance(raw, dict):
        return None

    raw_mermaid = _as_str(
        raw.get("mermaid") or raw.get("mermaid_code") or raw.get("mermaidCode") or raw.get("code")
    )
    raw_type = _as_str(raw.get("diagramType") or raw.get("diagram_type") or raw.get("type") or "flowchart").lower()
    if raw_type in ("sequence", "secuencia"):
        diagram_type = "sequence"
    elif raw_type in ("mindmap", "mapa", "tree"):
        diagram_type = "mindmap"
    elif raw_type in ("process", "proceso"):
        diagram_type = "process"
    else:
        diagram_type = "flowchart"

    raw_dir = _as_str(raw.get("direction") or raw.get("direccion") or "TD").upper()
    direction = "LR" if raw_dir in ("LR", "RL", "HORIZONTAL") else "TD"

    raw_nodes = (
        raw.get("nodes")
        if isinstance(raw.get("nodes"), list)
        else raw.get("nodos")
        if isinstance(raw.get("nodos"), list)
        else raw.get("steps")
        if isinstance(raw.get("steps"), list)
        else []
    )
    raw_edges = (
        raw.get("edges")
        if isinstance(raw.get("edges"), list)
        else raw.get("conexiones")
        if isinstance(raw.get("conexiones"), list)
        else raw.get("links")
        if isinstance(raw.get("links"), list)
        else []
    )

    nodes: List[Dict[str, Any]] = []
    seen_ids: set = set()
    for idx, n in enumerate(raw_nodes[:60]):
        if isinstance(n, str):
            lbl = n.strip()
            if not lbl:
                continue
            nid = f"n_{idx + 1}"
            seen_ids.add(nid)
            nodes.append({"id": nid, "label": lbl, "shape": "rounded", "tone": "neutral"})
            continue
        if not isinstance(n, dict):
            continue
        lbl = _as_str(n.get("label") or n.get("title") or n.get("titulo") or n.get("name") or n.get("nombre"))
        nid = _as_str(n.get("id")) or f"n_{idx + 1}"
        if (not lbl and not nid) or nid in seen_ids:
            continue
        seen_ids.add(nid)
        node_obj: Dict[str, Any] = {
            "id": nid,
            "label": lbl or nid,
            "shape": _sanitize_diagram_node_shape(_as_str(n.get("shape") or n.get("forma"))),
            "tone": _sanitize_diagram_node_tone(_as_str(n.get("tone") or n.get("tono"))),
        }
        sub = _as_str(n.get("subtitle") or n.get("subtitulo"))
        detail = _as_str(n.get("detail") or n.get("detalle") or n.get("description"))
        group = _as_str(n.get("group") or n.get("grupo"))
        if sub:
            node_obj["subtitle"] = sub
        if detail:
            node_obj["detail"] = detail
        if group:
            node_obj["group"] = group
        nodes.append(node_obj)

    edges: List[Dict[str, Any]] = []
    for idx, e in enumerate(raw_edges[:100]):
        if not isinstance(e, dict):
            continue
        src = _as_str(e.get("from") or e.get("source") or e.get("desde") or e.get("origen"))
        dst = _as_str(e.get("to") or e.get("target") or e.get("hacia") or e.get("destino"))
        if not src or not dst:
            continue
        if src not in seen_ids:
            seen_ids.add(src)
            nodes.append({"id": src, "label": src, "shape": "rounded", "tone": "neutral"})
        if dst not in seen_ids:
            seen_ids.add(dst)
            nodes.append({"id": dst, "label": dst, "shape": "rounded", "tone": "neutral"})
        e_style = _as_str(e.get("style") or e.get("estilo")).lower()
        edge_obj: Dict[str, Any] = {
            "id": _as_str(e.get("id")) or f"e_{idx + 1}",
            "from": src,
            "to": dst,
            "style": "dashed" if e_style in ("dashed", "discontinua") else "solid",
        }
        elbl = _as_str(e.get("label") or e.get("etiqueta"))
        if elbl:
            edge_obj["label"] = elbl
        edges.append(edge_obj)

    if not nodes and raw_mermaid:
        return {
            "diagramType": diagram_type,
            "direction": direction,
            "nodes": [],
            "edges": [],
            "mermaid": raw_mermaid,
        }
    if not nodes:
        return None

    if not edges and len(nodes) > 1 and diagram_type in ("process", "flowchart"):
        for idx in range(len(nodes) - 1):
            edges.append({
                "id": f"e_{idx + 1}",
                "from": nodes[idx]["id"],
                "to": nodes[idx + 1]["id"],
                "style": "solid",
            })

    out: Dict[str, Any] = {
        "diagramType": diagram_type,
        "direction": direction,
        "nodes": nodes,
        "edges": edges,
    }
    if raw_mermaid:
        out["mermaid"] = raw_mermaid
    return out


def _sanitize_plan_risk_level(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("high", "alta", "alto", "critical"):
        return "high"
    if low in ("medium", "media", "medio", "moderate"):
        return "medium"
    return "low"


def _sanitize_plan_step_status(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("in_progress", "running"):
        return "in_progress"
    if low in ("done", "completed", "completado"):
        return "done"
    if low in ("skipped", "omitido"):
        return "skipped"
    return "pending"


def _sanitize_plan_spec(raw: Any, fallback_goal: str = "") -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    goal = _as_str(raw.get("goal") or raw.get("objetivo") or raw.get("title")) or fallback_goal or ""
    raw_status = _as_str(raw.get("status") or raw.get("estado") or "draft").lower()
    if raw_status in ("approved", "aprobado"):
        status = "approved"
    elif raw_status in ("in_progress", "en_progreso"):
        status = "in_progress"
    elif raw_status in ("completed", "completado"):
        status = "completed"
    elif raw_status in ("changes_requested", "cambios"):
        status = "changes_requested"
    else:
        status = "draft"

    raw_scope = (
        raw.get("scope")
        if isinstance(raw.get("scope"), list)
        else raw.get("alcance")
        if isinstance(raw.get("alcance"), list)
        else raw.get("files")
        if isinstance(raw.get("files"), list)
        else []
    )
    scope = [_as_str(s) for s in raw_scope if _as_str(s)][:20]

    raw_assumptions = (
        raw.get("assumptions")
        if isinstance(raw.get("assumptions"), list)
        else raw.get("supuestos")
        if isinstance(raw.get("supuestos"), list)
        else []
    )
    assumptions = [_as_str(s) for s in raw_assumptions if _as_str(s)][:12]

    raw_risks = (
        raw.get("risks")
        if isinstance(raw.get("risks"), list)
        else raw.get("riesgos")
        if isinstance(raw.get("riesgos"), list)
        else []
    )
    risks: List[Dict[str, Any]] = []
    for r in raw_risks[:12]:
        if isinstance(r, str):
            if r.strip():
                risks.append({"level": "medium", "text": r.strip()})
            continue
        if not isinstance(r, dict):
            continue
        r_txt = _as_str(r.get("text") or r.get("description") or r.get("riesgo"))
        if not r_txt:
            continue
        r_obj: Dict[str, Any] = {
            "level": _sanitize_plan_risk_level(_as_str(r.get("level") or r.get("severity") or r.get("nivel"))),
            "text": r_txt,
        }
        mit = _as_str(r.get("mitigation") or r.get("mitigacion"))
        if mit:
            r_obj["mitigation"] = mit
        risks.append(r_obj)

    raw_phases = (
        raw.get("phases")
        if isinstance(raw.get("phases"), list)
        else raw.get("fases")
        if isinstance(raw.get("fases"), list)
        else []
    )
    phases: List[Dict[str, Any]] = []
    for p_idx, p in enumerate(raw_phases[:12]):
        if not isinstance(p, dict):
            continue
        p_id = _as_str(p.get("id")) or f"phase_{p_idx + 1}"
        p_title = _as_str(p.get("title") or p.get("titulo") or p.get("name")) or f"Fase {p_idx + 1}"
        p_summary = _as_str(p.get("summary") or p.get("resumen") or p.get("description"))
        p_status = _sanitize_plan_step_status(_as_str(p.get("status") or p.get("estado")))
        p_comment = _as_str(p.get("comment") or p.get("comentario"))
        raw_steps = (
            p.get("steps")
            if isinstance(p.get("steps"), list)
            else p.get("pasos")
            if isinstance(p.get("pasos"), list)
            else p.get("tasks")
            if isinstance(p.get("tasks"), list)
            else []
        )
        steps: List[Dict[str, Any]] = []
        for s_idx, s in enumerate(raw_steps[:20]):
            if isinstance(s, str):
                if s.strip():
                    steps.append({
                        "id": f"{p_id}_step_{s_idx + 1}",
                        "title": s.strip(),
                        "checked": True,
                        "status": "pending",
                    })
                continue
            if not isinstance(s, dict):
                continue
            s_title = _as_str(s.get("title") or s.get("titulo") or s.get("label") or s.get("name"))
            if not s_title:
                continue
            s_obj: Dict[str, Any] = {
                "id": _as_str(s.get("id")) or f"{p_id}_step_{s_idx + 1}",
                "title": s_title,
                "checked": bool(s.get("checked")) if isinstance(s.get("checked"), bool) else True,
                "status": _sanitize_plan_step_status(_as_str(s.get("status") or s.get("estado"))),
            }
            s_detail = _as_str(s.get("detail") or s.get("detalle") or s.get("description"))
            s_target = _as_str(s.get("target") or s.get("archivo") or s.get("area"))
            raw_deps = (
                s.get("dependsOn")
                if isinstance(s.get("dependsOn"), list)
                else s.get("depends_on")
                if isinstance(s.get("depends_on"), list)
                else s.get("depende_de")
                if isinstance(s.get("depende_de"), list)
                else []
            )
            deps = [_as_str(d) for d in raw_deps if _as_str(d)]
            s_risk = _as_str(s.get("risk") or s.get("riesgo"))
            s_comment = _as_str(s.get("comment") or s.get("comentario"))
            if s_detail:
                s_obj["detail"] = s_detail
            if s_target:
                s_obj["target"] = s_target
            if deps:
                s_obj["dependsOn"] = deps
            if s_risk:
                s_obj["risk"] = _sanitize_plan_risk_level(s_risk)
            if s_comment:
                s_obj["comment"] = s_comment
            steps.append(s_obj)

        p_obj: Dict[str, Any] = {
            "id": p_id,
            "title": p_title,
            "status": p_status,
            "steps": steps,
        }
        if p_summary:
            p_obj["summary"] = p_summary
        if p_comment:
            p_obj["comment"] = p_comment
        phases.append(p_obj)

    if not phases and isinstance(raw.get("steps"), list):
        fb_steps: List[Dict[str, Any]] = []
        for s_idx, s in enumerate(raw["steps"][:25]):
            txt = s.strip() if isinstance(s, str) else _as_str((s or {}).get("title") or (s or {}).get("label")) if isinstance(s, dict) else ""
            if txt:
                fb_steps.append({
                    "id": f"step_{s_idx + 1}",
                    "title": txt,
                    "checked": True,
                    "status": "pending",
                })
        if fb_steps:
            phases.append({
                "id": "phase_1",
                "title": "Plan de ejecución",
                "status": "pending",
                "steps": fb_steps,
            })

    if not phases and not goal:
        return None

    out: Dict[str, Any] = {
        "goal": goal or "Plan maestro",
        "status": status,
        "phases": phases,
    }
    if scope:
        out["scope"] = scope
    if assumptions:
        out["assumptions"] = assumptions
    if risks:
        out["risks"] = risks
    rev = _as_str(raw.get("reviewComment") or raw.get("review_comment"))
    if rev:
        out["reviewComment"] = rev
    return out


def _parse_numeric_metric_value(raw: Any) -> Optional[float]:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        cleaned = re.sub(r"[$€£,\s]", "", raw)
        cleaned = re.sub(r"\b(?:mxn|usd|eur|un\.?|u\.?|pzs?)\b", "", cleaned, flags=re.I)
        cleaned = cleaned.rstrip("%").strip()
        if cleaned and re.match(r"^-?\d+(?:\.\d+)?$", cleaned):
            try:
                return float(cleaned)
            except Exception:
                return None
    return None


def _sanitize_metric_tone(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("positive", "success", "ok", "good"):
        return "positive"
    if low in ("warning", "warn", "media", "caution"):
        return "warning"
    if low in ("critical", "danger", "error", "alta", "bad"):
        return "critical"
    return "neutral"


def _sanitize_chart_type(raw: str) -> str:
    low = (raw or "").strip().lower()
    if low in ("horizontal_bar", "hbar", "horizontal", "ranking"):
        return "horizontal_bar"
    if low in ("line", "linea", "línea", "trend"):
        return "line"
    if low in ("area", "área"):
        return "area"
    if low in ("donut", "pie", "dona", "pastel", "ring"):
        return "donut"
    return "bar"


def _sanitize_value_format(raw: str, unit: str = "") -> str:
    low = (raw or "").strip().lower()
    if low in ("currency", "moneda", "money"):
        return "currency"
    if low in ("percent", "percentage", "porcentaje"):
        return "percent"
    if low in ("compact", "compacto"):
        return "compact"
    if low in ("number", "numero", "número"):
        return "number"
    if unit and re.search(r"(\$|mxn|usd|eur)", unit, re.I):
        return "currency"
    if unit and "%" in unit:
        return "percent"
    return "number"


def _sanitize_dashboard_spec(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    raw_kpis = (
        raw.get("kpis")
        if isinstance(raw.get("kpis"), list)
        else raw.get("metrics")
        if isinstance(raw.get("metrics"), list)
        else raw.get("tarjetas")
        if isinstance(raw.get("tarjetas"), list)
        else []
    )
    kpis: List[Dict[str, Any]] = []
    for idx, k in enumerate(raw_kpis[:8]):
        if not isinstance(k, dict):
            continue
        lbl = _as_str(k.get("label") or k.get("title") or k.get("nombre"))
        val = _as_str(k.get("value") or k.get("valor"))
        if not lbl or not val:
            continue
        kpi_obj: Dict[str, Any] = {
            "id": _as_str(k.get("id")) or f"kpi_{idx + 1}",
            "label": lbl,
            "value": val,
            "tone": _sanitize_metric_tone(_as_str(k.get("tone") or k.get("tono"))),
        }
        delta = _as_str(k.get("delta") or k.get("change") or k.get("cambio"))
        if delta:
            kpi_obj["delta"] = delta
            raw_dt = _as_str(k.get("deltaTone") or k.get("delta_tone")).lower()
            if raw_dt in ("positive", "up"):
                kpi_obj["deltaTone"] = "positive"
            elif raw_dt in ("negative", "down"):
                kpi_obj["deltaTone"] = "negative"
            elif delta.strip().startswith("-"):
                kpi_obj["deltaTone"] = "negative"
            elif delta.strip().startswith("+"):
                kpi_obj["deltaTone"] = "positive"
            else:
                kpi_obj["deltaTone"] = "neutral"
        cap = _as_str(k.get("caption") or k.get("sub") or k.get("nota"))
        if cap:
            kpi_obj["caption"] = cap
        prog = _parse_numeric_metric_value(k.get("progress") if "progress" in k else k.get("ratio"))
        if prog is not None:
            norm_prog = prog * 100.0 if 0 < prog <= 1.0 else prog
            kpi_obj["progress"] = round(max(0.0, min(100.0, norm_prog)), 1)
        kpis.append(kpi_obj)

    raw_charts = (
        raw.get("charts")
        if isinstance(raw.get("charts"), list)
        else raw.get("graficas")
        if isinstance(raw.get("graficas"), list)
        else raw.get("graphs")
        if isinstance(raw.get("graphs"), list)
        else [raw["chart"]]
        if isinstance(raw.get("chart"), dict)
        else []
    )
    charts: List[Dict[str, Any]] = []
    for c_idx, c in enumerate(raw_charts[:6]):
        if not isinstance(c, dict):
            continue
        c_title = _as_str(c.get("title") or c.get("titulo")) or f"Gráfica {c_idx + 1}"
        c_sub = _as_str(c.get("subtitle") or c.get("subtitulo"))
        c_type = _sanitize_chart_type(_as_str(c.get("chartType") or c.get("chart_type") or c.get("type") or c.get("tipo")))
        unit = _as_str(c.get("unit") or c.get("unidad"))
        val_fmt = _sanitize_value_format(_as_str(c.get("valueFormat") or c.get("value_format") or c.get("format")), unit)

        raw_cats = (
            c.get("categories")
            if isinstance(c.get("categories"), list)
            else c.get("labels")
            if isinstance(c.get("labels"), list)
            else c.get("categorias")
            if isinstance(c.get("categorias"), list)
            else []
        )
        categories = [_as_str(x) for x in raw_cats if _as_str(x)]

        series: List[Dict[str, Any]] = []
        raw_series = c.get("series") if isinstance(c.get("series"), list) else []
        if raw_series:
            for s_idx, s in enumerate(raw_series[:6]):
                if not isinstance(s, dict):
                    continue
                s_name = _as_str(s.get("name") or s.get("label") or s.get("nombre")) or f"Serie {s_idx + 1}"
                raw_vals = (
                    s.get("values")
                    if isinstance(s.get("values"), list)
                    else s.get("data")
                    if isinstance(s.get("data"), list)
                    else s.get("valores")
                    if isinstance(s.get("valores"), list)
                    else []
                )
                vals = [(_parse_numeric_metric_value(v) or 0.0) for v in raw_vals]
                if not vals:
                    continue
                s_obj: Dict[str, Any] = {
                    "id": _as_str(s.get("id")) or f"s_{s_idx + 1}",
                    "name": s_name,
                    "values": vals,
                }
                raw_tone = _as_str(s.get("tone") or s.get("tono")).lower()
                if raw_tone == "accent":
                    s_obj["tone"] = "accent"
                elif raw_tone:
                    s_obj["tone"] = _sanitize_metric_tone(raw_tone)
                series.append(s_obj)
        elif isinstance(c.get("values"), list):
            vals = [(_parse_numeric_metric_value(v) or 0.0) for v in c["values"]]
            if vals:
                series.append({
                    "id": "s_1",
                    "name": _as_str(c.get("seriesName") or c.get("series_name")) or c_title,
                    "values": vals,
                    "tone": "accent",
                })
        else:
            raw_pts = (
                c.get("data")
                if isinstance(c.get("data"), list)
                else c.get("points")
                if isinstance(c.get("points"), list)
                else c.get("datos")
                if isinstance(c.get("datos"), list)
                else []
            )
            if raw_pts:
                pt_cats: List[str] = []
                pt_vals: List[float] = []
                for pt_idx, pt in enumerate(raw_pts[:32]):
                    if not isinstance(pt, dict):
                        continue
                    pt_lbl = _as_str(pt.get("label") or pt.get("name") or pt.get("category") or pt.get("x")) or f"Item {pt_idx + 1}"
                    pt_num = _parse_numeric_metric_value(
                        pt.get("value")
                        if "value" in pt
                        else pt.get("y")
                        if "y" in pt
                        else pt.get("total")
                        if "total" in pt
                        else pt.get("amount")
                        if "amount" in pt
                        else pt.get("valor")
                    )
                    pt_cats.append(pt_lbl)
                    pt_vals.append(pt_num if pt_num is not None else 0.0)
                if pt_cats:
                    if not categories:
                        categories = pt_cats
                    series.append({
                        "id": "s_1",
                        "name": _as_str(c.get("seriesName")) or unit or c_title,
                        "values": pt_vals,
                        "tone": "accent",
                    })

        if not series:
            continue
        max_len = max([len(categories), *[len(s["values"]) for s in series]])
        if max_len == 0:
            continue
        if not categories:
            categories = [f"#{i + 1}" for i in range(max_len)]
        target_len = min(len(categories), *[len(s["values"]) for s in series], 32)
        if target_len == 0:
            continue

        chart_obj: Dict[str, Any] = {
            "id": _as_str(c.get("id")) or f"chart_{c_idx + 1}",
            "title": c_title,
            "chartType": c_type,
            "categories": categories[:target_len],
            "series": [{**s, "values": s["values"][:target_len]} for s in series],
            "valueFormat": val_fmt,
        }
        if c_sub:
            chart_obj["subtitle"] = c_sub
        if unit:
            chart_obj["unit"] = unit
        t_val = _parse_numeric_metric_value(c.get("targetValue") if "targetValue" in c else c.get("target_value") if "target_value" in c else c.get("meta"))
        if t_val is not None:
            chart_obj["targetValue"] = t_val
        t_lbl = _as_str(c.get("targetLabel") or c.get("target_label"))
        if t_lbl:
            chart_obj["targetLabel"] = t_lbl
        charts.append(chart_obj)

    raw_insights = (
        raw.get("insights")
        if isinstance(raw.get("insights"), list)
        else raw.get("hallazgos")
        if isinstance(raw.get("hallazgos"), list)
        else []
    )
    insights: List[Dict[str, Any]] = []
    for ins in raw_insights[:8]:
        if isinstance(ins, str):
            if ins.strip():
                insights.append({"tone": "info", "text": ins.strip()})
            continue
        if not isinstance(ins, dict):
            continue
        txt = _as_str(ins.get("text") or ins.get("description") or ins.get("contenido"))
        if not txt:
            continue
        rt = _as_str(ins.get("tone") or ins.get("tono")).lower()
        tone = (
            "positive"
            if rt in ("positive", "success")
            else "warning"
            if rt in ("warning", "warn")
            else "critical"
            if rt in ("critical", "danger", "error")
            else "info"
        )
        ins_obj: Dict[str, Any] = {"tone": tone, "text": txt}
        ititle = _as_str(ins.get("title") or ins.get("titulo"))
        if ititle:
            ins_obj["title"] = ititle
        insights.append(ins_obj)

    if not kpis and not charts and not insights:
        return None

    out: Dict[str, Any] = {"kpis": kpis, "charts": charts}
    if insights:
        out["insights"] = insights
    return out


def _normalize_form_field_type(raw_type: Any, raw_obj: Dict[str, Any]) -> str:
    low = (
        unicodedata.normalize("NFD", _as_str(raw_type).lower())
        .encode("ascii", "ignore")
        .decode("ascii")
        .replace("-", "_")
        .replace(" ", "_")
    )
    if low in ("true_false", "boolean", "bool", "verdadero_falso", "vf"):
        return "true_false"
    if low in ("multi_choice", "multi", "checkbox", "checkboxes", "multiple_select", "multiselect", "opcion_multiple_varias"):
        return "multi_choice"
    if low in ("multiple_choice", "opcion_multiple"):
        has_multi = bool(
            isinstance(raw_obj.get("correctIndices"), list)
            or isinstance(raw_obj.get("correct_indices"), list)
            or raw_obj.get("multi") is True
            or raw_obj.get("allowMultiple") is True
        )
        return "multi_choice" if has_multi else "single_choice"
    if low in ("single_choice", "single", "choice", "mcq", "radio", "opcion_unica"):
        return "single_choice"
    if low in ("select", "dropdown", "lista", "desplegable"):
        return "select"
    if low in ("number", "numeric", "numero", "integer", "float", "decimal"):
        return "number"
    if low in ("rating", "stars", "scale", "escala", "calificacion"):
        return "rating"
    if low in ("long_text", "textarea", "paragraph", "essay", "open_ended", "abierta", "texto_largo"):
        return "long_text"
    if low in ("short_text", "text", "short", "input", "texto_corto", "open"):
        return "short_text"
    if any(isinstance(raw_obj.get(k), list) for k in ("options", "opciones", "choices")):
        return "single_choice"
    return "short_text"


def _resolve_form_option_index(raw_val: Any, options: List[str], field_type: str) -> Optional[int]:
    if isinstance(raw_val, bool) and field_type == "true_false":
        return 0 if raw_val else 1
    if isinstance(raw_val, int) and not isinstance(raw_val, bool):
        return raw_val if 0 <= raw_val < len(options) else None
    s = _as_str(raw_val)
    if not s:
        return None
    if re.fullmatch(r"\d+", s):
        idx = int(s)
        return idx if 0 <= idx < len(options) else None
    if field_type == "true_false":
        low = s.lower()
        if low in ("true", "verdadero", "v", "si", "sí", "yes"):
            return 0
        if low in ("false", "falso", "f", "no"):
            return 1
    if re.fullmatch(r"[A-Za-z]", s) and len(options) >= 2:
        idx = ord(s.upper()) - 65
        if 0 <= idx < len(options):
            return idx
    low_target = s.lower()
    for idx, opt in enumerate(options):
        if opt.lower() == low_target:
            return idx
    for idx, opt in enumerate(options):
        if low_target in opt.lower() or opt.lower() in low_target:
            return idx
    return None


def _sanitize_form_spec(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    raw_fields = next(
        (
            raw.get(k)
            for k in ("fields", "questions", "preguntas", "campos", "items")
            if isinstance(raw.get(k), list)
        ),
        [],
    )

    fields: List[Dict[str, Any]] = []
    used_ids = set()
    has_quiz_markers = False

    for idx, item in enumerate(raw_fields[:35]):
        if not isinstance(item, dict):
            continue
        label = _as_str(
            item.get("label")
            or item.get("question")
            or item.get("pregunta")
            or item.get("prompt")
            or item.get("title")
            or item.get("titulo")
            or item.get("texto")
        )
        if not label:
            continue

        raw_type = item.get("type") or item.get("tipo") or item.get("kind")
        ftype = _normalize_form_field_type(raw_type, item)

        raw_opts = next(
            (item.get(k) for k in ("options", "opciones", "choices") if isinstance(item.get(k), list)),
            [],
        )
        options: List[str] = []
        for opt in raw_opts[:12]:
            if isinstance(opt, (str, int, float, bool)):
                val = _as_str(opt)
            elif isinstance(opt, dict):
                val = _as_str(opt.get("label") or opt.get("text") or opt.get("value") or opt.get("texto"))
            else:
                val = ""
            if val:
                options.append(val)

        if ftype == "true_false" and not options:
            options = ["Verdadero", "Falso"]
        if ftype in ("single_choice", "multi_choice", "select") and not options:
            ftype = "short_text"

        base_id = _as_str(item.get("id")) or f"f_{idx + 1}"
        fid = re.sub(r"[^a-zA-Z0-9_-]+", "_", base_id) or f"f_{idx + 1}"
        if fid in used_ids:
            fid = f"{fid}_{idx + 1}"
        used_ids.add(fid)

        raw_correct_idx = None
        for k in ("correctIndex", "correct_index", "correctAnswerIndex", "indice_correcto", "correct_option", "correct_answer", "correctAnswer"):
            if item.get(k) is not None:
                raw_correct_idx = item.get(k)
                break
        correct_index = _resolve_form_option_index(raw_correct_idx, options, ftype) if options else None

        raw_correct_indices = next(
            (
                item.get(k)
                for k in ("correctIndices", "correct_indices", "correct_answers")
                if isinstance(item.get(k), list)
            ),
            None,
        )
        correct_indices: Optional[List[int]] = None
        if raw_correct_indices is not None and options:
            resolved = [
                r
                for c in raw_correct_indices
                for r in [_resolve_form_option_index(c, options, ftype)]
                if r is not None
            ]
            if resolved:
                correct_indices = sorted(set(resolved))

        expected_answer = _as_str(
            item.get("expectedAnswer")
            or item.get("expected_answer")
            or item.get("model_answer")
            or item.get("respuesta_esperada")
        )
        hint = _as_str(item.get("hint") or item.get("pista"))
        explanation = _as_str(item.get("explanation") or item.get("explicacion"))
        placeholder = _as_str(item.get("placeholder"))

        if (
            correct_index is not None
            or correct_indices is not None
            or expected_answer
            or explanation
            or hint
        ):
            has_quiz_markers = True

        field_obj: Dict[str, Any] = {
            "id": fid,
            "label": label,
            "type": ftype,
            "required": bool(item.get("required") is True or item.get("obligatorio") is True),
        }
        if placeholder:
            field_obj["placeholder"] = placeholder
        if options:
            field_obj["options"] = options
        if correct_index is not None:
            field_obj["correctIndex"] = correct_index
        if correct_indices is not None:
            field_obj["correctIndices"] = correct_indices
        if expected_answer:
            field_obj["expectedAnswer"] = expected_answer
        if hint:
            field_obj["hint"] = hint
        if explanation:
            field_obj["explanation"] = explanation

        pts = item.get("points") if item.get("points") is not None else item.get("puntos")
        if isinstance(pts, (int, float)) and not isinstance(pts, bool) and pts > 0:
            field_obj["points"] = pts
        for bound_key in ("min", "max"):
            bv = item.get(bound_key)
            if isinstance(bv, (int, float)) and not isinstance(bv, bool):
                field_obj[bound_key] = bv

        fields.append(field_obj)

    if not fields:
        return None

    raw_purpose = _as_str(
        raw.get("purpose") or raw.get("proposito") or raw.get("mode") or raw.get("form_type")
    ).lower()
    if raw_purpose in ("study_quiz", "quiz", "exam", "examen", "cuestionario", "practica", "study", "repaso", "autoevaluacion"):
        purpose = "study_quiz"
    elif raw_purpose in ("survey", "encuesta", "feedback"):
        purpose = "survey"
    elif raw_purpose in ("data_capture", "capture", "form", "formulario", "registro"):
        purpose = "data_capture"
    else:
        purpose = "study_quiz" if has_quiz_markers else "data_capture"

    out: Dict[str, Any] = {
        "purpose": purpose,
        "fields": fields,
    }
    desc = _as_str(raw.get("description") or raw.get("descripcion") or raw.get("instructions") or raw.get("instrucciones"))
    if desc:
        out["description"] = desc
    submit_label = _as_str(raw.get("submitLabel") or raw.get("submit_label"))
    if submit_label:
        out["submitLabel"] = submit_label
    pass_pct = raw.get("passingScorePercent") or raw.get("passing_score_percent") or raw.get("min_score")
    if isinstance(pass_pct, (int, float)) and not isinstance(pass_pct, bool) and 0 < pass_pct <= 100:
        out["passingScorePercent"] = round(pass_pct)
    if isinstance(raw.get("showHints"), bool):
        out["showHints"] = raw["showHints"]
    elif isinstance(raw.get("show_hints"), bool):
        out["showHints"] = raw["show_hints"]
    elif purpose == "study_quiz":
        out["showHints"] = True

    field_ids = {f["id"] for f in fields}
    if isinstance(raw.get("answers"), dict):
        clean_ans = {
            k: v
            for k, v in raw["answers"].items()
            if k in field_ids and (isinstance(v, (str, int, float, bool)) or (isinstance(v, list) and all(isinstance(n, int) for n in v)))
        }
        if clean_ans:
            out["answers"] = clean_ans
    if raw.get("checkedLocally") is True:
        out["checkedLocally"] = True
    if raw.get("submitted") is True:
        out["submitted"] = True
    if _as_str(raw.get("submittedAt")):
        out["submittedAt"] = _as_str(raw.get("submittedAt"))
    if isinstance(raw.get("score"), dict):
        out["score"] = raw["score"]

    return out


ALLOWED_INTERACTIVE_CONTROL_TYPES = frozenset({
    "number",
    "slider",
    "toggle",
    "select",
    "segmented",
    "text",
    "textarea",
    "checklist",
    "kanban",
})


def _sanitize_interactive_spec(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None

    raw_controls = next(
        (
            raw.get(k)
            for k in ("controls", "controles", "widgets", "fields", "campos", "items")
            if isinstance(raw.get(k), list)
        ),
        [],
    )
    raw_computed = next(
        (
            raw.get(k)
            for k in ("computed", "calculos", "metrics", "resultados", "kpis")
            if isinstance(raw.get(k), list)
        ),
        [],
    )
    raw_tabs = next(
        (raw.get(k) for k in ("tabs", "pestanas") if isinstance(raw.get(k), list)),
        [],
    )
    raw_actions = next(
        (raw.get(k) for k in ("actions", "acciones", "buttons", "botones") if isinstance(raw.get(k), list)),
        [],
    )

    tabs: List[Dict[str, Any]] = []
    used_tab_ids: set = set()
    for t_idx, t in enumerate(raw_tabs[:8]):
        if isinstance(t, str) and t.strip():
            tid = _normalize_col_id(t, t_idx, used_tab_ids)
            tabs.append({"id": tid, "label": t.strip()})
            continue
        if not isinstance(t, dict):
            continue
        tlbl = _as_str(t.get("label") or t.get("title") or t.get("titulo") or t.get("name"))
        if not tlbl:
            continue
        tid_raw = _as_str(t.get("id")) or tlbl
        tid = _normalize_col_id(tid_raw, t_idx, used_tab_ids)
        t_obj: Dict[str, Any] = {"id": tid, "label": tlbl}
        tdesc = _as_str(t.get("description") or t.get("descripcion"))
        if tdesc:
            t_obj["description"] = tdesc
        tabs.append(t_obj)

    state: Dict[str, Any] = {}
    raw_state = raw.get("state") if isinstance(raw.get("state"), dict) else raw.get("estado")
    if isinstance(raw_state, dict):
        for k, v in list(raw_state.items())[:60]:
            ks = _as_str(k)
            if not ks:
                continue
            if isinstance(v, (str, int, float, bool)):
                state[ks] = v
            elif isinstance(v, list):
                state[ks] = [_as_str(x) for x in v[:100] if _as_str(x)]

    controls: List[Dict[str, Any]] = []
    used_ctrl_ids: set = set()
    for c_idx, item in enumerate(raw_controls[:30]):
        if not isinstance(item, dict):
            continue
        lbl = _as_str(item.get("label") or item.get("title") or item.get("titulo") or item.get("name"))
        if not lbl:
            continue
        raw_t = _as_str(item.get("type") or item.get("tipo") or item.get("kind")).lower().replace("-", "_").replace(" ", "_")
        if raw_t in ("range", "deslizador"):
            ctype = "slider"
        elif raw_t in ("bool", "boolean", "switch", "checkbox"):
            ctype = "toggle"
        elif raw_t in ("dropdown", "lista"):
            ctype = "select"
        elif raw_t in ("radio", "pills", "segmentado", "tabs"):
            ctype = "segmented"
        elif raw_t in ("textarea", "long_text", "texto_largo"):
            ctype = "textarea"
        elif raw_t in ("checklist", "lista_verificacion", "tasks"):
            ctype = "checklist"
        elif raw_t in ("kanban", "board", "tablero"):
            ctype = "kanban"
        elif raw_t in ("number", "numeric", "numero", "currency", "money"):
            ctype = "number"
        elif raw_t in ALLOWED_INTERACTIVE_CONTROL_TYPES:
            ctype = raw_t
        else:
            ctype = "slider" if (item.get("min") is not None and item.get("max") is not None) else (
                "checklist" if isinstance(item.get("items"), list) else (
                    "select" if isinstance(item.get("options"), list) else "text"
                )
            )

        cid = _normalize_col_id(_as_str(item.get("id")) or lbl, c_idx, used_ctrl_ids)
        state_key = _as_str(item.get("stateKey") or item.get("state_key") or item.get("key") or item.get("var")) or cid

        ctrl: Dict[str, Any] = {
            "id": cid,
            "stateKey": state_key,
            "label": lbl,
            "type": ctype,
        }
        helper = _as_str(item.get("helperText") or item.get("helper_text") or item.get("description") or item.get("hint"))
        if helper:
            ctrl["helperText"] = helper
        tab_id = _as_str(item.get("tabId") or item.get("tab_id") or item.get("tab"))
        if tab_id:
            ctrl["tabId"] = tab_id
        unit = _as_str(item.get("unit") or item.get("unidad"))
        if unit:
            ctrl["unit"] = unit
        prefix = _as_str(item.get("prefix") or item.get("prefijo"))
        if prefix:
            ctrl["prefix"] = prefix
        placeholder = _as_str(item.get("placeholder"))
        if placeholder:
            ctrl["placeholder"] = placeholder

        for num_k in ("min", "max", "step"):
            nv = _parse_numeric_metric_value(item.get(num_k))
            if nv is not None:
                ctrl[num_k] = nv

        raw_opts = next((item.get(k) for k in ("options", "opciones", "choices") if isinstance(item.get(k), list)), None)
        if raw_opts is not None:
            opts = [_as_str(o) for o in raw_opts[:20] if _as_str(o)]
            if opts:
                ctrl["options"] = opts

        raw_cols = next((item.get(k) for k in ("columns", "columnas") if isinstance(item.get(k), list)), None)
        if raw_cols is not None:
            k_cols: List[Dict[str, str]] = []
            for kc_idx, kc in enumerate(raw_cols[:8]):
                if isinstance(kc, str) and kc.strip():
                    k_cols.append({"id": _normalize_col_id(kc, kc_idx, set()), "label": kc.strip()})
                elif isinstance(kc, dict):
                    klbl = _as_str(kc.get("label") or kc.get("title") or kc.get("name"))
                    kid = _as_str(kc.get("id")) or _normalize_col_id(klbl or f"col_{kc_idx+1}", kc_idx, set())
                    if klbl or kid:
                        k_cols.append({"id": kid, "label": klbl or kid})
            if k_cols:
                ctrl["columns"] = k_cols

        raw_items = next((item.get(k) for k in ("items", "elementos", "cards") if isinstance(item.get(k), list)), None)
        if raw_items is not None:
            c_items: List[Dict[str, Any]] = []
            used_item_ids: set = set()
            for it_idx, it in enumerate(raw_items[:80]):
                if isinstance(it, str) and it.strip():
                    iid = f"it_{it_idx + 1}"
                    used_item_ids.add(iid)
                    c_items.append({"id": iid, "label": it.strip()})
                elif isinstance(it, dict):
                    ilbl = _as_str(it.get("label") or it.get("title") or it.get("titulo") or it.get("name") or it.get("text"))
                    if not ilbl:
                        continue
                    iid = _as_str(it.get("id")) or f"it_{it_idx + 1}"
                    if iid in used_item_ids:
                        iid = f"{iid}_{it_idx + 1}"
                    used_item_ids.add(iid)
                    it_obj: Dict[str, Any] = {"id": iid, "label": ilbl}
                    idetail = _as_str(it.get("detail") or it.get("detalle") or it.get("subtitle"))
                    if idetail:
                        it_obj["detail"] = idetail
                    ibadge = _as_str(it.get("badge") or it.get("tag") or it.get("etiqueta"))
                    if ibadge:
                        it_obj["badge"] = ibadge
                    icol = _as_str(it.get("column") or it.get("columna") or it.get("stage") or it.get("status"))
                    if icol:
                        it_obj["column"] = icol
                    if isinstance(it.get("checked"), bool):
                        it_obj["checked"] = it["checked"]
                    c_items.append(it_obj)
            if c_items:
                ctrl["items"] = c_items

        # Inicializar valor en `state` si el usuario no lo definió explícitamente
        if state_key not in state:
            default_val = item.get("defaultValue") if "defaultValue" in item else item.get("default_value") if "default_value" in item else item.get("value")
            if default_val is not None:
                if isinstance(default_val, (str, int, float, bool)):
                    state[state_key] = default_val
                elif isinstance(default_val, list):
                    state[state_key] = [_as_str(x) for x in default_val if _as_str(x)]
            elif ctype in ("number", "slider"):
                state[state_key] = ctrl.get("min", 0)
            elif ctype == "toggle":
                state[state_key] = False
            elif ctype in ("select", "segmented") and ctrl.get("options"):
                state[state_key] = ctrl["options"][0]
            elif ctype == "checklist":
                state[state_key] = [
                    it["id"] for it in ctrl.get("items", []) if it.get("checked") is True
                ]
            elif ctype == "kanban":
                cols_list = ctrl.get("columns") or [{"id": "pendiente", "label": "Pendiente"}, {"id": "en_curso", "label": "En curso"}, {"id": "listo", "label": "Listo"}]
                if "columns" not in ctrl:
                    ctrl["columns"] = cols_list
                first_col_id = cols_list[0]["id"]
                col_lookup = {c["id"].lower(): c["id"] for c in cols_list}
                for c in cols_list:
                    col_lookup[c["label"].strip().lower()] = c["id"]
                kmap = {
                    it["id"]: col_lookup.get(str(it.get("column") or "").strip().lower(), first_col_id)
                    for it in ctrl.get("items", [])
                }
                state[state_key] = json.dumps(kmap, ensure_ascii=False)
            else:
                state[state_key] = ""

        vis_ctrl = _as_str(item.get("visibleWhen") or item.get("visible_when") or item.get("show_if"))
        if vis_ctrl:
            ctrl["visibleWhen"] = vis_ctrl

        controls.append(ctrl)

    computed: List[Dict[str, Any]] = []
    for m_idx, m in enumerate(raw_computed[:16]):
        if not isinstance(m, dict):
            continue
        mlbl = _as_str(m.get("label") or m.get("title") or m.get("titulo") or m.get("name"))
        expr = _as_str(m.get("expr") or m.get("formula") or m.get("expression"))
        if not mlbl or not expr:
            continue
        fmt = _as_str(m.get("format") or m.get("valueFormat") or m.get("value_format")).lower()
        if fmt not in ("number", "currency", "percent", "text"):
            fmt = "currency" if "$" in _as_str(m.get("unit")) else ("percent" if "%" in _as_str(m.get("unit")) else "number")
        comp_obj: Dict[str, Any] = {
            "id": _as_str(m.get("id")) or f"comp_{m_idx + 1}",
            "label": mlbl,
            "expr": expr,
            "format": fmt,
            "tone": _sanitize_metric_tone(_as_str(m.get("tone") or m.get("tono"))),
        }
        m_role = _as_str(m.get("role") or m.get("rol") or m.get("tier")).lower()
        if m_role in ("hero", "primary", "principal"):
            comp_obj["role"] = "hero"
        elif m_role in ("breakdown", "desglose", "step", "secondary", "secundario"):
            comp_obj["role"] = "breakdown"
        m_vis = _as_str(m.get("visibleWhen") or m.get("visible_when") or m.get("show_if"))
        if m_vis:
            comp_obj["visibleWhen"] = m_vis
        m_unit = _as_str(m.get("unit") or m.get("unidad"))
        if m_unit:
            comp_obj["unit"] = m_unit
        m_cap = _as_str(m.get("caption") or m.get("subtitle") or m.get("nota"))
        if m_cap:
            comp_obj["caption"] = m_cap
        m_tab = _as_str(m.get("tabId") or m.get("tab_id") or m.get("tab"))
        if m_tab:
            comp_obj["tabId"] = m_tab
        computed.append(comp_obj)

    actions: List[Dict[str, Any]] = []
    for a_idx, a in enumerate(raw_actions[:6]):
        if not isinstance(a, dict):
            continue
        albl = _as_str(a.get("label") or a.get("title") or a.get("text"))
        if not albl:
            continue
        atype = _as_str(a.get("action") or a.get("type")).lower()
        if atype not in ("send_to_xox", "reset"):
            atype = "reset" if "reset" in albl.lower() or "reinic" in albl.lower() else "send_to_xox"
        astyle = _as_str(a.get("style")).lower()
        act_obj: Dict[str, Any] = {
            "id": _as_str(a.get("id")) or f"act_{a_idx + 1}",
            "label": albl,
            "style": "secondary" if astyle == "secondary" or atype == "reset" else "primary",
            "action": atype,
        }
        ptpl = _as_str(a.get("promptTemplate") or a.get("prompt_template") or a.get("prompt"))
        if ptpl:
            act_obj["promptTemplate"] = ptpl
        actions.append(act_obj)

    if not controls and not computed:
        return None

    raw_layout = _as_str(raw.get("layout")).lower()
    layout = raw_layout if raw_layout in ("stack", "grid", "split", "tabs") else ("tabs" if tabs else "stack")

    out: Dict[str, Any] = {
        "layout": layout,
        "state": state,
        "controls": controls,
    }
    desc = _as_str(raw.get("description") or raw.get("descripcion"))
    if desc:
        out["description"] = desc
    if tabs:
        out["tabs"] = tabs
    if computed:
        out["computed"] = computed
    if actions:
        out["actions"] = actions
    if raw.get("submitted") is True:
        out["submitted"] = True
    if _as_str(raw.get("submittedAt")):
        out["submittedAt"] = _as_str(raw.get("submittedAt"))
    return out


def _strip_unsafe_external_html_tags(code: str) -> str:
    if not code:
        return ""
    out = re.sub(r"<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?</script>", "", code, flags=re.I)
    out = re.sub(r"<link\b[^>]*\bhref\s*=\s*[\"']?(?:https?:)?//[^>]*>", "", out, flags=re.I)
    out = re.sub(r"<(?:iframe|object|embed|base)\b[^>]*?(?:>[\s\S]*?</(?:iframe|object|embed)>|/>|>)", "", out, flags=re.I)
    out = re.sub(r"<meta\b[^>]*http-equiv\s*=\s*[\"']?refresh[^>]*>", "", out, flags=re.I)
    return out.strip()


def _sanitize_custom_app_spec(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    html_raw = str(raw.get("html") or raw.get("body") or raw.get("markup") or "").strip()
    css_raw = str(raw.get("css") or raw.get("styles") or "").strip()
    js_raw = str(raw.get("js") or raw.get("script") or "").strip()
    html_clean = _strip_unsafe_external_html_tags(html_raw)
    if not html_clean and not css_raw and not js_raw:
        return None

    out: Dict[str, Any] = {
        "html": html_clean or "<div id=\"app\"></div>",
    }
    if css_raw:
        out["css"] = css_raw[:35000]
    if js_raw:
        out["js"] = js_raw[:45000]
    desc = _as_str(raw.get("description") or raw.get("descripcion"))
    if desc:
        out["description"] = desc
    raw_state = raw.get("state") if isinstance(raw.get("state"), dict) else raw.get("initial_state")
    if isinstance(raw_state, dict):
        out["state"] = raw_state
    h_raw = _parse_numeric_metric_value(raw.get("height"))
    if h_raw is not None:
        out["height"] = max(260, min(780, int(round(h_raw))))
    saved_path = _as_str(raw.get("savedAppPath") or raw.get("saved_app_path"))
    if saved_path:
        out["savedAppPath"] = saved_path
    return out


def _sanitize_canvas_blocks(raw_blocks: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_blocks, list):
        return []
    blocks: List[Dict[str, Any]] = []
    for blk in raw_blocks[:20]:
        if not isinstance(blk, dict):
            continue
        btype = _as_str(blk.get("type") or blk.get("kind")).lower()
        btitle = _as_str(blk.get("title") or blk.get("titulo"))
        if btype in ("callout", "alert", "tip", "warning"):
            txt = _as_str(blk.get("text") or blk.get("content") or blk.get("texto"))
            if not txt:
                continue
            tone = _as_str(blk.get("tone") or blk.get("tono") or (btype if btype in ("warning",) else "")).lower()
            if tone not in ("info", "warning", "success", "critical"):
                tone = "warning" if btype == "alert" else "info"
            item: Dict[str, Any] = {"type": "callout", "text": txt, "tone": tone}
            if btitle:
                item["title"] = btitle
            blocks.append(item)
        elif btype in ("markdown", "text", "paragraph", "prose", "note", "resumen"):
            content = _as_str(blk.get("content") or blk.get("markdown") or blk.get("text"))
            if not content:
                continue
            item = {"type": "markdown", "content": content}
            if btitle:
                item["title"] = btitle
            blocks.append(item)
        elif btype == "diagram":
            d_src = blk.get("diagram") if isinstance(blk.get("diagram"), dict) else blk
            diag = _sanitize_diagram_spec(d_src)
            if diag:
                item = {"type": "diagram", "diagram": diag}
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
        elif btype == "plan":
            p_src = blk.get("plan") if isinstance(blk.get("plan"), dict) else blk
            pln = _sanitize_plan_spec(p_src, btitle)
            if pln:
                item = {"type": "plan", "plan": pln}
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
        elif btype == "dashboard":
            ds_src = blk.get("dashboard") if isinstance(blk.get("dashboard"), dict) else blk
            dash = _sanitize_dashboard_spec(ds_src)
            if dash:
                item = {"type": "dashboard", "dashboard": dash}
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
        elif btype == "form":
            f_src = blk.get("form") if isinstance(blk.get("form"), dict) else blk
            frm = _sanitize_form_spec(f_src)
            if frm:
                item = {"type": "form", "form": frm}
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
        elif btype == "interactive":
            i_src = blk.get("interactive") if isinstance(blk.get("interactive"), dict) else blk
            inter = _sanitize_interactive_spec(i_src)
            if inter:
                item = {"type": "interactive", "interactive": inter}
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
        elif btype == "table":
            tbl_canvas = sanitize_canvas_artifact({
                "title": btitle or "Tabla",
                "columns": blk.get("columns") or blk.get("headers"),
                "rows": blk.get("rows") or blk.get("data"),
            })
            if tbl_canvas and tbl_canvas.get("columns") and tbl_canvas.get("rows"):
                item = {
                    "type": "table",
                    "columns": tbl_canvas["columns"],
                    "rows": tbl_canvas["rows"],
                }
                if btitle:
                    item["title"] = btitle
                blocks.append(item)
    return blocks


def apply_canvas_patch(base_canvas: Dict[str, Any], patch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Aplica una actualización incremental (`update_canvas`) sobre un artefacto Canvas existente
    manteniendo su `id` y preservando los datos no modificados.
    """
    if not isinstance(base_canvas, dict) or not isinstance(patch, dict):
        return None
    merged = json.loads(json.dumps(base_canvas))
    if _as_str(patch.get("title")):
        merged["title"] = _as_str(patch.get("title"))
    if "subtitle" in patch:
        sub = _as_str(patch.get("subtitle"))
        if sub:
            merged["subtitle"] = sub
        else:
            merged.pop("subtitle", None)
    if "summary" in patch:
        sm = _as_str(patch.get("summary"))
        if sm:
            merged["summary"] = sm
        else:
            merged.pop("summary", None)
    if "markdown" in patch and patch.get("markdown") is not None:
        merged["markdown"] = str(patch.get("markdown"))

    # Parches sobre tablas existentes
    if isinstance(patch.get("columns"), list) and patch["columns"]:
        merged["columns"] = patch["columns"]
    if isinstance(patch.get("rows"), list):
        merged["rows"] = patch["rows"]
    elif isinstance(patch.get("append_rows"), list) and isinstance(merged.get("columns"), list) and merged["columns"]:
        existing_rows = list(merged.get("rows") or [])
        existing_rows.extend(patch["append_rows"])
        merged["rows"] = existing_rows

    if isinstance(patch.get("diagram"), dict) or patch.get("nodes") or patch.get("edges"):
        d_src = patch.get("diagram") if isinstance(patch.get("diagram"), dict) else patch
        base_d = dict(merged.get("diagram") or {})
        base_d.update({k: v for k, v in d_src.items() if v is not None})
        merged["diagram"] = base_d
        merged["kind"] = "diagram"

    if isinstance(patch.get("plan"), dict) or patch.get("phases"):
        p_src = patch.get("plan") if isinstance(patch.get("plan"), dict) else patch
        base_p = dict(merged.get("plan") or {})
        base_p.update({k: v for k, v in p_src.items() if v is not None})
        merged["plan"] = base_p
        merged["kind"] = "plan"

    if isinstance(patch.get("dashboard"), dict) or patch.get("kpis") or patch.get("charts"):
        ds_src = patch.get("dashboard") if isinstance(patch.get("dashboard"), dict) else patch
        base_ds = dict(merged.get("dashboard") or {})
        base_ds.update({k: v for k, v in ds_src.items() if v is not None})
        merged["dashboard"] = base_ds
        merged["kind"] = "dashboard"

    if isinstance(patch.get("form"), dict) or patch.get("fields"):
        f_src = patch.get("form") if isinstance(patch.get("form"), dict) else patch
        base_f = dict(merged.get("form") or {})
        base_f.update({k: v for k, v in f_src.items() if v is not None})
        merged["form"] = base_f
        merged["kind"] = "form"

    if isinstance(patch.get("interactive"), dict) or patch.get("controls") or patch.get("computed") or patch.get("state"):
        i_src = patch.get("interactive") if isinstance(patch.get("interactive"), dict) else patch
        base_i = dict(merged.get("interactive") or {})
        if isinstance(i_src.get("state"), dict) and isinstance(base_i.get("state"), dict):
            merged_state = {**base_i["state"], **i_src["state"]}
            base_i.update({k: v for k, v in i_src.items() if v is not None})
            base_i["state"] = merged_state
        else:
            base_i.update({k: v for k, v in i_src.items() if v is not None})
        merged["interactive"] = base_i
        merged["kind"] = "interactive"

    if isinstance(patch.get("custom_app"), dict) or isinstance(patch.get("customApp"), dict) or any(
        k in patch for k in ("html", "css", "js")
    ):
        c_src = (
            patch.get("customApp")
            if isinstance(patch.get("customApp"), dict)
            else patch.get("custom_app")
            if isinstance(patch.get("custom_app"), dict)
            else patch
        )
        base_c = dict(merged.get("customApp") or merged.get("custom_app") or {})
        base_c.update({k: v for k, v in c_src.items() if v is not None})
        merged["customApp"] = base_c
        merged["kind"] = "custom_app"

    if isinstance(patch.get("blocks"), list):
        merged["blocks"] = patch["blocks"]
        merged["kind"] = "composite"
    elif isinstance(patch.get("append_blocks"), list):
        existing_blks = list(merged.get("blocks") or [])
        existing_blks.extend(patch["append_blocks"])
        merged["blocks"] = existing_blks
        merged["kind"] = "composite"

    merged["id"] = _as_str(base_canvas.get("id")) or _as_str(patch.get("id"))
    merged["updatedAt"] = datetime.now(timezone.utc).isoformat()
    sanitized = sanitize_canvas_artifact(merged, fallback_id=merged["id"])
    if sanitized and canvas_has_cell_data(sanitized):
        return sanitized
    return None


def sanitize_canvas_artifact(raw: Any, fallback_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Valida y normaliza un artefacto Canvas (tabla comparativa, tabla, documento, diagrama, plan,
    dashboard, formulario, compuesto por bloques, interfaz interactiva o mini-app personalizada)
    generado por el agente mediante tool calling o bloque <canvas>.
    """
    if not isinstance(raw, dict):
        return None

    has_explicit_table = bool(raw.get("columns") or raw.get("columnas") or raw.get("rows") or raw.get("filas"))
    is_composite_hint = bool(isinstance(raw.get("blocks"), list) and len(raw["blocks"]) > 0)
    is_custom_app_hint = bool(
        raw.get("customApp")
        or raw.get("custom_app")
        or raw.get("html")
        or raw.get("js")
    )
    is_interactive_hint = bool(
        raw.get("interactive")
        or raw.get("interactivo")
        or raw.get("controls")
        or raw.get("controles")
        or raw.get("computed")
    )
    is_plan_hint = bool(raw.get("plan") or raw.get("phases") or raw.get("fases"))
    is_diagram_hint = bool(
        raw.get("diagram")
        or raw.get("diagrama")
        or raw.get("nodes")
        or raw.get("nodos")
        or raw.get("mermaid")
        or raw.get("mermaid_code")
    )
    is_form_hint = bool(
        raw.get("form")
        or raw.get("formulario")
        or (not has_explicit_table and not is_interactive_hint and (raw.get("fields") or raw.get("questions") or raw.get("preguntas") or raw.get("campos")))
    )
    is_dashboard_hint = bool(
        raw.get("dashboard") or raw.get("kpis") or raw.get("charts") or raw.get("graficas") or raw.get("chart")
    )
    title = _as_str(raw.get("title") or raw.get("titulo")) or (
        "Interfaz personalizada"
        if is_custom_app_hint
        else "Herramienta interactiva"
        if is_interactive_hint
        else "Lienzo compuesto"
        if is_composite_hint
        else "Plan de ejecución"
        if is_plan_hint
        else "Diagrama visual"
        if is_diagram_hint
        else "Cuestionario interactivo"
        if is_form_hint
        else "Dashboard de análisis"
        if is_dashboard_hint
        else "Tabla en Canvas"
    )
    subtitle = _as_str(raw.get("subtitle") or raw.get("subtitulo")) or None
    summary = _as_str(raw.get("summary") or raw.get("resumen")) or None
    markdown = _as_str(raw.get("markdown") or raw.get("contenido")) or None

    raw_kind = _as_str(raw.get("kind") or raw.get("tipo")).lower()
    if raw_kind in ("custom_app", "custom_ui", "app", "widget_html", "html_app"):
        kind = "custom_app"
    elif raw_kind in ("interactive", "interactivo", "calculator", "simulator", "widget"):
        kind = "interactive"
    elif raw_kind in ("composite", "compuesto", "blocks"):
        kind = "composite"
    elif raw_kind in ("comparison", "comparativa"):
        kind = "comparison"
    elif raw_kind in ("document", "documento"):
        kind = "document"
    elif raw_kind in ("diagram", "diagrama", "flowchart"):
        kind = "diagram"
    elif raw_kind in ("plan", "roadmap"):
        kind = "plan"
    elif raw_kind in ("form", "quiz", "cuestionario", "formulario", "examen", "survey", "encuesta"):
        kind = "form"
    elif raw_kind in ("dashboard", "chart", "grafica", "tablero"):
        kind = "dashboard"
    elif is_custom_app_hint:
        kind = "custom_app"
    elif is_interactive_hint:
        kind = "interactive"
    elif is_composite_hint:
        kind = "composite"
    elif is_plan_hint:
        kind = "plan"
    elif is_diagram_hint:
        kind = "diagram"
    elif is_form_hint:
        kind = "form"
    elif is_dashboard_hint:
        kind = "dashboard"
    elif re.search(r"compar|vs|alternativ|opci", title, re.I):
        kind = "comparison"
    else:
        kind = "table"

    now_iso = _as_str(raw.get("updatedAt")) or datetime.now(timezone.utc).isoformat()
    canvas_id = _as_str(raw.get("id")) or fallback_id or f"canvas_{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    if kind == "custom_app" or is_custom_app_hint:
        app_src = (
            raw.get("customApp")
            if isinstance(raw.get("customApp"), dict)
            else raw.get("custom_app")
            if isinstance(raw.get("custom_app"), dict)
            else raw
        )
        app_obj = _sanitize_custom_app_spec(app_src)
        if app_obj is not None:
            out_app: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "custom_app",
                "columns": [],
                "rows": [],
                "customApp": app_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_app["subtitle"] = subtitle
            if summary and summary != app_obj.get("description"):
                out_app["summary"] = summary
            if markdown:
                out_app["markdown"] = markdown
            return out_app

    if kind == "interactive" or is_interactive_hint:
        inter_src = (
            raw.get("interactive")
            if isinstance(raw.get("interactive"), dict)
            else raw.get("interactivo")
            if isinstance(raw.get("interactivo"), dict)
            else raw
        )
        inter_obj = _sanitize_interactive_spec(inter_src)
        if inter_obj is not None:
            out_inter: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "interactive",
                "columns": [],
                "rows": [],
                "interactive": inter_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_inter["subtitle"] = subtitle
            if summary and summary != inter_obj.get("description"):
                out_inter["summary"] = summary
            if markdown:
                out_inter["markdown"] = markdown
            return out_inter

    if kind == "composite" or is_composite_hint:
        blocks = _sanitize_canvas_blocks(raw.get("blocks"))
        if blocks:
            out_comp: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "composite",
                "columns": [],
                "rows": [],
                "blocks": blocks,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_comp["subtitle"] = subtitle
            if summary:
                out_comp["summary"] = summary
            if markdown:
                out_comp["markdown"] = markdown
            return out_comp

    if kind == "plan" or is_plan_hint:
        plan_src = raw.get("plan") if isinstance(raw.get("plan"), dict) else raw
        plan_obj = _sanitize_plan_spec(plan_src, summary or title)
        if plan_obj is not None:
            out_plan: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "plan",
                "columns": [],
                "rows": [],
                "plan": plan_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_plan["subtitle"] = subtitle
            if summary or plan_obj.get("goal"):
                out_plan["summary"] = summary or plan_obj.get("goal")
            if markdown:
                out_plan["markdown"] = markdown
            return out_plan

    if kind == "diagram" or is_diagram_hint:
        diag_src = (
            raw.get("diagram")
            if isinstance(raw.get("diagram"), dict)
            else raw.get("diagrama")
            if isinstance(raw.get("diagrama"), dict)
            else raw
        )
        diag_obj = _sanitize_diagram_spec(diag_src)
        if diag_obj is not None:
            out_diag: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "diagram",
                "columns": [],
                "rows": [],
                "diagram": diag_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_diag["subtitle"] = subtitle
            if summary:
                out_diag["summary"] = summary
            if markdown:
                out_diag["markdown"] = markdown
            return out_diag

    if kind == "form" or is_form_hint:
        form_src = (
            raw.get("form")
            if isinstance(raw.get("form"), dict)
            else raw.get("formulario")
            if isinstance(raw.get("formulario"), dict)
            else raw
        )
        form_obj = _sanitize_form_spec(form_src)
        if form_obj is not None:
            out_form: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "form",
                "columns": [],
                "rows": [],
                "form": form_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_form["subtitle"] = subtitle
            if summary or form_obj.get("description"):
                out_form["summary"] = summary or form_obj.get("description")
            if markdown:
                out_form["markdown"] = markdown
            return out_form

    dashboard_obj: Optional[Dict[str, Any]] = None
    if kind == "dashboard" or is_dashboard_hint:
        dash_src = raw.get("dashboard") if isinstance(raw.get("dashboard"), dict) else raw
        dashboard_obj = _sanitize_dashboard_spec(dash_src)

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

    if dashboard_obj is not None and not raw_cols and not raw_rows:
        out_dash: Dict[str, Any] = {
            "id": canvas_id,
            "title": title,
            "kind": "dashboard",
            "columns": [],
            "rows": [],
            "dashboard": dashboard_obj,
            "updatedAt": now_iso,
        }
        if subtitle:
            out_dash["subtitle"] = subtitle
        if summary:
            out_dash["summary"] = summary
        if markdown:
            out_dash["markdown"] = markdown
        return out_dash

    if not raw_cols and not raw_rows and markdown:
        mermaid_m = re.search(r"```mermaid\s*([\s\S]*?)```", markdown, re.I)
        if mermaid_m and mermaid_m.group(1).strip():
            diag_obj = _sanitize_diagram_spec(mermaid_m.group(1))
            if diag_obj is not None:
                return {
                    "id": canvas_id,
                    "title": title,
                    "subtitle": subtitle,
                    "kind": "diagram",
                    "columns": [],
                    "rows": [],
                    "summary": summary,
                    "markdown": markdown,
                    "diagram": diag_obj,
                    "updatedAt": now_iso,
                }
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

    if not col_meta:
        if dashboard_obj is not None:
            out_dash_fb: Dict[str, Any] = {
                "id": canvas_id,
                "title": title,
                "kind": "dashboard",
                "columns": [],
                "rows": [],
                "dashboard": dashboard_obj,
                "updatedAt": now_iso,
            }
            if subtitle:
                out_dash_fb["subtitle"] = subtitle
            if summary:
                out_dash_fb["summary"] = summary
            if markdown:
                out_dash_fb["markdown"] = markdown
            return out_dash_fb
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
        "kind": "dashboard" if dashboard_obj is not None else (kind if kind in ALLOWED_CANVAS_KINDS else "table"),
        "columns": columns,
        "rows": normalized_rows,
        "updatedAt": now_iso,
    }
    if dashboard_obj is not None:
        out["dashboard"] = dashboard_obj
    if subtitle:
        out["subtitle"] = subtitle
    if summary:
        out["summary"] = summary
    if markdown:
        out["markdown"] = markdown
    return out

