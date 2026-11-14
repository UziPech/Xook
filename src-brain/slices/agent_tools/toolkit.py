"""
Herramientas sandboxeadas del agente Xox sobre el Workspace activo (Fases 3A y 3B).

Modelo Guardián Estricto:
- Lectura y búsqueda dentro de `workspace_root` validado (bloquea traversal y rutas absolutas externas).
- Escritura autónoma permitida únicamente en `agente/` y `memoria/` (excepto ledger `.jsonl`).
- Toda modificación a `empresa/`, `datos/` o `habilidades/` se prepara en `agente/borradores/` + tarjeta HITL (`stagingPayload`).
- Toda ejecución de comandos en terminal se delega obligatoriamente al puente IPC de Rust (`rpc_callback: run_workspace_command`).
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
import uuid

from slices.inventory_advisor.review_engine import run_workspace_review
from slices.task_ui.schemas import sanitize_task_proposal


AUTONOMOUS_WRITE_ROOTS = ("agente", "memoria")
PROTECTED_HITL_ROOTS = ("empresa", "datos", "habilidades")
READ_SEARCH_EXCLUDED_ROOTS = {".xook", ".git", "__pycache__", "node_modules"}
IMAGE_FILE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".heic"}
MAX_READ_BYTES = 24 * 1024
MAX_SEARCH_MATCHES = 40


def _norm_rel(raw_path: Optional[str]) -> str:
    clean = str(raw_path or ".").strip().replace("\\", "/").lstrip("/")
    if clean in ("", "./"):
        return "."
    return clean.rstrip("/") or "."


def resolve_workspace_path(workspace_root: Path, rel_path: str) -> Tuple[Path, str, str]:
    """
    Valida y resuelve `rel_path` dentro de `workspace_root`.
    Retorna `(abs_path, clean_rel_posix, top_zone)`.
    Lanza `ValueError` si intenta salir del workspace o acceder a `.xook`.
    """
    root = workspace_root.resolve()
    clean = _norm_rel(rel_path)
    if clean == ".":
        return root, ".", "root"

    rel = Path(clean)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"Ruta fuera del espacio de trabajo bloqueada: {rel_path}")
    first = rel.parts[0] if rel.parts else ""
    if first == ".xook" or first.startswith(".git"):
        raise ValueError("Acceso denegado a carpeta protegida del sistema (.xook).")

    candidate = root / rel
    if candidate.exists():
        resolved = candidate.resolve()
        if resolved != root and root not in resolved.parents:
            raise ValueError(f"Symlink o ruta fuera del workspace bloqueada: {rel_path}")
        return resolved, rel.as_posix(), first

    # Verificar ancestro existente para archivos/carpetas nuevas
    parent = candidate.parent
    while True:
        if parent.exists():
            resolved_parent = parent.resolve()
            if resolved_parent != root and root not in resolved_parent.parents:
                raise ValueError(f"Directorio destino fuera del workspace: {rel_path}")
            tail = candidate.relative_to(parent)
            return resolved_parent / tail, rel.as_posix(), first
        if parent == parent.parent:
            raise ValueError("No se encontró un directorio ancestro válido dentro del workspace.")
        parent = parent.parent


def _write_atomic(abs_path: Path, content: str) -> None:
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = abs_path.with_name(f".{abs_path.name}.tmp.{os.getpid()}")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(abs_path)


def _slugify(raw: str) -> str:
    chars = []
    prev = False
    for ch in raw.strip().lower():
        if ch.isalnum():
            chars.append(ch)
            prev = False
        elif not prev and chars:
            chars.append("-")
            prev = True
    return "".join(chars).strip("-") or "borrador"


AGENT_TOOL_DEFS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "workspace_list",
            "description": (
                "Lista archivos y carpetas reales dentro del espacio de trabajo actual "
                "(empresa/, datos/, memoria/, habilidades/, agente/). Úsala antes de opinar sobre archivos reales."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Ruta relativa dentro del workspace (por defecto '.' para la raíz).",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_read",
            "description": "Lee el contenido de un archivo de texto dentro del espacio de trabajo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Ruta relativa al workspace, ej. 'empresa/perfil.json' o 'datos/inventario.csv'."},
                    "max_bytes": {"type": "integer", "description": "Límite máximo de bytes a leer (por defecto 16000)."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_search",
            "description": "Busca una palabra clave o texto dentro de los archivos del workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Texto a buscar (sin distinguir mayúsculas)."},
                    "path": {"type": "string", "description": "Subcarpeta opcional donde buscar, ej. 'datos' o 'empresa'."},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_mkdir",
            "description": "Crea una carpeta autónoma dentro de agente/ o memoria/ para organizar proyectos, reportes o notas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Ruta relativa dentro de agente/ o memoria/, ej. 'agente/proyectos/campana-q4'."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "workspace_write_file",
            "description": (
                "Crea o actualiza un archivo propio del agente dentro de agente/ o memoria/diario/. "
                "Para editar empresa/, datos/ o habilidades/ usa `propose_company_file_edit` (requiere aprobación HITL)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Ruta relativa dentro de agente/ o memoria/diario/."},
                    "content": {"type": "string", "description": "Contenido completo en UTF-8."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_record_fact",
            "description": "Registra un hecho o preferencia duradera del negocio en memoria/hechos.md.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fact": {"type": "string", "description": "Hecho o aprendizaje claro en una oración."},
                    "category": {"type": "string", "description": "Categoría breve, ej. 'proveedores', 'inventario', 'preferencias'."},
                },
                "required": ["fact"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_business_review",
            "description": (
                "Ejecuta el motor determinístico de revisión de inventario y reglas sobre los datos reales "
                "del workspace (`inventory_items` y `datos/`), escribe el reporte en `agente/revisiones/` "
                "y prepara propuestas de compra deduplicadas para aprobación."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "trigger_source": {"type": "string", "description": "Origen breve, ej. 'chat_agent'."}
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_company_file_edit",
            "description": (
                "Prepara en borrador (`agente/borradores/`) un cambio a un archivo protegido (`empresa/`, `datos/` o `habilidades/`) "
                "y genera una tarjeta HITL con comparativa visual para que el usuario lo apruebe antes de aplicarse."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_path": {"type": "string", "description": "Archivo destino en empresa/, datos/ o habilidades/."},
                    "new_content": {"type": "string", "description": "Contenido completo propuesto."},
                    "reason": {"type": "string", "description": "Explicación clara de por qué conviene este cambio."},
                    "title": {"type": "string", "description": "Título breve para la tarjeta de aprobación."},
                },
                "required": ["target_path", "new_content", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_delete_path",
            "description": (
                "Solicita autorización HITL explícita para archivar/eliminar un archivo del espacio de trabajo. "
                "Al aprobarse se mueve a `agente/.papelera/` de forma segura (nunca borra `.xook/`)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_path": {"type": "string", "description": "Ruta relativa del archivo existente dentro del workspace."},
                    "reason": {"type": "string", "description": "Motivo claro para proponer archivarlo/eliminarlo."},
                    "title": {"type": "string", "description": "Título breve para la tarjeta HITL."},
                },
                "required": ["target_path", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_schedule_automation",
            "description": (
                "Crea una tarjeta HITL en Por aceptar para activar un recordatorio o revisión automática recurrente "
                "en Agenda (`auto_scheduled = true`)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Nombre claro de la revisión o recordatorio programado."},
                    "time_label": {"type": "string", "description": "Hora o fecha/hora objetivo, ej. '09:00' o 'viernes 13, 18:00'."},
                    "recurrence": {
                        "type": "string",
                        "description": "Frecuencia deseada, ej. 'Diario', 'Semanal', 'Mensual' o 'Una vez'.",
                    },
                    "reason": {"type": "string", "description": "Qué revisará automáticamente esta programación."},
                    "auto_run_review": {
                        "type": "boolean",
                        "description": "Si true, al vencer ejecutará automáticamente el motor de revisiones del negocio.",
                    },
                },
                "required": ["title", "time_label", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "propose_tasks",
            "description": (
                "Envía una o más tarjetas estructuradas `TaskProposal` directamente al panel Por aceptar "
                "durante el flujo de herramientas."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "description": "Lista de objetos TaskProposal válidos (title, category, urgency, blocks, intent).",
                        "items": {"type": "object"},
                    },
                },
                "required": ["tasks"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_workspace_command",
            "description": (
                "Solicita al Guardián de Comandos de Rust ejecutar una utilidad de consola en el workspace "
                "(por ejemplo inspeccionar filas, validar JSON/CSV o correr un script de reporte). "
                "Si el comando requiere permiso, el usuario verá una tarjeta interactiva de autorización en vivo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "purpose": {"type": "string", "description": "Propósito claro en lenguaje humano para mostrar al usuario."},
                    "command": {"type": "string", "description": "Comando a ejecutar dentro del workspace (sin pipes ni sudo)."},
                    "cwd": {"type": "string", "description": "Subcarpeta de trabajo relativa al workspace (por defecto '.')."},
                    "timeout_sec": {"type": "integer", "description": "Tiempo límite en segundos (máximo 30)."},
                },
                "required": ["purpose", "command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_desktop_apps",
            "description": (
                "Consulta de solo lectura las aplicaciones de escritorio instaladas en el equipo "
                "(por ejemplo Notas, Calendario, Calculadora, Safari o editores). Úsala si hay duda sobre "
                "el nombre exacto instalado antes de abrirla."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Filtro opcional por nombre parcial o idioma (ej. 'notas', 'calendario', 'office')."},
                    "limit": {"type": "integer", "description": "Máximo de resultados (por defecto 25, máximo 60)."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "open_desktop_app",
            "description": (
                "Solicita al Guardián de Rust abrir una aplicación de escritorio instalada en el equipo del usuario "
                "(como Notas, Calendario, Recordatorios, Calculadora, Safari o Finder). "
                "Siempre solicita autorización al usuario con una tarjeta interactiva salvo que ya exista permiso permanente."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "app_name": {"type": "string", "description": "Nombre de la aplicación a abrir (ej. 'Notas', 'Calendario', 'Safari') o bundle ID."},
                    "purpose": {"type": "string", "description": "Propósito claro en español para mostrar al usuario en la tarjeta de autorización."},
                },
                "required": ["app_name", "purpose"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "os_list_notes",
            "description": (
                "Consulta notas y carpetas reales de la aplicación Notas del sistema (macOS). "
                "Úsala cuando el usuario quiera revisar, buscar o retomar notas guardadas en su Mac."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Texto opcional para filtrar por título o contenido."},
                    "folder": {"type": "string", "description": "Carpeta opcional dentro de Notas (ej. 'Notas', 'Trabajo')."},
                    "limit": {"type": "integer", "description": "Máximo de notas a devolver (por defecto 15, máximo 30)."},
                    "purpose": {"type": "string", "description": "Motivo breve en español para mostrar al usuario."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "os_create_note",
            "description": (
                "Crea una nota real en la aplicación Notas de macOS del usuario. "
                "Solicita autorización al usuario mediante tarjeta interactiva salvo que ya tenga permiso permanente."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Título claro de la nota."},
                    "body": {"type": "string", "description": "Contenido en texto plano con saltos de línea (sin etiquetas HTML)."},
                    "folder": {"type": "string", "description": "Carpeta destino opcional dentro de Notas (por defecto usa la carpeta principal)."},
                    "open_after": {"type": "boolean", "description": "Opcional: true para abrir y mostrar la nota creada en pantalla."},
                    "purpose": {"type": "string", "description": "Propósito claro en español para la tarjeta de autorización."},
                },
                "required": ["title", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "os_list_calendar_events",
            "description": (
                "Consulta los calendarios disponibles y los eventos reales en un rango de fechas dentro "
                "de la app Calendario de macOS. Úsala antes de agendar si necesitas verificar disponibilidad, "
                "huecos libres o resumir la agenda real del usuario."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "start_iso": {"type": "string", "description": "Inicio del rango en formato ISO local (ej. '2026-11-13' o '2026-11-13T00:00:00'). Si se omite, inicia hoy."},
                    "end_iso": {"type": "string", "description": "Fin del rango en formato ISO local (ej. '2026-11-15' o '2026-11-15T23:59:59'). Si se omite, cubre 7 días."},
                    "calendar_name": {"type": "string", "description": "Nombre opcional de un calendario específico (ej. 'Trabajo', 'Personal')."},
                    "limit": {"type": "integer", "description": "Máximo de eventos a devolver (por defecto 40, máximo 100)."},
                    "purpose": {"type": "string", "description": "Motivo breve en español para mostrar al usuario."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "os_create_calendar_event",
            "description": (
                "Agenda un evento real en la aplicación Calendario de macOS del usuario. "
                "Usa la fecha y hora local actual del sistema para calcular fechas ISO exactas y solicita "
                "autorización mediante tarjeta interactiva con vista previa antes de crearlo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Título del evento o reunión."},
                    "start_iso": {"type": "string", "description": "Fecha/hora de inicio en formato ISO local exacto (ej. '2026-11-14T15:00:00' o '2026-11-14' si es todo el día)."},
                    "end_iso": {"type": "string", "description": "Fecha/hora de fin opcional en ISO local (por defecto +1 hora para eventos con hora)."},
                    "all_day": {"type": "boolean", "description": "true si el evento dura todo el día."},
                    "calendar_name": {"type": "string", "description": "Nombre opcional del calendario editable destino (si se omite, usa el calendario principal)."},
                    "location": {"type": "string", "description": "Lugar o enlace opcional de la reunión."},
                    "description": {"type": "string", "description": "Notas o detalles adicionales del evento."},
                    "reminder_minutes_before": {"type": "integer", "description": "Minutos antes para alerta opcional (ej. 15)."},
                    "open_after": {"type": "boolean", "description": "Opcional: true para abrir Calendario mostrando el evento agendado."},
                    "purpose": {"type": "string", "description": "Propósito claro en español para la tarjeta de autorización."},
                },
                "required": ["title", "start_iso"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pdf_read",
            "description": (
                "Lee y extrae información estructurada de un archivo PDF del workspace: metadatos, "
                "índice/marcadores, texto por página y tablas estructuradas. Si alguna página es "
                "escaneada sin capa de texto, intenta OCR local automático."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Ruta relativa del archivo PDF dentro del workspace (ej. 'datos/documentos/factura.pdf' o 'agente/adjuntos/reporte.pdf').",
                    },
                    "start_page": {
                        "type": "integer",
                        "description": "Página inicial (1-based). Por defecto 1.",
                    },
                    "end_page": {
                        "type": "integer",
                        "description": "Página final (1-based, máximo 20 páginas por llamada).",
                    },
                    "include_tables": {
                        "type": "boolean",
                        "description": "Si true (default), extrae tablas detectadas en las páginas.",
                    },
                    "max_chars": {
                        "type": "integer",
                        "description": "Presupuesto máximo de caracteres a devolver (default 24000).",
                    },
                    "enable_ocr_fallback": {
                        "type": "boolean",
                        "description": "Si true (default), aplica OCR local automático a páginas escaneadas sin texto.",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "pdf_generate",
            "description": (
                "Genera un documento PDF profesional y estructurado en 'agente/reportes/' (o ruta dentro de 'agente/'). "
                "Estructura base con títulos, subtítulos, párrafos, listas, tablas, tarjetas métricas (kpi_strip), "
                "callouts, portada opcional e imágenes del workspace. Interpreta libremente la intención del usuario "
                "sobre dónde y cómo usar cada imagen o si requiere portada (full_bleed, hero_top, centered, split, minimal o auto)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Título principal del documento PDF.",
                    },
                    "subtitle": {
                        "type": "string",
                        "description": "Subtítulo o bajada descriptiva opcional del documento.",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Ruta de salida opcional dentro de 'agente/' (ej. 'agente/reportes/analisis.pdf'). Si se omite se crea automáticamente con fecha.",
                    },
                    "author": {
                        "type": "string",
                        "description": "Autor, área o nombre de la empresa emisora.",
                    },
                    "date": {
                        "type": "string",
                        "description": "Fecha visible en portada y pie de página (por defecto hoy).",
                    },
                    "theme": {
                        "type": "string",
                        "enum": ["executive", "minimal", "emerald", "warm", "midnight"],
                        "description": "Paleta visual del PDF (por defecto 'executive').",
                    },
                    "page_size": {
                        "type": "string",
                        "enum": ["letter", "a4"],
                        "description": "Tamaño de página (por defecto 'letter').",
                    },
                    "cover": {
                        "type": "object",
                        "description": "Portada dedicada opcional. Úsala cuando el documento la amerite o el usuario pida portada o imagen de portada.",
                        "properties": {
                            "enabled": {"type": "boolean"},
                            "image_path": {
                                "type": "string",
                                "description": "Ruta o nombre de imagen del workspace para portada (ej. 'agente/adjuntos/portada.png').",
                            },
                            "layout": {
                                "type": "string",
                                "enum": ["auto", "full_page", "hero_top", "full_bleed", "centered", "split", "minimal", "none"],
                                "description": "Disposición de portada. Usa 'full_page' cuando el usuario adjunte una portada o carátula ya diseñada (con texto/logos propios) para insertarla íntegra sin oscurecer ni encimar texto encima; 'auto' detecta carátulas, fotos o logos automáticamente.",
                            },
                            "overlay_text": {
                                "type": "boolean",
                                "description": "Solo pon true si deseas estampar título/autor encima de la imagen de portada aunque parezca carátula.",
                            },
                            "eyebrow": {"type": "string", "description": "Etiqueta superior corta en portada."},
                            "title": {"type": "string", "description": "Título alternativo para portada."},
                            "subtitle": {"type": "string", "description": "Subtítulo alternativo para portada."},
                            "meta": {"type": "string", "description": "Texto breve de autor/fecha en portada."},
                        },
                    },
                    "cover_only": {
                        "type": "boolean",
                        "description": "Déjalo en false salvo que el usuario haya pedido explícitamente un PDF de una sola página con únicamente la portada sin desarrollo.",
                    },
                    "blocks": {
                        "type": "array",
                        "description": "Arreglo JSON NATIVO (NO stringificado) con los bloques ordenados del documento (títulos, subtítulos, párrafos, listas, código, tablas, métricas, callouts, imágenes). Obligatorio incluir contenido desarrollado en 'blocks' o en 'markdown' (salvo cover_only=true).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "heading",
                                        "paragraph",
                                        "bullets",
                                        "bullet_list",
                                        "numbered_list",
                                        "code",
                                        "table",
                                        "image",
                                        "callout",
                                        "kpi_strip",
                                        "divider",
                                        "spacer",
                                        "page_break",
                                    ],
                                },
                                "level": {
                                    "type": "integer",
                                    "description": "Nivel para 'heading': 1=Título de sección, 2=Subtítulo, 3=Sub-subtítulo.",
                                },
                                "text": {
                                    "type": "string",
                                    "description": "Texto para 'heading', 'paragraph' o 'callout' (soporta **negritas**, *cursiva* y `código`).",
                                },
                                "code": {
                                    "type": "string",
                                    "description": "Código fuente literal para bloque 'code'.",
                                },
                                "language": {
                                    "type": "string",
                                    "description": "Lenguaje de programación para bloque 'code' (ej. 'python', 'typescript', 'sql').",
                                },
                                "title": {
                                    "type": "string",
                                    "description": "Título opcional para 'callout' o 'section'.",
                                },
                                "tone": {
                                    "type": "string",
                                    "enum": ["info", "success", "warning", "critical"],
                                    "description": "Tono visual para 'callout'.",
                                },
                                "items": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Elementos de texto para 'bullets' o 'numbered_list'.",
                                },
                                "metrics": {
                                    "type": "array",
                                    "description": "Tarjetas numéricas (máximo 4) para 'kpi_strip'.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {"type": "string"},
                                            "value": {"type": "string"},
                                            "detail": {"type": "string"},
                                        },
                                    },
                                },
                                "headers": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Encabezados de columna para 'table'.",
                                },
                                "rows": {
                                    "type": "array",
                                    "items": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "description": "Filas de celdas para 'table'.",
                                },
                                "path": {
                                    "type": "string",
                                    "description": "Ruta o nombre de archivo en workspace para bloque 'image'.",
                                },
                                "caption": {
                                    "type": "string",
                                    "description": "Pie de figura o tabla.",
                                },
                                "size": {
                                    "type": "string",
                                    "enum": ["small", "medium", "large", "full"],
                                    "description": "Ancho relativo para bloque 'image'.",
                                },
                                "align": {
                                    "type": "string",
                                    "enum": ["left", "center", "right"],
                                    "description": "Alineación para bloque 'image'.",
                                },
                            },
                        },
                    },
                    "markdown": {
                        "type": "string",
                        "description": "Recomendado para documentos extensos (8+, 12+ páginas) o guías largas: contenido completo en Markdown estructurado (#, ##, ###, listas, > callouts, | tablas | y ```lenguaje```). Más compacto y confiable que decenas de objetos JSON.",
                    },
                    "source_pdf_path": {
                        "type": "string",
                        "description": "Ruta del PDF existente en el workspace cuando el usuario pide modificarlo o agregarle más páginas conservando su misma tipografía, diseño y portada.",
                    },
                    "edit_action": {
                        "type": "string",
                        "enum": ["create", "append_pages", "modify"],
                        "description": "Usa 'append_pages' para agregar más páginas al final de `source_pdf_path` conservando intactas sus páginas actuales y la misma tipografía/tema; usa 'modify' para actualizar secciones del documento conservando su portada y estilo; usa 'create' para crear un PDF nuevo.",
                    },
                    "replacements": {
                        "type": "array",
                        "description": "Lista opcional de reemplazos puntuales de texto sobre cualquier página del PDF existente (ej. [{'find': 'texto anterior', 'replace': 'texto nuevo'}]).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "find": {"type": "string"},
                                "replace": {"type": "string"},
                                "page_number": {"type": "integer"},
                            },
                        },
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_screen_now",
            "description": (
                "Lee en tiempo real lo que el usuario está viendo ahora mismo en su pantalla o ventana activa "
                "(combina texto exacto OCR/accesibilidad e inspección visual en RAM sin guardar capturas en disco). "
                "Úsala SIEMPRE que el usuario diga 'lee la pantalla', 'qué ves', 'mira esto', 'qué dice aquí', "
                "'revisa esta ventana' o pregunte sobre contenido visible en su pantalla. NUNCA uses comandos de terminal para esto."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["display", "window"],
                        "description": "'display' para toda la pantalla detrás de QuickBar (default), o 'window' para la ventana frontal específica.",
                    },
                    "include_image": {
                        "type": "boolean",
                        "description": "Si incluir vista visual momentánea en RAM además del texto leído (default true).",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Motivo breve de lectura en lenguaje natural.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_screen_memory",
            "description": (
                "Consulta observaciones de texto recientes (últimos minutos) de pantallas y ventanas que el usuario estuvo viendo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Palabras clave opcionales para buscar en lo visto recientemente."},
                    "limit": {"type": "integer", "description": "Máximo de observaciones recientes a traer (default 5)."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_search",
            "description": (
                "Busca hechos guardados del negocio en memoria/hechos.md y contexto reciente indexado por SQLite FTS5 sin límite de caracteres."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Tema o palabras clave a recordar."},
                    "limit": {"type": "integer", "description": "Máximo de elementos relevantes."},
                },
                "required": ["query"],
            },
        },
    },
]


class WorkspaceToolExecutor:
    """Ejecuta herramientas agénticas dentro de un `workspace_root` con límite estricto de sandbox."""

    def __init__(
        self,
        workspace_root: Path,
        emit_event: Optional[Callable[[Dict[str, Any]], None]] = None,
        command_bridge: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ) -> None:
        self.workspace_root = workspace_root.resolve()
        self.emit_event = emit_event
        self.command_bridge = command_bridge
        self.staged_tasks: List[Dict[str, Any]] = []
        self.generated_pdfs: List[Dict[str, Any]] = []
        self.transient_tool_images: List[Dict[str, Any]] = []
        self.workspace_mutated = False

    def _emit_workspace_changed(self, path: str, action: str) -> None:
        self.workspace_mutated = True
        if self.emit_event:
            self.emit_event({
                "type": "workspace_changed",
                "path": path,
                "action": action,
            })

    def execute(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        handler = {
            "workspace_list": self._tool_list,
            "workspace_read": self._tool_read,
            "workspace_search": self._tool_search,
            "workspace_mkdir": self._tool_mkdir,
            "workspace_write_file": self._tool_write_file,
            "memory_record_fact": self._tool_record_fact,
            "run_business_review": self._tool_run_business_review,
            "propose_company_file_edit": self._tool_propose_company_edit,
            "propose_delete_path": self._tool_propose_delete_path,
            "propose_schedule_automation": self._tool_propose_schedule_automation,
            "propose_tasks": self._tool_propose_tasks,
            "run_workspace_command": self._tool_run_workspace_command,
            "list_desktop_apps": self._tool_list_desktop_apps,
            "open_desktop_app": self._tool_open_desktop_app,
            "os_list_notes": self._tool_os_list_notes,
            "os_create_note": self._tool_os_create_note,
            "os_list_calendar_events": self._tool_os_list_calendar_events,
            "os_create_calendar_event": self._tool_os_create_calendar_event,
            "pdf_read": self._tool_pdf_read,
            "pdf_generate": self._tool_pdf_generate,
            "read_screen_now": self._tool_read_screen_now,
            "query_screen_memory": self._tool_query_screen_memory,
            "memory_search": self._tool_memory_search,
        }.get(name)
        if not handler:
            return {"ok": False, "error": f"Herramienta desconocida: {name}"}
        try:
            return handler(args or {})
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _tool_list(self, args: Dict[str, Any]) -> Dict[str, Any]:
        target, clean_rel, _ = resolve_workspace_path(self.workspace_root, args.get("path") or ".")
        if not target.exists():
            return {"ok": False, "error": f"No existe la ruta: {clean_rel}"}
        if target.is_file():
            return {"ok": True, "path": clean_rel, "entries": [{"name": target.name, "kind": "file", "size": target.stat().st_size}]}

        entries: List[Dict[str, Any]] = []
        for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if entry.name.startswith(".") and clean_rel == ".":
                continue
            rel = entry.relative_to(self.workspace_root).as_posix()
            item: Dict[str, Any] = {
                "path": rel,
                "name": entry.name,
                "kind": "dir" if entry.is_dir() else "file",
            }
            if entry.is_file():
                item["size_bytes"] = entry.stat().st_size
            entries.append(item)
            if len(entries) >= 120:
                break
        return {"ok": True, "path": clean_rel, "entries": entries}

    def _tool_read(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_path = args.get("path")
        if not raw_path:
            return {"ok": False, "error": "Falta el parámetro 'path'."}
        target, clean_rel, top_zone = resolve_workspace_path(self.workspace_root, str(raw_path))
        if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
            return {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
        if not target.is_file():
            return {"ok": False, "error": f"Archivo no encontrado: {clean_rel}"}

        ext = target.suffix.lower()
        if ext == ".pdf":
            pdf_res = self._tool_pdf_read({"path": clean_rel})
            if pdf_res.get("ok"):
                pdf_res["note"] = (
                    "Archivo PDF leído mediante lector estructurado "
                    "(usa 'pdf_read' con start_page/end_page si necesitas leer más páginas)."
                )
            return pdf_res

        if ext in IMAGE_FILE_EXTENSIONS:
            return self._inspect_image_file(target, clean_rel)

        if ext in (".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".rtf", ".odt", ".ods", ".odp", ".csv", ".tsv"):
            try:
                from slices.pdf_engine import read_universal_document

                uni_res = read_universal_document(target, clean_rel)
                if uni_res.get("ok"):
                    return uni_res
            except Exception:
                pass

        limit = max(256, min(MAX_READ_BYTES, int(args.get("max_bytes") or 16000)))
        data = target.read_bytes()
        truncated = len(data) > limit
        text = data[:limit].decode("utf-8", errors="replace")
        return {
            "ok": True,
            "path": clean_rel,
            "size_bytes": len(data),
            "truncated": truncated,
            "content": text,
        }

    def _inspect_image_file(self, target: Path, clean_rel: str) -> Dict[str, Any]:
        size_bytes = target.stat().st_size
        width: Optional[int] = None
        height: Optional[int] = None
        img_format: Optional[str] = None
        mode: Optional[str] = None
        has_alpha = False
        try:
            from PIL import Image as PILImage, ImageOps

            with PILImage.open(target) as im:
                img_format = im.format
                mode = im.mode
                has_alpha = "A" in im.getbands()
                im_t = ImageOps.exif_transpose(im)
                width, height = im_t.size
        except Exception:
            pass

        ocr_text = ""
        try:
            from slices.pdf_engine.ocr import extract_text_from_images_macos

            ocr_map = extract_text_from_images_macos([target])
            ocr_text = (ocr_map.get(str(target)) or "").strip()
        except Exception:
            ocr_text = ""

        out: Dict[str, Any] = {
            "ok": True,
            "path": clean_rel,
            "kind": "image",
            "format": img_format or target.suffix.lstrip(".").upper(),
            "mode": mode,
            "has_alpha": has_alpha,
            "width": width,
            "height": height,
            "size_bytes": size_bytes,
            "note": (
                "Archivo de imagen binario dentro del workspace. "
                "Puedes pasarlo a 'pdf_generate' en 'cover.image_path' o en un bloque {type: 'image', path}."
            ),
        }
        if ocr_text:
            out["ocr_text"] = ocr_text[:4000]
        return out

    def _tool_pdf_read(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_path = args.get("path")
        if not raw_path:
            return {"ok": False, "error": "Falta el parámetro 'path' del PDF."}
        target, clean_rel, top_zone = resolve_workspace_path(self.workspace_root, str(raw_path))
        if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
            return {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
        if not target.is_file():
            return {"ok": False, "error": f"Archivo PDF no encontrado: {clean_rel}"}
        if target.suffix.lower() != ".pdf":
            return {"ok": False, "error": f"El archivo no es PDF ({target.suffix or 'sin extensión'}): {clean_rel}"}

        try:
            from slices.pdf_engine import read_pdf_document
        except Exception as exc:
            return {
                "ok": False,
                "error": f"Motor PDF no disponible en este entorno Python: {exc}",
            }

        try:
            start_page = int(args.get("start_page") or 1)
        except Exception:
            start_page = 1
        end_page_raw = args.get("end_page")
        try:
            end_page = int(end_page_raw) if end_page_raw is not None else None
        except Exception:
            end_page = None
        include_tables = args.get("include_tables")
        include_tables_bool = True if include_tables is None else bool(include_tables)
        enable_ocr = args.get("enable_ocr_fallback")
        enable_ocr_bool = True if enable_ocr is None else bool(enable_ocr)
        try:
            max_chars = int(args.get("max_chars") or 24000)
        except Exception:
            max_chars = 24000

        try:
            res = read_pdf_document(
                target,
                start_page=start_page,
                end_page=end_page,
                include_tables=include_tables_bool,
                max_chars=max_chars,
                enable_ocr_fallback=enable_ocr_bool,
            )
            res["path"] = clean_rel
            return res
        except Exception as exc:
            return {"ok": False, "error": f"Error leyendo PDF {clean_rel}: {exc}"}

    def _tool_pdf_generate(self, args: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(args, dict):
            return {"ok": False, "error": "Parámetros inválidos para generar PDF."}

        try:
            from slices.pdf_engine import (
                generate_pdf_document,
                modify_or_append_pdf_by_agent,
                render_pdf_preview,
            )
            from slices.pdf_engine.editor import _find_existing_pdf_in_workspace
            from slices.pdf_engine.generator import (
                _count_substantive_blocks,
                _normalize_blocks_input,
            )
        except Exception as exc:
            return {
                "ok": False,
                "error": f"Motor de generación PDF no disponible en este entorno Python: {exc}",
            }

        source_pdf_ref = str(
            args.get("source_pdf_path")
            or args.get("target_pdf_path")
            or args.get("existing_pdf_path")
            or ""
        ).strip()
        edit_action = str(args.get("edit_action") or args.get("mode") or "").strip().lower()
        replacements = args.get("replacements") if isinstance(args.get("replacements"), list) else []
        is_edit_or_append = (
            bool(source_pdf_ref)
            or bool(args.get("append_pages"))
            or bool(replacements)
            or edit_action in ("append_pages", "add_pages", "append", "agregar_paginas", "modify", "update", "edit")
        )
        if not is_edit_or_append and args.get("output_path"):
            existing_match = _find_existing_pdf_in_workspace(
                self.workspace_root,
                str(args.get("output_path")),
                resolve_workspace_path,
            )
            if existing_match is not None and edit_action != "create":
                is_edit_or_append = True

        title = str(args.get("title") or "").strip()
        if not title and not is_edit_or_append:
            return {"ok": False, "error": "Falta el título ('title') del documento PDF."}

        cover_only = bool(args.get("cover_only"))
        normalized_blocks, _ = _normalize_blocks_input(args)
        substantive_count = _count_substantive_blocks(normalized_blocks)
        if substantive_count == 0 and not cover_only and not replacements:
            return {
                "ok": False,
                "error": (
                    "El PDF NO se generó porque faltan los bloques de contenido del documento (`blocks`, `sections` o `markdown`). "
                    "No generes solo una portada cuando el usuario pidió desarrollar un tema o informe. "
                    "Vuelve a llamar a `pdf_generate` incluyendo `title`, `cover` (con `layout: 'full_page'` si la imagen adjunta ya es una carátula diseñada) "
                    "y el arreglo `blocks` completo con títulos (`heading`), párrafos explicativos (`paragraph`), listas (`bullets`/`bullet_list`), código (`code`) o tablas (`table`)."
                ),
            }

        raw_cover = args.get("cover")
        has_cover_requested = (
            (isinstance(raw_cover, bool) and raw_cover)
            or (
                isinstance(raw_cover, dict)
                and (
                    raw_cover.get("enabled")
                    or raw_cover.get("image_path")
                    or raw_cover.get("image")
                    or raw_cover.get("path")
                    or raw_cover.get("logo_path")
                )
            )
            or bool(args.get("cover_image") or args.get("coverImage") or args.get("portada_imagen"))
        )
        if has_cover_requested and not cover_only and not is_edit_or_append:
            has_structured = any(
                str(b.get("type") or "").lower() in ("table", "code", "kpi_strip", "image")
                for b in normalized_blocks
            )
            body_chars = sum(
                len(str(b.get("text") or b.get("code") or ""))
                + sum(len(str(x)) for x in (b.get("items") or []))
                for b in normalized_blocks
            )
            if substantive_count < 2 and body_chars < 90 and not has_structured:
                return {
                    "ok": False,
                    "error": (
                        "El PDF con portada requiere contenido desarrollado en las páginas siguientes (`blocks`). "
                        "Agrega varias secciones desarrolladas (headings, párrafos explicativos, listas, ejemplos o tablas) "
                        "dentro de `blocks` en lugar de escribir el desarrollo solo en el chat, y vuelve a llamar a `pdf_generate`."
                    ),
                }

        def _on_progress(evt: Dict[str, Any]) -> None:
            if self.emit_event:
                self.emit_event({"type": "pdf_draft_progress", **evt})

        try:
            if is_edit_or_append:
                out = modify_or_append_pdf_by_agent(
                    self.workspace_root,
                    args,
                    resolve_path_fn=resolve_workspace_path,
                    progress_callback=_on_progress if self.emit_event else None,
                )
            else:
                out = generate_pdf_document(
                    args,
                    workspace_root=self.workspace_root,
                    resolve_path_fn=resolve_workspace_path,
                    autonomous_roots=AUTONOMOUS_WRITE_ROOTS,
                    progress_callback=_on_progress if self.emit_event else None,
                )
        except Exception as exc:
            return {"ok": False, "error": f"No se pudo generar o modificar el PDF: {exc}"}

        if out.get("ok") and out.get("path"):
            self.generated_pdfs.append(out)
            self._emit_workspace_changed(str(out["path"]), "create_pdf")
            if self.emit_event:
                pdf_event_payload = dict(out)
                try:
                    _on_progress({
                        "stage": "rendering_preview",
                        "step_label": "Renderizando vista previa de páginas...",
                        "progress": 0.94,
                        "title": out.get("title") or title,
                        "theme": out.get("theme") or "executive",
                        "has_cover": bool(out.get("has_cover")),
                        "path": str(out["path"]),
                    })
                    out_abs, _, _ = resolve_workspace_path(self.workspace_root, str(out["path"]))
                    preview = render_pdf_preview(out_abs, start_page=1, max_pages=8)
                    if preview.get("ok"):
                        pdf_event_payload["preview_pages"] = preview.get("pages") or []
                        pdf_event_payload["preview_has_more"] = bool(preview.get("has_more"))
                except Exception:
                    pass
                self.emit_event({"type": "pdf_generated", "pdf": pdf_event_payload})
        return out

    def _tool_search(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip()
        if not query:
            return {"ok": False, "error": "Falta el texto 'query'."}
        base, clean_rel, _ = resolve_workspace_path(self.workspace_root, args.get("path") or ".")
        if not base.exists():
            return {"ok": False, "error": f"Ruta no encontrada: {clean_rel}"}

        q_lower = query.lower()
        matches: List[Dict[str, Any]] = []
        candidates = [base] if base.is_file() else sorted(base.rglob("*"))
        for p in candidates:
            if not p.is_file():
                continue
            rel_parts = p.relative_to(self.workspace_root).parts
            if any(part in READ_SEARCH_EXCLUDED_ROOTS for part in rel_parts):
                continue
            if p.stat().st_size > 512 * 1024:
                continue
            try:
                content = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            for lineno, line in enumerate(content.splitlines(), start=1):
                if q_lower in line.lower():
                    matches.append({
                        "path": p.relative_to(self.workspace_root).as_posix(),
                        "line": lineno,
                        "snippet": line.strip()[:220],
                    })
                    if len(matches) >= MAX_SEARCH_MATCHES:
                        return {"ok": True, "query": query, "truncated": True, "matches": matches}
        return {"ok": True, "query": query, "truncated": False, "matches": matches}

    def _tool_mkdir(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_path = args.get("path")
        if not raw_path:
            return {"ok": False, "error": "Falta el parámetro 'path'."}
        target, clean_rel, top_zone = resolve_workspace_path(self.workspace_root, str(raw_path))
        if top_zone not in AUTONOMOUS_WRITE_ROOTS:
            return {
                "ok": False,
                "error": "Solo puedes crear carpetas autónomas dentro de 'agente/' o 'memoria/'.",
            }
        target.mkdir(parents=True, exist_ok=True)
        self._emit_workspace_changed(clean_rel, "mkdir")
        return {"ok": True, "created_dir": clean_rel}

    def _tool_write_file(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_path = args.get("path")
        content = args.get("content")
        if not raw_path or content is None:
            return {"ok": False, "error": "Faltan 'path' o 'content'."}
        target, clean_rel, top_zone = resolve_workspace_path(self.workspace_root, str(raw_path))
        if top_zone not in AUTONOMOUS_WRITE_ROOTS:
            return {
                "ok": False,
                "error": (
                    f"La zona '{top_zone}/' está protegida. Usa `propose_company_file_edit` "
                    "para preparar cambios con aprobación HITL."
                ),
            }
        if clean_rel.endswith("decisiones.jsonl") or clean_rel.endswith("patrones.json"):
            return {
                "ok": False,
                "error": "Los registros estructurados de memoria los gestiona el sistema tras HITL.",
            }
        _write_atomic(target, str(content))
        self._emit_workspace_changed(clean_rel, "write_file")
        return {"ok": True, "path": clean_rel, "bytes_written": len(str(content).encode("utf-8"))}

    def _tool_record_fact(self, args: Dict[str, Any]) -> Dict[str, Any]:
        fact = str(args.get("fact") or "").strip()
        if not fact:
            return {"ok": False, "error": "Falta el parámetro 'fact'."}
        category = str(args.get("category") or "negocio").strip() or "negocio"
        target, clean_rel, _ = resolve_workspace_path(self.workspace_root, "memoria/hechos.md")
        now_str = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
        line = f"- [{now_str}] ({category}) {fact}\n"
        existing = target.read_text(encoding="utf-8") if target.is_file() else "# Hechos del negocio\n\n"
        if existing and not existing.endswith("\n"):
            existing += "\n"
        _write_atomic(target, existing + line)
        self._emit_workspace_changed(clean_rel, "memory_record_fact")
        return {"ok": True, "path": clean_rel, "recorded": line.strip()}

    def _tool_run_business_review(self, args: Dict[str, Any]) -> Dict[str, Any]:
        trigger = str(args.get("trigger_source") or "chat_agent").strip() or "chat_agent"
        res = run_workspace_review(self.workspace_root, trigger_source=trigger)
        raw_tasks = res.get("tasks") or []
        added_ids: List[str] = []
        existing_ids = {t.get("cardId") for t in self.staged_tasks}
        for raw_t in raw_tasks:
            clean_t = sanitize_task_proposal(raw_t)
            if clean_t and clean_t.get("cardId") not in existing_ids:
                self.staged_tasks.append(clean_t)
                existing_ids.add(clean_t.get("cardId"))
                added_ids.append(str(clean_t.get("cardId")))
        if res.get("report_path"):
            self._emit_workspace_changed(str(res["report_path"]), "run_business_review")
        return {
            "ok": True,
            "summary": res.get("summary"),
            "analyzed_items_count": res.get("analyzed_items_count", 0),
            "findings_count": res.get("findings_count", 0),
            "skipped_duplicates_count": res.get("skipped_duplicates_count", 0),
            "report_path": res.get("report_path"),
            "staged_task_ids": added_ids,
        }

    def _tool_propose_company_edit(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_target = str(args.get("target_path") or "").strip()
        new_content = args.get("new_content")
        reason = str(args.get("reason") or "").strip()
        if not raw_target or new_content is None or not reason:
            return {"ok": False, "error": "Faltan 'target_path', 'new_content' o 'reason'."}

        target_abs, clean_target, top_zone = resolve_workspace_path(self.workspace_root, raw_target)
        if top_zone not in PROTECTED_HITL_ROOTS:
            return {
                "ok": False,
                "error": (
                    f"`{clean_target}` no está en `empresa/`, `datos/` o `habilidades/`. "
                    "Para `agente/` o `memoria/` usa `workspace_write_file`."
                ),
            }

        new_text = str(new_content)
        old_text = target_abs.read_text(encoding="utf-8", errors="replace") if target_abs.is_file() else ""
        ts = int(time.time())
        draft_rel = f"agente/borradores/{ts}_{_slugify(clean_target)}.draft"
        draft_abs, _, _ = resolve_workspace_path(self.workspace_root, draft_rel)
        _write_atomic(draft_abs, new_text)
        self._emit_workspace_changed(draft_rel, "propose_company_file_edit")

        card_id = f"edit_{ts}_{_slugify(clean_target)[:20]}"
        title = str(args.get("title") or "").strip() or f"Actualizar {clean_target}"
        old_preview = (old_text.strip()[:120] + ("…" if len(old_text.strip()) > 120 else "")) or "(archivo nuevo)"
        new_preview = (new_text.strip()[:120] + ("…" if len(new_text.strip()) > 120 else "")) or "(vacío)"

        proposal = sanitize_task_proposal({
            "cardId": card_id,
            "dedupKey": f"file_edit:{clean_target}",
            "title": title,
            "subtitle": reason,
            "category": "regla",
            "urgency": "media",
            "statusChip": "Cambio en archivo",
            "defaultExpanded": True,
            "generatedBy": "Xox Workspace",
            "blocks": [
                {
                    "type": "comparison",
                    "rows": [
                        {
                            "label": "Archivo destino",
                            "before": old_preview,
                            "after": new_preview,
                            "tone": "positive",
                        }
                    ],
                },
                {
                    "type": "kv_list",
                    "rows": [
                        {"label": "Ruta protegida", "value": clean_target},
                        {"label": "Borrador", "value": draft_rel},
                        {"label": "Líneas actuales / nuevas", "value": f"{len(old_text.splitlines())} → {len(new_text.splitlines())}"},
                    ],
                },
                {
                    "type": "insight",
                    "text": reason,
                    "source": "Borrador pendiente de autorización HITL",
                },
            ],
            "intent": {
                "type": "apply_rule",
                "targetLabel": clean_target,
                "primaryLabel": "Aplicar cambio",
            },
            "paramValues": {},
            "stagingPayload": {
                "kind": "file_edit",
                "targetPath": clean_target,
                "draftPath": draft_rel,
                "newContent": new_text,
            },
        })
        if proposal:
            self.staged_tasks.append(proposal)
        return {
            "ok": True,
            "staged_card_id": card_id,
            "target_path": clean_target,
            "draft_path": draft_rel,
            "message": "Borrador guardado en agente/borradores/ y tarjeta HITL preparada para autorización.",
        }

    def _tool_propose_delete_path(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_target = str(args.get("target_path") or "").strip()
        reason = str(args.get("reason") or "").strip()
        if not raw_target or not reason:
            return {"ok": False, "error": "Faltan 'target_path' o 'reason'."}

        target_abs, clean_target, top_zone = resolve_workspace_path(self.workspace_root, raw_target)
        if clean_target == "." or top_zone in ("root", ""):
            return {"ok": False, "error": "No se puede proponer eliminar la raíz del espacio de trabajo."}
        if not target_abs.exists():
            return {"ok": False, "error": f"No existe `{clean_target}` en el workspace."}

        ts = int(time.time())
        card_id = f"del_{ts}_{_slugify(clean_target)[:20]}"
        title = str(args.get("title") or "").strip() or f"Archivar {clean_target}"
        proposal = sanitize_task_proposal({
            "cardId": card_id,
            "dedupKey": f"delete_path:{clean_target}",
            "title": title,
            "subtitle": reason,
            "category": "regla",
            "urgency": "alta",
            "statusChip": "Mover a papelera",
            "defaultExpanded": True,
            "generatedBy": "Xox Workspace",
            "blocks": [
                {
                    "type": "kv_list",
                    "rows": [
                        {"label": "Archivo o carpeta", "value": clean_target},
                        {"label": "Acción al aprobar", "value": "Mover a agente/.papelera/"},
                    ],
                },
                {
                    "type": "insight",
                    "text": reason,
                    "source": "Requiere autorización HITL",
                },
            ],
            "intent": {
                "type": "apply_rule",
                "targetLabel": clean_target,
                "primaryLabel": "Mover a papelera",
            },
            "paramValues": {},
            "stagingPayload": {
                "kind": "delete_path",
                "targetPath": clean_target,
            },
        })
        if proposal:
            self.staged_tasks.append(proposal)
        return {
            "ok": True,
            "staged_card_id": card_id,
            "target_path": clean_target,
            "message": "Tarjeta HITL creada; nada se moverá ni borrará hasta que el usuario apruebe.",
        }

    def _tool_propose_schedule_automation(self, args: Dict[str, Any]) -> Dict[str, Any]:
        title = str(args.get("title") or "").strip()
        time_label = str(args.get("time_label") or "").strip()
        reason = str(args.get("reason") or "").strip()
        recurrence = str(args.get("recurrence") or "Diario").strip() or "Diario"
        auto_run_review = bool(args.get("auto_run_review", True))
        if not title or not time_label or not reason:
            return {"ok": False, "error": "Faltan 'title', 'time_label' o 'reason'."}

        ts = int(time.time())
        card_id = f"sched_{ts}_{_slugify(title)[:20]}"
        is_recurring = recurrence.lower() not in ("una vez", "unico", "único")
        proposal = sanitize_task_proposal({
            "cardId": card_id,
            "dedupKey": f"schedule_auto:{_slugify(title)}:{_slugify(recurrence)}",
            "title": title,
            "subtitle": reason,
            "category": "agenda",
            "urgency": "media",
            "statusChip": f"{recurrence} · {time_label}",
            "defaultExpanded": True,
            "generatedBy": "Xox Agenda",
            "blocks": [
                {
                    "type": "schedule",
                    "mode": "recurring" if is_recurring else "alarm",
                    "timeLabel": time_label,
                    "recurrence": recurrence,
                    "autoSchedule": auto_run_review,
                    "autoTriggerLabel": reason,
                },
                {
                    "type": "insight",
                    "text": reason,
                    "source": "Programación automática sugerida",
                },
            ],
            "intent": {
                "type": "schedule_event",
                "targetLabel": title,
                "primaryLabel": "Activar programación",
            },
            "paramValues": {
                "auto_schedule": auto_run_review,
            },
        })
        if proposal:
            self.staged_tasks.append(proposal)
        return {
            "ok": True,
            "staged_card_id": card_id,
            "message": "Propuesta de programación automática enviada a Por aceptar para aprobación HITL.",
        }

    def _tool_propose_tasks(self, args: Dict[str, Any]) -> Dict[str, Any]:
        raw_tasks = args.get("tasks")
        if not isinstance(raw_tasks, list) or not raw_tasks:
            return {"ok": False, "error": "Se requiere una lista no vacía en 'tasks'."}
        existing_ids = {t.get("cardId") for t in self.staged_tasks}
        added: List[str] = []
        for idx, raw_t in enumerate(raw_tasks[:8]):
            if not isinstance(raw_t, dict):
                continue
            item = dict(raw_t)
            if not item.get("cardId"):
                item["cardId"] = f"task_{int(time.time())}_{idx + 1}"
            clean = sanitize_task_proposal(item)
            if clean and clean.get("cardId") not in existing_ids:
                self.staged_tasks.append(clean)
                existing_ids.add(clean.get("cardId"))
                added.append(str(clean.get("cardId")))
        return {"ok": True, "added_card_ids": added, "count": len(added)}

    def _tool_run_workspace_command(self, args: Dict[str, Any]) -> Dict[str, Any]:
        purpose = str(args.get("purpose") or "").strip()
        command = str(args.get("command") or "").strip()
        cwd = _norm_rel(args.get("cwd") or ".")
        timeout_sec = max(1, min(30, int(args.get("timeout_sec") or 20)))
        if not purpose or not command:
            return {"ok": False, "error": "Faltan 'purpose' o 'command'."}
        if self.command_bridge is None:
            return {
                "ok": False,
                "error": "La ejecución de comandos de terminal requiere la sesión de escritorio con Guardián activo.",
            }
        req_id = f"cmd_{uuid.uuid4().hex[:12]}"
        return self.command_bridge({
            "rpc_callback": "run_workspace_command",
            "request_id": req_id,
            "purpose": purpose,
            "command": command,
            "cwd": cwd,
            "timeout_sec": timeout_sec,
        })

    def _require_bridge(
        self,
        rpc_callback: str,
        prefix: str,
        payload: Dict[str, Any],
        unavailable_msg: str,
    ) -> Dict[str, Any]:
        if self.command_bridge is None:
            return {"ok": False, "error": unavailable_msg}
        req_id = f"{prefix}_{uuid.uuid4().hex[:12]}"
        return self.command_bridge({
            "rpc_callback": rpc_callback,
            "request_id": req_id,
            **payload,
        })

    def _tool_list_desktop_apps(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip()
        try:
            limit = max(1, min(60, int(args.get("limit") or 25)))
        except (TypeError, ValueError):
            limit = 25
        return self._require_bridge(
            "list_installed_apps",
            "apps",
            {"query": query, "limit": limit},
            "La consulta de aplicaciones instaladas requiere la sesión de escritorio activa.",
        )

    def _tool_open_desktop_app(self, args: Dict[str, Any]) -> Dict[str, Any]:
        app_name = str(args.get("app_name") or "").strip()
        purpose = str(args.get("purpose") or "").strip()
        if not app_name:
            return {"ok": False, "error": "Falta 'app_name' con el nombre de la aplicación a abrir."}
        if not purpose:
            purpose = f"Abrir la aplicación {app_name} a solicitud del usuario."
        return self._require_bridge(
            "open_desktop_app",
            "app",
            {"app_name": app_name, "purpose": purpose},
            "Abrir aplicaciones requiere la sesión de escritorio con Guardián activo.",
        )

    def _tool_os_list_notes(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip()
        folder = str(args.get("folder") or "").strip() or None
        purpose = str(args.get("purpose") or "").strip() or "Consultar notas en la aplicación Notas."
        try:
            limit = max(1, min(30, int(args.get("limit") or 15)))
        except (TypeError, ValueError):
            limit = 15
        return self._require_bridge(
            "os_notes_list",
            "notes_ls",
            {"query": query, "folder": folder, "limit": limit, "purpose": purpose},
            "Consultar Notas del sistema requiere la sesión de escritorio con Guardián activo.",
        )

    def _tool_os_create_note(self, args: Dict[str, Any]) -> Dict[str, Any]:
        title = str(args.get("title") or "").strip()
        body = str(args.get("body") or "").strip()
        folder = str(args.get("folder") or "").strip() or None
        open_after = bool(args.get("open_after", False))
        purpose = str(args.get("purpose") or "").strip()
        if not title:
            return {"ok": False, "error": "Falta 'title' con el título de la nota."}
        if not body:
            body = title
        if not purpose:
            purpose = f"Crear nota '{title}' en la app Notas."
        return self._require_bridge(
            "os_notes_create",
            "notes_new",
            {
                "title": title,
                "body": body,
                "folder": folder,
                "open_after": open_after,
                "purpose": purpose,
            },
            "Crear notas en el sistema requiere la sesión de escritorio con Guardián activo.",
        )

    def _tool_os_list_calendar_events(self, args: Dict[str, Any]) -> Dict[str, Any]:
        start_iso = str(args.get("start_iso") or "").strip() or None
        end_iso = str(args.get("end_iso") or "").strip() or None
        calendar_name = str(args.get("calendar_name") or "").strip() or None
        purpose = str(args.get("purpose") or "").strip() or "Consultar eventos en el Calendario del sistema."
        try:
            limit = max(1, min(100, int(args.get("limit") or 40)))
        except (TypeError, ValueError):
            limit = 40
        return self._require_bridge(
            "os_calendar_list",
            "cal_ls",
            {
                "start_iso": start_iso,
                "end_iso": end_iso,
                "calendar_name": calendar_name,
                "limit": limit,
                "purpose": purpose,
            },
            "Consultar Calendario del sistema requiere la sesión de escritorio con Guardián activo.",
        )

    def _tool_os_create_calendar_event(self, args: Dict[str, Any]) -> Dict[str, Any]:
        title = str(args.get("title") or "").strip()
        start_iso = str(args.get("start_iso") or "").strip()
        end_iso = str(args.get("end_iso") or "").strip() or None
        all_day = bool(args.get("all_day", False))
        calendar_name = str(args.get("calendar_name") or "").strip() or None
        location = str(args.get("location") or "").strip() or None
        description = str(args.get("description") or "").strip() or None
        open_after = bool(args.get("open_after", False))
        reminder_raw = args.get("reminder_minutes_before")
        reminder_minutes = None
        if reminder_raw is not None and reminder_raw != "":
            try:
                reminder_minutes = max(0, min(10080, int(reminder_raw)))
            except (TypeError, ValueError):
                reminder_minutes = None
        if not title or not start_iso:
            return {"ok": False, "error": "Faltan 'title' o 'start_iso' para agendar el evento."}
        purpose = str(args.get("purpose") or "").strip() or f"Agendar '{title}' en Calendario ({start_iso})."
        return self._require_bridge(
            "os_calendar_create_event",
            "cal_new",
            {
                "title": title,
                "start_iso": start_iso,
                "end_iso": end_iso,
                "all_day": all_day,
                "calendar_name": calendar_name,
                "location": location,
                "description": description,
                "reminder_minutes_before": reminder_minutes,
                "open_after": open_after,
                "purpose": purpose,
            },
            "Crear eventos en el Calendario requiere la sesión de escritorio con Guardián activo.",
        )

    def _tool_read_screen_now(self, args: Dict[str, Any]) -> Dict[str, Any]:
        mode = str(args.get("mode") or "display").strip().lower()
        if mode not in ("display", "window"):
            mode = "display"
        include_image = bool(args.get("include_image", True))
        raw = self._require_bridge(
            "read_screen_now",
            "scr",
            {
                "mode": mode,
                "include_image": include_image,
                "save_observation": True,
            },
            "La lectura de pantalla en tiempo real requiere la aplicación de escritorio activa.",
        )
        if not isinstance(raw, dict):
            return {"ok": False, "error": "Respuesta inválida del lector de pantalla."}

        result = dict(raw)
        img_url = result.pop("imageDataUrl", None)
        if isinstance(img_url, str) and img_url.startswith("data:image/"):
            self.transient_tool_images.append({
                "appName": result.get("appName") or "Pantalla",
                "windowTitle": result.get("windowTitle") or "",
                "imageDataUrl": img_url,
            })
            result["has_visual_image"] = True
        else:
            result["has_visual_image"] = False

        if result.get("blockedSensitive"):
            return {
                "ok": True,
                "blocked_sensitive": True,
                "sensitive_reason": result.get("sensitiveReason") or "Ventana protegida o campo de contraseña",
                "note": "Por privacidad se omitió la lectura porque hay una app o campo sensible activo.",
            }
        if not result.get("permissionGranted", True):
            return {
                "ok": False,
                "permission_required": True,
                "error": (
                    result.get("error")
                    or "XOOK aún no tiene permiso de Grabación de Pantalla en Ajustes del Sistema > Privacidad y Seguridad."
                ),
            }
        return result

    def _tool_query_screen_memory(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip()
        try:
            limit = max(1, min(12, int(args.get("limit") or 5)))
        except (TypeError, ValueError):
            limit = 5
        return self._require_bridge(
            "query_screen_memory",
            "scrmem",
            {"query": query, "limit": limit},
            "Consultar memoria reciente de pantalla requiere la app de escritorio activa.",
        )

    def _tool_memory_search(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query") or "").strip()
        if not query:
            return {"ok": False, "error": "Falta el parámetro 'query' para buscar en memoria."}
        return self._require_bridge(
            "memory_search",
            "mem",
            {"query": query},
            "La búsqueda unificada de memoria requiere la app de escritorio activa.",
        )



