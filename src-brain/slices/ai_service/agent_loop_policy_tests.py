"""
Tests del presupuesto del loop y de la verificación antes de entregar.

Los de integración corren los loops reales (síncrono y stream) contra un `urlopen` falso
que hace de modelo; ninguna prueba sale a internet.
"""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import patch

from slices.ai_service import openrouter_client as oc
from slices.ai_service.agent_loop_policy import (
    DELIVERY_CHECK_NOTE,
    STUCK_REPEAT_THRESHOLD,
    AgentBudget,
    BudgetLimits,
    budget_profile_for_task,
    with_delivery_check,
)
from slices.ai_service.model_router import clear_router_runtime_state
from slices.ai_service.provider_requests_tests import CATALOG, FINAL, _FakeResponse, _openai_sse

LIMITS = BudgetLimits(max_rounds=10, max_seconds=60.0, max_tokens=1000, subagent_rounds=3)


def _call(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class AgentBudgetTests(unittest.TestCase):
    def test_last_round_is_final_when_rounds_run_out(self) -> None:
        budget = AgentBudget(LIMITS)
        rounds = list(budget.rounds(lambda: 0))
        self.assertEqual(len(rounds), LIMITS.max_rounds)
        self.assertEqual([final for _, final in rounds].count(True), 1)
        self.assertEqual(rounds[-1], (LIMITS.max_rounds - 1, True))
        self.assertEqual(budget.stop_reason, "rounds")

    def test_agent_that_finishes_alone_has_no_stop_reason(self) -> None:
        budget = AgentBudget(LIMITS)
        for round_idx, _ in budget.rounds(lambda: 0):
            if round_idx == 2:
                break
        self.assertIsNone(budget.stop_reason)

    def test_time_runs_out(self) -> None:
        clock = _FakeClock()
        budget = AgentBudget(LIMITS, clock=clock)
        seen = []
        for _, final in budget.rounds(lambda: 0):
            seen.append(final)
            clock.now += 25.0
        self.assertEqual(seen, [False, False, False, True])
        self.assertEqual(budget.stop_reason, "time")

    def test_tokens_run_out(self) -> None:
        used = {"tokens": 0}
        budget = AgentBudget(LIMITS)
        seen = []
        for _, final in budget.rounds(lambda: used["tokens"]):
            seen.append(final)
            used["tokens"] += 400
        self.assertEqual(seen, [False, False, False, True])
        self.assertEqual(budget.stop_reason, "tokens")

    def test_repeating_the_same_round_wraps_up(self) -> None:
        budget = AgentBudget(LIMITS)
        seen = []
        for _, final in budget.rounds(lambda: 0):
            seen.append(final)
            # Mismos argumentos en otro orden de claves: cuenta como la misma ronda.
            args = {"path": ".", "depth": 1} if len(seen) % 2 else {"depth": 1, "path": "."}
            budget.record_tool_round([_call("workspace_list", args)])
        self.assertEqual(len(seen), STUCK_REPEAT_THRESHOLD + 1)
        self.assertTrue(seen[-1])
        self.assertEqual(budget.stop_reason, "stuck")

    def test_alternating_rounds_are_progress(self) -> None:
        # Un flujo de escritorio alterna actuar y leer la pantalla: no es estar atascado.
        budget = AgentBudget(LIMITS)
        calls = [
            [_call("desktop_act", {"ref": "e1", "action": "click"})],
            [_call("read_screen_now", {})],
        ]
        for round_idx, final in budget.rounds(lambda: 0):
            budget.record_tool_round(calls[round_idx % 2])
        self.assertEqual(budget.stop_reason, "rounds")

    def test_deep_analysis_gets_the_extended_profile(self) -> None:
        self.assertEqual(budget_profile_for_task("deep_analysis"), "extended")
        for kind in ("agent_execution", "canvas_tabular", "fast_chat", ""):
            self.assertEqual(budget_profile_for_task(kind), "standard")


class DeliveryCheckTests(unittest.TestCase):
    def test_successful_deliverable_gets_the_note(self) -> None:
        res = with_delivery_check("office_generate", {"ok": True, "path": "agente/x.docx"})
        self.assertEqual(res["verificar_antes_de_entregar"], DELIVERY_CHECK_NOTE)
        self.assertEqual(res["path"], "agente/x.docx")

    def test_failures_and_other_tools_are_untouched(self) -> None:
        failed = {"ok": False, "error": "x"}
        self.assertIs(with_delivery_check("pdf_generate", failed), failed)
        read = {"ok": True, "content": "..."}
        self.assertIs(with_delivery_check("workspace_read", read), read)


class _RepeatingModel:
    """Modelo falso: mientras le ofrezcan herramientas, repite la misma llamada."""

    def __init__(self, first_call: Optional[Dict[str, Any]] = None, repeat: bool = True) -> None:
        self.requests: List[Dict[str, Any]] = []
        self._first_call = first_call
        self._repeat = repeat

    def _next_call(self, body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not body.get("tools"):
            return None
        if self._first_call is not None:
            call, self._first_call = self._first_call, None
            return call
        return _call("workspace_list", {"path": "."}) if self._repeat else None

    def __call__(self, req: urllib.request.Request, timeout: Any = None, context: Any = None) -> _FakeResponse:
        body = json.loads(req.data.decode("utf-8")) if req.data else {}
        self.requests.append(body)
        call = self._next_call(body)
        if body.get("stream"):
            if call is None:
                return _FakeResponse(lines=_openai_sse({"choices": [{"delta": {"content": FINAL}, "finish_reason": "stop"}]}))
            return _FakeResponse(lines=_openai_sse(
                {"choices": [{"delta": {"tool_calls": [{"index": 0, **call}]}, "finish_reason": "tool_calls"}]}))
        if call is None:
            message: Dict[str, Any] = {"role": "assistant", "content": FINAL}
        else:
            message = {"role": "assistant", "content": "", "tool_calls": [call]}
        return _FakeResponse({"choices": [{"message": message, "finish_reason": "stop"}],
                              "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model": body.get("model")})


class AgentLoopBudgetIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_router_runtime_state()
        self._tmp = tempfile.TemporaryDirectory(prefix="xook_loop_budget_")
        ws = Path(self._tmp.name)
        (ws / "empresa").mkdir()
        (ws / "habilidades").mkdir()
        self.common = dict(user_message="Revisa qué archivos tengo", history=[], context_dir=ws / "empresa",
                           skills_dir=ws / "habilidades", workspace_root=str(ws), auto_failover=False,
                           api_key="sk-deepseektest1234567890", model_id="deepseek-chat", provider="deepseek")

    def tearDown(self) -> None:
        clear_router_runtime_state()
        self._tmp.cleanup()

    def _run(self, path: str, model: _RepeatingModel) -> List[Dict[str, Any]]:
        with patch.object(urllib.request, "urlopen", side_effect=model), \
                patch.object(oc, "list_openrouter_models", return_value=CATALOG):
            if path == "loop":
                oc.run_agent_completion(**self.common)
            else:
                oc.stream_agent_completion(emit_event=lambda _ev: None, **self.common)
        return [b for b in model.requests if "messages" in b]

    def test_stuck_agent_wraps_up_without_tools(self) -> None:
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                reqs = self._run(path, _RepeatingModel())
                self.assertEqual(len(reqs), STUCK_REPEAT_THRESHOLD + 1)
                self.assertTrue(all(r.get("tools") for r in reqs[:-1]))
                self.assertFalse(reqs[-1].get("tools"))
                last_user = [m.get("content") for m in reqs[-1]["messages"] if m.get("role") == "user"][-1]
                self.assertIn("Cierre de la tarea", str(last_user))

    def test_deliverable_result_asks_to_verify_before_answering(self) -> None:
        write = _call("workspace_write_file", {"path": "agente/nota.md", "content": "Hola"})
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                reqs = self._run(path, _RepeatingModel(first_call=write, repeat=False))
                self.assertEqual(len(reqs), 2)
                tool_msgs = [m for m in reqs[1]["messages"] if m.get("role") == "tool"]
                self.assertEqual(len(tool_msgs), 1)
                result = json.loads(tool_msgs[0]["content"])
                self.assertTrue(result.get("ok"), result)
                self.assertEqual(result.get("verificar_antes_de_entregar"), DELIVERY_CHECK_NOTE)


if __name__ == "__main__":
    unittest.main()
