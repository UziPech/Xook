"""
Tests de `encargo_schedule`: la tarjeta que prepara Xox para un pendiente.
"""

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from slices.agent_tools import WorkspaceToolExecutor
from slices.agent_tools.encargo_tools import (
    blocked_final_action_phrase,
    build_encargo_proposal,
    encargo_run_rules,
    encargos_context_block,
    read_encargo,
    when_label,
)
from slices.agent_tools.tool_catalog import detect_initial_toolkits

NOW = datetime(2026, 11, 23, 10, 0).astimezone()


def _args(**overrides):
    base = {
        "name": "Práctica 3 · Física",
        "when": "2026-11-23T16:00",
        "instruction": "Entrega reporte.pdf a las 4 en Teams, actividad Práctica 3",
        "steps": ["Abrir Teams", "Entrar a Práctica 3", "Adjuntar reporte.pdf", "Entregar"],
        "target_app": "Microsoft Teams",
        "files": ["datos/reporte.pdf"],
        "may_finish": True,
        "final_action": "Entregar · Práctica 3",
    }
    base.update(overrides)
    return base


def _resolve(raw: str) -> str:
    if raw.startswith("..") or "no-existe" in raw:
        raise ValueError(f"No encontré el archivo '{raw}' en el espacio de trabajo.")
    return raw


class EncargoProposalTests(unittest.TestCase):
    def test_builds_card_with_staging_payload_for_rust(self) -> None:
        result, card = build_encargo_proposal(_args(), resolve_file=_resolve, now=NOW, platform="darwin")

        self.assertTrue(result["ok"])
        self.assertEqual(result["when"], "Hoy 16:00")
        self.assertEqual(card["category"], "agenda")
        self.assertEqual(card["intent"]["type"], "schedule_encargo")
        self.assertEqual(card["intent"]["primaryLabel"], "Programar")
        self.assertEqual(card["subtitle"], "Lo dejaré hecho: Entregar · Práctica 3")

        sp = card["stagingPayload"]
        self.assertEqual(sp["kind"], "encargo")
        self.assertEqual(sp["files"], ["datos/reporte.pdf"])
        self.assertTrue(sp["mayFinish"])
        self.assertEqual(datetime.fromisoformat(sp["nextRunAt"]), datetime(2026, 11, 23, 16, 0).astimezone())

        kinds = [b["type"] for b in card["blocks"]]
        self.assertEqual(kinds, ["kv_list", "note", "insight"])
        self.assertIn("3. Adjuntar reporte.pdf", card["blocks"][1]["content"])

    def test_without_may_finish_it_stays_ready_and_drops_final_action(self) -> None:
        result, card = build_encargo_proposal(
            _args(may_finish=False), resolve_file=_resolve, now=NOW, platform="darwin"
        )
        self.assertTrue(result["ok"])
        self.assertEqual(card["subtitle"], "Lo dejaré listo, sin el último clic")
        self.assertIsNone(card["stagingPayload"]["finalAction"])

    def test_rejects_invalid_requests_without_a_card(self) -> None:
        cases = {
            "hora pasada": _args(when="2026-11-23T09:00"),
            "hora inválida": _args(when="a las 4"),
            "sin pasos": _args(steps=[]),
            "sin último clic": _args(final_action=""),
            "pago": _args(final_action="Pagar factura"),
            "archivo inexistente": _args(files=["datos/no-existe.pdf"]),
            "ruta fuera": _args(files=["../secreto.pdf"]),
        }
        for label, args in cases.items():
            with self.subTest(label):
                result, card = build_encargo_proposal(args, resolve_file=_resolve, now=NOW, platform="darwin")
                self.assertFalse(result["ok"])
                self.assertIsNone(card)

    def test_other_apps_are_rejected_where_desktop_control_does_not_exist(self) -> None:
        for platform in ("win32", "linux"):
            with self.subTest(platform):
                result, card = build_encargo_proposal(_args(), resolve_file=_resolve, now=NOW, platform=platform)
                self.assertFalse(result["ok"])
                self.assertIsNone(card)
        # Sin otra app (por ejemplo, solo generar un archivo) sí se puede en cualquier sistema.
        result, _ = build_encargo_proposal(
            _args(target_app="", may_finish=False), resolve_file=_resolve, now=NOW, platform="linux"
        )
        self.assertTrue(result["ok"])

    def test_blocked_final_actions_match_whole_words(self) -> None:
        self.assertEqual(blocked_final_action_phrase("Pagar con tarjeta"), "pagar")
        self.assertEqual(blocked_final_action_phrase("Vaciar papelera"), "vaciar papelera")
        self.assertIsNone(blocked_final_action_phrase("Entregar · Práctica 3"))
        self.assertIsNone(blocked_final_action_phrase("Payload de prueba"))

    def test_when_label_reads_naturally(self) -> None:
        self.assertEqual(when_label(NOW + timedelta(days=1), NOW), "Mañana 10:00")
        self.assertEqual(when_label(datetime(2026, 12, 1, 9, 30).astimezone(), NOW), "mar 1 dic 09:30")


