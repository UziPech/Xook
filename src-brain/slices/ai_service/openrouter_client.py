"""
XOOK AI Service - Cliente OpenRouter (Pure Python stdlib)
Ejecuta inferencia real vía OpenRouter Chat Completions y traduce respuestas
al contrato seguro de bloques visuales (TaskProposal) sin exponer JSON crudo al usuario.
"""

import json
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from slices.task_ui.schemas import (
    canvas_has_cell_data,
    clean_visible_reply,
    sanitize_canvas_artifact,
    sanitize_task_proposal,
)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
APP_REFERER = "https://xook.local"
APP_TITLE = "XOOK Enterprise Agentic Orchestrator"

CANVAS_TOOL_DEF: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "create_canvas",
        "description": (
            "Crea un lienzo interactivo (Canvas) junto al chat para mostrar tablas "
            "comparativas, datos, listas de costos, cronogramas o documentos "
            "estructurados. Incluye siempre los datos completos en rows."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título claro del Canvas o tabla"},
                "subtitle": {"type": "string", "description": "Contexto breve o unidades"},
                "kind": {"type": "string", "enum": ["comparison", "table", "document"]},
                "summary": {"type": "string", "description": "Conclusión clave en 1 oración"},
                "columns": {
                    "type": "array",
                    "description": "Nombres de columnas en orden, ej. [\"Sector\", \"Participación (%)\"]",
                    "items": {"type": "string"},
                },
                "rows": {
                    "type": "array",
                    "description": "Lista de filas. Cada fila es un arreglo de textos en el mismo orden de columns, ej. [[\"Agricultura\", \"22%\"], [\"Industria\", \"33%\"]]",
                    "items": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "recommended_row": {
                    "type": "integer",
                    "description": "Opcional (únicamente en comparativas o rankings con una opción ganadora): índice base 0 de la fila recomendada. Omítelo en listas o catálogos neutros.",
                },
                "recommended_badge": {
                    "type": "string",
                    "description": "Opcional: etiqueta breve para destacar esa fila, ej. 'Recomendado' o 'Principal'",
                },
                "markdown": {"type": "string", "description": "Notas o documento Markdown si kind es document"},
            },
            "required": ["title", "columns", "rows"],
        },
    },
}

DEFAULT_MODELS: List[Dict[str, Any]] = [
    {
        "id": "openrouter/free",
        "name": "Automático (Gratis)",
        "provider_name": "OpenRouter",
        "hint": "Elige el mejor modelo gratuito disponible",
        "is_free": True,
        "context_length": 200000,
    },
    {
        "id": "openrouter/auto",
        "name": "Automático (Estándar)",
        "provider_name": "OpenRouter",
        "hint": "Enruta al mejor modelo según la tarea",
        "is_free": False,
        "context_length": 2000000,
    },
    {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider_name": "Google",
        "hint": "Rápido y económico",
        "is_free": False,
        "context_length": 1000000,
    },
    {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o Mini",
        "provider_name": "OpenAI",
        "hint": "Preciso y ligero",
        "is_free": False,
        "context_length": 128000,
    },
    {
        "id": "openai/gpt-4o",
        "name": "GPT-4o",
        "provider_name": "OpenAI",
        "hint": "Modelo insignia multimodal de OpenAI",
        "is_free": False,
        "context_length": 128000,
    },
    {
        "id": "anthropic/claude-3.5-sonnet",
        "name": "Claude 3.5 Sonnet",
        "provider_name": "Anthropic",
        "hint": "Razonamiento profundo de negocio",
        "is_free": False,
        "context_length": 200000,
    },
]

CURATED_PRESET_BY_ID: Dict[str, Dict[str, Any]] = {m["id"]: m for m in DEFAULT_MODELS}


def _format_context_short(ctx: Optional[int]) -> str:
    if not ctx or ctx <= 0:
        return ""
    if ctx >= 1000000:
        val = ctx / 1000000.0
        return f"{int(val)}M" if abs(val - round(val)) < 0.08 else f"{val:.1f}M"
    if ctx >= 1000:
        return f"{round(ctx / 1000)}k"
    return str(ctx)


def _format_model_entry(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    mid = raw.get("id")
    if not mid:
        return None

    preset = CURATED_PRESET_BY_ID.get(mid)
    pricing = raw.get("pricing") or {}
    prompt_str = str(pricing.get("prompt", "1"))
    completion_str = str(pricing.get("completion", "1"))
    is_free = (
        mid.endswith(":free")
        or mid == "openrouter/free"
        or (prompt_str == "0" and completion_str == "0")
    )

    raw_name = (raw.get("name") or mid).strip()
    cleaned_name = re.sub(r"\s*\(free\)\s*$", "", raw_name, flags=re.IGNORECASE).strip()
    provider_name: Optional[str] = None
    if ":" in cleaned_name:
        left, right = cleaned_name.split(":", 1)
        if left.strip() and right.strip():
            provider_name = left.strip()
            cleaned_name = right.strip()
    elif "/" in mid:
        provider_name = mid.split("/", 1)[0].replace("-", " ").title()

    if preset:
        cleaned_name = preset["name"]
        provider_name = preset.get("provider_name") or provider_name

    ctx = raw.get("context_length") or (preset.get("context_length") if preset else None)
    ctx_short = _format_context_short(ctx)

    prompt_per_million: Optional[float] = None
    completion_per_million: Optional[float] = None
    try:
        p_val = float(prompt_str)
        c_val = float(completion_str)
        if p_val >= 0 and c_val >= 0:
            prompt_per_million = round(p_val * 1_000_000, 4)
            completion_per_million = round(c_val * 1_000_000, 4)
    except Exception:
        pass

    if mid == "openrouter/free":
        hint = "Elige el mejor modelo gratuito disponible"
    elif preset and not is_free:
        hint = f"{provider_name} · {ctx_short} ctx" if ctx_short else preset["hint"]
    elif is_free:
        parts = [p for p in [provider_name, f"{ctx_short} ctx" if ctx_short else None, "Gratis"] if p]
        hint = " · ".join(parts)
    else:
        parts = [p for p in [provider_name, f"{ctx_short} ctx" if ctx_short else None] if p]
        if prompt_per_million is not None and prompt_per_million > 0:
            parts.append(f"${prompt_per_million:.2f}/1M")
        hint = " · ".join(parts) if parts else "Modelo estándar"

    return {
        "id": mid,
        "name": cleaned_name,
        "provider_name": provider_name,
        "hint": hint,
        "is_free": is_free,
        "context_length": ctx,
        "prompt_price_per_million": prompt_per_million,
        "completion_price_per_million": completion_per_million,
    }


def _ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _build_headers(api_key: Optional[str] = None) -> Dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "HTTP-Referer": APP_REFERER,
        "X-Title": APP_TITLE,
        "User-Agent": "XOOK-Agent/0.1",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    return headers


def _extract_http_error_detail(err: urllib.error.HTTPError) -> str:
    body = err.read().decode("utf-8", errors="replace")
    detail = body
    try:
        parsed = json.loads(body)
        detail = parsed.get("error", {}).get("message") or parsed.get("message") or body
    except Exception:
        pass
    return f"HTTP {err.code}: {detail}"


def _http_json(
    url: str,
    method: str = "GET",
    api_key: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 45,
) -> Dict[str, Any]:
    headers = _build_headers(api_key)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw)
    except urllib.error.HTTPError as err:
        raise RuntimeError(_extract_http_error_detail(err)) from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Error de red al conectar con OpenRouter: {err.reason}") from err


