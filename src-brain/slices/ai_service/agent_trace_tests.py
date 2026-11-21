from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

BRAIN_DIR = Path(__file__).resolve().parents[2]
if str(BRAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BRAIN_DIR))

from slices.ai_service.agent_trace import AgentTraceWriter


class AgentTraceWriterTests(unittest.TestCase):
    def test_writes_meta_and_redacts_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            secret = "sk-or-v1-supersecretkey1234567890"
            writer = AgentTraceWriter(ws, session_id="conv/test 1", active_secrets=[secret])
            self.assertIsNotNone(writer.file_path)
            writer.record_turn_start(
                mode="agent",
                scope="chat",
                provider="openrouter",
                model="anthropic/claude-sonnet-4",
                history_count=6,
                has_checkpoint=False,
                user_preview=f"Usa la clave {secret} para probar",
            )
            writer.record_tool_result(
                round_idx=0,
                tool_call_id="tc_1",
                tool="workspace_read",
                target="empresa/perfil.json",
                ok=True,
                duration_ms=15,
                output_chars=400,
                disposition={"delivery": "delivered_verified", "retry": "safe", "verified": True},
            )
            assert writer.file_path is not None
            lines = writer.file_path.read_text(encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 3)
            meta = json.loads(lines[0])
            self.assertEqual(meta["type"], "trace.meta")
            self.assertEqual(meta["schema"], 1)
            start_ev = json.loads(lines[1])
            self.assertNotIn(secret, start_ev["user_preview"])
            self.assertIn("[REDACTED_API_KEY]", start_ev["user_preview"])
            tool_ev = json.loads(lines[2])
            self.assertEqual(tool_ev["disposition"]["delivery"], "delivered_verified")


if __name__ == "__main__":
    unittest.main()
