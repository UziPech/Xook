import json
import unittest

from slices.provider_evals.grader import grade


SCHEMAS = {
    "workspace_read": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    "workspace_edit_file": {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "old_text": {"type": "string"},
            "new_text": {"type": "string"},
            "replace_all": {"type": "boolean"},
        },
        "required": ["path", "old_text", "new_text"],
    },
    "read_screen_now": {
        "type": "object",
        "properties": {"mode": {"type": "string", "enum": ["text", "full"]}},
        "required": [],
    },
    "run_workspace_command": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
}

EDIT_CASE = {
    "id": "editar",
    "espera": {
        "herramienta_en": ["workspace_edit_file"],
        "args_coinciden": {"path": "horario\\.md", "old_text": "18:00", "new_text": "19:00"},
        "aceptables": ["workspace_read"],
        "prohibidas": ["run_workspace_command"],
    },
}


def _response(*calls, text=""):
    tool_calls = [
        {"id": f"c{i}", "type": "function", "function": {"name": name, "arguments": args if isinstance(args, str) else json.dumps(args)}}
        for i, (name, args) in enumerate(calls)
    ]
    message = {"role": "assistant", "content": text}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message}]}


class GraderTests(unittest.TestCase):
    def test_expected_tool_with_matching_args_is_ok(self):
        res = grade(EDIT_CASE, _response(("workspace_edit_file", {"path": "config/horario.md", "old_text": "Cierre: 18:00", "new_text": "Cierre: 19:00"})), SCHEMAS)
        self.assertEqual(res["resultado"], "ok")
        self.assertEqual(res["puntaje"], 1.0)

    def test_preparatory_step_gets_partial_credit(self):
        res = grade(EDIT_CASE, _response(("workspace_read", {"path": "config/horario.md"})), SCHEMAS)
        self.assertEqual(res["resultado"], "ok_preparatorio")
        self.assertEqual(res["puntaje"], 0.5)

    def test_args_mismatch_fails(self):
        res = grade(EDIT_CASE, _response(("workspace_edit_file", {"path": "config/horario.md", "old_text": "17:00", "new_text": "19:00"})), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("old_text", res["motivo"])

    def test_invented_tool_fails(self):
        res = grade(EDIT_CASE, _response(("edit_file", {"path": "x"})), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("inventada", res["motivo"])

    def test_invalid_json_arguments_fail(self):
        res = grade(EDIT_CASE, _response(("workspace_edit_file", '{"path": "config/horario.md",')), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("JSON", res["motivo"])

    def test_missing_required_argument_fails(self):
        res = grade(EDIT_CASE, _response(("workspace_edit_file", {"path": "config/horario.md", "old_text": "18:00"})), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("new_text", res["motivo"])

    def test_wrong_type_fails(self):
        args = {"path": "config/horario.md", "old_text": "18:00", "new_text": "19:00", "replace_all": "true"}
        res = grade(EDIT_CASE, _response(("workspace_edit_file", args)), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("boolean", res["motivo"])

    def test_forbidden_tool_fails_even_alongside_expected_one(self):
        res = grade(
            EDIT_CASE,
            _response(
                ("run_workspace_command", {"command": "sed -i '' s/18/19/ config/horario.md"}),
                ("workspace_edit_file", {"path": "config/horario.md", "old_text": "18:00", "new_text": "19:00"}),
            ),
            SCHEMAS,
        )
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("prohíbe", res["motivo"])

    def test_enum_violation_fails(self):
        case = {"id": "pantalla", "espera": {"herramienta_en": ["read_screen_now"]}}
        res = grade(case, _response(("read_screen_now", {"mode": "ocr"})), SCHEMAS)
        self.assertEqual(res["resultado"], "fallo")
        self.assertIn("mode", res["motivo"])

    def test_no_tool_case(self):
        case = {"id": "saludo", "espera": {"sin_herramienta": True}}
        self.assertEqual(grade(case, _response(text="¡Hola! Todo bien."), SCHEMAS)["resultado"], "ok")
        self.assertEqual(grade(case, _response(("read_screen_now", {})), SCHEMAS)["resultado"], "fallo")
        self.assertEqual(grade(case, _response(text="  "), SCHEMAS)["resultado"], "fallo")

    def test_missing_tool_call_fails_unless_allowed(self):
        strict = {"id": "a", "espera": {"herramienta_en": ["read_screen_now"]}}
        lenient = {"id": "b", "espera": {"herramienta_en": ["read_screen_now"], "permite_sin_herramienta": True}}
        reply = _response(text="No tengo una herramienta para eso.")
        self.assertEqual(grade(strict, reply, SCHEMAS)["resultado"], "fallo")
        self.assertEqual(grade(lenient, reply, SCHEMAS)["resultado"], "ok")

    def test_args_text_patterns_must_all_match(self):
        case = {"id": "t", "espera": {"herramienta_en": ["workspace_read"], "args_texto_coincide": ["horario", "config"]}}
        self.assertEqual(grade(case, _response(("workspace_read", {"path": "config/horario.md"})), SCHEMAS)["resultado"], "ok")
        self.assertEqual(grade(case, _response(("workspace_read", {"path": "horario.md"})), SCHEMAS)["resultado"], "fallo")

    def test_empty_response_fails(self):
        case = {"id": "x", "espera": {"herramienta_en": ["read_screen_now"]}}
        self.assertEqual(grade(case, {"choices": []}, SCHEMAS)["resultado"], "fallo")


if __name__ == "__main__":
    unittest.main()
