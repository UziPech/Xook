from __future__ import annotations

import sys
import unittest
from pathlib import Path

BRAIN_DIR = Path(__file__).resolve().parents[2]
if str(BRAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BRAIN_DIR))

from slices.agent_tools.toolkit import compute_tool_disposition


class ToolDispositionTests(unittest.TestCase):
    def test_read_only_failure_is_not_delivered_and_safe(self) -> None:
        disp = compute_tool_disposition("workspace_read", {"ok": False, "error": "Archivo no encontrado"})
        self.assertEqual(disp["delivery"], "not_delivered")
        self.assertEqual(disp["retry"], "safe")

    def test_successful_mutation_is_verified_and_unsafe_to_repeat(self) -> None:
        disp = compute_tool_disposition("workspace_write_file", {"ok": True, "path": "agente/nota.md"})
        self.assertEqual(disp["delivery"], "delivered_verified")
        self.assertEqual(disp["retry"], "unsafe")

    def test_blocked_mutation_is_not_delivered(self) -> None:
        disp = compute_tool_disposition(
            "run_workspace_command",
            {"ok": False, "status": "denied", "error": "Bloqueado por Guardián"},
        )
        self.assertEqual(disp["delivery"], "not_delivered")
        self.assertEqual(disp["retry"], "safe")

    def test_timed_out_command_is_delivered_unverified(self) -> None:
        disp = compute_tool_disposition(
            "run_workspace_command",
            {"ok": False, "error": "Tiempo límite agotado (60s)"},
        )
        self.assertEqual(disp["delivery"], "delivered_unverified")
        self.assertEqual(disp["retry"], "verify_first")


if __name__ == "__main__":
    unittest.main()
