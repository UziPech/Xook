"""
Runner de evals de proveedores.

Corre los casos de `cases.json` contra uno o varios modelos y muestra qué tan bien usa cada
uno las herramientas reales de XOOK. Gasta tokens reales: correrlo es decisión del usuario.

Las claves salen solo de la bóveda de XOOK. Rust las entrega por stdin con el mismo formato
que `build_provider_credentials_json` (`ai_vault.rs`), igual que en `ai_chat`:

    {"deepseek": {"api_key": "...", "model_id": "deepseek-chat", "region": null}, ...}

Nunca se leen de variables de entorno ni de archivos, y nunca se imprimen. Sin `--target`
se prueba el modelo configurado de cada proveedor; con `--target proveedor:modelo` se prueba
ese modelo con la clave de ese proveedor. Un target sin clave se salta sin tocar la red.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, TextIO, Tuple

from slices.ai_service.provider_registry import normalize_provider_id, resolve_provider_base_url
from slices.provider_evals.grader import grade


CASES_PATH = Path(__file__).with_name("cases.json")

# Prompt mínimo y neutro: mide al modelo, no al prompt de producción de XOOK.
EVAL_SYSTEM_PROMPT = (
    "Eres XOOK, un agente personal que trabaja en la Mac del usuario. "
    "Usa una herramienta cuando la petición requiera actuar, leer o recordar algo; "
    "si basta con responder, responde sin herramientas. "
    "Las acciones destructivas se proponen para aprobación, nunca se ejecutan directo. "
    "Fecha actual: 2026-11-21, zona horaria America/Mexico_City."
)

# (provider, api_key, model, payload, region) -> respuesta estilo OpenAI
Transport = Callable[[str, str, str, Dict[str, Any], Optional[str]], Dict[str, Any]]


def load_cases(path: Path = CASES_PATH) -> List[Dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def load_real_tool_defs() -> Dict[str, Dict[str, Any]]:
    """Definiciones reales del catálogo de XOOK, indexadas por nombre."""
    from slices.agent_tools.toolkit import AGENT_TOOL_DEFS

    return {d["function"]["name"]: d for d in AGENT_TOOL_DEFS}


def case_runs_on_this_system(case: Dict[str, Any], tool_defs: Dict[str, Dict[str, Any]]) -> bool:
    """Un caso cuya acción esperada no existe en este sistema (p. ej. `desktop_*` fuera de macOS) no aplica."""
    expect = case["espera"]
    needed = set(expect.get("herramienta_en") or [])
    return not needed or bool(needed & set(tool_defs)) or bool(expect.get("permite_sin_herramienta"))


def build_payload(case: Dict[str, Any], model: str, tool_defs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    tools = [tool_defs[name] for name in case["herramientas"] if name in tool_defs]
    # Sin `temperature`: varios modelos de razonamiento la rechazan.
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": EVAL_SYSTEM_PROMPT},
            {"role": "user", "content": case["mensaje"]},
        ],
        "tools": tools,
        "tool_choice": "auto",
        "max_tokens": 2048,
    }


def default_transport(
    provider: str,
    api_key: str,
    model: str,
    payload: Dict[str, Any],
    region: Optional[str] = None,
) -> Dict[str, Any]:
    # La misma llamada que usa el agente: el modelo se mide con las peticiones reales de XOOK.
    from slices.ai_service.openrouter_client import _provider_chat_completion

    return _provider_chat_completion(
        provider, api_key, payload, base_url=resolve_provider_base_url(provider, region), timeout=90, model=model
    )


def parse_target(raw: str) -> Tuple[str, str]:
    """`proveedor:modelo`. Solo se parte en el primer `:` (OpenRouter usa sufijos como `:free`)."""
    provider, sep, model = raw.partition(":")
    if not sep or not provider.strip() or not model.strip():
        raise ValueError(f"target inválido `{raw}`; formato esperado proveedor:modelo")
    return normalize_provider_id(provider), model.strip()


def parse_vault_credentials(raw: str) -> Dict[str, Dict[str, Any]]:
    """Lee el JSON de credenciales que entrega Rust. Descarta entradas sin clave."""
    data = json.loads(raw or "{}")
    if not isinstance(data, dict):
        raise ValueError("las credenciales deben ser un objeto JSON proveedor -> datos")
    creds: Dict[str, Dict[str, Any]] = {}
    for raw_pid, info in data.items():
        if not isinstance(info, dict):
            continue
        api_key = str(info.get("api_key") or "").strip()
        if not api_key:
            continue
        creds[normalize_provider_id(raw_pid)] = {
            "api_key": api_key,
            "model_id": str(info.get("model_id") or "").strip(),
            "region": info.get("region"),
        }
    return creds


def resolve_targets(raw_targets: Optional[List[str]], creds: Dict[str, Dict[str, Any]]) -> List[Tuple[str, str]]:
    """Sin targets explícitos: el modelo configurado de cada proveedor con clave en la bóveda."""
    if raw_targets:
        return [parse_target(t) for t in raw_targets]
    return [(pid, info["model_id"]) for pid, info in sorted(creds.items()) if info["model_id"]]


def run_target(
    provider: str,
    model: str,
    api_key: str,
    cases: Iterable[Dict[str, Any]],
    tool_defs: Dict[str, Dict[str, Any]],
    transport: Optional[Transport] = None,
    repeat: int = 1,
    region: Optional[str] = None,
) -> List[Dict[str, Any]]:
    # Se resuelve al llamar (no como default del parámetro) para que los tests puedan reemplazarlo.
    transport = transport or default_transport
    results: List[Dict[str, Any]] = []
    for case in cases:
        schemas = {
            name: tool_defs[name]["function"].get("parameters") or {}
            for name in case["herramientas"]
            if name in tool_defs
        }
        payload = build_payload(case, model, tool_defs)
        for _ in range(repeat):
            started = time.monotonic()
            try:
                response = transport(provider, api_key, model, payload, region)
            except (urllib.error.URLError, OSError, ValueError, RuntimeError) as exc:
                results.append({
                    "caso": case["id"],
                    "resultado": "fallo",
                    "puntaje": 0.0,
                    "motivo": f"error de red/API: {exc}",
                    "herramientas_llamadas": [],
                    "latencia_ms": int((time.monotonic() - started) * 1000),
                    "uso": {},
                })
                continue
            graded = grade(case, response, schemas)
            graded["latencia_ms"] = int((time.monotonic() - started) * 1000)
            graded["uso"] = response.get("usage") or {}
            results.append(graded)
    return results


def summarize(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not results:
        return {"casos": 0, "puntaje_pct": 0.0}
    latencies = [r["latencia_ms"] for r in results]
    return {
        "casos": len(results),
        "ok": sum(1 for r in results if r["resultado"] == "ok"),
        "ok_preparatorio": sum(1 for r in results if r["resultado"] == "ok_preparatorio"),
        "fallos": sum(1 for r in results if r["resultado"] == "fallo"),
        "puntaje_pct": round(100 * sum(r["puntaje"] for r in results) / len(results), 1),
        "latencia_p50_ms": int(statistics.median(latencies)),
        "tokens_entrada": sum(int((r.get("uso") or {}).get("prompt_tokens") or 0) for r in results),
        "tokens_salida": sum(int((r.get("uso") or {}).get("completion_tokens") or 0) for r in results),
    }


def format_report(report: Dict[str, Dict[str, Any]]) -> str:
    lines = [
        f"{'modelo':<44} {'puntaje':>8} {'ok':>4} {'prep':>5} {'fallo':>6} {'p50 ms':>8} {'tok in':>8} {'tok out':>8}",
    ]
    for target, data in report.items():
        s = data["resumen"]
        if data.get("saltado"):
            lines.append(f"{target:<44} {'—':>8}  {data['saltado']}")
            continue
        lines.append(
            f"{target:<44} {s['puntaje_pct']:>7}% {s['ok']:>4} {s['ok_preparatorio']:>5} {s['fallos']:>6} "
            f"{s['latencia_p50_ms']:>8} {s['tokens_entrada']:>8} {s['tokens_salida']:>8}"
        )
    for target, data in report.items():
        failures = [r for r in data.get("resultados", []) if r["resultado"] != "ok"]
        if failures:
            lines.append("")
            lines.append(f"{target}:")
            for r in failures:
                lines.append(f"  [{r['resultado']}] {r['caso']}: {r['motivo']}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None, stdin: Optional[TextIO] = None) -> int:
    parser = argparse.ArgumentParser(description="Evals de tool calling por proveedor para XOOK.")
    parser.add_argument("--target", action="append", help="proveedor:modelo (repetible; por defecto, los modelos de la bóveda)")
    parser.add_argument("--caso", action="append", help="id de caso a correr (repetible; por defecto todos)")
    parser.add_argument("--repetir", type=int, default=1, help="veces que se corre cada caso")
    parser.add_argument("--formato", choices=("tabla", "json"), default="tabla", help="`json` es el que consume Rust")
    args = parser.parse_args(argv)

    source = stdin or sys.stdin
    if source.isatty():
        print("Las claves llegan solo desde la bóveda de XOOK: corre las evals desde la app.", file=sys.stderr)
        return 2
    creds = parse_vault_credentials(source.read())
    cases = load_cases()
    if args.caso:
        wanted = set(args.caso)
        cases = [c for c in cases if c["id"] in wanted]
    tool_defs = load_real_tool_defs()
    cases = [c for c in cases if case_runs_on_this_system(c, tool_defs)]

    report: Dict[str, Dict[str, Any]] = {}
    for provider, model in resolve_targets(args.target, creds):
        label = f"{provider}:{model}"
        info = creds.get(provider)
        if not info:
            report[label] = {"resumen": {}, "saltado": "sin clave en la bóveda para este proveedor"}
            continue
        results = run_target(
            provider, model, info["api_key"], cases, tool_defs,
            repeat=max(1, args.repetir), region=info.get("region"),
        )
        report[label] = {"resumen": summarize(results), "resultados": results}

    if args.formato == "json":
        # ASCII puro: llega intacto a Rust aunque la consola no sea UTF-8.
        print(json.dumps(report))
    else:
        print(format_report(report) if report else "No hay proveedores con clave en la bóveda.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
