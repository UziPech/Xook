"""
Catálogo modular de herramientas y carga diferida (`tool_search`) para XOOK.

Inspirado en `McpToolExposure` y `tool_search` de pingdotgg/t3code (MIT):
en lugar de inyectar 45-60 definiciones JSON en cada ronda del LLM, expone un
núcleo compacto + los toolkits relevantes a la intención del usuario, y permite
al agente descubrir/cargar cualquier otro toolkit al vuelo con `tool_search`.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple


TOOL_SEARCH_NAME = "tool_search"

TOOL_SEARCH_TOOL_DEF: Dict[str, Any] = {
    "type": "function",
    "function": {
        "name": TOOL_SEARCH_NAME,
        "description": (
            "Busca y carga herramientas adicionales de XOOK que aún no están activas en este turno "
            "(por ejemplo: control de ventanas/UI de otras apps `desktop_*`, Notas/Calendario de Mac `os_*`, "
            "documentos PDF/Word/Excel `pdf_*` / `office_generate` / `document_*`, comandos/scripts `run_*`, "
            "limpieza/revisión de negocio, Canvas visual o perfil/skills). "
            "Una vez encontradas, quedan cargadas de inmediato para usarlas en la siguiente ronda."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Palabras clave o nombre de herramienta/grupo, ej. 'desktop ui click ventana', "
                        "'notas calendario', 'pdf', 'canvas tabla', 'limpieza', 'script', 'skill'."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Máximo de herramientas a cargar (default 8, máximo 12).",
                },
            },
            "required": ["query"],
        },
    },
}


# Herramientas núcleo siempre disponibles desde la ronda 1 (alta frecuencia y bajo peso).
CORE_ALWAYS_LOADED_TOOLS: Set[str] = {
    "workspace_list",
    "workspace_read",
    "workspace_search",
    "workspace_write_file",
    "workspace_edit_file",
    "propose_company_file_edit",
    "propose_tasks",
    "read_screen_now",
    "memory_search",
    "memory_record_fact",
    "save_user_info",
    "ask_clarification",
    "agent_checklist_update",
    "spawn_subagent",
    "study_create_deck",
    "web_search",
    "web_fetch",
    "image_search",
    # El primer paso en otra app no puede depender de que su nombre esté en una lista de palabras:
    # "revisa si en Teams tengo tareas" llegaba al modelo sin ninguna herramienta de escritorio.
    "desktop_list_windows",
    "desktop_snapshot",
    "open_desktop_app",
    TOOL_SEARCH_NAME,
}


# Mapa canónico de toolkits con riesgo declarado (alineado a `packages/contracts/src/agentPolicy.ts`)
# y disparadores léxicos para precarga inteligente sin latencia extra en la ronda 1.
TOOLKIT_SPECS: Dict[str, Dict[str, Any]] = {
    "desktop_ui": {
        "label": "Interacción con apps y ventanas de escritorio",
        "risk": "write_protected_hitl",
        "tools": {
            "desktop_list_windows",
            "desktop_snapshot",
            "desktop_find",
            "desktop_act",
            "list_desktop_apps",
            "open_desktop_app",
            "query_screen_memory",
        },
        "keywords": {
            "ventana", "ventanas", "window", "windows", "app", "aplicacion", "aplicaciones",
            "boton", "botones", "click", "clic", "clica", "presiona", "pulsa", "aprieta",
            "escribir en", "escribe en", "escribe", "teclea", "enter", "mensaje", "envia",
            "enviar", "chat", "llena", "rellena", "interfaz", "ui", "pantalla", "abre",
            "abrir", "lanza", "safari", "chrome", "excel", "finder", "mail", "correo",
            "slack", "whatsapp", "calculadora", "navegador", "erp", "interactua", "opera",
            "antigravity", "vscode", "cursor", "teams", "outlook", "gmail", "classroom", "moodle",
            "discord", "telegram", "notion", "zoom", "spotify", "claude", "chatgpt",
            "dile", "preguntale", "mandale", "escribele", "respondele", "contestale", "avisale",
        },
    },
    "os_apps": {
        "label": "Notas y Calendario nativos de macOS",
        "risk": "write_protected_hitl",
        "tools": {
            "os_list_notes",
            "os_create_note",
            "os_list_calendar_events",
            "os_create_calendar_event",
        },
        "keywords": {
            "nota", "notas", "apple notes", "calendario", "calendar", "evento", "eventos",
            "reunion", "reuniones", "cita", "citas", "agenda", "agendar", "horario", "horarios",
            "disponibilidad", "recordatorio",
        },
    },
    "documents_pdf": {
        "label": "Lectura, inspección de diseño y generación de documentos (PDF, Word, Excel)",
        "risk": "write_local",
        "tools": {
            "pdf_read",
            "pdf_inspect_design",
            "pdf_save_design_skill",
            "document_inspect_design",
            "document_save_design_skill",
            "pdf_generate",
            "office_generate",
        },
        "keywords": {
            "pdf", "docx", "word", "xlsx", "excel", "hoja de calculo", "libro", "pptx",
            "powerpoint", "presentacion", "csv", "tsv", "ofimatica", "presupuesto",
            "cotizacion", "tablas", "documento", "reporte", "informe", "portada", "pagina",
            "paginas", "contrato", "factura", "propuesta", "exporta", "exportar", "imprime",
            "acta", "inspector", "inspeccionar", "inspecciona", "replicar", "replica",
            "formato", "diseno", "plantilla", "membrete", "estilo", "maquetacion", "copiar diseno",
        },
    },
    "shell_scripts": {
        "label": "Comandos de consola y scripts Python/Node bajo Guardián",
        "risk": "command_exec",
        "tools": {
            "run_workspace_command",
            "run_custom_script",
            "workspace_mkdir",
        },
        "keywords": {
            "comando", "terminal", "consola", "shell", "script", "python", "node", "bash",
            "git", "npm", "cargo", "pytest", "unittest", "docx", "xlsx", "pptx", "csv",
            "excel", "word", "powerpoint", "carpeta", "directorio", "mkdir", "compila", "test",
        },
    },
    "business_ops": {
        "label": "Operaciones de negocio, limpieza segura y automatizaciones",
        "risk": "write_protected_hitl",
        "tools": {
            "run_business_review",
            "scan_workspace_cleanup",
            "propose_workspace_cleanup",
            "propose_delete_path",
            "propose_schedule_automation",
            "propose_workspace_blueprint",
        },
        "keywords": {
            "inventario", "stock", "quiebre", "proveedor", "proveedores", "orden de compra",
            "revision", "auditoria", "limpia", "limpiar", "limpieza", "basura", "temporales",
            "borra", "borrar", "elimina", "eliminar", "papelera", "programa", "programar",
            "recurrente", "automatiza", "automatizacion", "blueprint", "reestructura",
        },
    },
    "skills_profile": {
        "label": "Personalización de Xox, perfil del usuario y habilidades",
        "risk": "write_local",
        "tools": {
            "learn_skill",
            "update_skill",
            "customize_xox",
            "update_user_preferences",
            "discover_official_skills",
            "install_official_skill",
            "forget_user_info",
            "configure_ai_vault",
        },
        "keywords": {
            "skill", "skills", "habilidad", "habilidades", "personalidad", "nombre", "llamate",
            "voz", "tono", "prefiero", "preferencias", "gusta", "olvida", "olvidar", "espacio de xox",
            "api key", "proveedor ia", "openrouter", "anthropic", "deepseek", "openai", "gemini",
            "groq", "kimi", "boveda", "vault",
        },
    },
    "canvas_ui": {
        "label": "Superficies visuales interactivas en Canvas",
        "risk": "read_safe",
        "tools": {
            "create_canvas",
            "create_diagram",
            "create_plan",
            "create_dashboard",
            "create_form",
            "create_composite_canvas",
            "create_interactive_ui",
            "create_custom_ui",
            "update_canvas",
        },
        "keywords": {
            "canvas", "tabla", "comparativa", "diagrama", "flujo", "mapa", "plan", "roadmap",
            "dashboard", "grafica", "kpi", "formulario", "quiz", "examen", "encuesta",
            "calculadora", "simulador", "kanban", "mini app", "visual", "interactivo", "interfaz",
        },
    },
}


TOOL_TO_TOOLKIT: Dict[str, str] = {}
for _tk_name, _tk_spec in TOOLKIT_SPECS.items():
    for _t_name in _tk_spec["tools"]:
        TOOL_TO_TOOLKIT[_t_name] = _tk_name


def _normalize_text(raw: str) -> str:
    norm = unicodedata.normalize("NFD", str(raw or ""))
    norm = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", norm.lower()).strip()


def _tokenize_query(raw: str) -> List[str]:
    norm = _normalize_text(raw)
    return [tok for tok in re.split(r"[^a-z0-9_]+", norm) if len(tok) >= 2]


def _tool_name(td: Dict[str, Any]) -> str:
    fn = td.get("function") if isinstance(td.get("function"), dict) else {}
    return str(fn.get("name") or "").strip()


def _tool_description(td: Dict[str, Any]) -> str:
    fn = td.get("function") if isinstance(td.get("function"), dict) else {}
    return str(fn.get("description") or "").strip()


def detect_initial_toolkits(
    user_message: str,
    *,
    has_active_canvas: bool = False,
    has_active_document: bool = False,
    active_mode: Optional[str] = None,
) -> Set[str]:
    """Detecta qué toolkits conviene precargar desde la ronda 1 según el contexto del turno."""
    selected: Set[str] = set()
    norm_msg = _normalize_text(user_message)
    padded = f" {norm_msg} "

    if has_active_canvas:
        selected.add("canvas_ui")
    if has_active_document:
        selected.add("documents_pdf")
    mode_low = (active_mode or "").strip().lower()
    if mode_low in ("plan", "study"):
        selected.add("canvas_ui")
    elif mode_low == "inspector":
        selected.add("documents_pdf")
        selected.add("skills_profile")

    for tk_name, spec in TOOLKIT_SPECS.items():
        for kw in spec["keywords"]:
            clean_kw = _normalize_text(kw)
            if not clean_kw:
                continue
            if " " in clean_kw:
                if clean_kw in norm_msg:
                    selected.add(tk_name)
                    break
            else:
                if re.search(rf"(?:^|[^a-z0-9]){re.escape(clean_kw)}(?:$|[^a-z0-9])", padded):
                    selected.add(tk_name)
                    break

    return selected


class ToolExposureSession:
    """
    Controla qué herramientas se envían al modelo en cada ronda de un turno.
    - Empieza con núcleo + toolkits relevantes al mensaje.
    - `search(query)` carga dinámicamente herramientas adicionales y devuelve un resumen compacto.
    """

    def __init__(
        self,
        all_tool_defs: Sequence[Dict[str, Any]],
        *,
        user_message: str = "",
        has_active_canvas: bool = False,
        has_active_document: bool = False,
        active_mode: Optional[str] = None,
        enable_deferred: bool = True,
    ) -> None:
        self._all_by_name: Dict[str, Dict[str, Any]] = {}
        self._ordered_names: List[str] = []
        for td in all_tool_defs:
            nm = _tool_name(td)
            if nm and nm not in self._all_by_name:
                self._all_by_name[nm] = td
                self._ordered_names.append(nm)
        if enable_deferred and TOOL_SEARCH_NAME not in self._all_by_name:
            self._all_by_name[TOOL_SEARCH_NAME] = TOOL_SEARCH_TOOL_DEF
            self._ordered_names.append(TOOL_SEARCH_NAME)

        self.enable_deferred = enable_deferred
        self.loaded_names: Set[str] = set()
        self.preloaded_toolkits: Set[str] = set()

        if not enable_deferred:
            self.loaded_names.update(self._ordered_names)
            return

        # Cargar núcleo + cualquier herramienta no mapeada (retrocompatibilidad con tools nuevas)
        for nm in self._ordered_names:
            if nm in CORE_ALWAYS_LOADED_TOOLS or nm not in TOOL_TO_TOOLKIT:
                self.loaded_names.add(nm)

        self.preloaded_toolkits = detect_initial_toolkits(
            user_message,
            has_active_canvas=has_active_canvas,
            has_active_document=has_active_document,
            active_mode=active_mode,
        )
        for tk in self.preloaded_toolkits:
            for nm in TOOLKIT_SPECS.get(tk, {}).get("tools", set()):
                if nm in self._all_by_name:
                    self.loaded_names.add(nm)

    def active_tool_defs(self) -> List[Dict[str, Any]]:
        return [
            self._all_by_name[nm]
            for nm in self._ordered_names
            if nm in self.loaded_names
        ]

    def total_catalog_count(self) -> int:
        return len(self._ordered_names)

    def has_tool(self, name: str) -> bool:
        return name in self._all_by_name

    def mark_loaded(self, names: Iterable[str]) -> List[str]:
        newly: List[str] = []
        for nm in names:
            if nm in self._all_by_name and nm not in self.loaded_names:
                self.loaded_names.add(nm)
                newly.append(nm)
        return newly

    def load_toolkit(self, toolkit: str) -> List[str]:
        return self.mark_loaded(sorted(TOOLKIT_SPECS.get(toolkit, {}).get("tools", set())))

    def note_tool_used(self, name: str) -> List[str]:
        """Usar el primer paso de un toolkit que está en el núcleo carga el resto para la siguiente ronda."""
        if name in CORE_ALWAYS_LOADED_TOOLS and name in TOOL_TO_TOOLKIT:
            return self.load_toolkit(TOOL_TO_TOOLKIT[name])
        return []

    def search(self, query: str, limit: int = 8) -> Dict[str, Any]:
        clean_query = str(query or "").strip()
        clamped_limit = max(1, min(12, int(limit or 8)))
        terms = _tokenize_query(clean_query)

        if not terms:
            toolkits_summary = [
                {
                    "toolkit": tk_name,
                    "label": spec["label"],
                    "risk": spec["risk"],
                    "tools": sorted(t for t in spec["tools"] if t in self._all_by_name),
                }
                for tk_name, spec in TOOLKIT_SPECS.items()
            ]
            return {
                "ok": True,
                "query": clean_query,
                "loaded_now": [],
                "matches": [],
                "available_toolkits": toolkits_summary,
                "active_tool_count": len(self.loaded_names),
                "total_tool_count": len(self._ordered_names),
            }

        scored: List[Tuple[int, str]] = []
        for nm in self._ordered_names:
            if nm == TOOL_SEARCH_NAME:
                continue
            td = self._all_by_name[nm]
            desc_norm = _normalize_text(_tool_description(td))
            tk_name = TOOL_TO_TOOLKIT.get(nm, "core")
            tk_spec = TOOLKIT_SPECS.get(tk_name, {})
            tk_label_norm = _normalize_text(str(tk_spec.get("label") or ""))
            tk_keywords = {_normalize_text(k) for k in tk_spec.get("keywords", set())}

            score = 0
            nm_low = nm.lower()
            for term in terms:
                if term == nm_low:
                    score += 100
                elif term in nm_low:
                    score += 10
                if term == tk_name or term in tk_name:
                    score += 8
                if term in tk_keywords:
                    score += 6
                if term in tk_label_norm:
                    score += 4
                if term in desc_norm:
                    score += 2
            if score > 0:
                scored.append((score, nm))

        scored.sort(key=lambda item: (-item[0], item[1]))
        top_names = [nm for _, nm in scored[:clamped_limit]]
        newly_loaded = self.mark_loaded(top_names)

        matches = []
        for nm in top_names:
            tk_name = TOOL_TO_TOOLKIT.get(nm, "core")
            risk = str(TOOLKIT_SPECS.get(tk_name, {}).get("risk") or "read_safe")
            matches.append({
                "name": nm,
                "toolkit": tk_name,
                "risk": risk,
                "newly_loaded": nm in newly_loaded,
                "description": _tool_description(self._all_by_name[nm])[:220],
            })

        return {
            "ok": True,
            "query": clean_query,
            "loaded_now": newly_loaded,
            "matches": matches,
            "active_tool_count": len(self.loaded_names),
            "total_tool_count": len(self._ordered_names),
            "note": (
                "Las herramientas encontradas ya están cargadas y disponibles para llamarse directamente en la siguiente ronda."
                if matches
                else "No hubo coincidencias exactas; prueba términos como 'desktop', 'pdf', 'notas', 'calendario', 'canvas', 'script', 'limpieza' o 'skill'."
            ),
        }
