from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

BRAIN_DIR = Path(__file__).resolve().parents[2]
if str(BRAIN_DIR) not in sys.path:
    sys.path.insert(0, str(BRAIN_DIR))

from slices.ai_service.context_manager import (
    build_turn_working_memory,
    compact_turns_to_checkpoint,
    format_checkpoint_for_prompt,
    format_subagent_handoff,
    maybe_auto_compact_turns,
    prune_tool_loop_messages_with_stats,
)
from slices.ai_service import openrouter_client


class ContextManagerTests(unittest.TestCase):
    def test_llm_compaction_marks_llm_method_and_merges_artifacts(self) -> None:
        turns = [
            {"role": "user", "content": "Revisa src-brain/slices/ai_service/context_manager.py y arregla la pérdida de contexto."},
            {"role": "assistant", "content": "Revisé context_manager.py y encontré el fallback silencioso."},
            {"role": "user", "content": "Mejor usa npm workspaces en package.json y agrega packages/contracts/src/agentTrace.ts."},
            {"role": "assistant", "content": "De acuerdo, usaremos npm workspaces con packages/contracts/src/agentTrace.ts."},
        ]

        def fake_llm(_msgs):
            return json.dumps(
                {
                    "objective": "Corregir pérdida de contexto y estructurar monorepo",
                    "active_decisions": ["Usar npm workspaces", "Crear packages/contracts"],
                    "superseded_discarded": ["Solo mantener archivo monolítico"],
                    "active_artifacts": ["packages/contracts/src/agentTrace.ts"],
                    "document_state": "Fase 1 lista para pruebas",
                    "pending_items": ["Correr unittest y tsc"],
                    "summary": "Plan acordado para corregir compactación y agregar inspector.",
                },
                ensure_ascii=False,
            )

        ckpt = compact_turns_to_checkpoint(turns, scope="chat", call_llm_fn=fake_llm)
        self.assertEqual(ckpt["compaction_method"], "llm")
        self.assertNotIn("fallback_reason", ckpt)
        self.assertIn("packages/contracts/src/agentTrace.ts", ckpt["active_artifacts"])
        self.assertIn("src-brain/slices/ai_service/context_manager.py", ckpt["active_artifacts"])
        prompt_block = format_checkpoint_for_prompt(ckpt, scope="chat")
        self.assertIn("Archivos, rutas y artefactos clave", prompt_block)

    def test_llm_compaction_failure_records_explicit_fallback_reason(self) -> None:
        turns = [
            {"role": "user", "content": "Analiza src-ui/App.tsx línea por línea"},
            {"role": "assistant", "content": "Encontré 3 problemas en src-ui/App.tsx."},
        ]

        def broken_llm(_msgs):
            raise RuntimeError("HTTP 503 overloaded")

        ckpt = compact_turns_to_checkpoint(turns, scope="chat", call_llm_fn=broken_llm)
        self.assertEqual(ckpt["compaction_method"], "deterministic_fallback")
        self.assertIn("RuntimeError: HTTP 503 overloaded", ckpt.get("fallback_reason", ""))
        self.assertIn("src-ui/App.tsx", ckpt["active_artifacts"])

    def test_auto_compact_thresholds_scale_with_model_context_window(self) -> None:
        # 16 turns (8 exchanges): should NOT trigger premature compaction on a 200k model
        turns_16 = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"Mensaje breve #{i} sobre arquitectura."}
            for i in range(16)
        ]
        kept, ckpt, evt = maybe_auto_compact_turns(
            turns_16,
            scope="chat",
            model_context_window=200_000,
            call_llm_fn=None,
        )
        self.assertIsNone(evt)
        self.assertIsNone(ckpt)
        self.assertEqual(len(kept), 16)

        # On a small 32k model, 16 turns DOES trigger compaction (min_turns=14, keep_recent=6)
        kept_sm, ckpt_sm, evt_sm = maybe_auto_compact_turns(
            turns_16,
            scope="chat",
            model_context_window=32_000,
            call_llm_fn=None,
        )
        self.assertIsNotNone(evt_sm)
        self.assertIsNotNone(ckpt_sm)
        self.assertEqual(len(kept_sm), 6)

    def test_prune_tool_loop_protects_last_four_and_preserves_semantic_digest(self) -> None:
        big_code = "# Arquitectura XOOK\n\ndef compute_budget():\n    return 42\n" + ("x = 1\n" * 2000)
        loop_msgs = [{"role": "system", "content": "sys"}, {"role": "user", "content": "Compara 5 archivos"}]
        for i in range(5):
            tc_id = f"call_{i}"
            path = f"src/file_{i}.py"
            loop_msgs.append(
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"id": tc_id, "type": "function", "function": {"name": "workspace_read", "arguments": json.dumps({"path": path})}}
                    ],
                }
            )
            loop_msgs.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": json.dumps({"ok": True, "path": path, "content": big_code}, ensure_ascii=False),
                }
            )

        pruned, stats = prune_tool_loop_messages_with_stats(loop_msgs)
        # Only the oldest (index 0 of 5) should be pruned; last 4 stay untouched
        self.assertEqual(stats["pruned_count"], 1)
        first_tool_body = json.loads(pruned[3]["content"])
        self.assertIn("_compacted_prev_tool_output", first_tool_body)
        self.assertIn("def compute_budget():", first_tool_body.get("key_symbols_or_headings", []))
        self.assertGreater(first_tool_body.get("line_count", 0), 1000)
        # The 2nd tool output (among last 4) must remain full content
        second_tool_body = json.loads(pruned[5]["content"])
        self.assertNotIn("_compacted_prev_tool_output", second_tool_body)

    def test_working_memory_and_subagent_handoff(self) -> None:
        wm = build_turn_working_memory(
            [
                {"tool": "workspace_read", "target": "src-ui/App.tsx", "ok": True, "summary": "ok"},
                {"tool": "workspace_edit_file", "target": "src-brain/main_sidecar.py", "ok": True, "summary": "editado"},
                {"tool": "run_workspace_command", "target": "pytest", "ok": True, "summary": "pytest (exit 0)"},
            ],
            [{"name": "Auditor", "role": "Seguridad", "ok": True, "summary": "Sin fugas de secretos"}],
        )
        assert wm is not None
        self.assertIn("src-ui/App.tsx", wm["files_read"])
        self.assertIn("src-brain/main_sidecar.py", wm["files_modified"])
        self.assertIn("Auditor", wm["compact_note"])

        handoff = format_subagent_handoff(
            checkpoint_block="CHECKPOINT: objetivo refactor",
            recent_history=[
                {"role": "user", "content": "Audita la compactación"},
                {"role": "assistant", "content": "Voy a revisar el código"},
            ],
            turn_tool_records=[{"tool": "workspace_read", "target": "context_manager.py", "ok": True, "summary": "ok"}],
        )
        self.assertIn("CHECKPOINT: objetivo refactor", handoff)
        self.assertIn("Audita la compactación", handoff)
        self.assertIn("context_manager.py", handoff)

    def test_make_compact_llm_caller_uses_valid_signatures_for_openai_and_anthropic(self) -> None:
        captured_http = {}

        def fake_provider_http(provider, url, method="GET", api_key=None, payload=None, timeout=45):
            captured_http["provider"] = provider
            captured_http["url"] = url
            captured_http["method"] = method
            captured_http["api_key"] = api_key
            captured_http["payload"] = payload
            return {"choices": [{"message": {"content": '{"objective":"ok","summary":"ok"}'}}]}

        with patch.object(openrouter_client, "_provider_http_json", side_effect=fake_provider_http):
            caller = openrouter_client._make_compact_llm_caller(
                "openai", "sk-proj-testkey123456", "gpt-5-mini"
            )
            assert caller is not None
            out = caller([{"role": "system", "content": "s"}, {"role": "user", "content": "u"}])
            self.assertIn('"objective":"ok"', out)
            self.assertEqual(captured_http["provider"], "openai")
            self.assertEqual(captured_http["method"], "POST")
            self.assertIn("max_completion_tokens", captured_http["payload"])

        captured_ant = {}

        def fake_anthropic(api_key, openai_payload, timeout=60):
            captured_ant["api_key"] = api_key
            captured_ant["payload"] = openai_payload
            return {"choices": [{"message": {"content": '{"objective":"ant_ok","summary":"ok"}'}}]}

        with patch.object(openrouter_client, "anthropic_chat_completion", side_effect=fake_anthropic):
            caller_ant = openrouter_client._make_compact_llm_caller(
                "anthropic", "sk-ant-testkey123456", "claude-sonnet-4-20250514"
            )
            assert caller_ant is not None
            out_ant = caller_ant([{"role": "system", "content": "s"}, {"role": "user", "content": "u"}])
            self.assertIn("ant_ok", out_ant)
            self.assertEqual(captured_ant["api_key"], "sk-ant-testkey123456")
            self.assertEqual(captured_ant["payload"]["model"], "claude-sonnet-4-20250514")


if __name__ == "__main__":
    unittest.main()
