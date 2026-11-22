import tempfile
import unittest
from pathlib import Path

from slices.agent_tools.user_memory import (
    contains_secret_material,
    execute_user_memory_tool,
    format_user_memory_block,
    load_global_user_memory,
    patch_local_user_fallback,
    select_startup_user_memory_block,
    select_startup_workspace_facts_block,
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

    def test_select_startup_user_memory_block_l0_and_l2_index_on_unrelated_query(self) -> None:
        facts = [
            {
                "id": "1",
                "key": "nombre_preferido",
                "category": "identity",
                "value": "Prefiere que le llamen Uzi",
                "pinned": False,
                "updatedAt": "2026-03-10T10:00:00Z",
            },
            {
                "id": "2",
                "key": "regla_fija",
                "category": "preference",
                "value": "Respuestas directas y concisas",
                "pinned": True,
                "updatedAt": "2026-03-11T10:00:00Z",
            },
            {
                "id": "3",
                "key": "proveedor_empaque",
                "category": "work",
                "value": "Cajas corrugadas con Cartonera del Norte",
                "pinned": False,
                "updatedAt": "2026-03-12T10:00:00Z",
            },
            {
                "id": "4",
                "key": "rutina_gimnasio",
                "category": "routine",
                "value": "Entrena a las 7am de lunes a viernes",
                "pinned": False,
                "updatedAt": "2026-03-12T11:00:00Z",
            },
        ]
        block = select_startup_user_memory_block(facts, query="Hola buenos días, ¿cómo estás?")
        self.assertIn("[preference] (regla_fija): Respuestas directas y concisas", block)
        self.assertIn("[identity] (nombre_preferido): Prefiere que le llamen Uzi", block)
        self.assertNotIn("Cartonera del Norte", block)
        self.assertNotIn("Entrena a las 7am", block)
        self.assertIn(
            "- [índice_memoria_l2] (2 dato(s) adicionales en work, routine; usa memory_search si necesitas consultarlos)",
            block,
        )

    def test_select_startup_user_memory_block_promotes_matching_l1_facts(self) -> None:
        facts = [
            {
                "id": "1",
                "key": "nombre_preferido",
                "category": "identity",
                "value": "Prefiere que le llamen Uzi",
                "pinned": True,
                "updatedAt": "2026-03-10T10:00:00Z",
            },
            {
                "id": "2",
                "key": "proveedor_empaque",
                "category": "work",
                "value": "Cajas corrugadas con Cartonera del Norte",
                "pinned": False,
                "updatedAt": "2026-03-12T10:00:00Z",
            },
            {
                "id": "3",
                "key": "rutina_gimnasio",
                "category": "routine",
                "value": "Entrena a las 7am de lunes a viernes",
                "pinned": False,
                "updatedAt": "2026-03-12T11:00:00Z",
            },
        ]
        block = select_startup_user_memory_block(
            facts,
            query="Necesito cotizar cajas de empaque con nuestro proveedor",
        )
        self.assertIn("[identity] (nombre_preferido): Prefiere que le llamen Uzi", block)
        self.assertIn("[work] (proveedor_empaque): Cajas corrugadas con Cartonera del Norte", block)
        self.assertNotIn("Entrena a las 7am", block)
        self.assertIn(
            "- [índice_memoria_l2] (1 dato(s) adicionales en routine; usa memory_search si necesitas consultarlos)",
            block,
        )

    def test_select_startup_workspace_facts_block_compacts_and_matches_query(self) -> None:
        raw_md = "\n".join(
            [
                "# Hechos del negocio",
                "",
                "- [2026-03-01 09:00] (proveedores) Proveedor de café en grano: Café Veracruzano",
                "- [2026-03-02 10:00] (logistica) Reparto local con flotilla propia en zona centro",
                "- [2026-03-03 11:00] (empaque) Bolsas biodegradables calibre 40",
                "- [2026-03-04 12:00] (finanzas) Corte de caja diario a las 21:00 hrs",
                "- [2026-03-05 13:00] (horarios) Sucursal abre de lunes a sábado de 8:00 a 20:00",
                "- [2026-03-06 14:00] (envios) Envío gratis arriba de $1,200 MXN",
            ]
        )
        block = select_startup_workspace_facts_block(
            raw_md,
            query="¿Quién es nuestro proveedor de café en grano?",
            max_chars=700,
        )
        self.assertIn("Café Veracruzano", block)
        self.assertIn("Sucursal abre de lunes a sábado", block)
        self.assertIn("Envío gratis arriba de $1,200 MXN", block)
        self.assertNotIn("Bolsas biodegradables", block)
        self.assertIn(
            "- [+3 hecho(s) en memoria/hechos.md disponibles bajo demanda con memory_search]",
            block,
        )


if __name__ == "__main__":
    unittest.main()
