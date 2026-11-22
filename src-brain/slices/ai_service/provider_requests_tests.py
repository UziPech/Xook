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
    "anthropic": ("sk-ant-test12345678901234", "claude-sonnet-4-6", None, "https://api.anthropic.com/v1/messages"),
}


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

    def __init__(self, spawn_subagent: bool = False) -> None:
        self.requests: List[Dict[str, Any]] = []
        self._pending_spawn = spawn_subagent

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
                args = json.dumps({"name": "Analista", "role": "Analista", "task": "Resume las ventas del mes."})
                call = {"index": 0, "id": "call_sub_1", "type": "function",
                        "function": {"name": "spawn_subagent", "arguments": args}}
                return _FakeResponse(lines=_openai_sse(
                    {"choices": [{"delta": {"tool_calls": [call]}, "finish_reason": "tool_calls"}]}))
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

    def _capture(self, path: str, provider: str, region: Optional[str] = None) -> List[Dict[str, Any]]:
        key, model, default_region, _ = PROVIDERS[provider]
        region = region if region is not None else default_region
        network = _FakeNetwork(spawn_subagent=(path == "subagent"))
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
        expected_max_tokens = {"openrouter": 16384, "deepseek": 8192, "kimi": 8192, "anthropic": 16384}
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

    def test_openrouter_custom_base_url_per_path(self) -> None:
        # Hoy el loop normal y los subagentes ignoran la URL propia de OpenRouter.
        expected = {"compaction": GATEWAY_URL, "loop": OPENROUTER_URL, "stream": GATEWAY_URL, "subagent": OPENROUTER_URL}
        for path, url in expected.items():
            with self.subTest(path=path):
                reqs = self._capture(path, "openrouter", region=GATEWAY)
                req = [r for r in reqs if r["body"].get("max_tokens") == 2400][0] if path == "subagent" else reqs[0]
                self._assert_transport(req, "openrouter", url=url)


if __name__ == "__main__":
    unittest.main()
