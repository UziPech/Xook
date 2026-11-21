import tempfile
import unittest
from pathlib import Path

from slices.agent_tools.user_memory import (
    contains_secret_material,
    execute_user_memory_tool,
    format_user_memory_block,
    load_global_user_memory,
    patch_local_user_fallback,
    upsert_workspace_fact_md,
)


class UserMemoryTests(unittest.TestCase):
    def test_global_upsert_dedup_and_forget(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp)
            res1 = execute_user_memory_tool(
                "save_user_info",
                {
                    "key": "ciudad_base",
                    "category": "identity",
                    "value": "Vivo en Monterrey",
                    "pinned": True,
                },
                xox_config_dir=cfg,
                source_window="quick",
            )
            self.assertTrue(res1["ok"])
            self.assertEqual(res1["total_facts"], 1)

            # Actualiza misma key desde ventana main sin duplicar
            res2 = execute_user_memory_tool(
                "save_user_info",
                {
                    "key": "ciudad_base",
                    "category": "identity",
                    "value": "Vivo en Guadalajara",
                },
                xox_config_dir=cfg,
                source_window="main",
            )
            self.assertTrue(res2["ok"])
            facts = load_global_user_memory(cfg)
            self.assertEqual(len(facts), 1)
            self.assertEqual(facts[0]["value"], "Vivo en Guadalajara")
            self.assertTrue(facts[0]["pinned"])
            self.assertEqual(facts[0]["sourceWindow"], "main")

            block = format_user_memory_block(facts, max_chars=250)
            self.assertIn("[identity] (ciudad_base): Vivo en Guadalajara", block)

            res_del = execute_user_memory_tool(
                "forget_user_info",
                {"id_or_key": "ciudad_base"},
                xox_config_dir=cfg,
                source_window="settings",
            )
            self.assertTrue(res_del["ok"])
            self.assertEqual(load_global_user_memory(cfg), [])

    def test_rejects_secret_material(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp)
            self.assertTrue(contains_secret_material("sk-or-v1-abc1234567890xyz"))
            bad = execute_user_memory_tool(
                "save_user_info",
                {"value": "Mi clave es sk-or-v1-abc1234567890xyz"},
                xox_config_dir=cfg,
            )
            self.assertFalse(bad["ok"])
            self.assertEqual(load_global_user_memory(cfg), [])

    def test_profile_patch_and_no_name_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp)
            # Sin perfil previo con nombre, si solo llega ocupación debe preservarlo en memoria global sin romper
            deferred = execute_user_memory_tool(
                "save_user_info",
                {"occupation": "Diseñador de producto"},
                xox_config_dir=cfg,
                source_window="quick",
            )
            self.assertTrue(deferred["ok"])
            self.assertTrue(deferred.get("memory_updated"))
            self.assertEqual(len(load_global_user_memory(cfg)), 1)

            # Al crear perfil con nombre, los parches siguientes actualizan local-user.json
            first = patch_local_user_fallback(cfg, {"name": "Uziel", "role": "Dueño"})
            self.assertTrue(first["ok"])
            patched = execute_user_memory_tool(
                "save_user_info",
                {"preferred_name": "Uzi", "timezone": "America/Mexico_City"},
                xox_config_dir=cfg,
                source_window="main",
            )
            self.assertTrue(patched["ok"])
            self.assertEqual(patched["profile"]["preferredName"], "Uzi")
            self.assertEqual(patched["profile"]["timezone"], "America/Mexico_City")

    def test_workspace_fact_dedup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "memoria").mkdir(parents=True, exist_ok=True)
            r1 = upsert_workspace_fact_md(
                ws,
                fact="Envío gratis arriba de $999 MXN",
                category="envios",
                key="politica_envio",
            )
            self.assertTrue(r1["ok"])
            self.assertFalse(r1["deduplicated"])

            r2 = upsert_workspace_fact_md(
                ws,
                fact="Envío gratis arriba de $1,200 MXN",
                category="envios",
                key="politica_envio",
            )
            self.assertTrue(r2["ok"])
            self.assertTrue(r2["deduplicated"])
            txt = (ws / "memoria" / "hechos.md").read_text(encoding="utf-8")
            self.assertNotIn("999", txt)
            self.assertIn("1,200", txt)


if __name__ == "__main__":
    unittest.main()
