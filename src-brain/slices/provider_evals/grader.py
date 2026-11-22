"""
Calificación determinista de la primera respuesta de un modelo frente a un caso de eval.

Solo mira la primera ronda (qué herramienta elige y con qué argumentos), sin ejecutar nada.
Eso aísla la fiabilidad del modelo para tool calling de la del harness de XOOK.

Resultados posibles:
- `ok`: llamó a la herramienta esperada con argumentos válidos (o respondió sin herramientas cuando tocaba).
- `ok_preparatorio`: no llegó a la acción esperada, pero dio un paso previo válido (ej. leer antes de editar).
- `fallo`: cualquier otra cosa; `motivo` explica por qué.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple


PUNTAJE = {"ok": 1.0, "ok_preparatorio": 0.5, "fallo": 0.0}

_JSON_TYPES = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


def extract_first_turn(response: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]]]:
    """Devuelve (texto, llamadas) del primer choice de una respuesta estilo OpenAI."""
    choices = response.get("choices") or []
    if not choices:
        return "", []
    message = choices[0].get("message") or {}
    text = str(message.get("content") or "")
    calls: List[Dict[str, Any]] = []
    for tc in message.get("tool_calls") or []:
        fn = tc.get("function") or {}
        calls.append({"name": str(fn.get("name") or ""), "arguments": fn.get("arguments")})
    return text, calls


def _parse_args(raw: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    if isinstance(raw, dict):
        return raw, None
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return {}, None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return None, "argumentos no son JSON válido"
    if not isinstance(parsed, dict):
        return None, "argumentos no son un objeto JSON"
    return parsed, None


def _schema_error(args: Dict[str, Any], schema: Dict[str, Any]) -> Optional[str]:
    """Validación mínima: requeridos, tipo de primer nivel y enums. Sin dependencias externas."""
    for key in schema.get("required") or []:
        if key not in args:
            return f"falta el argumento requerido `{key}`"
    props = schema.get("properties") or {}
    for key, value in args.items():
        spec = props.get(key)
        if not isinstance(spec, dict):
            continue
        expected = _JSON_TYPES.get(str(spec.get("type") or ""))
        # bool es subclase de int en Python; no aceptarlo como número.
        if expected and (not isinstance(value, expected) or (isinstance(value, bool) and spec.get("type") != "boolean")):
            return f"`{key}` debería ser {spec.get('type')}"
        enum = spec.get("enum")
        if isinstance(enum, list) and value not in enum:
            return f"`{key}` = {value!r} no está en {enum}"
    return None


def _args_error(args: Dict[str, Any], expect: Dict[str, Any]) -> Optional[str]:
    for key, pattern in (expect.get("args_coinciden") or {}).items():
        value = args.get(key)
        if value is None:
            return f"falta `{key}`"
        if not re.search(pattern, value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), re.IGNORECASE):
            return f"`{key}` no coincide con /{pattern}/"
    serialized = json.dumps(args, ensure_ascii=False)
    for pattern in expect.get("args_texto_coincide") or []:
        if not re.search(pattern, serialized, re.IGNORECASE):
            return f"los argumentos no mencionan /{pattern}/"
    return None


def grade(case: Dict[str, Any], response: Dict[str, Any], tool_schemas: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Califica una respuesta. `tool_schemas` mapea nombre -> `parameters` de las herramientas expuestas."""
    expect = case.get("espera") or {}
    text, calls = extract_first_turn(response)

    def result(outcome: str, motivo: str = "") -> Dict[str, Any]:
        return {
            "caso": case.get("id"),
            "resultado": outcome,
            "puntaje": PUNTAJE[outcome],
            "motivo": motivo,
            "herramientas_llamadas": [c["name"] for c in calls],
        }

    if not calls:
        if expect.get("sin_herramienta") or expect.get("permite_sin_herramienta"):
            return result("ok") if text.strip() else result("fallo", "respuesta vacía")
        return result("fallo", "no llamó ninguna herramienta")

    if expect.get("sin_herramienta"):
        return result("fallo", f"llamó `{calls[0]['name']}` cuando debía responder sin herramientas")

    # Revisiones generales: nombres existentes, JSON válido, schema respetado.
    parsed_calls: List[Tuple[str, Dict[str, Any]]] = []
    for call in calls:
        name = call["name"]
        if name not in tool_schemas:
            return result("fallo", f"herramienta inventada `{name}`")
        args, err = _parse_args(call["arguments"])
        if err:
            return result("fallo", f"`{name}`: {err}")
        err = _schema_error(args or {}, tool_schemas[name])
        if err:
            return result("fallo", f"`{name}`: {err}")
        parsed_calls.append((name, args or {}))

    forbidden = set(expect.get("prohibidas") or [])
    for name, _ in parsed_calls:
        if name in forbidden:
            return result("fallo", f"usó `{name}`, que este caso prohíbe")

    expected_tools = set(expect.get("herramienta_en") or [])
    last_error = ""
    for name, args in parsed_calls:
        if name in expected_tools:
            err = _args_error(args, expect)
            if not err:
                return result("ok")
            last_error = f"`{name}`: {err}"
    if last_error:
        return result("fallo", last_error)

    preparatory = set(expect.get("aceptables") or [])
    if preparatory and all(name in preparatory for name, _ in parsed_calls):
        return result("ok_preparatorio", f"paso previo: {', '.join(n for n, _ in parsed_calls)}")

    return result("fallo", f"esperaba {sorted(expected_tools)}, llamó {[n for n, _ in parsed_calls]}")