def _normalize_api_key(api_key: Optional[str]) -> str:
    key = (api_key or "").strip().strip("'\"`").rstrip(",;.").strip("'\"`")
    if key.lower().startswith("bearer "):
        key = key[7:].strip().strip("'\"`").rstrip(",;.").strip("'\"`")
    embedded = re.search(r"\b(sk-or-(?:v1-)?[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,})\b", key)
    if embedded:
        return embedded.group(1)
    return key


def _friendly_http_error(err: RuntimeError) -> RuntimeError:
    msg = str(err)
    lower = msg.lower()
    if "402" in lower or "insufficient credits" in lower or "more credits" in lower:
        return RuntimeError(
            "Tu cuenta de OpenRouter no tiene saldo suficiente para este modelo. Cambia a un modelo gratuito o recarga créditos."
        )
    if "429" in lower or "rate limit" in lower:
        return RuntimeError(
            "Se alcanzó el límite temporal de solicitudes en OpenRouter (gratuito: 20/min o 50/día). Espera un momento o prueba otro modelo gratuito."
        )
    return err


def test_openrouter_key(api_key: str) -> Dict[str, Any]:
    """Verifica una API key de OpenRouter usando GET /api/v1/key (+ /credits opcional)."""
    key = _normalize_api_key(api_key)
    if not key:
        return {"ok": False, "message": "No hay una clave API configurada."}
    if re.fullmatch(r"[a-fA-F0-9]{64}", key):
        return {
            "ok": False,
            "message": "Parece que falta el prefijo 'sk-or-v1-' al inicio de la clave de OpenRouter.",
        }

    try:
        res = _http_json(f"{OPENROUTER_BASE_URL}/key", method="GET", api_key=key, timeout=15)
        data = res.get("data", res)
        is_free_tier = bool(data.get("is_free_tier", False))
        limit_val = data.get("limit")
        limit_remaining = data.get("limit_remaining")

        credits_total: Optional[float] = None
        credits_usage: Optional[float] = None
        credits_remaining: Optional[float] = None
        try:
            cred_res = _http_json(f"{OPENROUTER_BASE_URL}/credits", method="GET", api_key=key, timeout=8)
            cred_data = cred_res.get("data", cred_res)
            if isinstance(cred_data.get("total_credits"), (int, float)):
                credits_total = float(cred_data["total_credits"])
                credits_usage = float(cred_data.get("total_usage") or 0.0)
                credits_remaining = round(max(0.0, credits_total - credits_usage), 6)
        except Exception:
            pass

        if credits_remaining is not None:
            can_use_paid = credits_remaining > 0 and (
                limit_remaining is None or float(limit_remaining) > 0
            )
        elif limit_remaining is not None:
            can_use_paid = float(limit_remaining) > 0
        else:
            can_use_paid = not is_free_tier

        return {
            "ok": True,
            "label": data.get("label") or "OpenRouter",
            "is_free_tier": is_free_tier,
            "limit": limit_val,
            "limit_remaining": limit_remaining,
            "limit_reset": data.get("limit_reset"),
            "usage": data.get("usage"),
            "usage_daily": data.get("usage_daily"),
            "usage_weekly": data.get("usage_weekly"),
            "usage_monthly": data.get("usage_monthly"),
            "credits_total": credits_total,
            "credits_usage": credits_usage,
            "credits_remaining": credits_remaining,
            "can_use_paid_models": can_use_paid,
            "daily_free_limit": 50 if is_free_tier else 1000,
            "rpm_free_limit": 20,
            "message": "Conexión verificada con OpenRouter.",
        }
    except Exception as exc:
        return {
            "ok": False,
            "message": str(exc),
        }


def list_openrouter_models(api_key: Optional[str] = None, free_only: bool = False) -> Dict[str, Any]:
    """Consulta el catálogo vivo de OpenRouter o devuelve presets curados si falla la red."""
    try:
        res = _http_json(f"{OPENROUTER_BASE_URL}/models", method="GET", api_key=api_key, timeout=15)
        raw_models = res.get("data", [])
        formatted: List[Dict[str, Any]] = []
        for m in raw_models:
            entry = _format_model_entry(m)
            if not entry:
                continue
            if free_only and not entry["is_free"]:
                continue
            formatted.append(entry)

        # Priorizar openrouter/free primero, luego presets y modelos gratuitos, luego el resto
        preset_order = {p["id"]: i for i, p in enumerate(DEFAULT_MODELS)}
        formatted.sort(
            key=lambda x: (
                0 if x["id"] == "openrouter/free" else 1,
                0 if x["is_free"] else 1,
                preset_order.get(x["id"], 999),
                x["name"].lower(),
            )
        )
        return {"ok": True, "models": formatted, "source": "openrouter"}
    except Exception as exc:
        fallback = [m for m in DEFAULT_MODELS if not free_only or m.get("is_free")]
        return {"ok": False, "models": fallback, "source": "presets", "error": str(exc)}


def _load_json_safe(path: Path) -> Dict[str, Any]:
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _collect_context_sources(
    context_dir: Path,
    skills_dir: Path,
    attached_context: List[Dict[str, Any]],
) -> List[str]:
    sources: List[str] = []
    if (context_dir / "business-profiles" / "store-profile.json").exists():
        sources.append("store-profile.json")
    if (context_dir / "memory" / "memory_store.json").exists():
        sources.append("memory_store.json")
    if (skills_dir / "inventory-advisor" / "SKILL.md").exists():
        sources.append("inventory-advisor")
    for item in attached_context or []:
        name = str(item.get("name") or "").strip()
        if name and name not in sources:
            sources.append(name)
    return sources


_WEEKDAYS_ES = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
_MONTHS_ES = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)


def _current_local_datetime_label() -> str:
    now = datetime.now().astimezone()
    wd = _WEEKDAYS_ES[now.weekday()]
    mo = _MONTHS_ES[now.month - 1]
    hour12 = now.strftime("%I:%M %p").lstrip("0")
    tz = now.tzname() or "hora local"
    offset = now.strftime("%z")
    return (
        f"{wd} {now.day} de {mo} de {now.year}, "
        f"{now.strftime('%H:%M')} ({hour12}), zona horaria {tz} ({offset})"
    )


