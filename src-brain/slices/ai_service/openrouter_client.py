"""
XOOK AI Service - Cliente OpenRouter (Pure Python stdlib)
Ejecuta inferencia real vía OpenRouter Chat Completions y traduce respuestas
al contrato seguro de bloques visuales (TaskProposal) sin exponer JSON crudo al usuario.
"""

import http.client
import json
import re
import ssl
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from slices.agent_tools import AGENT_TOOL_DEFS, WorkspaceToolExecutor
from slices.ai_service.model_router import (
    mark_model_temporarily_unhealthy,
    select_best_models_for_task,
)
from slices.task_ui.schemas import (
    canvas_has_cell_data,
    clean_visible_reply,
    sanitize_canvas_artifact,
    sanitize_clarification,
    sanitize_task_proposal,
)


class _CandidateFailoverError(RuntimeError):
    """Error recuperable en candidato inicial que activa cambio al siguiente modelo."""

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
APP_REFERER = "https://xook.local"
APP_TITLE = "XOOK Enterprise Agentic Orchestrator"
MAX_AGENT_STEPS = 12


def _parse_tool_args(raw_args: Any) -> Dict[str, Any]:
    if isinstance(raw_args, dict):
        return raw_args
    if isinstance(raw_args, str) and raw_args.strip():
        try:
            parsed = json.loads(raw_args)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        recovered = _parse_json_candidates(raw_args)
        if isinstance(recovered, dict):
            return recovered
        return {
            "__parse_error__": (
                "No se pudo interpretar el JSON de argumentos de la herramienta "
                "(posible corte por longitud o sintaxis inválida). "
                "Vuelve a invocar la herramienta con JSON completo y válido."
            ),
            "__raw_preview__": raw_args.strip()[:240],
        }
    return {}


def _tool_step_meta(fn_name: str, args: Dict[str, Any]) -> Tuple[str, str]:
    target = str(args.get("path") or args.get("target_path") or args.get("query") or "").strip()
    if fn_name == "workspace_list":
        return "Explorando espacio de trabajo", target or "."
    if fn_name == "workspace_read":
        return "Leyendo archivo del negocio", target
    if fn_name == "workspace_search":
        return "Buscando en archivos", target
    if fn_name == "workspace_mkdir":
        return "Creando carpeta de trabajo", target
    if fn_name == "workspace_write_file":
        return "Guardando documento en workspace", target
    if fn_name == "memory_record_fact":
        return "Registrando aprendizaje en memoria", str(args.get("category") or "negocio")
    if fn_name == "run_business_review":
        return "Ejecutando revisión operativa real", str(args.get("trigger_source") or "workspace")
    if fn_name == "propose_company_file_edit":
        return "Preparando cambio para aprobación", str(args.get("target_path") or "")
    if fn_name == "propose_delete_path":
        return "Preparando borrado para aprobación", str(args.get("target_path") or "")
    if fn_name == "propose_schedule_automation":
        return "Preparando automatización en Agenda", str(args.get("title") or "")
    if fn_name == "propose_tasks":
        raw_tasks = args.get("tasks")
        count = len(raw_tasks) if isinstance(raw_tasks, list) else 0
        return "Preparando tarjetas de acción", f"{count} propuesta(s)" if count else ""
    if fn_name == "run_workspace_command":
        return "Ejecutando utilidad con Guardián", str(args.get("purpose") or "comando")
    if fn_name == "list_desktop_apps":
        return "Buscando aplicaciones instaladas", str(args.get("query") or "equipo")
    if fn_name == "open_desktop_app":
        return "Abriendo aplicación con Guardián", str(args.get("app_name") or args.get("purpose") or "aplicación")
    if fn_name == "os_list_notes":
        return "Consultando Notas de Mac", str(args.get("query") or args.get("folder") or "notas recientes")
    if fn_name == "os_create_note":
        return "Creando nota en Notas", str(args.get("title") or args.get("purpose") or "nueva nota")
    if fn_name == "os_list_calendar_events":
        return "Consultando Calendario de Mac", str(args.get("calendar_name") or args.get("start_iso") or "próximos eventos")
    if fn_name == "os_create_calendar_event":
        return "Agendando evento en Calendario", str(args.get("title") or args.get("start_iso") or "evento")
    if fn_name == "pdf_read":
        pdf_name = Path(target).name if target else "documento.pdf"
        s_pg = args.get("start_page")
        e_pg = args.get("end_page")
        pg_note = f" (p. {s_pg}–{e_pg})" if (s_pg and e_pg) else (f" (desde p. {s_pg})" if s_pg else "")
        return f"Leyendo PDF {pdf_name}{pg_note}".strip(), target
    if fn_name == "pdf_generate":
        doc_title = str(args.get("title") or args.get("output_path") or "documento").strip()
        return f"Generando PDF: {doc_title[:42]}", str(args.get("output_path") or "agente/reportes/")
    return f"Herramienta: {fn_name}", target


def _extract_attached_flags(
    attached_context: Optional[List[Dict[str, Any]]],
    *,
    max_images: int = 4,
) -> Tuple[bool, List[Dict[str, Any]]]:
    """Devuelve `(has_attachments, multimodal_image_parts)` desde `attachedContext`."""
    items = [it for it in (attached_context or []) if isinstance(it, dict)]
    image_parts: List[Dict[str, Any]] = []
    for it in items:
        if len(image_parts) >= max_images:
            break
        data_url = str(it.get("imageDataUrl") or "").strip()
        if (
            data_url.startswith("data:image/")
            and ";base64," in data_url
            and len(data_url) <= 6_000_000
        ):
            image_parts.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })
    return bool(items), image_parts


