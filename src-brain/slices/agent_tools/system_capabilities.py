"""
Capacidades del sistema operativo donde corre XOOK.

Las herramientas que dependen de APIs nativas solo se le ofrecen al modelo si el sistema las
soporta: así el agente no promete ni intenta lo que el equipo no puede hacer. La fuente de
verdad son los `cfg(target_os)` de `src-tauri/src/slices/`; si un slice gana soporte para otro
sistema, se agrega aquí.
"""

from __future__ import annotations

import sys
from typing import Any, Dict, FrozenSet, List, Sequence, Set


# Capacidad -> herramientas que la necesitan (slice de Rust que la implementa).
CAPABILITY_TOOLS: Dict[str, FrozenSet[str]] = {
    # Accesibilidad + CGEvent (`desktop_control`, `window_assist`).
    "desktop_control": frozenset(
        {"desktop_list_windows", "desktop_snapshot", "desktop_find", "desktop_act", "desktop_mark_risky_button"}
    ),
    # Búsqueda y apertura de apps instaladas (`app_launcher`).
    "app_launcher": frozenset({"list_desktop_apps", "open_desktop_app"}),
    # Lectura de pantalla con helper nativo (`screen_context`).
    "screen_reading": frozenset({"read_screen_now", "query_screen_memory"}),
    # Notas y Calendario por JXA (`env_actions`).
    "notes_calendar": frozenset({"os_list_notes", "os_create_note", "os_list_calendar_events", "os_create_calendar_event"}),
}

# `sys.platform` -> capacidades disponibles. Un sistema no listado no tiene ninguna.
PLATFORM_CAPABILITIES: Dict[str, FrozenSet[str]] = {
    "darwin": frozenset(CAPABILITY_TOOLS),
    "win32": frozenset(),
    "linux": frozenset(),
}


def system_capabilities(platform: str = sys.platform) -> FrozenSet[str]:
    return PLATFORM_CAPABILITIES.get(platform, frozenset())


def unavailable_tools(platform: str = sys.platform) -> Set[str]:
    available = system_capabilities(platform)
    return {tool for cap, tools in CAPABILITY_TOOLS.items() if cap not in available for tool in tools}


def filter_tool_defs_for_system(tool_defs: Sequence[Dict[str, Any]], platform: str = sys.platform) -> List[Dict[str, Any]]:
    blocked = unavailable_tools(platform)
    return [td for td in tool_defs if str((td.get("function") or {}).get("name") or "") not in blocked]
