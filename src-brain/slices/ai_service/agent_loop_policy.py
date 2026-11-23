"""
Reglas del loop del agente que no dependen del proveedor.

Presupuesto: en vez de un tope fijo de 12 rondas, el loop sigue mientras queden
rondas, tiempo y tokens. Cuando algo se agota, o el modelo repite la misma ronda
sin avanzar, la siguiente ronda es la final: sin herramientas y con la instrucción
de entregar lo que tiene y decir qué quedó pendiente. Así una investigación larga
no se corta a medias ni termina con una respuesta vacía.

Verificación antes de entregar: el resultado de una herramienta que produce un
entregable (documento o archivo) le pide al modelo comparar lo producido con cada
instrucción del usuario, incluido lo que pidió no incluir, antes de responder.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, Iterator, Optional, Tuple


@dataclass(frozen=True)
class BudgetLimits:
    max_rounds: int
    max_seconds: float
    max_tokens: int
    subagent_rounds: int


# `standard` duplica el tope anterior de 12 rondas. `extended` es para las tareas que
# el router clasifica como `deep_analysis` (investigación, auditoría, análisis largo).
BUDGET_PROFILES: Dict[str, BudgetLimits] = {
    "standard": BudgetLimits(max_rounds=24, max_seconds=300.0, max_tokens=600_000, subagent_rounds=5),
    "extended": BudgetLimits(max_rounds=60, max_seconds=900.0, max_tokens=2_000_000, subagent_rounds=10),
}

# Rondas seguidas con las mismas herramientas y los mismos argumentos que se toleran
# antes de dar al agente por atascado.
STUCK_REPEAT_THRESHOLD = 3


def budget_profile_for_task(task_kind: str) -> str:
    return "extended" if task_kind == "deep_analysis" else "standard"


def _round_signature(tool_calls: Iterable[Any]) -> str:
    parts = []
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        raw_args = fn.get("arguments")
        if isinstance(raw_args, str):
            try:
                raw_args = json.loads(raw_args)
            except ValueError:
                pass
        parts.append(f"{fn.get('name') or ''}:{json.dumps(raw_args, sort_keys=True, ensure_ascii=False, default=str)}")
    return "|".join(sorted(parts))


class AgentBudget:
    """Decide cuántas rondas corre el loop y cuál es la final."""

    def __init__(self, limits: BudgetLimits, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.limits = limits
        self._clock = clock
        self._started = clock()
        self._last_signature = ""
        self._repeat_count = 0
        # Por qué se forzó la ronda final; `None` mientras el agente termine solo.
        self.stop_reason: Optional[str] = None

    def _reason_to_wrap_up(self, round_idx: int, tokens_used: int) -> Optional[str]:
        if self._repeat_count >= STUCK_REPEAT_THRESHOLD:
            return "stuck"
        if self._clock() - self._started >= self.limits.max_seconds:
            return "time"
        if tokens_used >= self.limits.max_tokens:
            return "tokens"
        if round_idx >= self.limits.max_rounds - 1:
            return "rounds"
        return None

    def rounds(self, tokens_used: Callable[[], int]) -> Iterator[Tuple[int, bool]]:
        """Da `(round_idx, is_final)`. Después de una ronda final no da más."""
        for round_idx in range(self.limits.max_rounds):
            reason = self._reason_to_wrap_up(round_idx, tokens_used())
            if reason is not None:
                self.stop_reason = reason
                yield round_idx, True
                return
            yield round_idx, False

    def record_tool_round(self, tool_calls: Iterable[Any]) -> None:
        signature = _round_signature(tool_calls)
        if signature and signature == self._last_signature:
            self._repeat_count += 1
        else:
            self._repeat_count = 1 if signature else 0
        self._last_signature = signature


def wrap_up_step_label(reason: str, limits: BudgetLimits) -> str:
    if reason == "stuck":
        return "Cerrando: la misma acción se repetía sin avanzar"
    if reason == "time":
        return f"Cerrando: se cumplió el tiempo máximo ({int(limits.max_seconds // 60)} min)"
    if reason == "tokens":
        return "Cerrando: se alcanzó el máximo de tokens de la tarea"
    return f"Cerrando: se alcanzó el máximo de pasos ({limits.max_rounds})"


def wrap_up_nudge(reason: str) -> str:
    why = {
        "stuck": "repetiste la misma acción varias veces sin avanzar",
        "time": "se cumplió el tiempo máximo de esta tarea",
        "tokens": "se alcanzó el máximo de tokens de esta tarea",
        "rounds": "se alcanzó el máximo de pasos de esta tarea",
    }.get(reason, "se agotó el presupuesto de esta tarea")
    return (
        f"Cierre de la tarea: {why}. No llames más herramientas. Entrega ahora tu mejor respuesta "
        "con lo que ya averiguaste o hiciste, di con claridad qué quedó pendiente y qué haría falta "
        "para terminarlo."
    )


DELIVERABLE_TOOLS = frozenset({
    "office_generate",
    "pdf_generate",
    "workspace_write_file",
    "workspace_edit_file",
})

DELIVERY_CHECK_NOTE = (
    "Antes de responder, compara lo que produjiste con cada instrucción del usuario en esta "
    "conversación, incluido lo que pidió no incluir o quitar. Si algo no se cumple, corrígelo ahora "
    "con otra llamada y no lo reportes como hecho. Si todo se cumple, responde sin mencionar esta revisión."
)


def with_delivery_check(tool_name: str, tool_res: Any) -> Any:
    """Agrega el recordatorio de verificación al resultado de un entregable exitoso."""
    if tool_name not in DELIVERABLE_TOOLS or not isinstance(tool_res, dict) or not tool_res.get("ok"):
        return tool_res
    return {**tool_res, "verificar_antes_de_entregar": DELIVERY_CHECK_NOTE}