def _build_system_prompt(
    context_dir: Path,
    skills_dir: Path,
    current_tasks: List[Dict[str, Any]],
    agenda_items: List[Dict[str, Any]],
    attached_context: List[Dict[str, Any]],
    stream_mode: bool = False,
    user_profile: Optional[Dict[str, Any]] = None,
    active_canvas: Optional[Dict[str, Any]] = None,
) -> str:
    profile = _load_json_safe(context_dir / "business-profiles" / "store-profile.json")
    memory = _load_json_safe(context_dir / "memory" / "memory_store.json")
    skill_md_path = skills_dir / "inventory-advisor" / "SKILL.md"
    skill_text = skill_md_path.read_text(encoding="utf-8") if skill_md_path.exists() else ""

    compact_tasks = [
        {
            "cardId": t.get("cardId"),
            "title": t.get("title"),
            "category": t.get("category"),
            "urgency": t.get("urgency"),
            "paramValues": t.get("paramValues"),
            "intent": t.get("intent"),
        }
        for t in (current_tasks or [])[:8]
    ]

    compact_agenda = [
        {
            "id": a.get("id"),
            "kind": a.get("kind"),
            "title": a.get("title"),
            "timeLabel": a.get("timeLabel"),
            "autoScheduled": a.get("autoScheduled"),
        }
        for a in (agenda_items or [])[:8]
    ]

    extra_ctx = ""
    if attached_context:
        extra_ctx = "\nCONTEXTO ADJUNTO POR EL USUARIO:\n" + json.dumps(attached_context, ensure_ascii=False)

    operator_ctx = ""
    if user_profile and user_profile.get("name"):
        op_name = user_profile.get("name")
        op_role = user_profile.get("role") or "Operador"
        op_store = user_profile.get("storeName") or ""
        operator_ctx = f"\nUSUARIO ACTIVO EN SESIÓN:\nNombre: {op_name} | Rol: {op_role}" + (f" | Sucursal/Negocio: {op_store}" if op_store else "")

    canvas_ctx = ""
    if isinstance(active_canvas, dict) and active_canvas.get("title"):
        compact_canvas = {
            "id": active_canvas.get("id"),
            "title": active_canvas.get("title"),
            "kind": active_canvas.get("kind"),
            "summary": active_canvas.get("summary"),
            "columns": active_canvas.get("columns", [])[:12],
            "rows": active_canvas.get("rows", [])[:25],
        }
        canvas_ctx = (
            "\nCANVAS ACTIVO EN PANTALLA (si el usuario pide modificar, filtrar, ampliar o mejorar la tabla, actualiza este Canvas manteniendo su id):\n"
            + json.dumps(compact_canvas, ensure_ascii=False)
        )

    canvas_hint = """USO DE CANVAS PARA TABLAS Y COMPARATIVAS (IMPORTANTE):
Cuando el usuario pida o convenga mostrar una TABLA, tabla comparativa, desglose, matriz de opciones o presupuesto:
- Usa la herramienta `create_canvas` (preferida) pasando columnas en texto simple y TODAS las filas completas en `rows`, O incluye una sección `<canvas>{...}</canvas>` con:
  {"title":"Título corto","subtitle":"Criterio breve","kind":"comparison","summary":"Conclusión clave en 1 oración","columns":["Criterio","Opción A","Opción B"],"rows":[["Precio","$100","$120"],["Tiempo","2 días","5 días"]],"recommended_row":0,"recommended_badge":"Recomendado"}
- NUNCA envíes `rows` con celdas vacías ni escribas etiquetas HTML (<table>, <tr>, <th>, <td>, <pdf>) en `<respuesta>`.
- En `<respuesta>` escribe únicamente una explicación clara en español o la conclusión clave sin duplicar tablas HTML."""

    task_schema_hint = """ESQUEMA DE CADA TaskProposal EN "tasks":
{
  "cardId": "card_<slug>_<num>",
  "title": "Título corto accionable",
  "subtitle": "Explicación humana en 1 oración",
  "category": "abastecimiento" | "agenda" | "reloj" | "nota" | "optimizacion" | "regla",
  "urgency": "alta" | "media" | "baja" | "info",
  "statusChip": "Texto breve ej. '2d stock', '15 min', 'Hoy 18:00'",
  "defaultExpanded": true,
  "generatedBy": "Nombre corto del asesor ej. 'Xox IA'",
  "paramValues": { "order_qty": 20 },
  "intent": {
    "type": "stock_reorder" | "schedule_event" | "start_timer" | "save_note" | "apply_rule",
    "targetLabel": "Nombre del producto o tarea",
    "primaryLabel": "Texto corto del botón ej. 'Aprobar orden', 'Iniciar reloj', 'Agendar', 'Guardar nota'",
    "quantityParamKey": "order_qty",
    "unitPrice": 70,
    "fixedCost": 1400,
    "currency": "MXN",
    "supplierName": "Nombre del proveedor",
    "maxBudgetLimit": 50000
  },
  "blocks": [
    // Tipos: metrics_strip, coverage_bar, schedule, checklist, note, comparison, kv_list, param_control, insight
  ]
}"""

    if stream_mode:
        output_rules = f"""FORMATO DE RESPUESTA EN VIVO (OBLIGATORIO):
Responde usando estas secciones en orden (sin texto fuera de las etiquetas; opcionalmente incluye <canvas> si generas una tabla sin usar tool call):
<analisis>
- Explica en 2 a 4 viñetas breves en español humano qué revisaste (contexto del negocio, reglas aplicables, estado actual o intención del mensaje) y tu criterio antes de responder.
</analisis>
<respuesta>
Tu respuesta clara, directa y humana en español para el usuario (párrafos cortos o viñetas simples; nunca pongas JSON aquí).
</respuesta>
<canvas>
{{}} // Opcional: solo si generas una tabla/comparativa y no llamaste a la herramienta create_canvas
</canvas>
<acciones>
{{"xox_mood": "talking", "operation": "none", "tasks": []}}
</acciones>

En <acciones>: si el usuario pide analizar stock, reponer, agendar, crear un reloj/temporizador, nota o consolidar tarjetas, incluye 1 a 3 objetos TaskProposal dentro de "tasks" con "operation": "add_tasks" o "replace_tasks" y "xox_mood": "success". Si es conversación normal, deja "tasks": [] y "operation": "none".

{canvas_hint}

{task_schema_hint}"""
    else:
        output_rules = f"""REGLA DE SALIDA ESTRUCTURADA (OBLIGATORIA):
Responde ÚNICAMENTE con un objeto JSON válido (sin texto fuera del JSON) con esta estructura exacta:
{{
  "reply": "Tu respuesta clara y natural en español para el usuario (usa párrafos cortos o viñetas simples, nunca muestres JSON aquí).",
  "xox_mood": "talking" | "success" | "alert",
  "operation": "none" | "add_tasks" | "replace_tasks",
  "tasks": [
    // Opcional: 0 a 3 tarjetas TaskProposal si el usuario pide analizar, reponer, agendar, poner un reloj/temporizador, crear una nota o consolidar/reconstruir tareas.
  ],
  "canvas": null // Opcional: objeto Canvas si el usuario pidió una tabla o comparativa y no usaste `create_canvas`
}}

{canvas_hint}

{task_schema_hint}"""

    now_label = _current_local_datetime_label()

    return f"""Eres Xox, el asistente inteligente y copiloto operativo de XOOK (Enterprise Agentic Orchestrator).
Hablas SIEMPRE en español claro, humano, directo y útil.
Puedes responder con naturalidad cualquier consulta general (hora y fecha actual, cálculos, conocimiento general, tecnología, redacción, dudas cotidianas) además de ayudar con la operación del negocio, inventario, agenda, temporizadores y tareas.

FECHA Y HORA LOCAL ACTUAL DEL SISTEMA:
{now_label}
(Usa siempre esta fecha y hora exacta cuando el usuario pregunte qué hora es, qué día es hoy, o pida cálculos de tiempo y recordatorios.)

PERFIL DEL NEGOCIO ACTUAL:
{json.dumps(profile, ensure_ascii=False, indent=2)}

MEMORIA Y PATRONES APRENDIDOS:
{json.dumps(memory.get("inferred_patterns", []), ensure_ascii=False, indent=2)}

SKILL ACTIVO (inventory-advisor):
{skill_text[:1400]}

TAREAS PENDIENTES EN PANEL DERECHO:
{json.dumps(compact_tasks, ensure_ascii=False)}

AGENDA Y RELOJES ACTIVOS:
{json.dumps(compact_agenda, ensure_ascii=False)}{operator_ctx}{canvas_ctx}{extra_ctx}

{output_rules}

REGLAS CRÍTICAS:
- NO uses emojis (como 👋, ✨, 📦, 🚀) ni iconos decorativos en <respuesta> ni en <analisis>; escribe español claro, natural y limpio.
- Si el usuario hace una pregunta general o cotidiana (ej. "¿qué hora es?", "¿qué día es hoy?", dudas generales, matemáticas, charla o conocimiento general), respóndele directa y útilmente usando tu conocimiento y la fecha/hora local arriba, sin forzar temas de inventario; deja "operation": "none" y "tasks": [].
- Nunca inventes ventas o pagos automáticos: toda mutación requiere aprobación HITL en tarjeta.
- Si es una pregunta conversacional simple sobre el negocio (ej. "¿cómo ves el stock?", "¿por qué 20 unidades?"), responde en conversación normal con "operation": "none" y "tasks": [].
- Si el usuario pide crear una tarea, reloj/temporizador, recordatorio, auto-agenda, nota, análisis de compra o consolidar tarjetas, genera las "tasks" correspondientes con bloques claros."""


