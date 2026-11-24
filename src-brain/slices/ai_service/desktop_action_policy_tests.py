"""
Tests de que Xox actúe en otras apps en vez de rendirse.

Los de integración reproducen la conversación real del 2026-11-23: un modelo que contesta "no tengo
acceso a Teams" sin llamar ninguna herramienta. Corren los loops reales (síncrono y stream) contra un
`urlopen` falso; ninguna prueba sale a internet ni toca el escritorio.
"""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import patch

from slices.ai_service import openrouter_client as oc
from slices.ai_service.desktop_action_policy import (
    DESKTOP_RETRY_NUDGE,
    FIRST_LOOK_CHARS,
    OPENING_CHARS,
    ReplyHold,
    attempted_desktop,
    desktop_action_rules,
    gave_up_on_desktop,
)
from slices.agent_tools.system_capabilities import system_capabilities
from slices.ai_service.model_router import clear_router_runtime_state
from slices.ai_service.provider_requests_tests import CATALOG, _FakeResponse, _openai_sse

ASK_TEAMS = "revisame si en teams tengo algunas tareas pendientes"
REFUSAL_TEAMS = (
    "No tengo acceso directo a tu cuenta de Microsoft Teams, así que no puedo entrar a revisar tus tareas "
    "pendientes desde aquí.\n\nTengo un par de opciones para ayudarte:\n\n"
    "1. **Si tienes Teams abierto**, puedo leer lo que se muestra con `read_screen_now`."
)
REFUSAL_CLAUDE = (
    "No soy Claude, soy **Xox**, el agente de XOOK. Y no puedo abrir ni controlar otras aplicaciones (como Teams "
    "o el chat de Claude) directamente desde aquí sin usar herramientas de escritorio y tu autorización explícita."
)
ANSWER = "Tienes 2 tareas pendientes en Teams: Ensayo de historia y Práctica 4."


class GaveUpDetectionTests(unittest.TestCase):
    def test_real_refusals_are_detected(self) -> None:
        for reply, asked in (
            (REFUSAL_TEAMS, ASK_TEAMS),
            (REFUSAL_CLAUDE, "claude esta en la app que tienes abierto es el chat"),
            ("Lo siento, no tengo la capacidad de abrir aplicaciones en tu equipo.", "abre spotify"),
            ("No puedo enviar mensajes por WhatsApp directamente.", "mándale a mi mamá que llego tarde"),
            ("Lamentablemente no cuento con una integración con Outlook.", "checa mi correo"),
        ):
            self.assertTrue(gave_up_on_desktop(reply, asked), reply)

    def test_offering_to_look_after_being_asked_counts(self) -> None:
        offer = "Puedo revisarlo si tienes la app abierta. ¿Quieres que lea tu pantalla ahora?"
        self.assertTrue(gave_up_on_desktop(offer, "revisa mis pendientes de teams"))
        # Si solo preguntó qué sabe hacer, ofrecer es la respuesta correcta.
        self.assertFalse(gave_up_on_desktop(offer, "¿qué sabes hacer?"))

    def test_asking_before_sending_is_not_giving_up(self) -> None:
        self.assertFalse(gave_up_on_desktop("¿Quieres que envíe el mensaje a Juan por Teams?", "dile a juan que ya voy"))

    def test_ordinary_answers_are_not_refusals(self) -> None:
        for reply, asked in (
            ("¡Hola! ¿En qué te ayudo?", "hola"),
            ("No encontré ese archivo en el espacio de trabajo.", "lee el contrato"),
            ("No puedo inventar cifras de ventas: carga tu archivo de inventario.", "dame las ventas"),
            ("El IVA grava el consumo y el ISR los ingresos. No son lo mismo.", "diferencia iva isr"),
            (
                "Claro. Asunto: Acceso\n\nHola, no puedo entrar a mi cuenta de Teams desde ayer.",
                "redáctame un correo diciendo que no puedo entrar a mi cuenta de Teams",
            ),
        ):
            self.assertFalse(gave_up_on_desktop(reply, asked), reply)

    def test_a_tried_tool_means_it_did_not_give_up(self) -> None:
        self.assertTrue(attempted_desktop([{"tool": "memory_search"}, {"tool": "desktop_list_windows"}]))
        self.assertTrue(attempted_desktop([{"tool": "read_screen_now"}]))
        self.assertFalse(attempted_desktop([{"tool": "memory_search"}, {"tool": "tool_search"}]))


