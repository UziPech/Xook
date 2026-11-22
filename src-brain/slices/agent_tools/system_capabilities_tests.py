import sys
import unittest

from slices.agent_tools.system_capabilities import (
    CAPABILITY_TOOLS,
    filter_tool_defs_for_system,
    system_capabilities,
    unavailable_tools,
)


def _tool(name: str) -> dict:
    return {"type": "function", "function": {"name": name, "parameters": {"type": "object", "properties": {}}}}


ALL_OS_TOOLS = set().union(*CAPABILITY_TOOLS.values())


class SystemCapabilitiesTests(unittest.TestCase):
    def test_macos_has_every_capability(self):
        self.assertEqual(system_capabilities("darwin"), frozenset(CAPABILITY_TOOLS))
        self.assertEqual(unavailable_tools("darwin"), set())

    def test_windows_linux_and_unknown_systems_drop_native_tools(self):
        for platform in ("win32", "linux", "freebsd14"):
            self.assertEqual(unavailable_tools(platform), ALL_OS_TOOLS, platform)

    def test_filter_keeps_portable_tools_in_order(self):
        defs = [_tool("workspace_read"), _tool("desktop_act"), _tool("memory_search"), _tool("os_create_note")]
        names = [d["function"]["name"] for d in filter_tool_defs_for_system(defs, "win32")]
        self.assertEqual(names, ["workspace_read", "memory_search"])
        self.assertEqual(len(filter_tool_defs_for_system(defs, "darwin")), 4)

    def test_agent_catalog_matches_this_system(self):
        from slices.agent_tools.toolkit import AGENT_TOOL_DEFS

        names = {d["function"]["name"] for d in AGENT_TOOL_DEFS}
        self.assertFalse(names & unavailable_tools(), "el catálogo expone herramientas que este sistema no ejecuta")
        if sys.platform == "darwin":
            # Si una herramienta nativa se renombra, este test avisa que hay que actualizar el mapa.
            self.assertEqual(ALL_OS_TOOLS - names, set())


if __name__ == "__main__":
    unittest.main()