def _partial_tag_split(buf: str, tags: Tuple[str, ...]) -> Tuple[str, str]:
    """Separa un prefijo seguro para emitir y retiene un posible inicio parcial de etiqueta."""
    last_lt = buf.rfind("<")
    if last_lt == -1:
        return buf, ""
    tail = buf[last_lt:].lower()
    if ">" not in tail and any(tag.startswith(tail) for tag in tags):
        return buf[:last_lt], buf[last_lt:]
    return buf, ""


def _find_first_tag(buf: str, tags: Tuple[str, ...]) -> Optional[Tuple[int, str]]:
    lower = buf.lower()
    best_idx = -1
    best_tag = ""
    for tag in tags:
        idx = lower.find(tag)
        if idx != -1 and (best_idx == -1 or idx < best_idx):
            best_idx = idx
            best_tag = tag
    if best_idx == -1:
        return None
    return best_idx, best_tag


class _StreamTagRouter:
    """Enruta chunks de contenido streaming hacia análisis, respuesta, canvas y acciones ocultas."""

    OPEN_ANALYSIS = ("<analisis>", "<analysis>")
    CLOSE_ANALYSIS = ("</analisis>", "</analysis>")
    OPEN_REPLY = ("<respuesta>", "<response>")
    CLOSE_REPLY = ("</respuesta>", "</response>")
    OPEN_CANVAS = ("<canvas>", "<lienzo>")
    CLOSE_CANVAS = ("</canvas>", "</lienzo>")
    OPEN_ACTIONS = ("<acciones>", "<actions>")
    CLOSE_ACTIONS = ("</acciones>", "</actions>")
    STOP_REPLY = CLOSE_REPLY + OPEN_CANVAS + OPEN_ACTIONS
    ALL_OPEN = OPEN_ANALYSIS + OPEN_REPLY + OPEN_CANVAS + OPEN_ACTIONS

    def __init__(
        self,
        on_reasoning: Callable[[str], None],
        on_reply: Callable[[str], None],
        on_phase: Callable[[str], None],
    ) -> None:
        self.mode = "detect"
        self.buf = ""
        self.canvas_buf = ""
        self.actions_buf = ""
        self.on_reasoning = on_reasoning
        self.on_reply = on_reply
        self.on_phase = on_phase
        self._entered_reply = False
        self._entered_canvas = False

    def _enter_reply(self) -> None:
        if not self._entered_reply:
            self._entered_reply = True
            self.on_phase("talking")

    def _enter_canvas(self) -> None:
        self.mode = "canvas"
        if not self._entered_canvas:
            self._entered_canvas = True
            self.on_phase("canvas")

    def _try_match_next_section(self, allow_fallback_reply: bool = False) -> Optional[bool]:
        """Intenta consumir el inicio de la siguiente etiqueta conocida. Retorna True si avanzó, False si espera más chunks, None si no coincide."""
        trimmed = self.buf.lstrip()
        if not trimmed:
            self.buf = ""
            return False
        self.buf = trimmed
        lower = trimmed.lower()
        for tags, target in (
            (self.OPEN_ANALYSIS, "analysis"),
            (self.OPEN_REPLY, "reply"),
            (self.OPEN_CANVAS, "canvas"),
            (self.OPEN_ACTIONS, "actions"),
        ):
            matched = next((t for t in tags if lower.startswith(t)), None)
            if matched:
                self.buf = trimmed[len(matched) :].lstrip("\r\n")
                if target == "analysis":
                    self.mode = "analysis"
                    self.on_phase("thinking")
                elif target == "reply":
                    self.mode = "reply"
                    self._enter_reply()
                elif target == "canvas":
                    self._enter_canvas()
                else:
                    self.mode = "actions"
                return True
        if any(t.startswith(lower) for t in self.ALL_OPEN):
            return False
        if allow_fallback_reply:
            self.mode = "reply"
            self._enter_reply()
            return True
        self.buf = ""
        return False

    def feed(self, chunk: str) -> None:
        if not chunk:
            return
        self.buf += chunk
        self._process()

    def _process(self) -> None:
        while self.buf:
            if self.mode in ("detect", "after_analysis"):
                res = self._try_match_next_section(allow_fallback_reply=True)
                if res is False:
                    return
                continue

            if self.mode in ("after_reply", "after_canvas"):
                res = self._try_match_next_section(allow_fallback_reply=(self.mode == "after_canvas"))
                if res is False:
                    return
                continue

            if self.mode == "analysis":
                found = _find_first_tag(self.buf, self.CLOSE_ANALYSIS)
                if found:
                    idx, tag = found
                    if idx > 0:
                        self.on_reasoning(self.buf[:idx])
                    self.buf = self.buf[idx + len(tag) :]
                    self.mode = "after_analysis"
                    continue
                safe, rem = _partial_tag_split(self.buf, self.CLOSE_ANALYSIS)
                if safe:
                    self.on_reasoning(safe)
                self.buf = rem
                return

            if self.mode == "reply":
                found = _find_first_tag(self.buf, self.STOP_REPLY)
                if found:
                    idx, tag = found
                    if idx > 0:
                        self.on_reply(self.buf[:idx])
                    self.buf = self.buf[idx + len(tag) :]
                    if tag in self.OPEN_CANVAS:
                        self._enter_canvas()
                    elif tag in self.OPEN_ACTIONS:
                        self.mode = "actions"
                    else:
                        self.mode = "after_reply"
                    continue
                safe, rem = _partial_tag_split(self.buf, self.STOP_REPLY)
                if safe:
                    self.on_reply(safe)
                self.buf = rem
                return

            if self.mode == "canvas":
                found = _find_first_tag(self.buf, self.CLOSE_CANVAS)
                if found:
                    idx, tag = found
                    self.canvas_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(tag) :]
                    self.mode = "after_canvas"
                    continue
                safe, rem = _partial_tag_split(self.buf, self.CLOSE_CANVAS)
                self.canvas_buf += safe
                self.buf = rem
                return

            if self.mode == "actions":
                found = _find_first_tag(self.buf, self.CLOSE_ACTIONS)
                if found:
                    idx, _ = found
                    self.actions_buf += self.buf[:idx]
                    self.buf = ""
                    return
                safe, rem = _partial_tag_split(self.buf, self.CLOSE_ACTIONS)
                self.actions_buf += safe
                self.buf = rem
                return

    def flush(self) -> None:
        if not self.buf:
            return
        if self.mode in ("detect", "after_analysis"):
            trimmed = self.buf.lstrip()
            if trimmed:
                self._enter_reply()
                self.on_reply(trimmed)
        elif self.mode == "analysis":
            self.on_reasoning(self.buf)
        elif self.mode == "reply":
            self.on_reply(self.buf)
        elif self.mode == "canvas":
            cleaned = re.sub(r"</?(?:canvas|lienzo)>", "", self.buf, flags=re.IGNORECASE)
            self.canvas_buf += cleaned
        elif self.mode == "actions":
            cleaned = re.sub(r"</?(?:acciones|actions)>", "", self.buf, flags=re.IGNORECASE)
            self.actions_buf += cleaned
        self.buf = ""