def _sanitize_attached_context_for_prompt(
    attached_context: Optional[List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    """Elimina payloads binarios base64 grandes al serializar adjuntos al system prompt."""
    sanitized: List[Dict[str, Any]] = []
    for it in attached_context or []:
        if not isinstance(it, dict):
            continue
        clean: Dict[str, Any] = {}
        for k, v in it.items():
            if k == "imageDataUrl":
                continue
            if k == "content" and isinstance(v, str) and len(v) > 6000:
                clean[k] = v[:6000] + "\n...[contenido truncado]"
            else:
                clean[k] = v
        if it.get("imageDataUrl"):
            clean["hasInlineImage"] = True
        sanitized.append(clean)
    return sanitized


def _messages_have_images(messages: List[Dict[str, Any]]) -> bool:
    for msg in messages:
        content = msg.get("content") if isinstance(msg, dict) else None
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    return True
    return False


def _strip_image_parts(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convierte mensajes multimodales (`image_url`) a texto plano si el modelo no soporta visión."""
    cleaned: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            cleaned.append(msg)
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            cleaned.append(msg)
            continue
        text_bits: List[str] = []
        dropped_images = 0
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text" and isinstance(part.get("text"), str):
                text_bits.append(part["text"])
            elif part.get("type") == "image_url":
                dropped_images += 1
        joined = "\n".join(t for t in text_bits if t).strip()
        if dropped_images:
            note = (
                f"\n[{dropped_images} imagen(es) adjunta(s) omitida(s) en visión directa; "
                "usa `workspace_read` sobre su `workspacePath` o inspecciónala para conocer ruta, medidas y texto OCR.]"
            )
            joined = (joined + note).strip()
        cleaned.append({**msg, "content": joined or "Analiza los archivos adjuntos."})
    return cleaned


def _merge_tasks_dedup(base: List[Dict[str, Any]], extra: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = {str(t.get("cardId")) for t in base if isinstance(t, dict) and t.get("cardId")}
    merged = list(base)
    for t in extra:
        if not isinstance(t, dict):
            continue
        cid = str(t.get("cardId") or "")
        if cid and cid in seen:
            continue
        if cid:
            seen.add(cid)
        merged.append(t)
    return merged


def _summarize_workspace_tree(ws_root: Path) -> List[str]:
    summary: List[str] = []
    for zone in ("empresa", "datos", "memoria", "habilidades", "agente"):
        zdir = ws_root / zone
        if not zdir.is_dir():
            continue
        files = sorted(
            p.relative_to(ws_root).as_posix()
            for p in zdir.rglob("*")
            if p.is_file() and not p.name.startswith(".")
        )
        if files:
            summary.append(f"{zone}/ ({len(files)}): {', '.join(files[:8])}")
        else:
            summary.append(f"{zone}/ (vacía)")
    return summary

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
                "save_report": {
                    "type": "boolean",
                    "description": "Opcional: true si el usuario pidió guardar este reporte como Markdown dentro de agente/reportes/",
                },
            },
            "required": ["title", "columns", "rows"],
        },
    },
}

ASK_CLARIFICATION_TOOL_DEF: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "ask_clarification",
        "description": (
            "Abre una ventana interactiva de preguntas rápidas (Open Question) ÚNICAMENTE cuando al analizar "
            "el mensaje del usuario falte un dato indispensable que él NO haya mencionado (por ejemplo, pidió "
            "'agenda algo' sin qué ni cuándo, o pidió 'cita mañana' sin hora). PROHIBIDO pedir datos ya dichos "
            "(si ya dio evento + fecha + hora, crea la tarjeta directo sin preguntar)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Título breve contextualizado al caso, nunca genérico",
                },
                "subtitle": {
                    "type": "string",
                    "description": "Explicación corta en español del único dato faltante o duda real.",
                },
                "submitLabel": {
                    "type": "string",
                    "description": "Etiqueta del botón de envío, ej. 'Continuar'",
                },
                "questions": {
                    "type": "array",
                    "description": "Solo 1 a 3 preguntas estrictamente sobre lo que falta en el mensaje del usuario (nunca repetir lo que ya dijo).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "prompt": {"type": "string", "description": "Pregunta específica al dato faltante, redactada para este caso"},
                            "kind": {
                                "type": "string",
                                "enum": ["choice_or_text", "single", "multi", "text"],
                                "description": "Usa choice_or_text para mostrar chips sugeridos más campo libre",
                            },
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "2 a 4 opciones rápidas útiles para responder ese hueco concreto",
                            },
                            "placeholder": {"type": "string"},
                            "required": {"type": "boolean"},
                        },
                        "required": ["prompt"],
                    },
                },
            },
            "required": ["title", "questions"],
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
        "supported_parameters": ["tools", "structured_outputs"],
        "supports_tools": True,
        "supports_structured": True,
    },
    {
        "id": "openrouter/auto",
        "name": "Automático (Estándar)",
        "provider_name": "OpenRouter",
        "hint": "Enruta al mejor modelo según la tarea",
        "is_free": False,
        "context_length": 2000000,
        "supported_parameters": ["tools", "reasoning", "structured_outputs"],
        "supports_tools": True,
        "supports_reasoning": True,
        "supports_structured": True,
    },
    {
        "id": "google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider_name": "Google",
        "hint": "Rápido y económico",
        "is_free": False,
        "context_length": 1000000,
        "supported_parameters": ["tools", "reasoning", "structured_outputs"],
        "supports_tools": True,
        "supports_reasoning": True,
        "supports_structured": True,
    },
    {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o Mini",
        "provider_name": "OpenAI",
        "hint": "Preciso y ligero",
        "is_free": False,
        "context_length": 128000,
        "supported_parameters": ["tools", "structured_outputs"],
        "supports_tools": True,
        "supports_structured": True,
    },
    {
        "id": "openai/gpt-4o",
        "name": "GPT-4o",
        "provider_name": "OpenAI",
        "hint": "Modelo insignia multimodal de OpenAI",
        "is_free": False,
        "context_length": 128000,
        "supported_parameters": ["tools", "structured_outputs"],
        "supports_tools": True,
        "supports_structured": True,
    },
    {
        "id": "anthropic/claude-3.5-sonnet",
        "name": "Claude 3.5 Sonnet",
        "provider_name": "Anthropic",
        "hint": "Razonamiento profundo de negocio",
        "is_free": False,
        "context_length": 200000,
        "supported_parameters": ["tools", "structured_outputs"],
        "supports_tools": True,
        "supports_structured": True,
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

    raw_supported = raw.get("supported_parameters")
    if isinstance(raw_supported, list):
        supported_params = [str(p).strip().lower() for p in raw_supported if str(p).strip()]
    elif preset and isinstance(preset.get("supported_parameters"), list):
        supported_params = [str(p).strip().lower() for p in preset["supported_parameters"]]
    else:
        supported_params = []
    supp_set = set(supported_params)
    supports_tools = ("tools" in supp_set) or bool(preset and preset.get("supports_tools"))
    supports_reasoning = (
        ("reasoning" in supp_set or "include_reasoning" in supp_set)
        or bool(preset and preset.get("supports_reasoning"))
    )
    supports_structured = (
        ("structured_outputs" in supp_set or "response_format" in supp_set)
        or bool(preset and preset.get("supports_structured"))
    )
    arch = raw.get("architecture")
    supports_vision = False
    if isinstance(arch, dict):
        in_mods = [str(m).strip().lower() for m in (arch.get("input_modalities") or []) if str(m).strip()]
        modality = str(arch.get("modality") or "").strip().lower()
        if in_mods:
            supports_vision = "image" in in_mods
        elif modality:
            supports_vision = "image" in modality.split("->")[0]
    if not supports_vision and not (isinstance(arch, dict) and (arch.get("input_modalities") or arch.get("modality"))):
        low_id = mid.lower()
        supports_vision = bool(preset and preset.get("supports_vision")) or any(
            tok in low_id
            for tok in (
                "vision",
                "-vl-",
                "gemini-2",
                "gemini-1.5",
                "gpt-4o",
                "gpt-4.1",
                "claude-3",
                "claude-sonnet-4",
                "claude-opus-4",
                "gemma-3",
                "gemma-4",
                "llama-4",
            )
        )

    return {
        "id": mid,
        "name": cleaned_name,
        "provider_name": provider_name,
        "hint": hint,
        "is_free": is_free,
        "context_length": ctx,
        "prompt_price_per_million": prompt_per_million,
        "completion_price_per_million": completion_per_million,
        "supported_parameters": supported_params,
        "supports_tools": supports_tools,
        "supports_reasoning": supports_reasoning,
        "supports_structured": supports_structured,
        "supports_vision": supports_vision,
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
    workspace_root: Optional[Path] = None,
) -> str:
    ws_active = workspace_root is not None and workspace_root.is_dir()
    if ws_active and workspace_root is not None:
        profile = _load_json_safe(workspace_root / "empresa" / "perfil.json") or _load_json_safe(
            context_dir / "business-profiles" / "store-profile.json"
        )
        memory = _load_json_safe(workspace_root / "memoria" / "patrones.json") or _load_json_safe(
            context_dir / "memory" / "memory_store.json"
        )
        hechos_path = workspace_root / "memoria" / "hechos.md"
        facts_text = hechos_path.read_text(encoding="utf-8", errors="replace")[:1500] if hechos_path.is_file() else ""
        ws_tree = _summarize_workspace_tree(workspace_root)
    else:
        profile = _load_json_safe(context_dir / "business-profiles" / "store-profile.json")
        memory = _load_json_safe(context_dir / "memory" / "memory_store.json")
        facts_text = ""
        ws_tree = []

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
    clean_attached = _sanitize_attached_context_for_prompt(attached_context)
    if clean_attached:
        extra_ctx = "\nCONTEXTO ADJUNTO POR EL USUARIO:\n" + json.dumps(clean_attached, ensure_ascii=False)

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
- Usa la herramienta `create_canvas` (preferida; evita emitir etiquetas `<canvas>` manualmente) pasando columnas en texto simple y TODAS las filas completas en `rows`, o en último caso incluye una sección `<canvas>{...}</canvas>` con:
  {"title":"Título corto","subtitle":"Criterio breve","kind":"comparison","summary":"Conclusión clave en 1 oración","columns":["Criterio","Opción A","Opción B"],"rows":[["Precio","$100","$120"],["Tiempo","2 días","5 días"]],"recommended_row":0,"recommended_badge":"Recomendado"}
- NUNCA envíes `rows` con celdas vacías ni escribas etiquetas HTML (<table>, <tr>, <th>, <td>, <pdf>) en tu respuesta al usuario.
- En tu mensaje responde libremente con una explicación clara o la conclusión clave sin duplicar tablas HTML ni envolver el texto en etiquetas XML."""

    task_schema_hint = """ESQUEMA DE CADA TaskProposal EN "tasks":
{
  "cardId": "card_<slug>_<num>",
  "title": "Título corto accionable",
  "subtitle": "Explicación humana en 1 oración",
  "category": "abastecimiento" | "agenda" | "reloj" | "nota" | "optimizacion" | "regla",
  "urgency": "alta" | "media" | "baja" | "info",
  "statusChip": "Texto breve ej. '2d stock', '15 min', 'Vie 13 · 18:00'",
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
    // REGLA AGENDA VS RELOJ (MUY IMPORTANTE):
    // - Si es cita, entrega o recordatorio para una FECHA u HORA DEL RELOJ (ej. "mañana 18:00", "viernes 13, 18:00", "aviso 1h antes"): usa category="agenda", intent.type="schedule_event", schedule.mode="alarm" (o "recurring"), SIN durationSeconds y NUNCA start_timer.
    // - Usa category="reloj" e intent.type="start_timer" SOLO para cuentas regresivas cortas que empiezan AHORA (ej. "timer de 15 min", "en 20 minutos"), pasando paramValues={"duration_min": 15} y schedule.durationSeconds=900 explícitos.
    // Usa SIEMPRE estos campos exactos por tipo:
    // - schedule: {"type":"schedule","mode":"alarm"|"timer"|"recurring"|"auto","timeLabel":"19:00 hrs","dateLabel":"Viernes 13 nov","recurrence":"Semanal","autoSchedule":false}
    // - checklist: {"type":"checklist","title":"Pasos","items":[{"id":"chk_1","label":"Texto exacto del paso","done":false}]}  (NUNCA strings sueltos en items)
    // - note: {"type":"note","content":"Texto completo de la nota","tags":["Entrega"]}
    // - insight: {"type":"insight","text":"Explicación breve"}
    // - metrics_strip: {"type":"metrics_strip","items":[{"label":"Stock","value":"4 un.","tone":"critical"}]}
    // - param_control: {"type":"param_control","kind":"stepper"|"slider"|"toggle","key":"order_qty","label":"Cantidad","value":20,"min":1,"max":500}
  ]
}"""

    clarification_rule = """ACLARACIONES INTELIGENTES CON PREGUNTAS ABIERTAS (SIN PLANTILLAS FIJAS):
Antes de pedir aclaraciones, ANALIZA lo que el usuario ya dijo y lo que hay en AGENDA Y RELOJES ACTIVOS:
1. Si ya indicó QUÉ hacer y CUÁNDO (por ejemplo: "agendar una cita para mañana a las 10 pm", "recordatorio mañana 8 am", "timer de 15 min"), YA tienes lo necesario: crea la tarjeta `TaskProposal` directamente (por ejemplo "Cita — mañana 22:00") sin molestarlo preguntándole obviedades. Si notas empalme en su agenda activa a esa hora, adviértelo o pregunta solo cómo prefiere acomodarlo.
2. Usa `ask_clarification` (o `"operation":"ask_clarification"`) ÚNICAMENTE cuando falte un dato indispensable imposible de saber sin inventar (ej. dijo "agenda algo", "recuérdame luego", "haz una cita mañana" sin decir la hora, o "reponer producto" sin decir cuál).
3. PROHIBIDO repetir o volver a preguntar datos que el usuario ya mencionó, y NUNCA copies preguntas de un cuestionario genérico:
   - Si ya dijo "mañana a las 10 pm", NO preguntes día ni hora.
   - Si ya dijo "cita", NO preguntes "¿qué necesitas programar o hacer?".
   - Redacta únicamente 1 o 2 preguntas específicas al hueco real faltante, con formato:
     `{"title":"...","subtitle":"...","questions":[{"id":"dato_1","prompt":"<pregunta puntual sobre lo que realmente falta>","kind":"choice_or_text","options":["..."],"required":true}]}`."""

    if stream_mode:
        output_rules = f"""ESTILO DE RESPUESTA Y HERRAMIENTAS DE XOOK:
Responde directamente al usuario en español (o en el idioma que pida) usando Markdown natural y limpio, con plena libertad expresiva para escribir todo lo que necesites y elegir el tono, estructura, encabezados, listas, tablas Markdown, código o extensión que mejor ayuden al usuario.
- NUNCA envuelvas tu respuesta en etiquetas XML o pseudo-HTML como `<respuesta>`, `<analisis>`, `<posta>`, `<reply>`, `<canvas>` o `<acciones>`. Escribe texto directo y humano.
- Usa las herramientas nativas de XOOK solo cuando realmente aplique:
  * `propose_tasks`: cuando el usuario pida analizar stock con plan accionable, agendar tareas operativas, crear cronómetros/temporizadores o recordatorios internos de XOOK (`operation`: `"add_tasks"` o `"replace_tasks"`).
  * `ask_clarification`: si faltan datos críticos en una petición operativa ambigua y conviene preguntar con opciones interactivas.
  * `create_canvas`: para abrir tablas comparativas o reportes tabulares interactivos en el panel Canvas.
  * `pdf_generate` / `pdf_read`: para generar o leer archivos PDF.
- En preguntas generales, análisis de imágenes, lectura de documentos, programación, redacción o charla cotidiana, responde directamente en Markdown libre sin forzar tareas ni Canvas.

{clarification_rule}

{canvas_hint}

{task_schema_hint}"""
    else:
        output_rules = f"""REGLA DE SALIDA ESTRUCTURADA (OBLIGATORIA):
Responde ÚNICAMENTE con un objeto JSON válido (sin texto fuera del JSON) con esta estructura exacta:
{{
  "reply": "Tu respuesta clara y natural en español para el usuario (usa párrafos cortos o viñetas simples, nunca muestres JSON aquí).",
  "xox_mood": "talking" | "success" | "alert",
  "operation": "none" | "add_tasks" | "replace_tasks" | "ask_clarification",
  "tasks": [
    // Opcional: 0 a 3 tarjetas TaskProposal si el usuario pide analizar, reponer, agendar, poner un reloj/temporizador, crear una nota o consolidar/reconstruir tareas con datos suficientes.
  ],
  "clarification": null, // Opcional: objeto de aclaración cuando falten datos esenciales (operation = "ask_clarification")
  "canvas": null // Opcional: objeto Canvas si el usuario pidió una tabla o comparativa y no usaste `create_canvas`
}}

{clarification_rule}

{canvas_hint}

{task_schema_hint}"""

    now_label = _current_local_datetime_label()
    memory_patterns = memory.get("patterns") if isinstance(memory.get("patterns"), list) else memory.get("inferred_patterns", [])
    ws_section = ""
    if ws_active and workspace_root is not None:
        tree_lines = "\n".join(f"- {ln}" for ln in ws_tree) if ws_tree else "- Sin archivos todavía"
        ws_section = f"""
ESPACIO DE TRABAJO ACTIVO ({workspace_root.name}):
{tree_lines}

HECHOS REGISTRADOS EN memoria/hechos.md:
{facts_text or '(vacío)'}

HERRAMIENTAS DEL ESPACIO DE TRABAJO (OBLIGATORIO CUANDO OPERES SOBRE ARCHIVOS O REVISIONES):
- Puedes usar `workspace_list`, `workspace_read` y `workspace_search` para consultar archivos reales en `empresa/`, `datos/`, `memoria/`, `habilidades/` o `agente/`.
- Puedes organizar autónomamente carpetas y notas/reportes en `agente/` o `memoria/` con `workspace_mkdir`, `workspace_write_file` y `memory_record_fact`.
- Cuando el usuario pida analizar stock, inventario o buscar alertas reales, ejecuta `run_business_review` en lugar de inventar números o productos ficticios.
- NUNCA respondas diciendo "reviso qué hay en el workspace" o "voy a consultar primero" sin emitir en ese mismo turno la llamada real a herramienta (`tool_calls`). Si necesitas consultar archivos, llama a `workspace_list`/`workspace_read` de inmediato; si ya tienes los datos o es análisis estratégico, entrega la respuesta completa de una vez.
- Para proponer cambios en `empresa/`, `datos/` o `habilidades/`, usa SIEMPRE `propose_company_file_edit` (prepara borrador y tarjeta HITL).
- Si necesitas correr un comando de consola dentro del workspace (por ejemplo revisar líneas/conteos o ejecutar un script de validación), usa `run_workspace_command` explicando claramente `purpose` para el usuario.
- Cuando el usuario pida abrir, iniciar o lanzar una aplicación externa de su equipo (por ejemplo Notas, Calendario, Recordatorios, Calculadora, Safari, Finder, etc.), usa SIEMPRE `open_desktop_app` (y `list_desktop_apps` si necesitas verificar el nombre exacto instalado). No sustituyas "abrir Notas" o "abrir Calendario" creando tarjetas/tareas internas de XOOK a menos que el usuario pida explícitamente guardar una nota o agendar un evento aquí.
- Cuando el usuario pida crear, apuntar o consultar notas reales de su Mac (app Notas), usa `os_create_note` u `os_list_notes` (solo usa `workspace_write_file` o `propose_tasks` si pidió guardarlo específicamente dentro del espacio de trabajo de XOOK).
- Cuando el usuario pida revisar su Calendario, ver qué tiene agendado, buscar horarios disponibles, hacer una agenda desde su calendario o agendar un evento/cita/reunión real en Calendario, usa `os_list_calendar_events` y/o `os_create_calendar_event` calculando fechas ISO exactas a partir de la FECHA Y HORA LOCAL ACTUAL. Si falta un dato indispensable para agendar (por ejemplo falta el día o la hora), usa `ask_clarification` antes de invocar `os_create_calendar_event`.
- DOCUMENTOS PDF E IMÁGENES:
  - Si el usuario adjunta o menciona un PDF (en `agente/adjuntos/`, `datos/`, etc.), llama a `pdf_read` para extraer texto, tablas y páginas escaneadas con OCR antes de responder (pagina con `start_page`/`end_page` si tiene muchas páginas).
  - Si el usuario pide generar, redactar, convertir o exportar un informe/documento en PDF, llama a `pdf_generate` (escribe en `agente/reportes/`). **REGLA CRÍTICA**: incluye SIEMPRE todo el desarrollo completo en un arreglo JSON nativo `blocks` (NUNCA serialices `blocks` como string JSON) o, si el documento es muy extenso (8+, 12+ páginas o con código largo), usa preferentemente el campo `markdown` estructurado (`#`, `##`, `###`, listas, `> callouts`, tablas y ```` ```lenguaje ````) porque es más compacto y evita cortes. NUNCA generes un PDF sin desarrollo poniendo la explicación solo en el chat; en el chat solo confirma brevemente el resultado, archivo y páginas.
  - Si el usuario adjunta imágenes o las menciona desde el workspace e indica cómo integrarlas (por ejemplo como portada, logo, fondo visual o figuras dentro de secciones), interpreta libremente su intención:
    - Cuando la imagen adjunta YA sea una portada o carátula diseñada (ej. hoja institucional/académica o imagen con su propio texto/título/escudo), usa `cover: {{"enabled": true, "image_path": "...", "layout": "full_page"}}` para insertarla íntegra y nítida en la página 1 sin oscurecerla ni encimar texto blanco encima (y desarrolla el tema completo desde la página 2 en `blocks`).
    - Cuando sea una foto limpia, ilustración o logotipo donde sí corresponda diseñar portada tipográfica encima o al lado, usa `layout` entre `auto`, `hero_top`, `split`, `centered`, `full_bleed` o `minimal`."""

    return f"""Eres Xox, el asistente inteligente y copiloto operativo de XOOK (Enterprise Agentic Orchestrator).
Hablas SIEMPRE en español claro, humano, directo y útil.
Puedes responder con naturalidad cualquier consulta general (hora y fecha actual, cálculos, conocimiento general, tecnología, redacción, dudas cotidianas) además de ayudar con la operación del negocio, inventario, agenda, temporizadores y tareas.

FECHA Y HORA LOCAL ACTUAL DEL SISTEMA:
{now_label}
(Usa siempre esta fecha y hora exacta cuando el usuario pregunte qué hora es, qué día es hoy, o pida cálculos de tiempo y recordatorios.)

PERFIL DEL NEGOCIO ACTUAL:
{json.dumps(profile, ensure_ascii=False, indent=2)}

MEMORIA Y PATRONES APRENDIDOS:
{json.dumps(memory_patterns, ensure_ascii=False, indent=2)}{ws_section}

SKILL ACTIVO (inventory-advisor):
{skill_text[:1400]}

TAREAS PENDIENTES EN PANEL DERECHO:
{json.dumps(compact_tasks, ensure_ascii=False)}

AGENDA Y RELOJES ACTIVOS:
{json.dumps(compact_agenda, ensure_ascii=False)}{operator_ctx}{canvas_ctx}{extra_ctx}

{output_rules}

REGLAS CRÍTICAS:
- Tienes plena libertad expresiva y de formato: adapta el tono, la estructura, la extensión y el nivel de detalle a lo que pida el usuario, sin envolver el texto en etiquetas XML.
- Si el usuario hace una pregunta general o cotidiana (ej. "¿qué hora es?", "¿qué día es hoy?", análisis de imágenes, dudas técnicas, matemáticas, redacción, charla o conocimiento general), respóndele directa y útilmente usando tu conocimiento y la fecha/hora local arriba, sin forzar temas de inventario ni crear tareas innecesarias.
- Nunca inventes ventas, stock ni pagos: usa archivos reales del workspace o señala claramente si falta cargar inventario.
- Si es una pregunta conversacional simple sobre el negocio (ej. "¿cómo ves el stock?", "¿por qué 20 unidades?"), responde en conversación normal sin generar tarjetas.
- Si el usuario pide crear una tarea operativa del negocio dentro de XOOK, reloj/temporizador, o recordatorio explícitamente interno de XOOK, usa `propose_tasks` (o `"tasks"` en modo JSON); si pide crear una nota o evento/agenda en las apps Notas o Calendario de su Mac, usa directamente las herramientas `os_create_note` / `os_create_calendar_event`."""


_PROTOCOL_TAG_PREFIX_RE = re.compile(r"^<\s*(?:/\s*)?[a-z]*\s*$", re.IGNORECASE)
_TAG_REGEX_CACHE: Dict[Tuple[Tuple[str, ...], bool], re.Pattern[str]] = {}


def _compile_tag_pattern(tags: Tuple[str, ...], anchored: bool = False) -> re.Pattern[str]:
    key = (tags, anchored)
    cached = _TAG_REGEX_CACHE.get(key)
    if cached is not None:
        return cached
    parts: List[str] = []
    for tag in tags:
        is_close = tag.startswith("</")
        name = tag[2:-1] if is_close else tag[1:-1]
        slash = r"/\s*" if is_close else ""
        parts.append(rf"<\s*{slash}{re.escape(name)}\s*>")
    joined = "|".join(parts)
    pattern = rf"^(?:{joined})" if anchored else joined
    compiled = re.compile(pattern, re.IGNORECASE)
    _TAG_REGEX_CACHE[key] = compiled
    return compiled


def _canonical_tag(raw_tag: str) -> str:
    return re.sub(r"\s+", "", raw_tag).lower()


def _partial_tag_split(buf: str, tags: Tuple[str, ...]) -> Tuple[str, str]:
    """Separa un prefijo seguro para emitir y retiene un posible inicio parcial de etiqueta."""
    last_lt = buf.rfind("<")
    if last_lt == -1:
        return buf, ""
    tail = buf[last_lt:]
    if ">" not in tail and _PROTOCOL_TAG_PREFIX_RE.fullmatch(tail):
        normalized = _canonical_tag(tail)
        if any(tag.startswith(normalized) for tag in tags):
            return buf[:last_lt], buf[last_lt:]
    return buf, ""


def _find_first_tag(buf: str, tags: Tuple[str, ...]) -> Optional[Tuple[int, str, str]]:
    m = _compile_tag_pattern(tags, anchored=False).search(buf)
    if not m:
        return None
    raw = m.group(0)
    return m.start(), raw, _canonical_tag(raw)


class _StreamTagRouter:
    """Enruta chunks de contenido streaming hacia análisis, respuesta, canvas y acciones ocultas."""

    OPEN_ANALYSIS = ("<analisis>", "<analysis>")
    CLOSE_ANALYSIS = ("</analisis>", "</analysis>")
    OPEN_REPLY = ("<respuesta>", "<response>", "<posta>", "<reply>", "<resp>")
    CLOSE_REPLY = ("</respuesta>", "</response>", "</posta>", "</reply>", "</resp>")
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
        for tags, target in (
            (self.OPEN_ANALYSIS, "analysis"),
            (self.OPEN_REPLY, "reply"),
            (self.OPEN_CANVAS, "canvas"),
            (self.OPEN_ACTIONS, "actions"),
        ):
            m = _compile_tag_pattern(tags, anchored=True).match(trimmed)
            if m:
                self.buf = trimmed[m.end() :].lstrip("\r\n")
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
        if _PROTOCOL_TAG_PREFIX_RE.fullmatch(trimmed):
            normalized = _canonical_tag(trimmed)
            if any(t.startswith(normalized) for t in self.ALL_OPEN):
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
                    idx, raw_tag, _ = found
                    if idx > 0:
                        self.on_reasoning(self.buf[:idx])
                    self.buf = self.buf[idx + len(raw_tag) :]
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
                    idx, raw_tag, canonical = found
                    if idx > 0:
                        self.on_reply(self.buf[:idx])
                    self.buf = self.buf[idx + len(raw_tag) :]
                    if canonical in self.OPEN_CANVAS:
                        self._enter_canvas()
                    elif canonical in self.OPEN_ACTIONS:
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
                    idx, raw_tag, _ = found
                    self.canvas_buf += self.buf[:idx]
                    self.buf = self.buf[idx + len(raw_tag) :]
                    self.mode = "after_canvas"
                    continue
                safe, rem = _partial_tag_split(self.buf, self.CLOSE_CANVAS)
                self.canvas_buf += safe
                self.buf = rem
                return

            if self.mode == "actions":
                found = _find_first_tag(self.buf, self.CLOSE_ACTIONS)
                if found:
                    idx, _, _ = found
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
            trimmed = re.sub(
                r"<\s*/?\s*(?:analisis|analysis|respuesta|response|canvas|lienzo|acciones|actions|posta|reply|resp)\s*(?:>|$)",
                "",
                self.buf.lstrip(),
                flags=re.IGNORECASE,
            )
            if trimmed:
                self._enter_reply()
                self.on_reply(trimmed)
        elif self.mode == "analysis":
            self.on_reasoning(self.buf)
        elif self.mode == "reply":
            cleaned = re.sub(
                r"<\s*/?\s*(?:analisis|analysis|respuesta|response|canvas|lienzo|acciones|actions|posta|reply|resp)\s*(?:>|$)",
                "",
                self.buf,
                flags=re.IGNORECASE,
            )
            if cleaned:
                self.on_reply(cleaned)
        elif self.mode == "canvas":
            cleaned = re.sub(r"<\s*/?\s*(?:canvas|lienzo)\s*>", "", self.buf, flags=re.IGNORECASE)
            self.canvas_buf += cleaned
        elif self.mode == "actions":
            cleaned = re.sub(r"<\s*/?\s*(?:acciones|actions)\s*>", "", self.buf, flags=re.IGNORECASE)
            self.actions_buf += cleaned
        self.buf = ""


def _decode_partial_json_string(raw_inner: str) -> str:
    """Decodifica contenido interno parcial de un string JSON sin requerir comilla de cierre."""
    cleaned = raw_inner
    if cleaned.endswith("\\"):
        cleaned = cleaned[:-1]
    try:
        return str(json.loads(f'"{cleaned}"'))
    except Exception:
        return (
            cleaned.replace("\\n", "\n")
            .replace("\\r", "")
            .replace("\\t", " ")
            .replace('\\"', '"')
            .replace("\\\\", "\\")
        )


def _markdown_to_preview_blocks(md_text: str, limit: int = 18) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    para_lines: List[str] = []

    def _flush_para() -> None:
        if para_lines:
            blocks.append({"type": "paragraph", "text": " ".join(para_lines)[:240]})
            para_lines.clear()

    for line in (md_text or "").splitlines():
        s = line.strip()
        if not s:
            _flush_para()
            continue
        if s.startswith("### "):
            _flush_para()
            blocks.append({"type": "heading", "level": 3, "text": s[4:].strip()[:160]})
        elif s.startswith("## "):
            _flush_para()
            blocks.append({"type": "heading", "level": 2, "text": s[3:].strip()[:160]})
        elif s.startswith("# "):
            _flush_para()
            blocks.append({"type": "heading", "level": 1, "text": s[2:].strip()[:160]})
        elif s.startswith(("- ", "* ")):
            _flush_para()
            if blocks and blocks[-1].get("type") == "bullet_list":
                blocks[-1]["items"].append(s[2:].strip()[:110])
            else:
                blocks.append({"type": "bullet_list", "items": [s[2:].strip()[:110]]})
        else:
            para_lines.append(s)
        if len(blocks) >= limit:
            break
    if len(blocks) < limit:
        _flush_para()
    return blocks[:limit]


def _summarize_pdf_preview_block(blk: Dict[str, Any]) -> Dict[str, Any]:
    bt = str(blk.get("type") or "").lower()
    out_b: Dict[str, Any] = {"type": bt or "paragraph"}
    if bt == "heading":
        out_b["level"] = int(blk.get("level") or 1)
        out_b["text"] = str(blk.get("text") or blk.get("title") or "")[:160]
    elif bt in ("paragraph", "callout", "summary", "quote"):
        if blk.get("title"):
            out_b["title"] = str(blk.get("title"))[:120]
        if blk.get("tone"):
            out_b["tone"] = str(blk.get("tone"))[:24]
        out_b["text"] = str(blk.get("text") or blk.get("content") or "")[:240]
    elif bt in ("bullets", "bullet_list", "unordered_list", "ul", "list", "numbered_list", "ordered_list", "ol"):
        out_b["type"] = "numbered_list" if bt in ("numbered_list", "ordered_list", "ol") else "bullet_list"
        items = blk.get("items") or []
        out_b["items"] = [str(x)[:110] for x in items[:5]] if isinstance(items, list) else []
    elif bt in ("code", "code_block", "pre"):
        out_b["type"] = "code"
        lang = str(blk.get("language") or blk.get("lang") or "").strip()
        if lang:
            out_b["language"] = lang[:30]
        out_b["text"] = str(blk.get("code") or blk.get("text") or blk.get("content") or "")[:320]
    elif bt == "table":
        cols = blk.get("headers") or blk.get("columns") or []
        rows = blk.get("rows") or []
        out_b["columns"] = [str(c)[:40] for c in cols[:6]] if isinstance(cols, list) else []
        out_b["rows"] = [
            [str(c)[:40] for c in r[:6]]
            for r in (rows[:4] if isinstance(rows, list) else [])
            if isinstance(r, list)
        ]
    elif bt == "image":
        out_b["path"] = str(blk.get("path") or blk.get("image_path") or blk.get("src") or "")
        out_b["caption"] = str(blk.get("caption") or "")[:100]
    elif bt == "kpi_strip":
        cards = blk.get("metrics") or blk.get("items") or []
        out_b["metrics"] = [
            {"label": str(c.get("label") or "")[:40], "value": str(c.get("value") or "")[:40]}
            for c in (cards[:4] if isinstance(cards, list) else [])
            if isinstance(c, dict)
        ]
    return out_b


def _extract_partial_pdf_draft(raw_args: str) -> Optional[Dict[str, Any]]:
    """
    Extrae metadatos y bloques ya formados (más el bloque activo en redacción)
    de los argumentos JSON mientras el modelo hace streaming de `pdf_generate`.
    """
    text = (raw_args or "").strip()
    start = text.find("{")
    if start == -1:
        return None
    src = text[start:]

    try:
        full = json.loads(src)
        if isinstance(full, dict):
            raw_cov = full.get("cover")
            cov_dict = dict(raw_cov) if isinstance(raw_cov, dict) else {}
            cov_img = str(
                cov_dict.get("image_path")
                or cov_dict.get("image")
                or cov_dict.get("path")
                or full.get("cover_image")
                or full.get("coverImage")
                or full.get("portada_imagen")
                or ""
            ).strip()
            has_cov = bool(raw_cov is True or cov_dict.get("enabled") or cov_img)
            raw_blks = full.get("blocks") or full.get("sections") or []
            if isinstance(raw_blks, str):
                from slices.pdf_engine.generator import _recover_json_block_objects

                raw_blks = _recover_json_block_objects(raw_blks)
            blocks_out = (
                [_summarize_pdf_preview_block(b) for b in raw_blks[:20] if isinstance(b, dict)]
                if isinstance(raw_blks, list) and raw_blks
                else _markdown_to_preview_blocks(str(full.get("markdown") or ""))
            )
            return {
                "title": str(full.get("title") or "").strip(),
                "subtitle": str(full.get("subtitle") or "").strip(),
                "theme": str(full.get("theme") or "executive").strip().lower(),
                "author": str(full.get("author") or full.get("company") or "").strip(),
                "has_cover": has_cov,
                "cover": {
                    "enabled": has_cov,
                    "layout": str(cov_dict.get("layout") or "auto"),
                    "eyebrow": str(cov_dict.get("eyebrow") or cov_dict.get("badge") or cov_dict.get("kicker") or ""),
                    "image_path": cov_img,
                } if has_cov else None,
                "blocks": blocks_out,
                "total_blocks": len(blocks_out),
            }
    except Exception:
        pass

    n = len(src)

    def _skip_ws(pos: int) -> int:
        while pos < n and src[pos] in " \t\r\n,":
            pos += 1
        return pos

    def _read_str(pos: int) -> Tuple[str, int, bool]:
        if pos >= n or src[pos] != '"':
            return "", pos, False
        j = pos + 1
        esc = False
        while j < n:
            ch = src[j]
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                raw_slice = src[pos : j + 1]
                try:
                    return str(json.loads(raw_slice)), j + 1, True
                except Exception:
                    return _decode_partial_json_string(src[pos + 1 : j]), j + 1, True
            j += 1
        return _decode_partial_json_string(src[pos + 1 :]), n, False

    def _scan_balanced(pos: int, open_ch: str, close_ch: str) -> Tuple[str, int, bool]:
        j = pos
        depth = 0
        in_str = False
        esc = False
        while j < n:
            ch = src[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == open_ch:
                    depth += 1
                elif ch == close_ch:
                    depth -= 1
                    if depth == 0:
                        return src[pos : j + 1], j + 1, True
            j += 1
        return src[pos:], n, False

    scalars: Dict[str, Any] = {}
    cover_raw = ""
    cover_closed = False
    blocks_slice = ""
    i = 1
    while i < n:
        i = _skip_ws(i)
        if i >= n or src[i] == "}":
            break
        if src[i] != '"':
            i += 1
            continue
        key, next_i, k_closed = _read_str(i)
        if not k_closed:
            break
        i = next_i
        while i < n and src[i] in " \t\r\n":
            i += 1
        if i >= n or src[i] != ":":
            break
        i += 1
        while i < n and src[i] in " \t\r\n":
            i += 1
        if i >= n:
            break
        ch = src[i]
        if ch == '"':
            val_str, next_v, v_closed = _read_str(i)
            if key in ("blocks", "sections") and val_str.lstrip().startswith("["):
                blocks_slice = val_str
            else:
                scalars[key] = val_str
            i = next_v
            if not v_closed:
                break
        elif ch == "{":
            obj_raw, next_v, o_closed = _scan_balanced(i, "{", "}")
            if key == "cover":
                cover_raw = obj_raw
                cover_closed = o_closed
            i = next_v
            if not o_closed:
                break
        elif ch == "[":
            arr_raw, next_v, a_closed = _scan_balanced(i, "[", "]")
            if key in ("blocks", "sections"):
                blocks_slice = arr_raw
            i = next_v
            if not a_closed:
                break
        else:
            j = i
            while j < n and src[j] not in ",}":
                j += 1
            tok = src[i:j].strip().lower()
            if tok == "true":
                scalars[key] = True
            elif tok == "false":
                scalars[key] = False
            i = j

    blocks_out: List[Dict[str, Any]] = []
    if blocks_slice:
        bn = len(blocks_slice)
        bi = 1
        b_depth = 0
        b_str = False
        b_esc = False
        obj_start = -1
        while bi < bn and len(blocks_out) < 20:
            c = blocks_slice[bi]
            if b_str:
                if b_esc:
                    b_esc = False
                elif c == "\\":
                    b_esc = True
                elif c == '"':
                    b_str = False
            else:
                if c == '"':
                    b_str = True
                elif c == "{":
                    if b_depth == 0:
                        obj_start = bi
                    b_depth += 1
                elif c == "}":
                    if b_depth > 0:
                        b_depth -= 1
                        if b_depth == 0 and obj_start != -1:
                            try:
                                blk_obj = json.loads(blocks_slice[obj_start : bi + 1])
                                if isinstance(blk_obj, dict):
                                    blocks_out.append(_summarize_pdf_preview_block(blk_obj))
                            except Exception:
                                pass
                            obj_start = -1
            bi += 1
        if obj_start != -1 and len(blocks_out) < 20:
            open_obj = blocks_slice[obj_start:]
            m_type = re.search(r'"type"\s*:\s*"([^"]+)"', open_obj)
            if m_type:
                btype = m_type.group(1).strip().lower()
                partial_blk: Dict[str, Any] = {"type": btype, "streaming": True}
                m_lvl = re.search(r'"level"\s*:\s*(\d+)', open_obj)
                if m_lvl:
                    partial_blk["level"] = int(m_lvl.group(1))
                m_txt = re.search(r'"(?:text|content|code)"\s*:\s*"((?:[^"\\]|\\.)*)', open_obj)
                if m_txt:
                    partial_blk["text"] = _decode_partial_json_string(m_txt.group(1))[:260]
                m_lang = re.search(r'"(?:language|lang)"\s*:\s*"((?:[^"\\]|\\.)*)', open_obj)
                if m_lang:
                    partial_blk["language"] = _decode_partial_json_string(m_lang.group(1))[:30]
                m_ttl = re.search(r'"title"\s*:\s*"((?:[^"\\]|\\.)*)', open_obj)
                if m_ttl:
                    partial_blk["title"] = _decode_partial_json_string(m_ttl.group(1))[:120]
                blocks_out.append(partial_blk)
    elif isinstance(scalars.get("markdown"), str) and scalars["markdown"]:
        blocks_out = _markdown_to_preview_blocks(scalars["markdown"])

    cov_dict: Dict[str, Any] = {}
    if cover_raw:
        if cover_closed:
            try:
                parsed_cov = json.loads(cover_raw)
                if isinstance(parsed_cov, dict):
                    cov_dict = parsed_cov
            except Exception:
                pass
        else:
            if re.search(r'"enabled"\s*:\s*true', cover_raw, re.IGNORECASE):
                cov_dict["enabled"] = True
            for ck in ("image_path", "image", "path", "eyebrow", "badge", "kicker", "layout", "footer_note"):
                cm = re.search(rf'"{ck}"\s*:\s*"((?:[^"\\]|\\.)*)"', cover_raw)
                if cm:
                    cov_dict[ck] = _decode_partial_json_string(cm.group(1))

    cov_img = str(
        cov_dict.get("image_path")
        or cov_dict.get("image")
        or cov_dict.get("path")
        or scalars.get("cover_image")
        or scalars.get("coverImage")
        or scalars.get("portada_imagen")
        or ""
    ).strip()
    has_cov = bool(scalars.get("cover") is True or cov_dict.get("enabled") or cov_img)

    if not scalars and not blocks_out and not cov_dict:
        return None

    return {
        "title": str(scalars.get("title") or "").strip(),
        "subtitle": str(scalars.get("subtitle") or "").strip(),
        "theme": str(scalars.get("theme") or "executive").strip().lower(),
        "author": str(scalars.get("author") or scalars.get("company") or "").strip(),
        "has_cover": has_cov,
        "cover": {
            "enabled": has_cov,
            "layout": str(cov_dict.get("layout") or "auto"),
            "eyebrow": str(cov_dict.get("eyebrow") or cov_dict.get("badge") or cov_dict.get("kicker") or ""),
            "image_path": cov_img,
        } if has_cov else None,
        "blocks": blocks_out,
        "total_blocks": len(blocks_out),
    }


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


def _canvas_wants_saved_report(tool_calls: List[Dict[str, Any]]) -> bool:
    for tc in tool_calls:
        fn = tc.get("function") or {}
        fn_name = str(fn.get("name") or "").strip().lower()
        if not fn_name or ("create_canvas" not in fn_name and fn_name != "canvas"):
            continue
        parsed_args = _parse_tool_args(fn.get("arguments"))
        if isinstance(parsed_args.get("save_report"), bool) and parsed_args.get("save_report"):
            return True
        inner = parsed_args.get("canvas") if isinstance(parsed_args.get("canvas"), dict) else {}
        if isinstance(inner.get("save_report"), bool) and inner.get("save_report"):
            return True
    return False


def _maybe_save_canvas_report(
    ws_path: Optional[Path],
    canvas_obj: Optional[Dict[str, Any]],
    tool_calls: List[Dict[str, Any]],
) -> Optional[str]:
    if ws_path is None or canvas_obj is None or not _canvas_wants_saved_report(tool_calls):
        return None
    title = str(canvas_obj.get("title") or "reporte").strip()
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48] or "reporte"
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_dir = ws_path / "agente" / "reportes"
    report_dir.mkdir(parents=True, exist_ok=True)
    target = report_dir / f"{slug}_{stamp}.md"

    lines: List[str] = [f"# {title}"]
    if canvas_obj.get("subtitle"):
        lines.append(f"_{canvas_obj['subtitle']}_")
    if canvas_obj.get("summary"):
        lines.extend(["", f"> {canvas_obj['summary']}"])
    cols = canvas_obj.get("columns") or []
    rows = canvas_obj.get("rows") or []
    if cols and rows:
        headers = [str(c.get("label") or c.get("key") or f"Col {i+1}") for i, c in enumerate(cols)]
        keys = [str(c.get("key") or f"col_{i}") for i, c in enumerate(cols)]
        lines.append("")
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join("---" for _ in headers) + " |")
        for row in rows:
            vals = [str(row.get(k, "")).replace("|", "\\|").replace("\n", " ") for k in keys]
            lines.append("| " + " | ".join(vals) + " |")
    if canvas_obj.get("markdown"):
        lines.extend(["", str(canvas_obj["markdown"])])

    target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return f"agente/reportes/{target.name}"


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
    workspace_root: Optional[Path] = None,
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
        workspace_root=workspace_root,
    )

    messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for msg in (history or [])[-10:]:
        role = msg.get("role")
        content = msg.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    _, image_parts = _extract_attached_flags(attached_context)
    clean_user_text = (user_message or "").strip()
    if image_parts:
        prompt_txt = clean_user_text or "Analiza las imágenes y archivos adjuntos."
        final_user_content: Any = [
            {"type": "text", "text": prompt_txt},
            *image_parts,
        ]
    else:
        final_user_content = clean_user_text or (
            "Analiza los archivos adjuntos." if attached_context else user_message
        )
    messages.append({"role": "user", "content": final_user_content})
    return key, chosen_model, messages


def _extract_clarification_from_tool_calls(tool_calls: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        if "ask_clarification" not in str(fn.get("name") or "").lower():
            continue
        raw_args = fn.get("arguments")
        args_obj: Optional[Dict[str, Any]] = None
        if isinstance(raw_args, dict):
            args_obj = raw_args
        elif isinstance(raw_args, str):
            args_obj = _parse_json_candidates(raw_args)
        if args_obj:
            clean = sanitize_clarification(args_obj)
            if clean:
                return clean
    return None


def _normalize_agent_actions(
    parsed: Dict[str, Any],
    tool_calls: Optional[List[Dict[str, Any]]] = None,
    user_message: str = "",
) -> Tuple[List[Dict[str, Any]], str, str, Optional[Dict[str, Any]]]:
    clarification = _extract_clarification_from_tool_calls(tool_calls or [])
    if clarification is None and parsed.get("clarification") is not None:
        clarification = sanitize_clarification(parsed.get("clarification"))
    if clarification is not None and user_message and not clarification.get("originalQuery"):
        clarification["originalQuery"] = user_message

    raw_tasks = parsed.get("tasks") if isinstance(parsed.get("tasks"), list) else []
    safe_tasks = [sanitize_task_proposal(t) for t in raw_tasks if isinstance(t, dict)]

    operation = parsed.get("operation", "none")
    if clarification is not None:
        operation = "ask_clarification"
        safe_tasks = []
    elif operation not in ("none", "add_tasks", "replace_tasks", "ask_clarification"):
        operation = "add_tasks" if safe_tasks else "none"
    elif operation == "ask_clarification" and clarification is None:
        operation = "add_tasks" if safe_tasks else "none"

    mood = parsed.get("xox_mood", "talking")
    if mood not in ("talking", "success", "alert"):
        mood = "success" if safe_tasks else "talking"

    return safe_tasks, operation, mood, clarification


def _is_recoverable_candidate_error(err_msg: str) -> bool:
    low = (err_msg or "").lower()
    if any(tok in low for tok in ("401", "unauthorized", "invalid api key", "no auth")):
        return False
    return any(
        tok in low
        for tok in (
            "402",
            "404",
            "429",
            "500",
            "502",
            "503",
            "504",
            "provider returned error",
            "bad gateway",
            "overloaded",
            "context length",
            "maximum context",
            "max_tokens",
            "rate limit",
            "no endpoints",
            "insufficient credits",
            "more credits",
            "tool",
            "function",
            "unsupported",
            "temporarily",
            "timeout",
            "timed out",
            "vacía",
            "empty",
        )
    )


def _messages_have_tool_history(messages: List[Dict[str, Any]]) -> bool:
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("role") == "tool" or msg.get("tool_calls"):
            return True
    return False


def _sanitize_tool_calls_for_history(
    tool_calls: List[Dict[str, Any]],
    parsed_args_list: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    Asegura que todo `tool_call` guardado en el historial tenga JSON válido en `function.arguments`
    (si un argumento quedó truncado/inválido al reenviarlo causaría HTTP 400 en OpenRouter).
    Retorna `(sanitized_calls, all_failed_parse)`.
    """
    sanitized: List[Dict[str, Any]] = []
    failed_count = 0
    for idx, tc in enumerate(tool_calls):
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        fn_name = str(fn.get("name") or "").strip() or f"tool_{idx}"
        tc_id = str(tc.get("id") or f"call_hist_{idx}").strip()
        raw_args = fn.get("arguments")
        parsed = parsed_args_list[idx] if idx < len(parsed_args_list) else {}

        if isinstance(parsed, dict) and "__parse_error__" in parsed:
            failed_count += 1
            safe_args_str = "{}"
        else:
            valid_raw = False
            if isinstance(raw_args, str) and raw_args.strip():
                try:
                    loaded = json.loads(raw_args)
                    if isinstance(loaded, dict):
                        valid_raw = True
                except Exception:
                    valid_raw = False
            if valid_raw:
                safe_args_str = str(raw_args)
            elif isinstance(parsed, dict):
                safe_args_str = json.dumps(parsed, ensure_ascii=False)
            else:
                safe_args_str = "{}"

        sanitized.append({
            "id": tc_id,
            "type": "function",
            "function": {
                "name": fn_name,
                "arguments": safe_args_str,
            },
        })
    all_failed = bool(tool_calls) and failed_count >= len(tool_calls)
    return sanitized, all_failed


def _collapse_tool_history_to_text(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convierte rondas previas de `assistant(tool_calls)` + `role=tool` en mensajes planos
    cuando un proveedor upstream rechaza mensajes multi-turno con rol `tool` (HTTP 400).
    """
    collapsed: List[Dict[str, Any]] = []
    tool_summaries: List[str] = []

    def _flush_tools() -> None:
        if not tool_summaries:
            return
        collapsed.append({
            "role": "assistant",
            "content": "Ya ejecuté las herramientas solicitadas:\n" + "\n".join(tool_summaries),
        })
        collapsed.append({
            "role": "user",
            "content": "Continúa y responde al usuario con base en esos resultados (si faltó completar algo o corregir un parámetro, hazlo ahora).",
        })
        tool_summaries.clear()

    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role == "assistant" and msg.get("tool_calls"):
            txt = str(msg.get("content") or "").strip()
            if txt:
                tool_summaries.append(f"- Nota previa: {txt[:300]}")
            for tc in msg.get("tool_calls") or []:
                fn = (tc.get("function") or {}) if isinstance(tc, dict) else {}
                fname = str(fn.get("name") or "herramienta")
                tool_summaries.append(f"- Invocación: `{fname}`")
            continue
        if role == "tool":
            res_raw = str(msg.get("content") or "").strip()
            if len(res_raw) > 1800:
                res_raw = res_raw[:1800] + "... [truncado]"
            tool_summaries.append(f"- Resultado: {res_raw}")
            continue
        _flush_tools()
        collapsed.append(msg)

    _flush_tools()
    return collapsed


def _needs_agent_continuation(
    round_reply: str,
    round_reasoning: str,
    finish_reason: str,
    *,
    tools_available: bool,
    has_canvas: bool,
    has_actions: bool,
    has_staged_tasks: bool,
) -> Optional[Tuple[str, str]]:
    if has_canvas or has_actions or has_staged_tasks:
        return None
    if finish_reason == "length":
        return (
            "Completando análisis extenso",
            "Tu respuesta anterior se cortó por límite de longitud. Continúa exactamente donde te quedaste, "
            "sin repetir texto previo, hasta completar todo el análisis y recomendaciones.",
        )
    clean_rep = (round_reply or "").strip()
    clean_reas = (round_reasoning or "").strip()
    if not clean_rep and clean_reas:
        return (
            "Redactando conclusión tras análisis",
            "Completaste un razonamiento previo, pero no emitiste respuesta final ni ejecutaste herramientas. "
            "Si necesitas consultar el workspace invoca ahora las herramientas reales; de lo contrario entrega ya tu respuesta completa directamente en Markdown (sin etiquetas XML).",
        )
    if clean_rep and len(clean_rep) <= 340:
        low = clean_rep.lower()
        promised_action = bool(
            re.search(
                r"\b(reviso|revisar[eé]|voy a revisar|voy a consultar|voy a verificar|voy a analizar|"
                r"voy a leer|d[eé]jame\s+(?:revisar|consultar|ver|buscar)|perm[ií]teme\s+(?:revisar|consultar)|"
                r"antes de darte|empecemos por revisar|consulto los archivos|verificando qu[eé] hay)\b",
                low,
            )
            or (
                low.endswith(":")
                and any(k in low for k in ("pasos", "reviso", "consult", "analiz", "haré", "primero"))
            )
        )
        if promised_action:
            if tools_available:
                return (
                    "Ejecutando verificación en workspace",
                    "Anunciaste que revisarías el workspace antes de responder, pero no llamaste ninguna herramienta. "
                    "Invoca AHORA la herramienta real necesaria (`workspace_list`, `workspace_read`, `run_business_review`) mediante `tool_calls`, "
                    "o entrega inmediatamente el análisis completo con base en el contexto disponible sin pausas intermedias.",
                )
            return (
                "Completando análisis",
                "No dejes la respuesta en una introducción; entrega ahora mismo el análisis completo y accionable.",
            )
    return None


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
    workspace_root: Optional[str] = None,
    command_bridge: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    ws_path = Path(workspace_root).resolve() if workspace_root and Path(workspace_root).is_dir() else None
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
        workspace_root=ws_path,
    )

    executor = (
        WorkspaceToolExecutor(ws_path, emit_event=None, command_bridge=command_bridge)
        if ws_path is not None
        else None
    )
    active_tools = [CANVAS_TOOL_DEF, ASK_CLARIFICATION_TOOL_DEF]
    if executor is not None:
        active_tools = [*AGENT_TOOL_DEFS, *active_tools]

    has_attachments, image_parts = _extract_attached_flags(attached_context)
    routing_plan = select_best_models_for_task(
        chosen_model,
        user_message,
        has_workspace=ws_path is not None,
        has_active_canvas=active_canvas is not None,
        tools_available=True,
        history=history,
        fetch_catalog_fn=lambda: list_openrouter_models(api_key=key, free_only=False),
        has_attachments=has_attachments,
        has_images=bool(image_parts),
    )
    candidate_models = list(routing_plan.candidates or [chosen_model])

    started = time.time()

    def _call_with_fallbacks(cur_payload: Dict[str, Any], allow_tool_downgrade: bool) -> Dict[str, Any]:
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
                if (
                    _messages_have_images(cur_payload.get("messages") or [])
                    and any(tok in err_lower for tok in ("image", "vision", "multimodal", "image_url"))
                ):
                    if not allow_tool_downgrade:
                        raise _CandidateFailoverError(str(err)) from err
                    cur_payload["messages"] = _strip_image_parts(cur_payload.get("messages") or [])
                    continue
                if "tools" in cur_payload and any(
                    tok in err_lower for tok in ("400", "404", "tool", "function", "endpoints", "unsupported")
                ):
                    if not allow_tool_downgrade:
                        raise _CandidateFailoverError(str(err)) from err
                    cur_payload.pop("tools", None)
                    cur_payload.pop("tool_choice", None)
                    continue
                if "response_format" in cur_payload and any(
                    tok in err_lower for tok in ("400", "404", "response_format", "json_object", "structured")
                ):
                    cur_payload.pop("response_format", None)
                    continue
                if "400" in err_lower and _messages_have_tool_history(cur_payload.get("messages") or []):
                    cur_payload["messages"] = _collapse_tool_history_to_text(
                        _strip_image_parts(cur_payload.get("messages") or [])
                    )
                    continue
                if not allow_tool_downgrade and _is_recoverable_candidate_error(err_lower):
                    raise _CandidateFailoverError(str(err)) from err
                raise _friendly_http_error(err) from err
        raise RuntimeError("No se pudo completar la solicitud tras reintentar.")

    active_model = candidate_models[0]
    res: Dict[str, Any] = {}
    message_obj: Dict[str, Any] = {}
    raw_content = ""
    all_ui_tool_calls: List[Dict[str, Any]] = []

    for cand_idx, cand_model in enumerate(candidate_models):
        has_next_candidate = cand_idx < len(candidate_models) - 1
        active_model = cand_model
        loop_messages: List[Dict[str, Any]] = list(messages)
        res = {}
        message_obj = {}
        raw_content = ""
        tool_calls: List[Dict[str, Any]] = []
        all_ui_tool_calls = []
        use_response_format = True
        tools_supported = True
        vision_supported = True
        continuations_used = 0
        target_max_tokens = (
            8192
            if (
                routing_plan.task_profile.needs_reasoning
                or routing_plan.task_profile.needs_canvas
                or bool(active_tools)
            )
            else 6144
        )

        try:
            for round_idx in range(MAX_AGENT_STEPS):
                allow_tools_now = tools_supported and (round_idx < MAX_AGENT_STEPS - 1 or executor is None)
                allow_downgrade_now = not (has_next_candidate and round_idx == 0)
                round_messages = loop_messages if vision_supported else _strip_image_parts(loop_messages)
                payload: Dict[str, Any] = {
                    "model": cand_model,
                    "messages": round_messages,
                    "temperature": 0.3,
                    "max_tokens": target_max_tokens,
                }
                if use_response_format:
                    payload["response_format"] = {"type": "json_object"}
                if allow_tools_now:
                    payload["tools"] = active_tools
                    payload["tool_choice"] = "auto"

                res = _call_with_fallbacks(payload, allow_tool_downgrade=allow_downgrade_now)
                if "tools" not in payload:
                    tools_supported = False
                if "response_format" not in payload:
                    use_response_format = False
                if vision_supported and not _messages_have_images(payload.get("messages") or []):
                    vision_supported = False
                    loop_messages = _strip_image_parts(loop_messages)

                choices = res.get("choices") or []
                message_obj = (choices[0].get("message") or {}) if choices else {}
                finish_reason = str((choices[0].get("finish_reason") if choices else "") or "")
                raw_content = message_obj.get("content") or ""
                tool_calls = message_obj.get("tool_calls") or []

                if not raw_content.strip() and not tool_calls and use_response_format:
                    use_response_format = False
                    payload.pop("response_format", None)
                    res = _call_with_fallbacks(payload, allow_tool_downgrade=allow_downgrade_now)
                    choices = res.get("choices") or []
                    message_obj = (choices[0].get("message") or {}) if choices else {}
                    finish_reason = str((choices[0].get("finish_reason") if choices else "") or "")
                    raw_content = message_obj.get("content") or ""
                    tool_calls = message_obj.get("tool_calls") or []

                if not isinstance(tool_calls, list) or not tool_calls:
                    parsed_tmp = _parse_agent_json(raw_content) if raw_content.strip() else {}
                    tmp_reply = str(parsed_tmp.get("reply") or raw_content or "").strip()
                    tmp_reasoning = str(
                        message_obj.get("reasoning") or message_obj.get("reasoning_content") or ""
                    ).strip()
                    cont = (
                        _needs_agent_continuation(
                            tmp_reply,
                            tmp_reasoning,
                            finish_reason,
                            tools_available=allow_tools_now and executor is not None,
                            has_canvas=bool(all_ui_tool_calls or parsed_tmp.get("canvas")),
                            has_actions=bool(parsed_tmp.get("tasks") or parsed_tmp.get("clarification")),
                            has_staged_tasks=bool(executor is not None and executor.staged_tasks),
                        )
                        if (continuations_used < 2 and round_idx < MAX_AGENT_STEPS - 1)
                        else None
                    )
                    if cont is not None:
                        continuations_used += 1
                        _, nudge = cont
                        loop_messages.append({"role": "assistant", "content": raw_content or tmp_reply or "..."})
                        loop_messages.append({"role": "user", "content": nudge})
                        continue
                    break

                all_ui_tool_calls.extend(tool_calls)
                ui_names = {"create_canvas", "ask_clarification"}
                exec_calls = [
                    tc for tc in tool_calls
                    if isinstance(tc, dict)
                    and str((tc.get("function") or {}).get("name") or "") not in ui_names
                ]
                if not exec_calls or executor is None:
                    break

                parsed_nonstream_args: List[Dict[str, Any]] = []
                tool_results_nonstream: List[Tuple[str, Dict[str, Any]]] = []
                for idx, tc in enumerate(tool_calls):
                    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                    fn_name = str(fn.get("name") or "")
                    tc_id = str(tc.get("id") or f"call_{round_idx}_{idx}")
                    if fn_name in ui_names:
                        parsed_nonstream_args.append({})
                        tool_results_nonstream.append((tc_id, {"ok": True, "recorded": fn_name}))
                    else:
                        args = _parse_tool_args(fn.get("arguments"))
                        parsed_nonstream_args.append(args)
                        if isinstance(args, dict) and args.get("__parse_error__"):
                            tool_out = {"ok": False, "error": str(args["__parse_error__"])}
                        else:
                            tool_out = executor.execute(fn_name, args)
                        tool_results_nonstream.append((tc_id, tool_out))

                hist_tcs, all_failed_parse = _sanitize_tool_calls_for_history(tool_calls, parsed_nonstream_args)
                if all_failed_parse:
                    loop_messages.append({
                        "role": "assistant",
                        "content": raw_content or "Intenté preparar la llamada a herramienta, pero quedó incompleta.",
                    })
                    loop_messages.append({
                        "role": "user",
                        "content": (
                            "Tu llamada anterior quedó truncada o con JSON inválido. Reintenta con JSON válido; "
                            "para PDFs extensos usa el campo `markdown` estructurado (más compacto) o `blocks` como arreglo JSON real."
                        ),
                    })
                else:
                    loop_messages.append({
                        "role": "assistant",
                        "content": raw_content or "",
                        "tool_calls": hist_tcs,
                    })
                    for tc_id, tool_out in tool_results_nonstream:
                        loop_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": json.dumps(tool_out, ensure_ascii=False),
                        })

            has_staged = bool(executor is not None and executor.staged_tasks)
            if not raw_content.strip() and not all_ui_tool_calls and not has_staged and has_next_candidate:
                raise _CandidateFailoverError("Respuesta vacía del candidato.")
            break
        except _CandidateFailoverError as err:
            mark_model_temporarily_unhealthy(cand_model, str(err))
            continue
        except RuntimeError as err:
            if (
                has_next_candidate
                and not all_ui_tool_calls
                and (executor is None or not executor.workspace_mutated)
                and _is_recoverable_candidate_error(str(err))
            ):
                mark_model_temporarily_unhealthy(cand_model, str(err))
                continue
            raise

    canvas_obj = _extract_canvas_from_tool_calls(all_ui_tool_calls) if all_ui_tool_calls else None
    clarify_tool_obj = _extract_clarification_from_tool_calls(all_ui_tool_calls) if all_ui_tool_calls else None

    if not raw_content.strip() and clarify_tool_obj is not None:
        raw_content = json.dumps({
            "reply": f'{clarify_tool_obj["title"]} Responde estas breves preguntas para dejarlo exacto.',
            "xox_mood": "talking",
            "operation": "ask_clarification",
            "tasks": [],
            "clarification": clarify_tool_obj,
        }, ensure_ascii=False)
    elif not raw_content.strip() and canvas_obj is not None:
        raw_content = json.dumps({
            "reply": f'Listo, generé "{canvas_obj["title"]}" en Canvas ({len(canvas_obj["rows"])} filas y {len(canvas_obj["columns"])} columnas).',
            "xox_mood": "success",
            "operation": "none",
            "tasks": [],
        }, ensure_ascii=False)
    elif not raw_content.strip() and executor is not None and executor.staged_tasks:
        raw_content = json.dumps({
            "reply": f"Listo, completé la revisión del espacio de trabajo y preparé {len(executor.staged_tasks)} tarjeta(s) de acción.",
            "xox_mood": "success",
            "operation": "add_tasks",
            "tasks": [],
        }, ensure_ascii=False)

    if not raw_content.strip():
        raise RuntimeError(
            "El modelo seleccionado devolvió una respuesta vacía temporalmente. Intenta enviar de nuevo o elige otro modelo."
        )

    latency_ms = int((time.time() - started) * 1000)

    parsed = _parse_agent_json(raw_content)
    safe_tasks, operation, mood, clarification_obj = _normalize_agent_actions(
        parsed,
        tool_calls=all_ui_tool_calls,
        user_message=user_message,
    )
    if executor is not None and executor.staged_tasks:
        safe_tasks = _merge_tasks_dedup(executor.staged_tasks, safe_tasks)
        if operation == "none":
            operation = "add_tasks"
        mood = "success"

    full_reply = str(parsed.get("reply") or "Listo.")
    if canvas_obj is None:
        canvas_obj = _resolve_canvas_artifact(
            tool_calls=all_ui_tool_calls,
            canvas_buf="",
            actions_canvas=parsed.get("canvas"),
            full_reply=full_reply,
            user_message=user_message,
        )
    saved_report_path = _maybe_save_canvas_report(ws_path, canvas_obj, all_ui_tool_calls)
    if saved_report_path and executor is not None:
        executor.workspace_mutated = True

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
        "generated_pdfs": list(executor.generated_pdfs) if executor else [],
        "model_used": res.get("model") or active_model,
        "usage": res.get("usage") or {},
        "latency_ms": latency_ms,
        "workspace_mutated": bool(executor.workspace_mutated) if executor else False,
    }
    if canvas_obj is not None:
        out["canvas"] = canvas_obj
    if clarification_obj is not None:
        out["clarification"] = clarification_obj
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
    workspace_root: Optional[str] = None,
    command_bridge: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    ws_path = Path(workspace_root).resolve() if workspace_root and Path(workspace_root).is_dir() else None
    if ws_path is not None:
        sources = [
            rel for rel in ("empresa/perfil.json", "empresa/proveedores.json", "memoria/hechos.md", "memoria/patrones.json")
            if (ws_path / rel).is_file()
        ]
        for item in attached_context or []:
            nm = str(item.get("name") or "").strip()
            if nm and nm not in sources:
                sources.append(nm)
    else:
        sources = _collect_context_sources(context_dir, skills_dir, attached_context or [])

    steps: List[Dict[str, Any]] = [
        {
            "id": "read_context",
            "label": "Leyendo contexto y reglas del negocio",
            "detail": " · ".join(sources[:4]) if sources else "Espacio de trabajo",
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
        workspace_root=ws_path,
    )

    executor = (
        WorkspaceToolExecutor(ws_path, emit_event=emit_event, command_bridge=command_bridge)
        if ws_path is not None
        else None
    )
    active_tools = [CANVAS_TOOL_DEF, ASK_CLARIFICATION_TOOL_DEF]
    if executor is not None:
        active_tools = [*AGENT_TOOL_DEFS, *active_tools]

    has_attachments, image_parts = _extract_attached_flags(attached_context)
    routing_plan = select_best_models_for_task(
        chosen_model,
        user_message,
        has_workspace=ws_path is not None,
        has_active_canvas=active_canvas is not None,
        tools_available=True,
        history=history,
        fetch_catalog_fn=lambda: list_openrouter_models(api_key=key, free_only=False),
        has_attachments=has_attachments,
        has_images=bool(image_parts),
    )
    candidate_models = list(routing_plan.candidates or [chosen_model])
    active_model = candidate_models[0]

    steps[0]["status"] = "done"
    if routing_plan.is_auto:
        steps.append(
            {
                "id": "route_model",
                "label": f"Evaluando IA ideal ({routing_plan.task_profile.reason_es})",
                "detail": routing_plan.selected_reason,
                "status": "done",
            }
        )
    steps.append(
        {
            "id": "think_llm",
            "label": "Analizando tu solicitud",
            "detail": active_model,
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
    actual_model = active_model

    def _set_think_step(status: Optional[str] = None, detail: Optional[str] = None) -> None:
        for idx, st in enumerate(steps):
            if st.get("id") == "think_llm":
                updated = dict(st)
                if status is not None:
                    updated["status"] = status
                if detail is not None:
                    updated["detail"] = detail
                steps[idx] = updated
                return

    def _reset_partial_reasoning() -> None:
        nonlocal reasoning_started, reasoning_ended
        if reasoning_chunks and not reply_chunks:
            reasoning_chunks.clear()
            reasoning_started = None
            reasoning_ended = None
            emit_event({"type": "reasoning_reset"})

    def _can_failover_candidate(has_next: bool) -> bool:
        return (
            has_next
            and not reply_chunks
            and not all_ui_tool_calls
            and (executor is None or not executor.workspace_mutated)
        )

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

    def _upsert_step(step_id: str, label: str, status: str = "running", detail: Optional[str] = None) -> None:
        for idx, st in enumerate(steps):
            if st.get("id") == step_id:
                updated = {**st, "label": label, "status": status}
                if detail is not None:
                    updated["detail"] = detail
                steps[idx] = updated
                return
        item: Dict[str, Any] = {"id": step_id, "label": label, "status": status}
        if detail is not None:
            item["detail"] = detail
        steps.append(item)

    def on_phase_change(phase: str) -> None:
        nonlocal reasoning_ended
        if phase == "talking":
            if reasoning_started is not None and reasoning_ended is None:
                reasoning_ended = time.time()
            _set_think_step(status="done")
            _upsert_step("talk_reply", "Respondiendo en vivo", "running")
            emit_event({"type": "phase", "xox_state": "talking", "label": "Respondiendo..."})
            emit_event({"type": "steps", "steps": steps})
        elif phase == "canvas":
            if reasoning_started is not None and reasoning_ended is None:
                reasoning_ended = time.time()
            _set_think_step(status="done")
            _upsert_step("build_canvas", "Generando tabla en Canvas", "running")
            emit_event({"type": "phase", "xox_state": "syncing", "label": "Diseñando tabla en Canvas..."})
            emit_event({"type": "steps", "steps": steps})
        elif phase == "thinking":
            emit_event({"type": "phase", "xox_state": "thinking", "label": "Evaluando opciones..."})

    def _open_stream(
        req_messages: List[Dict[str, Any]],
        include_usage: bool,
        include_tools: bool,
        timeout_sec: int = 60,
        max_tokens_override: Optional[int] = None,
    ) -> Any:
        if max_tokens_override is not None:
            target_max_tokens = int(max_tokens_override)
        elif (
            routing_plan.task_profile.needs_reasoning
            or routing_plan.task_profile.needs_canvas
            or include_tools
        ):
            target_max_tokens = 8192
        else:
            target_max_tokens = 6144
        payload: Dict[str, Any] = {
            "model": active_model,
            "messages": req_messages,
            "temperature": 0.3,
            "max_tokens": target_max_tokens,
            "stream": True,
        }
        if include_usage:
            payload["stream_options"] = {"include_usage": True}
        if include_tools:
            payload["tools"] = active_tools
            payload["tool_choice"] = "auto"
        req = urllib.request.Request(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers=_build_headers(key),
            method="POST",
        )
        return urllib.request.urlopen(req, timeout=timeout_sec, context=_ssl_context())

    tools_supported = True
    vision_supported = True

    def _run_stream_pass(
        req_messages: List[Dict[str, Any]],
        allow_tools: bool,
        tag_router: _StreamTagRouter,
        fail_fast_on_candidate: bool = False,
        pass_meta: Optional[Dict[str, str]] = None,
        timeout_sec: int = 60,
    ) -> List[Dict[str, Any]]:
        nonlocal actual_model, usage_data, tools_supported, vision_supported
        include_usage = True
        include_tools = allow_tools and tools_supported
        active_msgs = req_messages if vision_supported else _strip_image_parts(req_messages)
        resp = None
        cur_max_tokens: Optional[int] = None
        collapsed_tool_history = False
        for _attempt in range(5):
            try:
                resp = _open_stream(
                    active_msgs,
                    include_usage=include_usage,
                    include_tools=include_tools,
                    timeout_sec=timeout_sec,
                    max_tokens_override=cur_max_tokens,
                )
                break
            except urllib.error.HTTPError as err:
                detail_msg = _extract_http_error_detail(err)
                lower_msg = detail_msg.lower()
                if include_usage and err.code == 400 and "stream_options" in lower_msg:
                    include_usage = False
                    continue
                if (
                    _messages_have_images(active_msgs)
                    and err.code in (400, 404, 422)
                    and (
                        any(tok in lower_msg for tok in ("image", "vision", "multimodal", "image_url"))
                        or _messages_have_tool_history(active_msgs)
                    )
                ):
                    if (
                        fail_fast_on_candidate
                        and not _messages_have_tool_history(active_msgs)
                        and any(tok in lower_msg for tok in ("image", "vision", "multimodal", "image_url"))
                    ):
                        raise _CandidateFailoverError(detail_msg) from err
                    vision_supported = False
                    active_msgs = _strip_image_parts(active_msgs)
                    continue
                if include_tools and err.code in (400, 404) and any(
                    tok in lower_msg for tok in ("tool", "function", "endpoints", "unsupported")
                ):
                    if fail_fast_on_candidate:
                        raise _CandidateFailoverError(detail_msg) from err
                    include_tools = False
                    tools_supported = False
                    continue
                if err.code in (400, 422):
                    if include_usage:
                        include_usage = False
                        continue
                    if _messages_have_tool_history(active_msgs) and not collapsed_tool_history:
                        collapsed_tool_history = True
                        active_msgs = _collapse_tool_history_to_text(active_msgs)
                        if executor is not None and (executor.generated_pdfs or executor.staged_tasks):
                            include_tools = False
                        continue
                    if cur_max_tokens is None or cur_max_tokens > 4096:
                        cur_max_tokens = 4096
                        continue
                if fail_fast_on_candidate and (
                    err.code in (402, 404, 429, 500, 502, 503, 504)
                    or _is_recoverable_candidate_error(lower_msg)
                ):
                    raise _CandidateFailoverError(detail_msg) from err
                raise RuntimeError(detail_msg) from err

        if resp is None:
            raise RuntimeError("No se pudo abrir el stream con OpenRouter.")

        tc_acc: Dict[int, Dict[str, Any]] = {}
        notified_canvas_tc = False
        last_pdf_draft_emit: Dict[int, Tuple[float, int, str]] = {}
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
                    if (
                        fail_fast_on_candidate
                        and not reasoning_chunks
                        and not reply_chunks
                        and not tc_acc
                        and _is_recoverable_candidate_error(err_msg)
                    ):
                        raise _CandidateFailoverError(err_msg)
                    raise _friendly_http_error(RuntimeError(err_msg))
                if isinstance(event_obj.get("model"), str) and event_obj["model"]:
                    actual_model = event_obj["model"]
                    _set_think_step(detail=actual_model)
                if isinstance(event_obj.get("usage"), dict) and event_obj["usage"]:
                    usage_data = event_obj["usage"]
                choices = event_obj.get("choices") or []
                if not choices:
                    continue
                fr = choices[0].get("finish_reason")
                if isinstance(fr, str) and fr and pass_meta is not None:
                    pass_meta["finish_reason"] = fr
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
                        if "pdf_generate" in entry["function"]["name"].lower():
                            now_m = time.monotonic()
                            raw_tc_args = entry["function"]["arguments"]
                            prev_t, prev_len, prev_sig = last_pdf_draft_emit.get(idx, (0.0, 0, ""))
                            if prev_t == 0.0 or (len(raw_tc_args) - prev_len >= 70) or (now_m - prev_t >= 0.22):
                                draft = _extract_partial_pdf_draft(raw_tc_args) or {}
                                blocks_d = draft.get("blocks") or []
                                sig = f"{draft.get('title', '')}|{len(blocks_d)}|{draft.get('has_cover')}"
                                if prev_t == 0.0 or sig != prev_sig or (now_m - prev_t >= 0.25):
                                    last_pdf_draft_emit[idx] = (now_m, len(raw_tc_args), sig)
                                    emit_event({
                                        "type": "pdf_draft_progress",
                                        "stage": "composing",
                                        "step_label": (
                                            f"Redactando sección {len(blocks_d)}..."
                                            if blocks_d
                                            else (
                                                "Definiendo portada del documento..."
                                                if draft.get("has_cover")
                                                else "Estructurando documento PDF..."
                                            )
                                        ),
                                        "progress": round(min(0.22, 0.04 + 0.015 * len(blocks_d)), 3),
                                        **draft,
                                    })
                c_chunk = delta.get("content")
                if isinstance(c_chunk, str) and c_chunk:
                    tag_router.feed(c_chunk)
        tag_router.flush()
        return [tc_acc[k] for k in sorted(tc_acc.keys())]

    loop_messages: List[Dict[str, Any]] = list(messages)
    tool_calls_list: List[Dict[str, Any]] = []
    all_ui_tool_calls: List[Dict[str, Any]] = []
    combined_canvas_buf = ""
    combined_actions_buf = ""
    ui_tool_names = {"create_canvas", "ask_clarification"}

    for cand_idx, cand_model in enumerate(candidate_models):
        has_next_candidate = cand_idx < len(candidate_models) - 1
        active_model = cand_model
        actual_model = cand_model
        tools_supported = True
        vision_supported = True
        loop_messages = list(messages)
        tool_calls_list = []
        all_ui_tool_calls = []
        combined_canvas_buf = ""
        combined_actions_buf = ""

        if cand_idx > 0:
            _upsert_step("route_model", "Reenrutando IA por disponibilidad", "done", detail=cand_model)
            _set_think_step(status="running", detail=cand_model)
            emit_event({"type": "phase", "xox_state": "thinking", "label": "Probando modelo alternativo..."})
            emit_event({"type": "steps", "steps": steps})

        continuations_used = 0

        try:
            for round_idx in range(MAX_AGENT_STEPS):
                round_reasoning_chunks: List[str] = []
                round_reply_chunks: List[str] = []

                def _round_on_reasoning(chunk: str) -> None:
                    if chunk:
                        round_reasoning_chunks.append(chunk)
                        on_reasoning_delta(chunk)

                def _round_on_reply(chunk: str) -> None:
                    if not chunk:
                        return
                    if not round_reply_chunks and reply_chunks and not "".join(reply_chunks[-3:]).endswith("\n"):
                        on_reply_delta("\n\n")
                    round_reply_chunks.append(chunk)
                    on_reply_delta(chunk)

                round_router = _StreamTagRouter(
                    on_reasoning=_round_on_reasoning,
                    on_reply=_round_on_reply,
                    on_phase=on_phase_change,
                )
                allow_tools_now = tools_supported and (round_idx < MAX_AGENT_STEPS - 1 or executor is None)
                can_failover_here = (
                    has_next_candidate
                    and round_idx == 0
                    and not reply_chunks
                    and not all_ui_tool_calls
                    and (executor is None or not executor.workspace_mutated)
                )
                pass_meta: Dict[str, str] = {}
                pass_tool_calls = _run_stream_pass(
                    loop_messages,
                    allow_tools=allow_tools_now,
                    tag_router=round_router,
                    fail_fast_on_candidate=can_failover_here,
                    pass_meta=pass_meta,
                    timeout_sec=45 if has_next_candidate else 75,
                )
                combined_canvas_buf += round_router.canvas_buf
                combined_actions_buf += round_router.actions_buf
                tool_calls_list = pass_tool_calls

                if pass_tool_calls:
                    all_ui_tool_calls.extend(pass_tool_calls)

                exec_calls = [
                    tc for tc in pass_tool_calls
                    if isinstance(tc, dict)
                    and str((tc.get("function") or {}).get("name") or "") not in ui_tool_names
                ]
                if not exec_calls or executor is None:
                    round_reply_text = "".join(round_reply_chunks)
                    round_reas_text = "".join(round_reasoning_chunks)
                    round_actions_parsed = (
                        _parse_actions_payload(round_router.actions_buf)
                        if round_router.actions_buf.strip()
                        else {}
                    )
                    cont = (
                        _needs_agent_continuation(
                            round_reply_text,
                            round_reas_text,
                            pass_meta.get("finish_reason", ""),
                            tools_available=allow_tools_now and executor is not None,
                            has_canvas=bool(all_ui_tool_calls or round_router.canvas_buf.strip()),
                            has_actions=bool(round_actions_parsed.get("tasks") or round_actions_parsed.get("clarification")),
                            has_staged_tasks=bool(executor is not None and executor.staged_tasks),
                        )
                        if (continuations_used < 2 and round_idx < MAX_AGENT_STEPS - 1)
                        else None
                    )
                    if cont is not None:
                        continuations_used += 1
                        cont_label, cont_nudge = cont
                        _set_think_step(status="done")
                        _upsert_step(f"continue_{round_idx}", cont_label, "running")
                        emit_event({"type": "phase", "xox_state": "thinking", "label": f"{cont_label}..."})
                        emit_event({"type": "steps", "steps": steps})
                        loop_messages.append({
                            "role": "assistant",
                            "content": round_reply_text or round_reas_text or "...",
                        })
                        loop_messages.append({
                            "role": "user",
                            "content": cont_nudge,
                        })
                        _upsert_step(f"continue_{round_idx}", cont_label, "done")
                        continue
                    break

                _set_think_step(status="done")
                parsed_pass_args: List[Dict[str, Any]] = []
                pass_tool_results: List[Tuple[str, Dict[str, Any]]] = []

                for idx, tc in enumerate(pass_tool_calls):
                    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                    fn_name = str(fn.get("name") or "")
                    tc_id = str(tc.get("id") or f"call_{round_idx}_{idx}")
                    if fn_name in ui_tool_names:
                        parsed_pass_args.append({})
                        pass_tool_results.append((tc_id, {"ok": True, "recorded": fn_name}))
                    else:
                        args = _parse_tool_args(fn.get("arguments"))
                        parsed_pass_args.append(args)
                        step_id = f"tool_{round_idx}_{idx}_{fn_name}"
                        if isinstance(args, dict) and args.get("__parse_error__"):
                            label, _ = _tool_step_meta(fn_name, {})
                            _upsert_step(step_id, label, "error", detail="Argumentos inválidos o incompletos")
                            emit_event({"type": "steps", "steps": steps})
                            tool_res = {"ok": False, "error": str(args["__parse_error__"])}
                        else:
                            label, detail = _tool_step_meta(fn_name, args)
                            _upsert_step(step_id, label, "running", detail=detail or None)
                            phase_state = "reading" if fn_name in ("workspace_list", "workspace_read", "workspace_search", "pdf_read", "list_desktop_apps", "os_list_notes", "os_list_calendar_events") else "syncing"
                            emit_event({"type": "phase", "xox_state": phase_state, "label": f"{label}..."})
                            emit_event({"type": "steps", "steps": steps})

                            tool_res = executor.execute(fn_name, args)
                            _upsert_step(
                                step_id,
                                label,
                                "done" if tool_res.get("ok") else "error",
                                detail=detail or None,
                            )
                            emit_event({"type": "steps", "steps": steps})
                        pass_tool_results.append((tc_id, tool_res))

                hist_tcs, all_failed_parse = _sanitize_tool_calls_for_history(pass_tool_calls, parsed_pass_args)
                if all_failed_parse:
                    # Evitar mandar JSON roto dentro de `assistant.tool_calls` (causaría HTTP 400 en OpenRouter)
                    loop_messages.append({
                        "role": "assistant",
                        "content": "".join(round_reply_chunks).strip() or "Intenté preparar la llamada a herramienta, pero se truncó el JSON.",
                    })
                    loop_messages.append({
                        "role": "user",
                        "content": (
                            "Tu llamada anterior quedó truncada o con JSON inválido. Vuelve a enviarla completa y válida; "
                            "si es un PDF extenso, utiliza el campo `markdown` estructurado (mucho más compacto) o `blocks` como arreglo JSON real."
                        ),
                    })
                else:
                    loop_messages.append({
                        "role": "assistant",
                        "content": "".join(round_reply_chunks).strip() or "",
                        "tool_calls": hist_tcs,
                    })
                    for tc_id, tool_res in pass_tool_results:
                        loop_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_id,
                            "content": json.dumps(tool_res, ensure_ascii=False),
                        })

            has_staged = bool(executor is not None and executor.staged_tasks)
            if (
                not reasoning_chunks
                and not reply_chunks
                and not all_ui_tool_calls
                and not combined_canvas_buf.strip()
                and not combined_actions_buf.strip()
                and not has_staged
                and has_next_candidate
            ):
                raise _CandidateFailoverError("El candidato devolvió una respuesta vacía.")
            break
        except _CandidateFailoverError as err:
            mark_model_temporarily_unhealthy(cand_model, str(err))
            _reset_partial_reasoning()
            continue
        except urllib.error.HTTPError as err:
            detail_msg = _extract_http_error_detail(err)
            if _can_failover_candidate(has_next_candidate) and (
                err.code in (402, 404, 429, 500, 502, 503, 504)
                or _is_recoverable_candidate_error(detail_msg)
            ):
                mark_model_temporarily_unhealthy(cand_model, detail_msg)
                _reset_partial_reasoning()
                continue
            if executor is not None and (executor.generated_pdfs or executor.staged_tasks):
                break
            raise _friendly_http_error(RuntimeError(detail_msg)) from err
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as err:
            reason_txt = str(getattr(err, "reason", None) or err or "conexión interrumpida")
            if _can_failover_candidate(has_next_candidate):
                mark_model_temporarily_unhealthy(cand_model, reason_txt)
                _reset_partial_reasoning()
                continue
            if executor is not None and (executor.generated_pdfs or executor.staged_tasks):
                break
            raise RuntimeError(f"Error de red al conectar con OpenRouter: {reason_txt}") from err
        except RuntimeError as err:
            if _can_failover_candidate(has_next_candidate) and _is_recoverable_candidate_error(str(err)):
                mark_model_temporarily_unhealthy(cand_model, str(err))
                _reset_partial_reasoning()
                continue
            if executor is not None and (executor.generated_pdfs or executor.staged_tasks):
                break
            raise _friendly_http_error(err) from err

    latency_ms = int((time.time() - started) * 1000)
    full_reasoning = "".join(reasoning_chunks).strip()
    full_reply = "".join(reply_chunks).strip()

    parsed_actions = _parse_actions_payload(combined_actions_buf)
    if full_reply.startswith("{") and '"reply"' in full_reply:
        fallback_json = _parse_agent_json(full_reply)
        full_reply = str(fallback_json.get("reply") or full_reply).strip()
        if not parsed_actions.get("tasks") and isinstance(fallback_json.get("tasks"), list):
            parsed_actions = fallback_json

    canvas_obj = _resolve_canvas_artifact(
        tool_calls=all_ui_tool_calls,
        canvas_buf=combined_canvas_buf,
        actions_canvas=parsed_actions.get("canvas"),
        full_reply=full_reply,
        user_message=user_message,
    )

    if canvas_obj is not None:
        _upsert_step("build_canvas", f'Tabla lista en Canvas: "{canvas_obj["title"]}"', "done")
        saved_report_path = _maybe_save_canvas_report(ws_path, canvas_obj, all_ui_tool_calls)
        if saved_report_path and executor is not None:
            executor.workspace_mutated = True
            _upsert_step("save_report", "Reporte guardado en espacio", "done", detail=saved_report_path)
        emit_event({"type": "canvas", "canvas": canvas_obj})
        emit_event({"type": "steps", "steps": steps})

        if all_ui_tool_calls and not full_reply:
            tool_result_content = json.dumps(
                {
                    "ok": True,
                    "canvas_title": canvas_obj["title"],
                    "columns": len(canvas_obj["columns"]),
                    "rows": len(canvas_obj["rows"]),
                    "instruction": (
                        "La tabla ya está abierta en Canvas. Responde únicamente con 1 a 3 oraciones breves "
                        "de conclusión en español directamente en Markdown (sin etiquetas XML). NO repitas la tabla ni escribas HTML."
                    ),
                },
                ensure_ascii=False,
            )
            followup_messages = [
                *loop_messages,
                {"role": "assistant", "content": "", "tool_calls": tool_calls_list},
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

    safe_tasks, operation, mood, clarification_obj = _normalize_agent_actions(
        parsed_actions,
        tool_calls=all_ui_tool_calls,
        user_message=user_message,
    )
    if executor is not None and executor.staged_tasks:
        safe_tasks = _merge_tasks_dedup(executor.staged_tasks, safe_tasks)
        if operation == "none":
            operation = "add_tasks"
        mood = "success"

    if not full_reply and clarification_obj is None:
        if executor is not None and executor.generated_pdfs:
            last_pdf = executor.generated_pdfs[-1]
            pdf_lines = "\n".join(
                f"- `{p.get('path')}` ({p.get('page_count', '?')} página(s))"
                for p in executor.generated_pdfs
            )
            fallback_pdf_msg = (
                f"He generado el documento PDF **{last_pdf.get('title') or last_pdf.get('filename') or 'Documento'}**:\n\n"
                f"{pdf_lines}\n\n"
                "Puedes revisarlo directamente en el panel **Documento PDF**."
            )
            on_reply_delta(fallback_pdf_msg)
            full_reply = fallback_pdf_msg
            mood = "success"
        elif executor is not None and executor.staged_tasks:
            fallback_msg = f"Listo, completé el trabajo en el espacio de trabajo y preparé {len(executor.staged_tasks)} tarjeta(s) para tu revisión."
            on_reply_delta(fallback_msg)
            full_reply = fallback_msg
        elif full_reasoning:
            full_reply = "Terminé el análisis; revisa los detalles arriba si deseas profundizar."
        else:
            raise RuntimeError(
                "El modelo seleccionado devolvió una respuesta vacía temporalmente. Intenta enviar de nuevo o elige otro modelo."
            )
    if canvas_obj is not None and mood == "talking":
        mood = "success"

    for st in steps:
        if st.get("status") == "running":
            st["status"] = "done"

    if clarification_obj is not None:
        if not full_reply:
            fallback_q_msg = f'{clarification_obj["title"]} Responde estas breves preguntas para continuar.'
            on_reply_delta(fallback_q_msg)
            full_reply = fallback_q_msg
        steps.append(
            {
                "id": "ask_clarification",
                "label": f'Solicitando aclaración ({len(clarification_obj["questions"])} preguntas)',
                "status": "done",
            }
        )
    elif safe_tasks:
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
        "generated_pdfs": list(executor.generated_pdfs) if executor else [],
        "model_used": actual_model,
        "usage": usage_data,
        "latency_ms": latency_ms,
        "workspace_mutated": bool(executor.workspace_mutated) if executor else False,
    }
    if canvas_obj is not None:
        result["canvas"] = canvas_obj
    if clarification_obj is not None:
        result["clarification"] = clarification_obj
    return result

