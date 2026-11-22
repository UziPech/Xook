"""
Tests de caracterización de las peticiones HTTP que hace el cliente del agente.

Congelan, para cada camino (compactación, loop normal, stream y subagentes) y cada familia de
proveedor (OpenRouter, compatibles con OpenAI y Anthropic), lo que realmente sale a la red: URL,
autenticación, timeout y los campos del cuerpo que dependen del proveedor. Son la red de seguridad
para separar la capa de proveedores (claude/diseno-capa-proveedores.md) sin cambiar comportamiento.
Toda la red pasa por un `urlopen` falso; ninguna prueba sale a internet.
"""

import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import patch

from slices.ai_service import openrouter_client as oc
from slices.ai_service.model_router import clear_router_runtime_state


FINAL = json.dumps({"reply": "Listo.", "xox_mood": "success", "operation": "none", "tasks": []})
CATALOG = {
    "models": [{
        "id": "openrouter/free",
        "name": "Free",
        "context_length": 200000,
        "pricing": {"prompt": "0", "completion": "0"},
        "supported_parameters": ["tools"],
        "architecture": {"input_modalities": ["text"]},
    }]
}

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GATEWAY = "https://gw.ejemplo.test/api/v1"
GATEWAY_URL = GATEWAY + "/chat/completions"

# proveedor -> (clave, modelo, región, URL esperada)
PROVIDERS = {
    "openrouter": ("sk-or-v1-test1234567890", "openrouter/free", None, OPENROUTER_URL),
    "deepseek": ("sk-deepseektest1234567890", "deepseek-chat", None, "https://api.deepseek.com/chat/completions"),
    "kimi": ("sk-kimitest12345678901234", "kimi-k3.1-pro", "cn", "https://api.moonshot.cn/v1/chat/completions"),
    "gemini": ("AIzaSyTEST0123456789012345678901234567", "gemini-2.5-flash-lite", None,
               "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
    "groq": ("gsk_test1234567890123456789012", "openai/gpt-oss-120b", None, "https://api.groq.com/openai/v1/chat/completions"),
    "anthropic": ("sk-ant-test12345678901234", "claude-sonnet-4-6", None, "https://api.anthropic.com/v1/messages"),
}
REASONING = "Voy a listar el workspace."


class _FakeResponse:
    def __init__(self, body: Optional[Dict[str, Any]] = None, lines: Optional[List[bytes]] = None) -> None:
        self._body = json.dumps(body or {}).encode("utf-8")
        self._lines = list(lines or [])
        self.headers: Dict[str, str] = {}
        self.status = 200

    def read(self, *_args: Any) -> bytes:
        return self._body

    def __iter__(self):
        return iter(self._lines)

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *_args: Any) -> bool:
        return False

    def close(self) -> None:
        pass


def _openai_sse(*chunks: Dict[str, Any]) -> List[bytes]:
    return [("data: " + json.dumps(c) + "\n").encode("utf-8") for c in chunks] + [b"data: [DONE]\n"]


def _anthropic_sse(model: str) -> List[bytes]:
    events = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_1", "type": "message", "role": "assistant", "model": model, "content": [],
            "usage": {"input_tokens": 10, "output_tokens": 0}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": FINAL}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 5}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    out: List[bytes] = []
    for name, data in events:
        out += [f"event: {name}\n".encode(), ("data: " + json.dumps(data) + "\n").encode(), b"\n"]
    return out


