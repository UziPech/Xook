"""
Evaluador y enrutador inteligente de modelos de IA por tarea (OpenRouter).

Cuando el usuario selecciona `openrouter/free` ("Automático (Gratis)") o
`openrouter/auto` ("Automático (Estándar)"), analiza la intención del turno
y las capacidades reales reportadas por el catálogo de OpenRouter
(`supported_parameters`, ventana de contexto, precios y salud reciente) para
elegir una cadena ordenada de candidatos óptimos.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional


AUTO_FREE_ID = "openrouter/free"
AUTO_STANDARD_ID = "openrouter/auto"

_CATALOG_LOCK = threading.Lock()
_CATALOG_CACHE: Dict[str, Any] = {
    "fetched_at": 0.0,
    "models": [],
}
_UNHEALTHY_UNTIL: Dict[str, float] = {}
CATALOG_TTL_SECONDS = 600.0
UNHEALTHY_COOLDOWN_SECONDS = 180.0


@dataclass(frozen=True)
class TaskProfile:
    task_kind: str  # "agent_execution" | "canvas_tabular" | "deep_analysis" | "fast_chat"
    needs_tools: bool
    needs_reasoning: bool
    needs_canvas: bool
    min_context: int
    reason_es: str
    needs_vision: bool = False


@dataclass(frozen=True)
class RoutingPlan:
    is_auto: bool
    requested_model: str
    task_profile: TaskProfile
    candidates: List[str]
    selected_reason: str


def is_auto_model_id(model_id: Optional[str]) -> bool:
    clean = (model_id or "").strip()
    return clean in ("", AUTO_FREE_ID, AUTO_STANDARD_ID)


def mark_model_temporarily_unhealthy(model_id: str, reason: str = "") -> None:
    """Pone en enfriamiento corto un candidato concreto que devolvió 404/429/503 o falló en tools."""
    clean = (model_id or "").strip()
    if not clean or clean in (AUTO_FREE_ID, AUTO_STANDARD_ID):
        return
    with _CATALOG_LOCK:
        _UNHEALTHY_UNTIL[clean] = time.time() + UNHEALTHY_COOLDOWN_SECONDS


def clear_router_runtime_state() -> None:
    """Limpia cachés en memoria (útil en pruebas unitarias)."""
    with _CATALOG_LOCK:
        _CATALOG_CACHE["fetched_at"] = 0.0
        _CATALOG_CACHE["models"] = []
        _UNHEALTHY_UNTIL.clear()


def _is_model_unhealthy(model_id: str, now: Optional[float] = None) -> bool:
    ts = now if now is not None else time.time()
    with _CATALOG_LOCK:
        until = _UNHEALTHY_UNTIL.get(model_id)
        if until is None:
            return False
        if until <= ts:
            _UNHEALTHY_UNTIL.pop(model_id, None)
            return False
        return True


def classify_task_intent(
    user_message: str,
    *,
    has_workspace: bool = False,
    has_active_canvas: bool = False,
    tools_available: bool = True,
    history: Optional[List[Dict[str, Any]]] = None,
    has_attachments: bool = False,
    has_images: bool = False,
) -> TaskProfile:
    base = _classify_task_intent_base(
        user_message,
        has_workspace=has_workspace,
        has_active_canvas=has_active_canvas,
        tools_available=tools_available,
        history=history,
        skip_casual=bool(has_attachments or has_images),
    )
    if not (has_attachments or has_images):
        return base
    upgrade_from_fast = base.task_kind == "fast_chat" and tools_available
    return TaskProfile(
        task_kind="agent_execution" if upgrade_from_fast else base.task_kind,
        needs_tools=True if (tools_available and (has_workspace or has_attachments)) else base.needs_tools,
        needs_reasoning=base.needs_reasoning,
        needs_canvas=base.needs_canvas,
        min_context=max(base.min_context, 32000),
        reason_es=(
            "Adjuntos (PDF/imagen): requiere herramientas e inspección del espacio"
            if upgrade_from_fast
            else base.reason_es
        ),
        needs_vision=bool(has_images),
    )


def _classify_task_intent_base(
    user_message: str,
    *,
    has_workspace: bool = False,
    has_active_canvas: bool = False,
    tools_available: bool = True,
    history: Optional[List[Dict[str, Any]]] = None,
    skip_casual: bool = False,
) -> TaskProfile:
    text = (user_message or "").strip().lower()
    _ = history  # Evitar contaminar el enrutamiento actual con palabras clave de turnos pasados

    explicit_action_re = re.compile(
        r"\b(carpeta|directorio|archivo|borrador|crea|crear|creame|edita|escribe|guardar?|guarda|"
        r"elimina|borra|mueve|archiva|ejecuta|corre|lista|lee|busca|revision|revisi[oó]n|"
        r"abre|abrir|abreme|[áa]breme|inicia|iniciar|lanza|lanzar|arranca|"
        r"app|apps|aplicaci[oó]n|aplicaciones|nota|notas|apunta|apuntar|apuntame|ap[úu]ntame|"
        r"calendario|evento|eventos|reuni[oó]n|cita|junta|disponibilidad|hueco|"
        r"recordatorios|calculadora|safari|finder|"
        r"datos/|empresa/|agente/|habilidades/|comando|consola|terminal|script|"
        r"agenda|agendar|agendame|ag[ée]ndame|programa|programar|automatiza\w*|temporizador|reloj|alarma|recordatorio|"
        r"pdf|documento|informe|reporte|portada|factura|cotizaci[oó]n|contrato|cat[aá]logo|resumir|resume|extraer|imagen|foto|logo|generar?|exportar?|"
        r"orden\s+de\s+compra|reponer|csv|json)\b"
    )
    domain_ops_re = re.compile(
        r"\b(revisa|inventario|stock|orden|compra|memoria|recuerda|regla|empresa|proveedores?)\b"
    )
    canvas_re = re.compile(
        r"\b(tabla|comparativa|comparaci[oó]n|cuadro|canvas|matriz|cronograma|"
        r"reporte\s+visual|exporta\w*|resumen\s+en\s+tabla)\b"
    )
    deep_re = re.compile(
        r"\b(analiza|an[aá]lisis|estrategia|rentabilidad|margen|riesgos?\s+financieros?|"
        r"costeo|pron[oó]stico|por\s+qu[eé]|diagnostica|diagn[oó]stico|plan\s+detallado|"
        r"auditor[ií]a|optimiza|optimizaci[oó]n|eval[uú]a|evaluaci[oó]n|recomendaciones|"
        r"paso\s+a\s+paso|a\s+profundidad|frente\s+al\s+costo)\b"
    )
    casual_re = re.compile(
        r"^(hola+|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches|hey+|gracias+|"
        r"ok+|perfecto|listo|qu[eé]\s+tal|c[oó]mo\s+est[aá]s)[\s!?.]*$"
    )

    if casual_re.match(text) and not has_active_canvas and not skip_casual:
        return TaskProfile(
            task_kind="fast_chat",
            needs_tools=False,
            needs_reasoning=False,
            needs_canvas=False,
            min_context=8000,
            reason_es="conversación rápida de baja latencia",
        )

    is_canvas = bool(canvas_re.search(text) or (has_active_canvas and len(text) < 220))
    is_deep = bool(deep_re.search(text))
    is_explicit_action = bool(explicit_action_re.search(text))
    is_domain_ops = bool(domain_ops_re.search(text))

    # Si pide análisis estratégico/financiero profundo sin orden explícita de archivo/comando/agenda,
    # priorizar razonamiento profundo manteniendo herramientas disponibles por si consulta datos/.
    if is_deep and not is_explicit_action and not is_canvas:
        return TaskProfile(
            task_kind="deep_analysis",
            needs_tools=has_workspace and tools_available,
            needs_reasoning=True,
            needs_canvas=False,
            min_context=64000,
            reason_es="razonamiento analítico profundo",
        )

    if has_workspace and tools_available and (is_explicit_action or is_domain_ops or not is_deep):
        if is_canvas:
            return TaskProfile(
                task_kind="canvas_tabular",
                needs_tools=True,
                needs_reasoning=is_deep,
                needs_canvas=True,
                min_context=32000,
                reason_es="generación de tabla/Canvas y herramientas del espacio",
            )
        return TaskProfile(
            task_kind="agent_execution",
            needs_tools=True,
            needs_reasoning=is_deep,
            needs_canvas=False,
            min_context=32000,
            reason_es="ejecución agéntica con herramientas verificadas",
        )

    if is_canvas:
        return TaskProfile(
            task_kind="canvas_tabular",
            needs_tools=tools_available,
            needs_reasoning=is_deep,
            needs_canvas=True,
            min_context=16000,
            reason_es="diseño de tablas y comparativas estructuradas",
        )

    if is_deep:
        return TaskProfile(
            task_kind="deep_analysis",
            needs_tools=has_workspace and tools_available,
            needs_reasoning=True,
            needs_canvas=False,
            min_context=64000,
            reason_es="razonamiento analítico profundo",
        )

    return TaskProfile(
        task_kind="agent_execution" if (has_workspace and tools_available) else "fast_chat",
        needs_tools=has_workspace and tools_available,
        needs_reasoning=False,
        needs_canvas=False,
        min_context=16000,
        reason_es="asistencia operativa general",
    )


def _is_excluded_specialized_model(model_id: str) -> bool:
    low = model_id.lower()
    excluded_tokens = (
        "guard",
        "shield",
        "safeguard",
        "embed",
        "whisper",
        "audio",
        "tts",
        "moderation",
        "safety",
        "ocr",
        "-vl-",
        "-vl:",
        "vl:",
        "-omni-",
        "-omni:",
        "vision-only",
    )
    return any(tok in low for tok in excluded_tokens)


def _score_family_prior(model_id: str, task: TaskProfile) -> float:
    low = model_id.lower()
    score = 0.0

    # Familias con mayor confiabilidad histórica en JSON, razonamiento y function calling
    if any(k in low for k in ("qwen3", "qwen-2.5", "qwen2.5")):
        score += 36.0
    elif any(k in low for k in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro")):
        score += 38.0
    elif "gemma-4-31b" in low:
        score += 36.0
    elif "gemma-4" in low:
        score += 32.0
    elif "gpt-4o" in low:
        score += 36.0
    elif "claude-3.5-sonnet" in low or "claude-3.7" in low or "claude-sonnet-4" in low:
        score += 38.0
    elif "gpt-oss" in low:
        score += 28.0
    elif any(k in low for k in ("llama-3.3", "llama-4")):
        score += 26.0
    elif "mistral-small" in low or "mistral-medium" in low or "devstral" in low:
        score += 24.0
    elif "deepseek-chat" in low or "deepseek-v3" in low:
        score += 30.0
    elif "nemotron-3-ultra" in low or "nemotron-3.5-lightning" in low:
        score += 32.0
    elif "glm-4" in low or "trinity" in low or "nemotron" in low:
        score += 18.0

    # Modelos con tendencia frecuente a cortar turnos con preámbulos o preview inestable en tools
    if "ernie" in low:
        score -= 24.0
    elif ("-preview" in low or ":preview" in low) and not any(
        k in low for k in ("gemini", "claude", "gpt-")
    ):
        score -= 10.0

    # Modelos especializados de razonamiento (<think> largo); evitar coincidir con nombres de proveedor como thinkingmachines
    is_reasoning_heavy = any(
        k in low for k in ("deepseek-r1", "qwq", "-thinking", ":thinking", "/thinking", "-r1")
    )
    if is_reasoning_heavy:
        if task.needs_reasoning:
            score += 24.0
        elif task.task_kind == "fast_chat":
            score -= 22.0
        else:
            score -= 8.0

    # Modelos pequeños/mini/nano rinden menos en estrategia profunda y tool calling multi-paso
    if any(
        k in low
        for k in (
            ":1b",
            ":3b",
            "-1b",
            "-1.7b",
            "-2.6b",
            "-3b",
            "-4b",
            "-7b",
            "-8b",
            "-mini",
            "-small",
            "-nano",
            "-note-",
        )
    ):
        if task.needs_tools or task.needs_reasoning:
            score -= 20.0
        elif task.task_kind == "fast_chat":
            score += 8.0
    elif any(k in low for k in ("70b", "72b", "120b", "235b", "32b", "pro", "sonnet")) or (
        "gemini" in low and "flash" in low
    ):
        if task.needs_tools or task.needs_reasoning:
            score += 14.0

    if "instruct" in low:
        score += 4.0

    return score


def score_model_for_task(model_entry: Dict[str, Any], task: TaskProfile) -> float:
    mid = str(model_entry.get("id") or "").strip()
    if not mid or mid in (AUTO_FREE_ID, AUTO_STANDARD_ID):
        return -9999.0
    if _is_excluded_specialized_model(mid):
        return -9999.0

    supported = model_entry.get("supported_parameters")
    has_meta = isinstance(supported, list) and len(supported) > 0
    supp_set = {str(p).strip().lower() for p in supported} if has_meta else set()
    supports_tools = bool(model_entry.get("supports_tools") or ("tools" in supp_set))
    supports_reasoning = bool(model_entry.get("supports_reasoning") or ("reasoning" in supp_set) or ("include_reasoning" in supp_set))
    supports_structured = bool(
        model_entry.get("supports_structured")
        or ("structured_outputs" in supp_set)
        or ("response_format" in supp_set)
    )
    supports_vision = bool(model_entry.get("supports_vision"))
    has_vision_meta = "supports_vision" in model_entry

    score = _score_family_prior(mid, task)

    if task.needs_tools:
        if supports_tools:
            score += 140.0
        elif has_meta:
            # Catálogo en vivo confirmó que NO soporta herramientas
            score -= 400.0

    if task.needs_vision:
        if supports_vision:
            score += 65.0
        elif has_vision_meta:
            score -= 120.0

    if task.task_kind in ("agent_execution", "canvas_tabular") and supports_structured:
        score += 22.0
    if task.needs_reasoning and supports_reasoning:
        score += 48.0
    if task.task_kind == "fast_chat" and not supports_reasoning:
        score += 6.0

    ctx = model_entry.get("context_length") or 0
    try:
        ctx_int = int(ctx)
    except Exception:
        ctx_int = 0

    if ctx_int >= task.min_context:
        score += 15.0
    elif 0 < ctx_int < task.min_context:
        score -= 25.0
    if ctx_int >= 120000 and task.needs_reasoning:
        score += 12.0

    # Para openrouter/auto (pagado), evitar modelos extremadamente caros si hay opciones ágiles excelentes
    prompt_pm = model_entry.get("prompt_price_per_million")
    if isinstance(prompt_pm, (int, float)):
        if prompt_pm == 0:
            score += 2.0
        elif prompt_pm <= 1.0:
            score += 14.0 if task.task_kind != "deep_analysis" else 6.0
        elif prompt_pm <= 4.0:
            score += 10.0 if task.task_kind == "deep_analysis" else 4.0
        elif prompt_pm > 10.0 and task.task_kind != "deep_analysis":
            score -= 24.0

    return score


def get_cached_catalog_models(
    fetch_fn: Callable[[], Dict[str, Any]],
    *,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    now = time.time()
    with _CATALOG_LOCK:
        cached = list(_CATALOG_CACHE.get("models") or [])
        age = now - float(_CATALOG_CACHE.get("fetched_at") or 0.0)
        if cached and not force_refresh and age < CATALOG_TTL_SECONDS:
            return cached

    try:
        res = fetch_fn()
        models = list(res.get("models") or [])
        if models and res.get("ok"):
            with _CATALOG_LOCK:
                _CATALOG_CACHE["models"] = models
                _CATALOG_CACHE["fetched_at"] = time.time()
            return models
        if models:
            return models
    except Exception:
        pass

    with _CATALOG_LOCK:
        return list(_CATALOG_CACHE.get("models") or [])


def select_best_models_for_task(
    requested_model: Optional[str],
    user_message: str,
    *,
    has_workspace: bool,
    has_active_canvas: bool,
    tools_available: bool,
    history: Optional[List[Dict[str, Any]]] = None,
    catalog_models: Optional[List[Dict[str, Any]]] = None,
    fetch_catalog_fn: Optional[Callable[[], Dict[str, Any]]] = None,
    max_concrete_candidates: int = 2,
    has_attachments: bool = False,
    has_images: bool = False,
) -> RoutingPlan:
    req = (requested_model or AUTO_FREE_ID).strip() or AUTO_FREE_ID
    profile = classify_task_intent(
        user_message,
        has_workspace=has_workspace,
        has_active_canvas=has_active_canvas,
        tools_available=tools_available,
        history=history,
        has_attachments=has_attachments,
        has_images=has_images,
    )

    if not is_auto_model_id(req):
        return RoutingPlan(
            is_auto=False,
            requested_model=req,
            task_profile=profile,
            candidates=[req],
            selected_reason="modelo fijado manualmente por ti",
        )

    free_only = req == AUTO_FREE_ID
    models = list(catalog_models or [])
    if not models and fetch_catalog_fn is not None:
        models = get_cached_catalog_models(fetch_catalog_fn)

    now = time.time()
    scored: List[tuple[float, Dict[str, Any]]] = []
    for entry in models:
        if not isinstance(entry, dict):
            continue
        mid = str(entry.get("id") or "").strip()
        if not mid or mid in (AUTO_FREE_ID, AUTO_STANDARD_ID):
            continue
        if free_only and not entry.get("is_free"):
            continue
        if _is_model_unhealthy(mid, now=now):
            continue
        sc = score_model_for_task(entry, profile)
        if sc <= -200.0:
            continue
        scored.append((sc, entry))

    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("id") or "")))
    concrete_ids = [str(entry["id"]) for _, entry in scored[:max_concrete_candidates]]

    # Siempre conservar el router de OpenRouter como respaldo final
    candidates = [*concrete_ids, req]

    if concrete_ids:
        top_entry = scored[0][1]
        top_name = str(top_entry.get("name") or top_entry["id"])
        tools_note = "con soporte nativo de herramientas" if profile.needs_tools else profile.reason_es
        reason = f"{top_name} ({tools_note})"
    else:
        reason = f"enrutador {req} ({profile.reason_es})"

    return RoutingPlan(
        is_auto=True,
        requested_model=req,
        task_profile=profile,
        candidates=candidates,
        selected_reason=reason,
    )

