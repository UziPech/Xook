"""
`encargo_schedule`: Xox prepara un pendiente, algo que hará solo a la hora indicada.

En pantalla se llaman "Pendientes"; en el código, "encargos". Esta herramienta solo arma la
tarjeta: el pendiente se crea en Rust (`slices/encargos`) cuando el usuario la aprueba.
Diseño: claude/diseno-encargos.md.
"""

from __future__ import annotations

import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple

from slices.agent_tools.system_capabilities import system_capabilities
from slices.task_ui.schemas import sanitize_task_proposal

MAX_NAME_CHARS = 80
MAX_STEPS = 20
MAX_FILES = 10
RECURRENCES = ("Una vez", "Diario", "Semanal", "Mensual")

# Copia de `BLOCKED_FINAL_ACTION_PHRASES` (src-tauri/src/slices/encargos/store.rs), que es la que
# manda: aquí solo sirve para avisar al modelo antes de mostrarle la tarjeta al usuario.
BLOCKED_FINAL_ACTION_PHRASES = (
    "pagar",
    "pay",
    "comprar",
    "buy",
    "transferir",
    "transfer",
    "eliminar",
    "borrar",
    "delete",
    "remove",
    "vaciar papelera",
    "empty trash",
)

_WEEKDAYS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
_MONTHS = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")

ENCARGO_TOOL_DEFS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "encargo_schedule",
            "description": (
                "Programa un pendiente: algo que TÚ harás solo a una hora, sin que el usuario esté presente "
                "(ej. 'entrega este PDF a las 4 en Teams', 'a las 9 genera el reporte y súbelo'). Crea una tarjeta "
                "que el usuario aprueba; nada se programa sin su aprobación. Úsala en lugar de `propose_tasks` con "
                "`schedule_event` cuando el usuario pide que hagas algo a una hora; si solo quiere que le avises, usa "
                "un recordatorio de Agenda. `may_finish`=true solo si el usuario dijo que lo termines (entrégalo, "
                "envíalo); si solo dijo 'súbelo' o hay duda, pregunta con `ask_clarification`. Si hay que generar un "
                "archivo, genéralo antes (`pdf_generate` u `office_generate`) y pásalo en `files`."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Nombre corto y claro que tú eliges, ej. 'Práctica 3 · Física'.",
                    },
                    "when": {
                        "type": "string",
                        "description": (
                            "Fecha y hora local 'YYYY-MM-DDTHH:MM', calculada desde la FECHA Y HORA LOCAL ACTUAL."
                        ),
                    },
                    "instruction": {
                        "type": "string",
                        "description": "Lo que pidió el usuario, con sus palabras.",
                    },
                    "steps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Pasos que seguirás, en lenguaje claro (3 a 8), ej. 'Abrir Teams', 'Adjuntar reporte.pdf'.",
                    },
                    "target_app": {
                        "type": "string",
                        "description": "App que usarás, ej. 'Microsoft Teams'. Omítela si no hace falta usar otra app.",
                    },
                    "files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Rutas dentro del espacio de trabajo de los archivos que usarás.",
                    },
                    "may_finish": {
                        "type": "boolean",
                        "description": "true solo si el usuario pidió que des el último clic (Entregar, Enviar).",
                    },
                    "final_action": {
                        "type": "string",
                        "description": "El último clic cuando may_finish es true, ej. 'Entregar · Práctica 3'.",
                    },
                    "recurrence": {
                        "type": "string",
                        "enum": list(RECURRENCES),
                        "description": "Si se repite. Por defecto 'Una vez'.",
                    },
                },
                "required": ["name", "when", "instruction", "steps", "may_finish"],
            },
        },
    },
]


def _fold(raw: str) -> str:
    norm = unicodedata.normalize("NFD", str(raw or ""))
    norm = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", norm).strip()


def _slug(raw: str) -> str:
    return _fold(raw).replace(" ", "-")[:40].strip("-") or "pendiente"


def blocked_final_action_phrase(raw: str) -> Optional[str]:
    padded = f" {_fold(raw)} "
    return next((p for p in BLOCKED_FINAL_ACTION_PHRASES if f" {p} " in padded), None)


def parse_when(raw: str) -> datetime:
    """Interpreta la hora del modelo como hora local del sistema si no trae zona horaria."""
    dt = datetime.fromisoformat(str(raw).strip())
    return dt.astimezone()


def when_label(when: datetime, now: datetime) -> str:
    hhmm = when.strftime("%H:%M")
    days = (when.date() - now.date()).days
    if days == 0:
        return f"Hoy {hhmm}"
    if days == 1:
        return f"Mañana {hhmm}"
    return f"{_WEEKDAYS[when.weekday()]} {when.day} {_MONTHS[when.month - 1]} {hhmm}"


def _str_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if isinstance(v, (str, int, float)) and str(v).strip()]