class _FakeNetwork:
    """Reemplaza a `urllib.request.urlopen`: registra cada petición y responde en el formato del proveedor."""

    def __init__(
        self,
        spawn_subagent: bool = False,
        spawn_model: Optional[str] = None,
        reasoning_tool_round: bool = False,
        reasoning_only_round: bool = False,
    ) -> None:
        self.requests: List[Dict[str, Any]] = []
        self._pending_spawn = spawn_subagent
        self._spawn_model = spawn_model
        # Primera ronda: razonamiento nativo (`reasoning_content`) y una llamada a workspace_list.
        self._pending_reasoning_round = reasoning_tool_round
        # Primera ronda: solo razonamiento nativo, sin texto ni herramientas.
        self._pending_reasoning_only = reasoning_only_round

    def __call__(self, req: urllib.request.Request, timeout: Any = None, context: Any = None) -> _FakeResponse:
        body = json.loads(req.data.decode("utf-8")) if req.data else {}
        auth = "x-api-key" if req.get_header("X-api-key") else ("bearer" if req.get_header("Authorization") else None)
        self.requests.append({"url": req.full_url, "timeout": timeout, "auth": auth, "body": body})
        is_anthropic = "anthropic.com" in req.full_url
        if body.get("stream"):
            if is_anthropic:
                return _FakeResponse(lines=_anthropic_sse(body.get("model", "")))
            if self._pending_spawn:
                self._pending_spawn = False
                args = {"name": "Analista", "role": "Analista", "task": "Resume las ventas del mes."}
                if self._spawn_model:
                    args["model"] = self._spawn_model
                call = {"index": 0, "id": "call_sub_1", "type": "function",
                        "function": {"name": "spawn_subagent", "arguments": json.dumps(args)}}
                return _FakeResponse(lines=_openai_sse(
                    {"choices": [{"delta": {"tool_calls": [call]}, "finish_reason": "tool_calls"}]}))
            if self._pending_reasoning_round:
                self._pending_reasoning_round = False
                call = {"index": 0, "id": "call_ls_1", "type": "function",
                        "function": {"name": "workspace_list", "arguments": "{}"}}
                return _FakeResponse(lines=_openai_sse(
                    {"choices": [{"delta": {"reasoning_content": REASONING}}]},
                    {"choices": [{"delta": {"tool_calls": [call]}, "finish_reason": "tool_calls"}]}))
            if self._pending_reasoning_only:
                self._pending_reasoning_only = False
                return _FakeResponse(lines=_openai_sse(
                    {"choices": [{"delta": {"reasoning_content": REASONING}, "finish_reason": "stop"}]}))
            return _FakeResponse(lines=_openai_sse({"choices": [{"delta": {"content": FINAL}, "finish_reason": "stop"}]}))
        if is_anthropic:
            return _FakeResponse({"id": "msg_1", "type": "message", "role": "assistant", "model": body.get("model"),
                                  "content": [{"type": "text", "text": FINAL}], "stop_reason": "end_turn",
                                  "usage": {"input_tokens": 10, "output_tokens": 5}})
        return _FakeResponse({"choices": [{"message": {"role": "assistant", "content": FINAL}, "finish_reason": "stop"}],
                              "usage": {"prompt_tokens": 10, "completion_tokens": 5}, "model": body.get("model")})