class ReplyHoldTests(unittest.TestCase):
    def setUp(self) -> None:
        self.shown: List[str] = []
        self.phases: List[str] = []

    def _hold(self, enabled: bool = True) -> ReplyHold:
        return ReplyHold(self.shown.append, self.phases.append, enabled=enabled)

    def _stream(self, hold: ReplyHold, text: str, size: int = 7) -> None:
        hold.phase("talking")
        for i in range(0, len(text), size):
            hold.feed(text[i:i + size])

    def test_normal_reply_is_shown_live_after_a_first_look(self) -> None:
        hold = self._hold()
        text = "Claro, aquí va el resumen del proyecto con sus avances. " * 4
        self._stream(hold, text[:FIRST_LOOK_CHARS - 10])
        self.assertEqual(self.shown, [])
        self.assertEqual(self.phases, [])
        self._stream(hold, text[FIRST_LOOK_CHARS - 10:])
        self.assertEqual("".join(self.shown), text)
        self.assertEqual(self.phases, ["talking"])

    def test_reply_with_an_innocent_no_is_released_after_its_opening(self) -> None:
        hold = self._hold()
        text = "No son lo mismo: el IVA grava el consumo y el ISR los ingresos. " * 5
        self._stream(hold, text)
        self.assertGreater(len(text), OPENING_CHARS)
        self.assertEqual("".join(self.shown), text)

    def test_refusal_never_reaches_the_screen(self) -> None:
        hold = self._hold()
        self._stream(hold, REFUSAL_TEAMS + " " + REFUSAL_TEAMS)
        self.assertEqual((self.shown, self.phases), ([], []))
        hold.discard()
        hold.release()
        self.assertEqual((self.shown, self.phases), ([], []))

    def test_short_reply_is_complete_on_release(self) -> None:
        hold = self._hold()
        self._stream(hold, "Listo.")
        hold.release()
        self.assertEqual(("".join(self.shown), self.phases), ("Listo.", ["talking"]))

    def test_disabled_hold_is_transparent(self) -> None:
        hold = self._hold(enabled=False)
        self._stream(hold, REFUSAL_TEAMS)
        self.assertEqual("".join(self.shown), REFUSAL_TEAMS)
        self.assertEqual(self.phases, ["talking"])


