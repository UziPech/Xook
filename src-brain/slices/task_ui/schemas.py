"""
Contrato declarativo de UI Generativa segura (Zero-Trust) para el motor Python de XOOK.
Refleja 1:1 el esquema TypeScript en `src-ui/features/task-decisions/taskSchema.ts`.
"""

from dataclasses import dataclass, field
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
        if isinstance(blk, dict) and blk.get("type") in ALLOWED_BLOCK_TYPES:
            safe_blocks.append(blk)

    return {
        "cardId": str(raw.get("cardId", "card_gen_01")),
        "title": str(raw.get("title", "Propuesta de acción")),
        "subtitle": raw.get("subtitle"),
        "category": category,
        "urgency": urgency,
        "statusChip": raw.get("statusChip"),
        "defaultExpanded": bool(raw.get("defaultExpanded", False)),
        "generatedBy": raw.get("generatedBy"),
        "blocks": safe_blocks,
        "intent": dict(raw.get("intent", {})),
        "paramValues": dict(raw.get("paramValues", {})),
    }