class EncargoToolWiringTests(unittest.TestCase):
    def test_executor_stages_card_and_resolves_files_inside_workspace(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xook_encargo_") as tmp:
            root = Path(tmp)
            (root / "datos").mkdir()
            (root / "datos" / "reporte.pdf").write_bytes(b"%PDF-1.4")
            ex = WorkspaceToolExecutor(root)
            when = (datetime.now() + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M")

            ok = ex.execute("encargo_schedule", _args(when=when))
            self.assertTrue(ok["ok"], ok)
            self.assertEqual(len(ex.staged_tasks), 1)
            self.assertEqual(ex.staged_tasks[0]["stagingPayload"]["files"], ["datos/reporte.pdf"])

            missing = ex.execute("encargo_schedule", _args(when=when, files=["datos/otro.pdf"]))
            self.assertFalse(missing["ok"])
            self.assertEqual(len(ex.staged_tasks), 1)

    def test_catalog_preloads_tool_for_delivery_requests(self) -> None:
        self.assertIn("pendientes", detect_initial_toolkits("entrega esto a las 4 de la tarde en Teams"))
        self.assertIn("pendientes", detect_initial_toolkits("súbelo mañana al Classroom"))
        self.assertNotIn("pendientes", detect_initial_toolkits("¿qué es la fotosíntesis?"))


def _make_db(root: Path, rows) -> None:
    import sqlite3

    (root / ".xook").mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(root / ".xook" / "xook.db")
    conn.executescript(
        "CREATE TABLE encargos (id TEXT PRIMARY KEY, name TEXT, folder TEXT, next_run_at TEXT, status TEXT, "
        "target_app TEXT, may_finish INTEGER);"
        "CREATE TABLE encargo_runs (id TEXT PRIMARY KEY, encargo_id TEXT, started_at TEXT, report_path TEXT);"
    )
    conn.executemany(
        "INSERT INTO encargos (id, name, folder, next_run_at, status, target_app, may_finish) VALUES (?,?,?,?,?,?,?)",
        rows,
    )
    conn.commit()
    conn.close()


class EncargoContextTests(unittest.TestCase):
    def test_context_block_lists_today_tomorrow_and_attention_only(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xook_encargo_ctx_") as tmp:
            root = Path(tmp)
            at = lambda days, h: (NOW + timedelta(days=days)).replace(hour=h, minute=0).isoformat()
            _make_db(root, [
                ("e1", "Práctica 3", "agente/encargos/practica-3", at(0, 16), "programado", "Microsoft Teams", 1),
                ("e2", "Reporte semanal", "agente/encargos/reporte", at(1, 9), "programado", None, 0),
                ("e3", "Lejano", "agente/encargos/lejano", at(5, 9), "programado", None, 0),
                ("e4", "Tarea vieja", "agente/encargos/vieja", at(-1, 9), "perdido", "Microsoft Teams", 1),
                ("e5", "Ya hecho", "agente/encargos/hecho", at(-1, 8), "hecho", None, 0),
            ])
            block = encargos_context_block(root, now=NOW)

        self.assertIn("Hoy 16:00 · Práctica 3 · programado (Microsoft Teams, lo deja hecho)", block)
        self.assertIn("Mañana 09:00 · Reporte semanal · programado (lo deja listo)", block)
        self.assertIn("Tarea vieja · se pasó la hora", block)
        self.assertNotIn("Lejano", block)
        self.assertNotIn("Ya hecho", block)

    def test_context_block_is_empty_without_database(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xook_encargo_ctx_") as tmp:
            self.assertEqual(encargos_context_block(Path(tmp), now=NOW), "")

    def test_read_encargo_returns_md_and_latest_report(self) -> None:
        with tempfile.TemporaryDirectory(prefix="xook_encargo_read_") as tmp:
            root = Path(tmp)
            folder = root / "agente" / "encargos" / "practica-3"
            folder.mkdir(parents=True)
            (folder / "encargo.md").write_text("# Práctica 3", encoding="utf-8")
            (folder / "informe-2026-11-23-1600.md").write_text("# Práctica 3 · Hecho", encoding="utf-8")
            _make_db(root, [("e1", "Práctica 3", "agente/encargos/practica-3", NOW.isoformat(), "hecho", None, 0)])
            import sqlite3

            conn = sqlite3.connect(root / ".xook" / "xook.db")
            conn.execute(
                "INSERT INTO encargo_runs VALUES ('r1', 'e1', ?, 'agente/encargos/practica-3/informe-2026-11-23-1600.md')",
                (NOW.isoformat(),),
            )
            conn.commit()
            conn.close()

            found = read_encargo(root, "practica")
            missing = read_encargo(root, "otra cosa")

        self.assertTrue(found["ok"])
        self.assertEqual(found["encargo_md"], "# Práctica 3")
        self.assertEqual(found["last_report"], "# Práctica 3 · Hecho")
        self.assertFalse(missing["ok"])
        self.assertIn("Práctica 3", missing["error"])

    def test_run_rules_depend_on_final_click_permission(self) -> None:
        finish = encargo_run_rules({
            "targetApp": "Microsoft Teams",
            "mayFinish": True,
            "finalAction": "Entregar · Práctica 3",
            "procedurePath": "memoria/procedimientos/microsoft-teams.md",
        })
        self.assertIn("El último clic autorizado es «Entregar · Práctica 3»", finish)
        self.assertIn("memoria/procedimientos/microsoft-teams.md", finish)
        self.assertIn("RESULTADO: hecho", finish)

        ready = encargo_run_rules({"targetApp": "Microsoft Teams", "mayFinish": False})
        self.assertIn("NO des el último clic", ready)


if __name__ == "__main__":
    unittest.main()
