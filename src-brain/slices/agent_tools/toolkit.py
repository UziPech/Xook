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
        target, clean_rel, _ = resolve_workspace_path(self.workspace_root, str(raw_path))
        if not target.is_file():
            return {"ok": False, "error": f"Archivo no encontrado: {clean_rel}"}
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

