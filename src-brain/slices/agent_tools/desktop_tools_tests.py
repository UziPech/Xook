import tempfile
import unittest
from pathlib import Path

from slices.agent_tools import (
    AGENT_TOOL_DEFS,
    TOOL_SEARCH_TOOL_DEF,
    WorkspaceToolExecutor,
)


class DesktopControlToolsTests(unittest.TestCase):
    def test_desktop_tools_and_tool_search_have_valid_schemas(self) -> None:
        by_name = {td["function"]["name"]: td["function"] for td in [*AGENT_TOOL_DEFS, TOOL_SEARCH_TOOL_DEF]}
        for name in ("desktop_list_windows", "desktop_snapshot", "desktop_find", "desktop_act", "tool_search"):
            self.assertIn(name, by_name)
            params = by_name[name]["parameters"]
            self.assertEqual(params.get("type"), "object")
            self.assertTrue(params.get("properties"), f"{name} must declare non-empty properties")
        act_enum = by_name["desktop_act"]["parameters"]["properties"]["action"]["enum"]
        for expected in ("click", "set_value", "type_text", "press_key", "focus", "scroll_to", "focus_window"):
            self.assertIn(expected, act_enum)

    def test_desktop_act_rejects_bare_ref_before_calling_bridge(self) -> None:
        called = []

        def fake_bridge(payload: dict) -> dict:
            called.append(payload)
            return {"ok": True}

        with tempfile.TemporaryDirectory(prefix="xook_dact_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute("desktop_act", {"action": "click", "ref_id": "@e1", "purpose": "Probar"})
            self.assertFalse(res["ok"])
            self.assertEqual(res["disposition"]["delivery"], "not_delivered")
            self.assertEqual(res["disposition"]["retry"], "safe")
            self.assertEqual(called, [])

    def test_desktop_act_preserves_rust_unverified_disposition_and_triggers_verification_snapshot(self) -> None:
        captured = []

        def fake_bridge(payload: dict) -> dict:
            captured.append(payload)
            if payload.get("rpc_callback") == "desktop_act":
                return {
                    "ok": False,
                    "action": "click",
                    "appName": "Excel",
                    "refId": "s1:@e3",
                    "error": "Timeout durante AXPress",
                    "disposition": {
                        "delivery": "delivered_unverified",
                        "retry": "verify_first",
                        "verified": False,
                        "reason": "El clic pudo haber aterrizado.",
                    },
                }
            if payload.get("rpc_callback") == "desktop_find":
                return {
                    "ok": True,
                    "accessibilityGranted": True,
                    "blockedSensitive": False,
                    "snapshotId": "s9",
                    "window": {"appName": "Excel", "bundleId": "com.microsoft.Excel", "title": "Hoja1"},
                    "complete": True,
                    "truncated": False,
                    "nodesObserved": 40,
                    "refsAllocated": 1,
                    "treeText": "Búsqueda s9 · App: Excel\n- button [s9:@e1] \"Guardar\" @(200,40,80x24) {click}",
                }
            return {"ok": True}

        with tempfile.TemporaryDirectory(prefix="xook_dact2_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute(
                "desktop_act",
                {
                    "action": "click",
                    "ref_id": "s1:@e3",
                    "purpose": "Presionar Guardar en Excel",
                    "client_request_id": "click_save_01",
                },
            )
            self.assertFalse(res["ok"])
            self.assertEqual(len(captured), 2)
            self.assertEqual(captured[0]["rpc_callback"], "desktop_act")
            self.assertEqual(captured[0]["client_request_id"], "click_save_01")
            self.assertEqual(captured[1]["rpc_callback"], "desktop_find")
            self.assertEqual(res["disposition"]["delivery"], "delivered_unverified")
            self.assertEqual(res["disposition"]["retry"], "verify_first")
            self.assertTrue(res["verification_triggered"])
            self.assertTrue(res["blind_retry_forbidden"])
            self.assertEqual(res["verification_snapshot"]["snapshot_id"], "s9")

    def test_desktop_snapshot_marks_external_untrusted_and_respects_sensitive_block(self) -> None:
        responses = [
            {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": False,
                "snapshotId": "s1",
                "window": {"appName": "Finder", "bundleId": "com.apple.finder", "title": "Docs"},
                "complete": True,
                "truncated": False,
                "nodesObserved": 12,
                "refsAllocated": 3,
                "treeText": "Snapshot s1 · App: Finder\n- button [s1:@e1] \"Nueva carpeta\" {click}",
            },
            {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": True,
                "sensitiveReason": "App de contraseñas (1Password)",
            },
        ]

        def fake_bridge(_payload: dict) -> dict:
            return responses.pop(0)

        with tempfile.TemporaryDirectory(prefix="xook_dsnap_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            ok_res = ex.execute("desktop_snapshot", {"app_name": "Finder", "interactive_only": True})
            self.assertTrue(ok_res["ok"])
            self.assertEqual(ok_res["snapshot_id"], "s1")
            self.assertEqual(ok_res["trust_level"], "external_untrusted_data")
            self.assertIn("s1:@e1", ok_res["tree_text"])

            sec_res = ex.execute("desktop_snapshot", {"app_name": "1Password"})
            self.assertTrue(sec_res["ok"])
            self.assertTrue(sec_res["blocked_sensitive"])
            self.assertNotIn("tree_text", sec_res)

    def test_desktop_find_forwards_roles_and_query_and_marks_untrusted(self) -> None:
        captured = []

        def fake_bridge(payload: dict) -> dict:
            captured.append(payload)
            return {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": False,
                "snapshotId": "s2",
                "window": {"appName": "Antigravity", "bundleId": "com.google.antigravity", "title": "Xook"},
                "complete": True,
                "truncated": False,
                "nodesObserved": 412,
                "refsAllocated": 2,
                "treeText": "Find s2 · App: Antigravity\n- textarea [s2:@e1] \"Ask anything\" @(820,760,420x48) {click, type_text}",
            }

        with tempfile.TemporaryDirectory(prefix="xook_dfind_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute(
                "desktop_find",
                {
                    "app_name": "Antigravity",
                    "query": "ask",
                    "roles": ["textarea", "textfield"],
                    "limit": 10,
                },
            )
            self.assertTrue(res["ok"])
            self.assertEqual(res["snapshot_id"], "s2")
            self.assertEqual(res["trust_level"], "external_untrusted_data")
            self.assertIn("s2:@e1", res["tree_text"])
            self.assertEqual(len(captured), 1)
            self.assertEqual(captured[0]["rpc_callback"], "desktop_find")
            self.assertEqual(captured[0]["roles"], ["textarea", "textfield"])
            self.assertEqual(captured[0]["limit"], 10)

    def test_desktop_act_type_text_press_key_and_coordinate_click(self) -> None:
        captured = []

        def fake_bridge(payload: dict) -> dict:
            captured.append(payload)
            return {
                "ok": True,
                "action": payload.get("action"),
                "disposition": {"delivery": "delivered_verified", "retry": "do_not_retry", "verified": True},
            }

        with tempfile.TemporaryDirectory(prefix="xook_dact_v2_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)

            # type_text with ref_id + clear + press_enter
            res_type = ex.execute(
                "desktop_act",
                {
                    "action": "type_text",
                    "ref_id": "s2:@e1",
                    "value": "Hola desde Xook",
                    "clear": True,
                    "press_enter": True,
                    "purpose": "Escribir y enviar mensaje en Antigravity",
                },
            )
            self.assertTrue(res_type["ok"])
            self.assertEqual(captured[-1]["action"], "type_text")
            self.assertEqual(captured[-1]["value"], "Hola desde Xook")
            self.assertTrue(captured[-1]["clear"])
            self.assertTrue(captured[-1]["press_enter"])

            # type_text without ref_id or coordinates is BLOCKED on Electron/Chromium apps (Rule B)
            before_electron_block = len(captured)
            blocked_electron = ex.execute(
                "desktop_act",
                {
                    "action": "type_text",
                    "app_name": "Antigravity",
                    "value": "Mensaje a ciegas",
                    "purpose": "Intento sin ref ni coordenadas en Electron",
                },
            )
            self.assertFalse(blocked_electron["ok"])
            self.assertIn("BLOCKED_BLIND_TYPE", blocked_electron["error"])
            self.assertEqual(blocked_electron["disposition"]["delivery"], "not_delivered")
            self.assertEqual(len(captured), before_electron_block)

            # type_text with explicit physical coordinates (x, y) IS allowed on Electron/Chromium apps
            res_type_xy = ex.execute(
                "desktop_act",
                {
                    "action": "type_text",
                    "app_name": "Antigravity",
                    "x": 620.0,
                    "y": 755.0,
                    "value": "Mensaje con coordenadas",
                    "press_enter": True,
                    "purpose": "Clic en coordenadas y escribir en Antigravity",
                },
            )
            self.assertTrue(res_type_xy["ok"])
            self.assertIsNone(captured[-1]["ref_id"])
            self.assertEqual(captured[-1]["x"], 620.0)
            self.assertEqual(captured[-1]["y"], 755.0)
            self.assertTrue(captured[-1]["press_enter"])

            # type_text without ref_id IS still forwarded for native macOS apps (Rust verifies live editable focus)
            res_type_native = ex.execute(
                "desktop_act",
                {
                    "action": "type_text",
                    "app_name": "TextEdit",
                    "value": "Nota rápida",
                    "purpose": "Teclear en documento activo",
                },
            )
            self.assertTrue(res_type_native["ok"])
            self.assertIsNone(captured[-1]["ref_id"])
            self.assertEqual(captured[-1]["app_name"], "TextEdit")

            # press_key
            res_key = ex.execute(
                "desktop_act",
                {
                    "action": "press_key",
                    "app_name": "Antigravity",
                    "key": "return",
                    "purpose": "Enviar mensaje",
                },
            )
            self.assertTrue(res_key["ok"])
            self.assertEqual(captured[-1]["key"], "return")

            # coordinate click
            res_xy = ex.execute(
                "desktop_act",
                {
                    "action": "click",
                    "app_name": "Antigravity",
                    "x": 920.5,
                    "y": 784.0,
                    "headed": True,
                    "purpose": "Hacer clic en caja de chat",
                },
            )
            self.assertTrue(res_xy["ok"])
            self.assertEqual(captured[-1]["x"], 920.5)
            self.assertEqual(captured[-1]["y"], 784.0)
            self.assertTrue(captured[-1]["headed"])

            # Validation errors should not hit the bridge
            before_count = len(captured)
            bad_type = ex.execute("desktop_act", {"action": "type_text", "value": "", "purpose": "Vacío"})
            self.assertFalse(bad_type["ok"])
            bad_key = ex.execute("desktop_act", {"action": "press_key", "purpose": "Sin tecla"})
            self.assertFalse(bad_key["ok"])
            bad_click = ex.execute("desktop_act", {"action": "click", "app_name": "Antigravity", "purpose": "Sin ref ni xy"})
            self.assertFalse(bad_click["ok"])
            bad_half_xy = ex.execute("desktop_act", {"action": "click", "x": 100, "purpose": "Falta y"})
            self.assertFalse(bad_half_xy["ok"])
            self.assertEqual(len(captured), before_count)

    def test_desktop_find_auto_retries_when_truncated_with_zero_hits_and_drill_container(self) -> None:
        calls = []

        def fake_bridge(payload: dict) -> dict:
            calls.append(payload)
            if len(calls) == 1:
                return {
                    "ok": True,
                    "accessibilityGranted": True,
                    "blockedSensitive": False,
                    "snapshotId": "s4",
                    "window": {"appName": "Antigravity", "bundleId": "com.google.antigravity", "title": "Xook"},
                    "complete": False,
                    "truncated": True,
                    "nodesObserved": 1389,
                    "refsAllocated": 1,
                    "treeText": (
                        "Búsqueda s4 · App: Antigravity · 1 coincidencias [búsqueda truncada]\n"
                        "- web_area [s4:@e1] \"Chat\" @(520,80,480x750) [drill_container: usa como root_ref]"
                    ),
                }
            return {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": False,
                "snapshotId": "s5",
                "window": {"appName": "Antigravity", "bundleId": "com.google.antigravity", "title": "Xook"},
                "complete": True,
                "truncated": False,
                "nodesObserved": 210,
                "refsAllocated": 1,
                "treeText": (
                    "Búsqueda s5 · App: Antigravity · 1 coincidencias\n"
                    "- textarea [s5:@e1] \"Message input\" @(553,730,422x49) {click, type_text}"
                ),
            }

        with tempfile.TemporaryDirectory(prefix="xook_dfind_retry_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute(
                "desktop_find",
                {
                    "app_name": "Antigravity",
                    "window_id": 62571,
                    "query": "message",
                    "roles": ["textarea", "textfield"],
                },
            )
            self.assertTrue(res["ok"])
            self.assertEqual(len(calls), 2)
            # Second call drilled down into s4:@e1 without text query and escalated max_nodes
            self.assertEqual(calls[1]["root_ref"], "s4:@e1")
            self.assertEqual(calls[1]["query"], "")
            self.assertGreaterEqual(calls[1]["max_nodes"], 4500)
            self.assertTrue(res["auto_retried"])
            self.assertEqual(res["snapshot_id"], "s5")
            self.assertEqual(res["search_status"], "complete")
            self.assertIn("Message input", res["tree_text"])

    def test_desktop_find_distinguishes_partial_scan_with_matches_from_empty_truncation(self) -> None:
        calls = []

        def fake_bridge(payload: dict) -> dict:
            calls.append(payload)
            return {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": False,
                "snapshotId": "s8",
                "window": {"appName": "Antigravity", "bundleId": "com.google.antigravity", "title": "Xook"},
                "complete": False,
                "truncated": True,
                "nodesObserved": 2104,
                "refsAllocated": 1,
                "treeText": (
                    "Búsqueda s8 · App: Antigravity · 1 coincidencias (de 2104 nodos revisados / tope 6000) "
                    "[coincidencias encontradas; recorrido parcial del árbol]\n"
                    "- textarea [s8:@e1] \"Message input\" @(553,730,422x49) {click, type_text}"
                ),
            }

        with tempfile.TemporaryDirectory(prefix="xook_dfind_partial_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute(
                "desktop_find",
                {"app_name": "Antigravity", "roles": ["textarea", "textfield"], "max_nodes": 6000},
            )
            self.assertTrue(res["ok"])
            self.assertEqual(len(calls), 1)
            self.assertEqual(res["matched_hits"], 1)
            self.assertEqual(res["search_status"], "matches_found_partial_scan")
            self.assertFalse(res.get("auto_retried", False))

    def test_desktop_act_stale_ref_triggers_automatic_verification_snapshot(self) -> None:
        calls = []

        def fake_bridge(payload: dict) -> dict:
            calls.append(payload)
            if payload.get("rpc_callback") == "desktop_act":
                return {
                    "ok": False,
                    "action": "type_text",
                    "appName": "Antigravity",
                    "refId": "s1:@e2",
                    "error": "STALE_REF: El elemento 's1:@e2' ya no existe en la ventana.",
                    "disposition": {"delivery": "not_delivered", "retry": "safe", "verified": False},
                }
            return {
                "ok": True,
                "accessibilityGranted": True,
                "blockedSensitive": False,
                "snapshotId": "s6",
                "window": {"appName": "Antigravity", "bundleId": "com.google.antigravity", "title": "Xook"},
                "complete": True,
                "truncated": False,
                "nodesObserved": 180,
                "refsAllocated": 1,
                "treeText": "Búsqueda s6 · App: Antigravity\n- textarea [s6:@e1] \"Message input\" @(553,730,422x49)",
            }

        with tempfile.TemporaryDirectory(prefix="xook_stale_") as tmp:
            ex = WorkspaceToolExecutor(Path(tmp), command_bridge=fake_bridge)
            res = ex.execute(
                "desktop_act",
                {
                    "action": "type_text",
                    "ref_id": "s1:@e2",
                    "app_name": "Antigravity",
                    "window_id": 62571,
                    "value": "Hola",
                    "purpose": "Escribir en chat",
                },
            )
            self.assertFalse(res["ok"])
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[1]["rpc_callback"], "desktop_find")
            self.assertTrue(res["verification_triggered"])
            self.assertTrue(res["blind_retry_forbidden"])
            self.assertEqual(res["verification_snapshot"]["snapshot_id"], "s6")


if __name__ == "__main__":
    unittest.main()