def build_encargo_proposal(
    args: Dict[str, Any],
    *,
    resolve_file: Callable[[str], str],
    now: Optional[datetime] = None,
    platform: str = sys.platform,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """
    Valida los argumentos y arma la tarjeta del pendiente.
    `resolve_file` recibe una ruta y devuelve su forma limpia dentro del workspace, o lanza `ValueError`.
    Devuelve `(resultado_para_el_modelo, tarjeta)`; la tarjeta es `None` si algo no es válido.
    """
    now = (now or datetime.now()).astimezone()

    def fail(msg: str) -> Tuple[Dict[str, Any], None]:
        return {"ok": False, "status": "validation_error", "error": msg}, None

    name = str(args.get("name") or "").strip()[:MAX_NAME_CHARS]
    instruction = str(args.get("instruction") or "").strip()
    steps = _str_list(args.get("steps"))[:MAX_STEPS]
    if not name or not instruction:
        return fail("Faltan 'name' o 'instruction'.")
    if not steps:
        return fail("Falta 'steps': escribe los pasos que seguirás, en lenguaje claro.")

    try:
        when = parse_when(str(args.get("when") or ""))
    except ValueError:
        return fail("'when' debe ser fecha y hora local 'YYYY-MM-DDTHH:MM'.")
    if when <= now + timedelta(minutes=1):
        return fail(f"La hora {when.strftime('%Y-%m-%d %H:%M')} ya pasó o es demasiado pronto. Pregunta al usuario otra hora.")
    if when > now + timedelta(days=366):
        return fail("Un pendiente se puede programar hasta con un año de anticipación.")

    recurrence = str(args.get("recurrence") or "Una vez").strip()
    if recurrence not in RECURRENCES:
        recurrence = "Una vez"

    target_app = str(args.get("target_app") or "").strip()
    if target_app and "desktop_control" not in system_capabilities(platform):
        return fail(
            "En este sistema todavía no puedo usar otras apps por mi cuenta. Ofrece al usuario un recordatorio "
            "o dejar listos los archivos."
        )

    raw_files = _str_list(args.get("files"))
    if len(raw_files) > MAX_FILES:
        return fail(f"Un pendiente admite hasta {MAX_FILES} archivos.")
    files: List[str] = []
    for raw in raw_files:
        try:
            files.append(resolve_file(raw))
        except ValueError as exc:
            return fail(str(exc))

    may_finish = bool(args.get("may_finish"))
    final_action = str(args.get("final_action") or "").strip()
    if may_finish:
        if not final_action:
            return fail("Con may_finish=true falta 'final_action', ej. 'Entregar · Práctica 3'.")
        phrase = blocked_final_action_phrase(final_action)
        if phrase:
            return fail(
                f"No puedo '{phrase}' por mi cuenta. Ofrece dejarlo listo para que el usuario dé el último clic."
            )

    label = when_label(when, now)
    finish_text = f"Lo dejaré hecho: {final_action}" if may_finish else "Lo dejaré listo, sin el último clic"
    when_text = label if recurrence == "Una vez" else f"{label} · {recurrence}"
    rows = [{"label": "Cuándo", "value": when_text}]
    if target_app:
        rows.append({"label": "App", "value": target_app})
    if files:
        rows.append({"label": "Archivos", "value": ", ".join(f.rsplit("/", 1)[-1] for f in files)})
    rows.append({"label": "Al final", "value": finish_text})

    slug = _slug(name)
    card_id = f"encargo_{int(time.time())}_{slug[:20]}"
    proposal = sanitize_task_proposal({
        "cardId": card_id,
        "dedupKey": f"encargo:{slug}:{when.isoformat()}",
        "title": name,
        "subtitle": finish_text,
        "category": "agenda",
        "urgency": "media",
        "statusChip": label,
        "defaultExpanded": True,
        "generatedBy": "Xox · Pendientes",
        "blocks": [
            {"type": "kv_list", "rows": rows},
            {"type": "note", "content": "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))},
            {"type": "insight", "text": instruction, "source": "Tu instrucción"},
        ],
        "intent": {"type": "schedule_encargo", "targetLabel": name, "primaryLabel": "Programar"},
        "paramValues": {},
        "stagingPayload": {
            "kind": "encargo",
            "name": name,
            "instruction": instruction,
            "steps": steps,
            "files": files,
            "nextRunAt": when.isoformat(),
            "recurrence": recurrence,
            "targetApp": target_app or None,
            "mayFinish": may_finish,
            "finalAction": final_action if may_finish else None,
        },
    })
    return {
        "ok": True,
        "staged_card_id": card_id,
        "when": label,
        "message": (
            "Tarjeta lista para que el usuario la apruebe. Dile en una frase qué harás, a qué hora y si lo dejarás "
            "terminado o listo sin el último clic."
        ),
    }, proposal
