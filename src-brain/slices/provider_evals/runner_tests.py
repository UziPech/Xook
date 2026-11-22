import io
import json
import os
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest import mock

from slices.provider_evals import runner


class CasesFileTests(unittest.TestCase):
    """Si una herramienta se renombra o cambia su schema, estos tests avisan antes que las evals."""

    @classmethod
    def setUpClass(cls):
        cls.cases = runner.load_cases()
        # Catálogo completo, sin el filtro por sistema operativo, para validar en cualquier equipo.
        from slices.agent_tools.system_capabilities import CAPABILITY_TOOLS

        cls.os_dependent = set().union(*CAPABILITY_TOOLS.values())
        cls.tool_defs = runner.load_real_tool_defs()

    def test_case_ids_are_unique(self):
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(ids), len(set(ids)))

    def test_cases_only_reference_real_tools(self):
        for case in self.cases:
            expect = case["espera"]
            referenced = set(case["herramientas"])
            referenced |= set(expect.get("herramienta_en") or [])
            referenced |= set(expect.get("aceptables") or [])
            referenced |= set(expect.get("prohibidas") or [])
            missing = referenced - set(self.tool_defs) - self.os_dependent
            self.assertFalse(missing, f"{case['id']}: herramientas inexistentes {sorted(missing)}")

    def test_expected_tools_are_exposed_in_the_case(self):
        for case in self.cases:
            expect = case["espera"]
            for name in (expect.get("herramienta_en") or []) + (expect.get("aceptables") or []):
                self.assertIn(name, case["herramientas"], f"{case['id']}: `{name}` no está expuesta")

    def test_arg_expectations_use_real_parameters(self):
        for case in self.cases:
            expect = case["espera"]
            for tool in expect.get("herramienta_en") or []:
                if tool not in self.tool_defs:
                    continue  # herramienta de otro sistema operativo
                props = self.tool_defs[tool]["function"].get("parameters", {}).get("properties", {})
                for key in expect.get("args_coinciden") or {}:
                    self.assertIn(key, props, f"{case['id']}: `{tool}` no tiene el parámetro `{key}`")