def _parse_json_candidates(raw_text: str) -> Optional[Dict[str, Any]]:
    text = (raw_text or "").strip()
    if not text:
        return None
    candidates = [text]
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text)
    if fence:
        candidates.insert(0, fence.group(1))
    s = text.find("{")
    e = text.rfind("}")
    if s != -1 and e > s:
        candidates.append(text[s : e + 1])

    expanded: List[str] = []
    for cand in candidates:
        expanded.append(cand)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cand)
        if cleaned != cand:
            expanded.append(cleaned)

    for cand in expanded:
        try:
            parsed: Any = json.loads(cand)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _parse_actions_payload(raw_actions: str) -> Dict[str, Any]:
    parsed = _parse_json_candidates(raw_actions)
    if parsed is not None:
        return parsed
    return {"xox_mood": "talking", "operation": "none", "tasks": []}


def _parse_canvas_payload(raw_canvas: str) -> Optional[Dict[str, Any]]:
    text = (raw_canvas or "").strip()
    if not text or text == "{}":
        return None
    parsed = _parse_json_candidates(text)
    if parsed:
        sanitized = sanitize_canvas_artifact(parsed)
        if sanitized and canvas_has_cell_data(sanitized):
            return sanitized
    # Fallback: el modelo escribió tabla Markdown o HTML dentro de <canvas>...</canvas>
    if ("|" in text and "---" in text) or "<tr" in text.lower() or "<table" in text.lower():
        sanitized_tbl = sanitize_canvas_artifact({"title": "Tabla comparativa", "markdown": text})
        if sanitized_tbl and canvas_has_cell_data(sanitized_tbl):
            return sanitized_tbl
    return None


def _is_table_request(user_message: str) -> bool:
    return bool(
        re.search(
            r"\b(tabla|tablas|comparativa|comparativo|comparaci[oó]n|comparar|compara|composici[oó]n|desglose|canvas|lienzo|matriz|cuadro)\b",
            user_message or "",
            re.IGNORECASE,
        )
    )


def _has_structured_table_markup(text: str) -> bool:
    if not text:
        return False
    lower = text.lower()
    if "<tr" in lower and ("<td" in lower or "<th" in lower):
        return True
    if "|" in text and "---" in text:
        return True
    return False


def _extract_canvas_tool_metadata(tool_calls: List[Dict[str, Any]]) -> Dict[str, Any]:
    for tc in tool_calls:
        fn = tc.get("function") or {}
        fn_name = str(fn.get("name") or "").strip().lower()
        if not fn_name or ("create_canvas" not in fn_name and fn_name != "canvas"):
            continue
        raw_args = fn.get("arguments")
        parsed_args = raw_args if isinstance(raw_args, dict) else _parse_json_candidates(str(raw_args or ""))
        if isinstance(parsed_args, dict):
            inner = (
                parsed_args.get("canvas")
                if isinstance(parsed_args.get("canvas"), dict)
                else parsed_args.get("arguments")
                if isinstance(parsed_args.get("arguments"), dict)
                else parsed_args
            )
            if isinstance(inner, dict):
                return inner
    return {}