class ProviderRequestsTests(unittest.TestCase):
    def setUp(self) -> None:
        clear_router_runtime_state()
        self._tmp = tempfile.TemporaryDirectory(prefix="xook_prov_req_")
        ws = Path(self._tmp.name)
        (ws / "empresa").mkdir()
        (ws / "habilidades").mkdir()
        self.common = dict(user_message="Hola, ¿qué pendientes tengo?", history=[], context_dir=ws / "empresa",
                           skills_dir=ws / "habilidades", workspace_root=str(ws), auto_failover=False)

    def tearDown(self) -> None:
        clear_router_runtime_state()
        self._tmp.cleanup()

    def _capture(
        self,
        path: str,
        provider: str,
        region: Optional[str] = None,
        model: Optional[str] = None,
        **network_options: Any,
    ) -> List[Dict[str, Any]]:
        key, default_model, default_region, _ = PROVIDERS[provider]
        model = model or default_model
        region = region if region is not None else default_region
        network = _FakeNetwork(spawn_subagent=(path == "subagent"), **network_options)
        with patch.object(urllib.request, "urlopen", side_effect=network), \
                patch.object(oc, "list_openrouter_models", return_value=CATALOG):
            if path == "compaction":
                oc._make_compact_llm_caller(provider, key, model, region)([{"role": "user", "content": "resume"}])
            elif path == "loop":
                oc.run_agent_completion(api_key=key, model_id=model, provider=provider, provider_region=region, **self.common)
            else:
                oc.stream_agent_completion(api_key=key, model_id=model, provider=provider, provider_region=region,
                                           emit_event=lambda _ev: None,
                                           active_mode=("agent" if path == "subagent" else None), **self.common)
        self.assertTrue(network.requests, f"{path}/{provider}: no salió ninguna petición")
        return network.requests

    def _assert_transport(self, req: Dict[str, Any], provider: str, url: Optional[str] = None) -> None:
        self.assertEqual(req["url"], url or PROVIDERS[provider][3])
        self.assertEqual(req["auth"], "x-api-key" if provider == "anthropic" else "bearer")

    def test_compaction(self) -> None:
        for provider in PROVIDERS:
            with self.subTest(provider=provider):
                reqs = self._capture("compaction", provider)
                self.assertEqual(len(reqs), 1)
                req, body = reqs[0], reqs[0]["body"]
                self._assert_transport(req, provider)
                self.assertEqual(req["timeout"], 25)
                self.assertEqual((body["max_tokens"], body["temperature"], body["stream"]), (1400, 0.1, False))
                self.assertNotIn("tools", body)

    def test_agent_loop(self) -> None:
        for provider in PROVIDERS:
            with self.subTest(provider=provider):
                req = self._capture("loop", provider)[0]
                body = req["body"]
                self._assert_transport(req, provider)
                self.assertEqual(req["timeout"], 60)
                self.assertEqual((body["max_tokens"], body["temperature"]), (8192, 0.3))
                self.assertTrue(body["tools"])
                if provider == "anthropic":
                    self.assertNotIn("response_format", body)
                    self.assertIn("system", body)
                else:
                    self.assertEqual(body["response_format"], {"type": "json_object"})
                    self.assertEqual(body["tool_choice"], "auto")
                    self.assertNotIn("stream", body)

    def test_stream(self) -> None:
        expected_max_tokens = {
            "openrouter": 16384, "deepseek": 8192, "kimi": 8192, "gemini": 16384, "groq": 8192, "anthropic": 16384,
        }
        for provider in PROVIDERS:
            with self.subTest(provider=provider):
                req = self._capture("stream", provider)[0]
                body = req["body"]
                self._assert_transport(req, provider)
                self.assertEqual(req["timeout"], 75)
                self.assertIs(body["stream"], True)
                self.assertEqual(body["max_tokens"], expected_max_tokens[provider])
                if provider == "anthropic":
                    self.assertNotIn("stream_options", body)
                else:
                    self.assertEqual(body["stream_options"], {"include_usage": True})

    def test_subagent(self) -> None:
        for provider in ("openrouter", "deepseek", "kimi"):
            with self.subTest(provider=provider):
                sub = [r for r in self._capture("subagent", provider) if r["body"].get("max_tokens") == 2400]
                self.assertEqual(len(sub), 1, "se esperaba una sola llamada del subagente")
                req, body = sub[0], sub[0]["body"]
                self._assert_transport(req, provider)
                self.assertEqual(req["timeout"], 45)
                self.assertEqual(body["temperature"], 0.25)
                self.assertEqual(body["tool_choice"], "auto")
                self.assertNotIn("response_format", body)
                self.assertNotIn("stream", body)

    def test_stream_reasoning_model_gets_long_output_without_temperature(self) -> None:
        body = self._capture("stream", "deepseek", model="deepseek-reasoner")[0]["body"]
        self.assertEqual(body["max_tokens"], 16384)
        self.assertNotIn("temperature", body)

    def test_subagent_vendor_model_only_on_openrouter(self) -> None:
        # Los ids "proveedor/modelo" solo existen en OpenRouter; fuera de ahí se usa el modelo de la conversación.
        expected = {"openrouter": "openai/gpt-4o", "deepseek": "deepseek-chat"}
        for provider, model in expected.items():
            with self.subTest(provider=provider):
                reqs = self._capture("subagent", provider, spawn_model="openai/gpt-4o")
                self.assertEqual([r["body"]["model"] for r in reqs if r["body"].get("max_tokens") == 2400], [model])

    def test_native_reasoning_replay_in_tool_loop(self) -> None:
        # El razonamiento nativo (`reasoning_content`) vuelve completo a quien lo necesita, y a nadie más.
        cases = {
            ("deepseek", "deepseek-chat"): REASONING,
            ("openrouter", "openrouter/free"): None,
            ("openrouter", "deepseek/deepseek-r1"): REASONING,
        }
        for (provider, model), expected in cases.items():
            with self.subTest(provider=provider, model=model):
                reqs = self._capture("stream", provider, model=model, reasoning_tool_round=True)
                streams = [r for r in reqs if r["body"].get("stream")]
                self.assertGreaterEqual(len(streams), 2)
                turns = [m for m in streams[1]["body"]["messages"] if m.get("role") == "assistant" and m.get("tool_calls")]
                self.assertEqual(len(turns), 1)
                self.assertEqual(turns[0].get("reasoning_content"), expected)

    def test_reasoning_only_round_asks_for_the_final_answer(self) -> None:
        # Si el modelo solo razonó, el agente le pide la respuesta final en lugar de dar un texto genérico.
        reqs = self._capture("stream", "deepseek", reasoning_only_round=True)
        streams = [r for r in reqs if r["body"].get("stream")]
        self.assertEqual(len(streams), 2)
        last_user = [m.get("content") for m in streams[1]["body"]["messages"] if m.get("role") == "user"][-1]
        self.assertIn("Completaste un razonamiento previo", str(last_user))

    def test_openrouter_custom_base_url_is_used_by_every_path(self) -> None:
        # Con una URL propia configurada, la clave nunca debe viajar a openrouter.ai.
        for path in ("compaction", "loop", "stream", "subagent"):
            with self.subTest(path=path):
                reqs = self._capture(path, "openrouter", region=GATEWAY)
                for req in reqs:
                    self._assert_transport(req, "openrouter", url=GATEWAY_URL)


if __name__ == "__main__":
    unittest.main()
