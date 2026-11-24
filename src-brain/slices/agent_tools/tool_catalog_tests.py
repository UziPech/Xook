import unittest

from slices.agent_tools.tool_catalog import (
    CORE_ALWAYS_LOADED_TOOLS,
    TOOL_SEARCH_NAME,
    ToolExposureSession,
    detect_initial_toolkits,
)


def _fake_tool(name: str, description: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": {}},
        },
    }


SAMPLE_CATALOG = [
    _fake_tool("workspace_list", "Lista archivos del workspace."),
    _fake_tool("workspace_read", "Lee un archivo."),
    _fake_tool("read_screen_now", "Lee la pantalla actual."),
    _fake_tool("desktop_list_windows", "Lista ventanas abiertas en macOS."),
    _fake_tool("desktop_snapshot", "Inspecciona el árbol de accesibilidad con refs s1:@e1."),
    _fake_tool("desktop_find", "Búsqueda profunda de controles en otra app con refs s1:@e1."),
    _fake_tool("desktop_act", "Ejecuta click, type_text, press_key o set_value sobre un control de otra app."),
    _fake_tool("os_create_note", "Crea una nota en Apple Notes."),
    _fake_tool("pdf_generate", "Genera o edita un documento PDF profesional."),
    _fake_tool("run_custom_script", "Ejecuta un script Python/Node bajo Guardián."),
    _fake_tool("create_dashboard", "Abre un dashboard visual en Canvas."),
]


class ToolCatalogTests(unittest.TestCase):
    def test_starts_compact_with_core_plus_tool_search_for_generic_prompt(self) -> None:
        session = ToolExposureSession(SAMPLE_CATALOG, user_message="hola, resumen del proyecto")
        active_names = {td["function"]["name"] for td in session.active_tool_defs()}

        self.assertIn("workspace_list", active_names)
        self.assertIn("workspace_read", active_names)
        self.assertIn(TOOL_SEARCH_NAME, active_names)
        self.assertNotIn("desktop_act", active_names)
        self.assertNotIn("pdf_generate", active_names)
        self.assertNotIn("os_create_note", active_names)

    def test_preloads_desktop_ui_toolkit_when_user_mentions_other_app_ui(self) -> None:
        toolkits = detect_initial_toolkits("Revisa la ventana de Excel y haz clic en Guardar")
        self.assertIn("desktop_ui", toolkits)

        session = ToolExposureSession(
            SAMPLE_CATALOG,
            user_message="Revisa la ventana de Excel y haz clic en Guardar",
        )
        active_names = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertIn("desktop_list_windows", active_names)
        self.assertIn("desktop_snapshot", active_names)
        self.assertIn("desktop_find", active_names)
        self.assertIn("desktop_act", active_names)

    def test_preloads_desktop_find_for_antigravity_message_prompt(self) -> None:
        msg = "Envía un mensaje por la ventana de Antigravity diciendo hola"
        toolkits = detect_initial_toolkits(msg)
        self.assertIn("desktop_ui", toolkits)

        session = ToolExposureSession(SAMPLE_CATALOG, user_message=msg)
        active_names = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertIn("desktop_find", active_names)
        self.assertIn("desktop_act", active_names)

    def test_tool_search_dynamically_loads_deferred_tools_for_next_round(self) -> None:
        session = ToolExposureSession(SAMPLE_CATALOG, user_message="ayúdame a organizar tareas")
        before = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertNotIn("pdf_generate", before)

        res = session.search("pdf documento reporte")
        self.assertTrue(res["ok"])
        self.assertIn("pdf_generate", res["loaded_now"])

        after = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertIn("pdf_generate", after)

    def test_any_app_can_be_looked_at_without_a_keyword(self) -> None:
        session = ToolExposureSession(SAMPLE_CATALOG, user_message="revisa si en blackboard dejaron algo nuevo")
        active_names = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertIn("desktop_list_windows", active_names)
        self.assertIn("desktop_snapshot", active_names)
        self.assertNotIn("desktop_act", active_names)

        self.assertIn("desktop_act", session.note_tool_used("desktop_list_windows"))
        active_names = {td["function"]["name"] for td in session.active_tool_defs()}
        self.assertLessEqual({"desktop_find", "desktop_act"}, active_names)

    def test_using_a_core_tool_without_toolkit_loads_nothing(self) -> None:
        session = ToolExposureSession(SAMPLE_CATALOG, user_message="lee el contrato")
        self.assertEqual(session.note_tool_used("workspace_read"), [])

    def test_messages_for_other_apps_preload_the_whole_desktop_toolkit(self) -> None:
        for msg in (
            "revisame si en teams tengo algunas tareas pendientes",
            "dile a claude que no puedes abrir mi app",
            "pregúntale a Juan si ya llegó",
        ):
            self.assertIn("desktop_ui", detect_initial_toolkits(msg), msg)

    def test_core_set_always_includes_tool_search(self) -> None:
        self.assertIn(TOOL_SEARCH_NAME, CORE_ALWAYS_LOADED_TOOLS)


if __name__ == "__main__":
    unittest.main()