def _extract_canvas_from_tool_calls(tool_calls: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for tc in tool_calls:
        fn = tc.get("function") or {}
        fn_name = str(fn.get("name") or "").strip().lower()
        if not fn_name or ("create_canvas" not in fn_name and fn_name != "canvas"):
            continue
        raw_args = fn.get("arguments")
        parsed_args: Optional[Dict[str, Any]] = None
        if isinstance(raw_args, dict):
            parsed_args = raw_args
        elif isinstance(raw_args, str):
            parsed_args = _parse_json_candidates(raw_args)
            if parsed_args is None and _has_structured_table_markup(raw_args):
                tbl = sanitize_canvas_artifact({"title": "Tabla comparativa", "markdown": raw_args})
                if tbl and canvas_has_cell_data(tbl):
                    return tbl
        if isinstance(parsed_args, dict):
            inner = (
                parsed_args.get("canvas")
                if isinstance(parsed_args.get("canvas"), dict)
                else parsed_args.get("arguments")
                if isinstance(parsed_args.get("arguments"), dict)
                else parsed_args
            )
            canvas = sanitize_canvas_artifact(inner)
            if canvas and canvas_has_cell_data(canvas):
                return canvas
    return None


def _resolve_canvas_artifact(
    tool_calls: List[Dict[str, Any]],
    canvas_buf: str,
    actions_canvas: Any,
    full_reply: str,
    user_message: str,
) -> Optional[Dict[str, Any]]:
    from_tool = _extract_canvas_from_tool_calls(tool_calls)
    if from_tool and canvas_has_cell_data(from_tool):
        return from_tool
    from_tag = _parse_canvas_payload(canvas_buf)
    if from_tag and canvas_has_cell_data(from_tag):
        return from_tag
    if isinstance(actions_canvas, dict):
        from_actions = sanitize_canvas_artifact(actions_canvas)
        if from_actions and canvas_has_cell_data(from_actions):
            return from_actions
    if _has_structured_table_markup(full_reply) and (_is_table_request(user_message) or bool(tool_calls) or "<tr" in full_reply.lower() or "|" in full_reply):
        tool_meta = _extract_canvas_tool_metadata(tool_calls) if tool_calls else {}
        extracted = sanitize_canvas_artifact({
            "title": tool_meta.get("title") or tool_meta.get("titulo") or "Tabla generada",
            "subtitle": tool_meta.get("subtitle") or tool_meta.get("subtitulo"),
            "summary": tool_meta.get("summary") or tool_meta.get("resumen"),
            "markdown": full_reply,
        })
        if extracted and canvas_has_cell_data(extracted) and extracted.get("columns"):
            return extracted
    return None


def _parse_agent_json(raw_content: str) -> Dict[str, Any]:
    text = (raw_content or "").strip()
    # Intentar parseo directo
    candidates = [text]
    # Extraer bloque ```json ... ``` si el modelo envolvió en markdown
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", text)
    if fence_match:
        candidates.insert(0, fence_match.group(1))
    # Extraer primer objeto JSON balanceado aproximado
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start != -1 and brace_end > brace_start:
        candidates.append(text[brace_start : brace_end + 1])

    for cand in candidates:
        try:
            parsed = json.loads(cand)
            if isinstance(parsed, dict) and "reply" in parsed:
                return parsed
        except Exception:
            continue

    # Si el modelo respondió texto plano válido sin JSON, mostrarlo tal cual en reply
    return {
        "reply": text or "Listo, revisé tu solicitud.",
        "xox_mood": "talking",
        "operation": "none",
        "tasks": [],
    }


def _validate_and_build_messages(
    api_key: str,
    model_id: str,
    user_message: str,
    history: List[Dict[str, str]],
    context_dir: Path,
    skills_dir: Path,
    current_tasks: Optional[List[Dict[str, Any]]],
    agenda_items: Optional[List[Dict[str, Any]]],
    attached_context: Optional[List[Dict[str, Any]]],
    stream_mode: bool = False,
    user_profile: Optional[Dict[str, Any]] = None,
    active_canvas: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str, List[Dict[str, Any]]]:
    key = _normalize_api_key(api_key)
    if not key:
        raise RuntimeError("Falta la clave API de OpenRouter. Configúrala en Xook o pégala en el chat.")
    if re.fullmatch(r"[a-fA-F0-9]{64}", key):
        raise RuntimeError(
            "La clave guardada no incluye el prefijo 'sk-or-v1-'. Pégala completa en Configuración de IA."
        )

    chosen_model = (model_id or "openrouter/free").strip() or "openrouter/free"
    system_prompt = _build_system_prompt(
        context_dir=context_dir,
        skills_dir=skills_dir,
        current_tasks=current_tasks or [],
        agenda_items=agenda_items or [],
        attached_context=attached_context or [],
        stream_mode=stream_mode,
        user_profile=user_profile,
        active_canvas=active_canvas,
    )

    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for msg in (history or [])[-10:]:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return key, chosen_model, messages


def _normalize_agent_actions(parsed: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str, str]:
    raw_tasks = parsed.get("tasks") if isinstance(parsed.get("tasks"), list) else []
    safe_tasks = [sanitize_task_proposal(t) for t in raw_tasks if isinstance(t, dict)]

    operation = parsed.get("operation", "none")
    if operation not in ("none", "add_tasks", "replace_tasks"):
        operation = "add_tasks" if safe_tasks else "none"

    mood = parsed.get("xox_mood", "talking")
    if mood not in ("talking", "success", "alert"):
        mood = "success" if safe_tasks else "talking"

    return safe_tasks, operation, mood


def run_agent_completion(
    api_key: str,
    model_id: str,
    user_message: str,
    history: List[Dict[str, str]],
    context_dir: Path,
    skills_dir: Path,
    current_tasks: Optional[List[Dict[str, Any]]] = None,
    agenda_items: Optional[List[Dict[str, Any]]] = None,
    attached_context: Optional[List[Dict[str, Any]]] = None,
    user_profile: Optional[Dict[str, Any]] = None,
    active_canvas: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    key, chosen_model, messages = _validate_and_build_messages(
        api_key=api_key,
        model_id=model_id,
        user_message=user_message,
        history=history,
        context_dir=context_dir,
        skills_dir=skills_dir,
        current_tasks=current_tasks,
        agenda_items=agenda_items,
        attached_context=attached_context,
        stream_mode=False,
        user_profile=user_profile,
        active_canvas=active_canvas,
    )

    started = time.time()
    payload: Dict[str, Any] = {
        "model": chosen_model,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
        "tools": [CANVAS_TOOL_DEF],
        "tool_choice": "auto",
    }

    def _call_with_fallbacks(cur_payload: Dict[str, Any]) -> Dict[str, Any]:
        for _attempt in range(3):
            try:
                return _http_json(
                    f"{OPENROUTER_BASE_URL}/chat/completions",
                    method="POST",
                    api_key=key,
                    payload=cur_payload,
                    timeout=60,
                )
            except RuntimeError as err:
                err_lower = str(err).lower()
                dropped = False
                if "tools" in cur_payload and any(
                    tok in err_lower for tok in ("400", "404", "tool", "function", "endpoints", "unsupported")
                ):
                    cur_payload.pop("tools", None)
                    cur_payload.pop("tool_choice", None)
                    dropped = True
                if "response_format" in cur_payload and any(
                    tok in err_lower for tok in ("400", "404", "response_format", "json_object", "structured")
                ):
                    cur_payload.pop("response_format", None)
                    dropped = True
                if not dropped:
                    raise _friendly_http_error(err) from err
        raise RuntimeError("No se pudo completar la solicitud tras reintentar.")

    res = _call_with_fallbacks(payload)
    choices = res.get("choices") or []
    message_obj = (choices[0].get("message") or {}) if choices else {}
    raw_content = message_obj.get("content") or ""
    tool_calls = message_obj.get("tool_calls") or []

    if not raw_content.strip() and not tool_calls and "response_format" in payload:
        payload.pop("response_format", None)
        res = _call_with_fallbacks(payload)
        choices = res.get("choices") or []
        message_obj = (choices[0].get("message") or {}) if choices else {}
        raw_content = message_obj.get("content") or ""
        tool_calls = message_obj.get("tool_calls") or []

    canvas_obj = _extract_canvas_from_tool_calls(tool_calls) if isinstance(tool_calls, list) else None

    if not raw_content.strip() and canvas_obj is not None:
        raw_content = json.dumps({
            "reply": f'Listo, generé "{canvas_obj["title"]}" en Canvas ({len(canvas_obj["rows"])} filas y {len(canvas_obj["columns"])} columnas).',
            "xox_mood": "success",
            "operation": "none",
            "tasks": [],
        }, ensure_ascii=False)

    if not raw_content.strip():
        raise RuntimeError(
            "El modelo seleccionado devolvió una respuesta vacía temporalmente. Intenta enviar de nuevo o elige otro modelo."
        )

    latency_ms = int((time.time() - started) * 1000)

    parsed = _parse_agent_json(raw_content)
    safe_tasks, operation, mood = _normalize_agent_actions(parsed)
    full_reply = str(parsed.get("reply") or "Listo.")
    if canvas_obj is None:
        canvas_obj = _resolve_canvas_artifact(
            tool_calls=tool_calls if isinstance(tool_calls, list) else [],
            canvas_buf="",
            actions_canvas=parsed.get("canvas"),
            full_reply=full_reply,
            user_message=user_message,
        )
    full_reply = clean_visible_reply(full_reply, strip_tables=False)
    if canvas_obj is not None and mood == "talking":
        mood = "success"

    reasoning = (
        message_obj.get("reasoning")
        or message_obj.get("reasoning_content")
        or ""
    )

    out: Dict[str, Any] = {
        "status": "ok",
        "reply": full_reply,
        "reasoning": str(reasoning).strip(),
        "xox_mood": mood,
        "operation": operation,
        "tasks": safe_tasks,
        "model_used": res.get("model") or chosen_model,
        "usage": res.get("usage") or {},
        "latency_ms": latency_ms,
    }
    if canvas_obj is not None:
        out["canvas"] = canvas_obj
    return out


def _extract_delta_reasoning(delta: Dict[str, Any]) -> str:
    direct = delta.get("reasoning") or delta.get("reasoning_content")
    if isinstance(direct, str) and direct:
        return direct
    details = delta.get("reasoning_details")
    if isinstance(details, list):
        parts: List[str] = []
        for item in details:
            if isinstance(item, dict):
                txt = item.get("text") or item.get("summary")
                if isinstance(txt, str) and txt:
                    parts.append(txt)
        return "".join(parts)
    return ""


def stream_agent_completion(
    api_key: str,
    model_id: str,
    user_message: str,
    history: List[Dict[str, str]],
    context_dir: Path,
    skills_dir: Path,
    emit_event: Callable[[Dict[str, Any]], None],
    current_tasks: Optional[List[Dict[str, Any]]] = None,
    agenda_items: Optional[List[Dict[str, Any]]] = None,
    attached_context: Optional[List[Dict[str, Any]]] = None,
    user_profile: Optional[Dict[str, Any]] = None,
    active_canvas: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    sources = _collect_context_sources(context_dir, skills_dir, attached_context or [])
    steps: List[Dict[str, Any]] = [
        {
            "id": "read_context",
            "label": "Leyendo contexto y reglas del negocio",
            "detail": " · ".join(sources[:4]) if sources else "Contexto base",
            "status": "running",
        }
    ]
    emit_event({"type": "phase", "xox_state": "reading", "label": "Leyendo perfil y reglas..."})
    emit_event({"type": "steps", "steps": steps})

    key, chosen_model, messages = _validate_and_build_messages(
        api_key=api_key,
        model_id=model_id,
        user_message=user_message,
        history=history,
        context_dir=context_dir,
        skills_dir=skills_dir,
        current_tasks=current_tasks,
        agenda_items=agenda_items,
        attached_context=attached_context,
        stream_mode=True,
        user_profile=user_profile,
        active_canvas=active_canvas,
    )

    steps[0]["status"] = "done"
    steps.append(
        {
            "id": "think_llm",
            "label": "Analizando tu solicitud",
            "detail": chosen_model,
            "status": "running",
        }
    )
    emit_event({"type": "phase", "xox_state": "thinking", "label": "Analizando tu solicitud..."})
    emit_event({"type": "steps", "steps": steps})

    started = time.time()
    reasoning_started: Optional[float] = None
    reasoning_ended: Optional[float] = None
    reasoning_chunks: List[str] = []
    reply_chunks: List[str] = []
    usage_data: Dict[str, Any] = {}
    actual_model = chosen_model

    def on_reasoning_delta(chunk: str) -> None:
        nonlocal reasoning_started
        if not chunk:
            return
        if reasoning_started is None:
            reasoning_started = time.time()
        reasoning_chunks.append(chunk)
        emit_event({"type": "reasoning_delta", "delta": chunk})

    def on_reply_delta(chunk: str) -> None:
        nonlocal reasoning_ended
        if not chunk:
            return
        if reasoning_started is not None and reasoning_ended is None:
            reasoning_ended = time.time()
        reply_chunks.append(chunk)
        emit_event({"type": "reply_delta", "delta": chunk})

    def _upsert_step(step_id: str, label: str, status: str = "running") -> None:
        for idx, st in enumerate(steps):
            if st.get("id") == step_id:
                steps[idx] = {**st, "label": label, "status": status}
                return
        steps.append({"id": step_id, "label": label, "status": status})

    def on_phase_change(phase: str) -> None:
        nonlocal reasoning_ended
        if phase == "talking":
            if reasoning_started is not None and reasoning_ended is None:
                reasoning_ended = time.time()
            steps[1]["status"] = "done"
            _upsert_step("talk_reply", "Respondiendo en vivo", "running")
            emit_event({"type": "phase", "xox_state": "talking", "label": "Respondiendo..."})
            emit_event({"type": "steps", "steps": steps})
        elif phase == "canvas":
            if reasoning_started is not None and reasoning_ended is None:
                reasoning_ended = time.time()
            steps[1]["status"] = "done"
            _upsert_step("build_canvas", "Generando tabla en Canvas", "running")
            emit_event({"type": "phase", "xox_state": "syncing", "label": "Diseñando tabla en Canvas..."})
            emit_event({"type": "steps", "steps": steps})
        elif phase == "thinking":
            emit_event({"type": "phase", "xox_state": "thinking", "label": "Evaluando opciones..."})

    router = _StreamTagRouter(
        on_reasoning=on_reasoning_delta,
        on_reply=on_reply_delta,
        on_phase=on_phase_change,
    )

    def _open_stream(req_messages: List[Dict[str, Any]], include_usage: bool, include_tools: bool) -> Any:
        payload: Dict[str, Any] = {
            "model": chosen_model,
            "messages": req_messages,
            "temperature": 0.3,
            "max_tokens": 4096,
            "stream": True,
        }
        if include_usage:
            payload["stream_options"] = {"include_usage": True}
        if include_tools:
            payload["tools"] = [CANVAS_TOOL_DEF]
            payload["tool_choice"] = "auto"
        req = urllib.request.Request(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers=_build_headers(key),
            method="POST",
        )
        return urllib.request.urlopen(req, timeout=90, context=_ssl_context())

    def _run_stream_pass(
        req_messages: List[Dict[str, Any]],
        allow_tools: bool,
        tag_router: _StreamTagRouter,
    ) -> List[Dict[str, Any]]:
        nonlocal actual_model, usage_data
        include_usage = True
        include_tools = allow_tools
        resp = None
        for _attempt in range(3):
            try:
                resp = _open_stream(req_messages, include_usage=include_usage, include_tools=include_tools)
                break
            except urllib.error.HTTPError as err:
                detail_msg = _extract_http_error_detail(err)
                lower_msg = detail_msg.lower()
                retried = False
                if include_usage and err.code == 400 and "stream_options" in lower_msg:
                    include_usage = False
                    retried = True
                if include_tools and err.code in (400, 404) and any(
                    tok in lower_msg for tok in ("tool", "function", "endpoints", "unsupported")
                ):
                    include_tools = False
                    retried = True
                if retried:
                    continue
                raise RuntimeError(detail_msg) from err

        if resp is None:
            raise RuntimeError("No se pudo abrir el stream con OpenRouter.")

        tc_acc: Dict[int, Dict[str, Any]] = {}
        notified_canvas_tc = False
        with resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or line.startswith(":") or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event_obj = json.loads(data_str)
                except Exception:
                    continue
                if event_obj.get("error"):
                    err_msg = event_obj["error"].get("message") or str(event_obj["error"])
                    raise _friendly_http_error(RuntimeError(err_msg))
                if isinstance(event_obj.get("model"), str) and event_obj["model"]:
                    actual_model = event_obj["model"]
                    steps[1]["detail"] = actual_model
                if isinstance(event_obj.get("usage"), dict) and event_obj["usage"]:
                    usage_data = event_obj["usage"]
                choices = event_obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                r_chunk = _extract_delta_reasoning(delta)
                if r_chunk:
                    on_reasoning_delta(r_chunk)
                tc_deltas = delta.get("tool_calls")
                if isinstance(tc_deltas, list):
                    for tcd in tc_deltas:
                        if not isinstance(tcd, dict):
                            continue
                        idx = int(tcd.get("index", 0) or 0)
                        entry = tc_acc.setdefault(
                            idx,
                            {
                                "id": f"call_{idx}",
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            },
                        )
                        if isinstance(tcd.get("id"), str) and tcd["id"]:
                            entry["id"] = tcd["id"]
                        fn_delta = tcd.get("function") or {}
                        fn_name_delta = fn_delta.get("name")
                        if isinstance(fn_name_delta, str) and fn_name_delta:
                            existing_name = entry["function"]["name"]
                            if not existing_name:
                                entry["function"]["name"] = fn_name_delta
                            elif (
                                fn_name_delta != existing_name
                                and not existing_name.endswith(fn_name_delta)
                            ):
                                entry["function"]["name"] += fn_name_delta
                        args_delta = fn_delta.get("arguments")
                        if isinstance(args_delta, str) and args_delta:
                            existing_args = entry["function"]["arguments"]
                            replaced = False
                            if existing_args.rstrip().endswith("}") and args_delta.lstrip().startswith("{"):
                                try:
                                    parsed_existing = json.loads(existing_args)
                                    parsed_new = json.loads(args_delta)
                                    if isinstance(parsed_existing, dict) and isinstance(parsed_new, dict):
                                        entry["function"]["arguments"] = args_delta
                                        replaced = True
                                except Exception:
                                    pass
                            if not replaced:
                                entry["function"]["arguments"] += args_delta
                        elif isinstance(args_delta, dict) and args_delta:
                            entry["function"]["arguments"] = json.dumps(args_delta, ensure_ascii=False)
                        if not notified_canvas_tc and "create_canvas" in entry["function"]["name"].lower():
                            notified_canvas_tc = True
                            on_phase_change("canvas")
                c_chunk = delta.get("content")
                if isinstance(c_chunk, str) and c_chunk:
                    tag_router.feed(c_chunk)
        tag_router.flush()
        return [tc_acc[k] for k in sorted(tc_acc.keys())]

    try:
        tool_calls_list = _run_stream_pass(messages, allow_tools=True, tag_router=router)
    except urllib.error.HTTPError as err:
        raise _friendly_http_error(RuntimeError(_extract_http_error_detail(err))) from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Error de red al conectar con OpenRouter: {err.reason}") from err
    except RuntimeError as err:
        raise _friendly_http_error(err) from err

    latency_ms = int((time.time() - started) * 1000)
    full_reasoning = "".join(reasoning_chunks).strip()
    full_reply = "".join(reply_chunks).strip()

    parsed_actions = _parse_actions_payload(router.actions_buf)
    if full_reply.startswith("{") and '"reply"' in full_reply:
        fallback_json = _parse_agent_json(full_reply)
        full_reply = str(fallback_json.get("reply") or full_reply).strip()
        if not parsed_actions.get("tasks") and isinstance(fallback_json.get("tasks"), list):
            parsed_actions = fallback_json

    canvas_obj = _resolve_canvas_artifact(
        tool_calls=tool_calls_list,
        canvas_buf=router.canvas_buf,
        actions_canvas=parsed_actions.get("canvas"),
        full_reply=full_reply,
        user_message=user_message,
    )

    if canvas_obj is not None:
        _upsert_step("build_canvas", f'Tabla lista en Canvas: "{canvas_obj["title"]}"', "done")
        emit_event({"type": "canvas", "canvas": canvas_obj})
        emit_event({"type": "steps", "steps": steps})

        # Si el modelo invocó create_canvas sin texto aún, ejecutamos el turno tool -> assistant en vivo
        if tool_calls_list and not full_reply:
            tool_result_content = json.dumps(
                {
                    "ok": True,
                    "canvas_title": canvas_obj["title"],
                    "columns": len(canvas_obj["columns"]),
                    "rows": len(canvas_obj["rows"]),
                    "instruction": (
                        "La tabla ya está abierta en Canvas. Responde únicamente con 1 a 3 oraciones breves "
                        "de conclusión en español dentro de <respuesta>. NO repitas la tabla ni escribas HTML."
                    ),
                },
                ensure_ascii=False,
            )
            followup_messages = [
                *messages,
                {"role": "assistant", "content": None, "tool_calls": tool_calls_list},
                *[
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id") or f"call_{i}",
                        "content": tool_result_content,
                    }
                    for i, tc in enumerate(tool_calls_list)
                ],
            ]
            followup_router = _StreamTagRouter(
                on_reasoning=on_reasoning_delta,
                on_reply=on_reply_delta,
                on_phase=on_phase_change,
            )
            try:
                _run_stream_pass(followup_messages, allow_tools=False, tag_router=followup_router)
                full_reply = "".join(reply_chunks).strip()
                if followup_router.actions_buf.strip():
                    parsed_actions = _parse_actions_payload(followup_router.actions_buf)
            except Exception:
                pass

        if not full_reply:
            summary_msg = f'Listo, preparé "{canvas_obj["title"]}" en Canvas ({len(canvas_obj["rows"])} filas y {len(canvas_obj["columns"])} columnas).'
            if canvas_obj.get("summary"):
                summary_msg += f"\n\n{canvas_obj['summary']}"
            on_reply_delta(summary_msg)
            full_reply = summary_msg

    # Limpia etiquetas HTML residuales (<table>, <tr>, </pdf>) en la respuesta visible final
    has_tabular_canvas = bool(canvas_obj and canvas_obj.get("columns") and canvas_obj.get("rows"))
    if full_reply:
        cleaned_reply = clean_visible_reply(full_reply, strip_tables=has_tabular_canvas)
        if not cleaned_reply and has_tabular_canvas and canvas_obj is not None:
            cleaned_reply = f'Listo, preparé "{canvas_obj["title"]}" en Canvas ({len(canvas_obj["rows"])} filas y {len(canvas_obj["columns"])} columnas).'
            if canvas_obj.get("summary"):
                cleaned_reply += f"\n\n{canvas_obj['summary']}"
        full_reply = cleaned_reply or full_reply

    if not full_reply and full_reasoning:
        full_reply = "Terminé el análisis; revisa los detalles arriba si deseas profundizar."

    if not full_reply:
        raise RuntimeError(
            "El modelo seleccionado devolvió una respuesta vacía temporalmente. Intenta enviar de nuevo o elige otro modelo."
        )

    safe_tasks, operation, mood = _normalize_agent_actions(parsed_actions)
    if canvas_obj is not None and mood == "talking":
        mood = "success"

    for st in steps:
        if st.get("status") == "running":
            st["status"] = "done"

    if safe_tasks:
        steps.append(
            {
                "id": "build_tasks",
                "label": f"Generando {len(safe_tasks)} tarjeta(s) de acción",
                "status": "done",
            }
        )
        emit_event({"type": "phase", "xox_state": "syncing", "label": "Preparando tarjetas de acción..."})
    elif len(steps) < 3 and canvas_obj is None:
        steps.append({"id": "talk_reply", "label": "Respuesta completada", "status": "done"})

    emit_event({"type": "steps", "steps": steps})

    reasoning_ms = 0
    if reasoning_started is not None:
        end_ts = reasoning_ended or time.time()
        reasoning_ms = max(200, int((end_ts - reasoning_started) * 1000))
    elif full_reasoning:
        reasoning_ms = latency_ms

    result: Dict[str, Any] = {
        "status": "ok",
        "reply": full_reply,
        "reasoning": full_reasoning,
        "reasoning_duration_ms": reasoning_ms,
        "steps": steps,
        "xox_mood": mood,
        "operation": operation,
        "tasks": safe_tasks,
        "model_used": actual_model,
        "usage": usage_data,
        "latency_ms": latency_ms,
    }
    if canvas_obj is not None:
        result["canvas"] = canvas_obj
    return result