class _ScriptedModel:
    """Modelo falso: contesta cada ronda con lo siguiente del guion (texto o llamada a herramienta)."""

    def __init__(self, script: List[Any]) -> None:
        self.requests: List[Dict[str, Any]] = []
        self._script = list(script)

    def __call__(self, req: urllib.request.Request, timeout: Any = None, context: Any = None) -> _FakeResponse:
        body = json.loads(req.data.decode("utf-8")) if req.data else {}
        self.requests.append(body)
        step = self._script.pop(0) if self._script else ANSWER
        call: Optional[Dict[str, Any]] = None
        if isinstance(step, tuple):
            name, args = step
            call = {"id": f"call_{name}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}
        if body.get("stream"):
            if call is not None:
                return _FakeResponse(lines=_openai_sse(
                    {"choices": [{"delta": {"tool_calls": [{"index": 0, **call}]}, "finish_reason": "tool_calls"}]}))
            chunks = [step[i:i + 9] for i in range(0, len(step), 9)]
            return _FakeResponse(lines=_openai_sse(
                *({"choices": [{"delta": {"content": c}}]} for c in chunks),
                {"choices": [{"delta": {}, "finish_reason": "stop"}]}))
        message: Dict[str, Any] = {"role": "assistant", "content": ""}
        if call is not None:
            message["tool_calls"] = [call]
        else:
            message["content"] = json.dumps({"reply": step, "xox_mood": "talking", "operation": "none", "tasks": []})
        return _FakeResponse({"choices": [{"message": message, "finish_reason": "stop"}],
                              "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model": body.get("model")})


@unittest.skipUnless("desktop_control" in system_capabilities(), "este sistema no opera otras apps")
class ActInsteadOfRefusingIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_router_runtime_state()
        self._tmp = tempfile.TemporaryDirectory(prefix="xook_desktop_action_")
        self.ws = Path(self._tmp.name)
        (self.ws / "empresa").mkdir()
        (self.ws / "habilidades").mkdir()
        self.bridge_calls: List[str] = []
        self.events: List[Dict[str, Any]] = []

    def tearDown(self) -> None:
        clear_router_runtime_state()
        self._tmp.cleanup()

    def _bridge(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.bridge_calls.append(str(payload.get("rpc_callback")))
        if payload.get("rpc_callback") == "desktop_list_windows":
            return {"ok": True, "windows": [{"windowId": 7, "appName": "Microsoft Teams", "title": "Tareas"}]}
        if payload.get("rpc_callback") == "read_screen_now":
            return {"ok": True, "permissionGranted": True, "appName": "Microsoft Teams", "text": "Ensayo de historia"}
        return {"ok": True}

    def _run(self, path: str, model: _ScriptedModel, message: str = ASK_TEAMS, **extra: Any) -> Dict[str, Any]:
        common = dict(user_message=message, history=[], context_dir=self.ws / "empresa",
                      skills_dir=self.ws / "habilidades", workspace_root=str(self.ws), auto_failover=False,
                      api_key="sk-deepseektest1234567890", model_id="deepseek-chat", provider="deepseek",
                      command_bridge=self._bridge)
        common.update(extra)
        self.bridge_calls.clear()
        self.events.clear()
        with patch.object(urllib.request, "urlopen", side_effect=model), \
                patch.object(oc, "list_openrouter_models", return_value=CATALOG):
            if path == "loop":
                return oc.run_agent_completion(**common)
            return oc.stream_agent_completion(emit_event=self.events.append, **common)

    @staticmethod
    def _tool_names(body: Dict[str, Any]) -> set:
        return {t["function"]["name"] for t in body.get("tools") or []}

    def test_first_round_can_already_look_at_any_app(self) -> None:
        # "Blackboard" no está en ninguna lista de palabras clave.
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                model = _ScriptedModel([ANSWER])
                self._run(path, model, "revisa si en blackboard dejaron algo nuevo")
                first = self._tool_names(model.requests[0])
                self.assertLessEqual({"desktop_list_windows", "open_desktop_app", "desktop_snapshot", "read_screen_now"}, first)
                self.assertIn("TRABAJO EN OTRAS APPS", str(model.requests[0]["messages"][0]["content"]))

    def test_refusal_is_replaced_by_the_real_work(self) -> None:
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                model = _ScriptedModel([
                    REFUSAL_TEAMS,
                    ("desktop_list_windows", {"query": "teams"}),
                    ("read_screen_now", {"mode": "window"}),
                    ANSWER,
                ])
                res = self._run(path, model)
                self.assertEqual(res["reply"], ANSWER)
                self.assertEqual(self.bridge_calls, ["desktop_list_windows", "read_screen_now"])
                self.assertEqual(model.requests[1]["messages"][-1]["content"], DESKTOP_RETRY_NUDGE)
                # Ya con el intento pedido, el resto del control de apps queda disponible.
                self.assertLessEqual({"desktop_find", "desktop_act"}, self._tool_names(model.requests[1]))
                shown = "".join(e.get("delta", "") for e in self.events if e.get("type") == "reply_delta")
                self.assertNotIn("No tengo acceso", shown)

    def test_second_refusal_is_shown_instead_of_looping(self) -> None:
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                model = _ScriptedModel([REFUSAL_CLAUDE, REFUSAL_CLAUDE])
                res = self._run(path, model, "claude esta en la app que tienes abierto es el chat")
                self.assertEqual(len(model.requests), 2)
                self.assertIn("No soy Claude", res["reply"])
                if path == "stream":
                    shown = "".join(e.get("delta", "") for e in self.events if e.get("type") == "reply_delta")
                    self.assertEqual(shown.count("No soy Claude"), 1)

    def test_failing_after_trying_is_a_valid_answer(self) -> None:
        honest = "No puedo ver tus tareas: Teams pide iniciar sesión en su ventana. Entra y vuelve a pedírmelo."
        for path in ("loop", "stream"):
            with self.subTest(path=path):
                model = _ScriptedModel([("desktop_list_windows", {"query": "teams"}), honest])
                res = self._run(path, model)
                self.assertEqual(len(model.requests), 2)
                self.assertEqual(res["reply"], honest)

    def test_using_the_first_step_loads_the_rest(self) -> None:
        model = _ScriptedModel([("desktop_list_windows", {"query": "blackboard"}), ANSWER])
        self._run("stream", model, "revisa si en blackboard dejaron algo nuevo")
        self.assertNotIn("desktop_act", self._tool_names(model.requests[0]))
        self.assertIn("desktop_act", self._tool_names(model.requests[1]))

    def test_without_the_desktop_app_the_refusal_stands(self) -> None:
        model = _ScriptedModel([REFUSAL_TEAMS])
        res = self._run("stream", model, command_bridge=None)
        self.assertEqual(len(model.requests), 1)
        self.assertIn("No tengo acceso", res["reply"])


class DesktopRulesTests(unittest.TestCase):
    def test_rules_only_where_the_system_can_act(self) -> None:
        with patch("slices.ai_service.desktop_action_policy.system_capabilities", return_value=frozenset()):
            self.assertEqual(desktop_action_rules(), "")
        with patch(
            "slices.ai_service.desktop_action_policy.system_capabilities",
            return_value=frozenset({"desktop_control"}),
        ):
            self.assertIn("HAZLO en este turno", desktop_action_rules())


if __name__ == "__main__":
    unittest.main()