class RunnerTests(unittest.TestCase):
    TOOL_DEFS = {
        "read_screen_now": {"type": "function", "function": {"name": "read_screen_now", "parameters": {"type": "object", "properties": {}}}},
        "memory_search": {
            "type": "function",
            "function": {"name": "memory_search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
        },
    }
    CASES = [
        {"id": "pantalla", "mensaje": "¿Qué veo?", "herramientas": ["read_screen_now", "memory_search"], "espera": {"herramienta_en": ["read_screen_now"]}},
        {"id": "saludo", "mensaje": "Hola", "herramientas": ["read_screen_now"], "espera": {"sin_herramienta": True}},
    ]

    def _fake_transport(self, replies):
        calls = []

        def transport(provider, api_key, model, payload, region=None):
            calls.append({"provider": provider, "api_key": api_key, "model": model, "payload": payload, "region": region})
            reply = replies[len(calls) - 1]
            if isinstance(reply, Exception):
                raise reply
            return reply

        return transport, calls

    def test_parse_target_keeps_colons_in_model(self):
        self.assertEqual(runner.parse_target("openrouter:meta-llama/llama-3-8b:free"), ("openrouter", "meta-llama/llama-3-8b:free"))
        self.assertEqual(runner.parse_target("DeepSeek:deepseek-chat"), ("deepseek", "deepseek-chat"))
        with self.assertRaises(ValueError):
            runner.parse_target("deepseek")

    def test_cases_for_tools_missing_on_this_system_are_skipped(self):
        only_memory = {"memory_search": self.TOOL_DEFS["memory_search"]}
        desktop = {"id": "d", "herramientas": ["desktop_list_windows"], "espera": {"herramienta_en": ["desktop_list_windows"]}}
        lenient = {"id": "w", "herramientas": ["open_desktop_app"], "espera": {"herramienta_en": ["open_desktop_app"], "permite_sin_herramienta": True}}
        greeting = {"id": "s", "mensaje": "Hola", "herramientas": ["read_screen_now"], "espera": {"sin_herramienta": True}}
        self.assertFalse(runner.case_runs_on_this_system(desktop, only_memory))
        self.assertTrue(runner.case_runs_on_this_system(lenient, only_memory))
        self.assertTrue(runner.case_runs_on_this_system(greeting, only_memory))
        self.assertEqual(runner.build_payload(greeting, "m", only_memory)["tools"], [])

    def test_payload_exposes_only_case_tools_and_no_temperature(self):
        payload = runner.build_payload(self.CASES[1], "m", self.TOOL_DEFS)
        self.assertEqual([t["function"]["name"] for t in payload["tools"]], ["read_screen_now"])
        self.assertNotIn("temperature", payload)
        self.assertEqual(payload["messages"][-1], {"role": "user", "content": "Hola"})

    def test_run_target_grades_and_summarizes(self):
        replies = [
            {
                "choices": [{"message": {"content": "", "tool_calls": [{"function": {"name": "read_screen_now", "arguments": "{}"}}]}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 10},
            },
            {"choices": [{"message": {"content": "¡Hola!"}}], "usage": {"prompt_tokens": 80, "completion_tokens": 5}},
        ]
        transport, calls = self._fake_transport(replies)
        results = runner.run_target("deepseek", "deepseek-chat", "k", self.CASES, self.TOOL_DEFS, transport=transport)

        self.assertEqual([r["resultado"] for r in results], ["ok", "ok"])
        self.assertEqual(len(calls), 2)
        summary = runner.summarize(results)
        self.assertEqual(summary["puntaje_pct"], 100.0)
        self.assertEqual(summary["tokens_entrada"], 180)
        self.assertEqual(summary["tokens_salida"], 15)

    def test_network_error_counts_as_failure_and_continues(self):
        replies = [
            urllib.error.URLError("sin conexión"),
            {"choices": [{"message": {"content": "¡Hola!"}}]},
        ]
        transport, _ = self._fake_transport(replies)
        results = runner.run_target("groq", "m", "k", self.CASES, self.TOOL_DEFS, transport=transport)
        self.assertEqual(results[0]["resultado"], "fallo")
        self.assertIn("sin conexión", results[0]["motivo"])
        self.assertEqual(results[1]["resultado"], "ok")
        self.assertEqual(runner.summarize(results)["puntaje_pct"], 50.0)

    def test_repeat_runs_each_case_n_times(self):
        reply = {"choices": [{"message": {"content": "hola"}}]}
        transport, calls = self._fake_transport([reply] * 3)
        runner.run_target("openai", "m", "k", self.CASES[1:], self.TOOL_DEFS, transport=transport, repeat=3)
        self.assertEqual(len(calls), 3)

    def _run_main(self, argv, vault_json, transport):
        with mock.patch.object(runner, "default_transport", side_effect=transport), \
                mock.patch.object(runner, "load_real_tool_defs", return_value=self.TOOL_DEFS), \
                mock.patch.object(runner, "load_cases", return_value=self.CASES):
            out = io.StringIO()
            with redirect_stdout(out):
                code = runner.main(argv, stdin=io.StringIO(vault_json))
        self.assertEqual(code, 0)
        return out.getvalue()

    def test_vault_credentials_drop_entries_without_key(self):
        creds = runner.parse_vault_credentials(json.dumps({
            "DeepSeek": {"api_key": " sk-a ", "model_id": "deepseek-chat", "region": None},
            "groq": {"api_key": "", "model_id": "llama"},
            "gemini": "basura",
        }))
        self.assertEqual(creds, {"deepseek": {"api_key": "sk-a", "model_id": "deepseek-chat", "region": None}})
        with self.assertRaises(ValueError):
            runner.parse_vault_credentials("[]")

    def test_without_targets_uses_each_configured_vault_model(self):
        creds = {
            "openrouter": {"api_key": "k1", "model_id": "openrouter/free", "region": None},
            "deepseek": {"api_key": "k2", "model_id": "deepseek-chat", "region": None},
            "groq": {"api_key": "k3", "model_id": "", "region": None},
        }
        self.assertEqual(runner.resolve_targets(None, creds), [("deepseek", "deepseek-chat"), ("openrouter", "openrouter/free")])
        self.assertEqual(runner.resolve_targets(["gemini:g"], creds), [("gemini", "g")])

    def test_main_uses_vault_key_and_region(self):
        reply = {"choices": [{"message": {"content": "hola"}}]}
        transport, calls = self._fake_transport([reply, reply])
        vault = json.dumps({"kimi": {"api_key": "sk-vault", "model_id": "kimi-k2", "region": "cn"}})
        out = self._run_main(["--formato", "json"], vault, transport)

        self.assertEqual({c["api_key"] for c in calls}, {"sk-vault"})
        self.assertEqual({c["region"] for c in calls}, {"cn"})
        report = json.loads(out)
        self.assertIn("kimi:kimi-k2", report)
        self.assertNotIn("sk-vault", out)

    def test_main_never_reads_keys_from_environment(self):
        env = {"DEEPSEEK_API_KEY": "sk-env-1", "XOOK_EVAL_KEY_DEEPSEEK": "sk-env-2"}
        with mock.patch.dict(os.environ, env):
            out = self._run_main(
                ["--target", "deepseek:deepseek-chat"],
                "{}",
                AssertionError("no debe llamar a la red"),
            )
        self.assertIn("sin clave en la bóveda", out)
        self.assertNotIn("sk-env", out)

    def test_interactive_terminal_is_rejected_instead_of_waiting(self):
        class _Tty(io.StringIO):
            def isatty(self):
                return True

        with mock.patch.object(runner, "default_transport", side_effect=AssertionError("no debe llamar a la red")):
            self.assertEqual(runner.main([], stdin=_Tty()), 2)

    def test_default_transport_uses_the_agent_provider_call(self):
        with mock.patch(
            "slices.ai_service.openrouter_client._provider_chat_completion", return_value={"choices": []}
        ) as call:
            out = runner.default_transport("kimi", "sk-k", "kimi-k2", {"model": "kimi-k2"}, "cn")
        self.assertEqual(out, {"choices": []})
        args, kwargs = call.call_args
        self.assertEqual(args, ("kimi", "sk-k", {"model": "kimi-k2"}))
        self.assertEqual(kwargs, {"base_url": "https://api.moonshot.cn/v1", "timeout": 90, "model": "kimi-k2"})

    def test_report_never_contains_the_api_key(self):
        secret = "sk-test-supersecreta-123456"
        reply = {"choices": [{"message": {"content": "hola"}}]}
        transport, _ = self._fake_transport([reply, reply])
        results = runner.run_target("deepseek", "m", secret, self.CASES, self.TOOL_DEFS, transport=transport)
        report = {"deepseek:m": {"resumen": runner.summarize(results), "resultados": results}}
        self.assertNotIn(secret, runner.format_report(report))
        self.assertNotIn(secret, json.dumps(report))


if __name__ == "__main__":
    unittest.main()
