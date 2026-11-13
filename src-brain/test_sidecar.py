"""
Prueba unitaria para verificar que main_sidecar.py responde adecuadamente
al protocolo RPC stdio sin requerir frameworks externos.
"""
import subprocess
import json
import sys
from pathlib import Path

def test_sidecar_ping_and_inventory():
    sidecar_script = Path(__file__).resolve().parent / "main_sidecar.py"
    proc = subprocess.Popen(
        [sys.executable, str(sidecar_script)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    # 1. Test ping
    ping_req = json.dumps({"id": 1, "method": "ping", "params": {}})
    proc.stdin.write(ping_req + "\n")
    proc.stdin.flush()
    ping_res = json.loads(proc.stdout.readline())
    assert ping_res.get("result", {}).get("status") == "pong", f"Fallo ping: {ping_res}"
    print("✅ Ping exitoso con el sidecar de Python.")

    # 2. Test analyze_inventory
    inv_req = json.dumps({
        "id": 2,
        "method": "analyze_inventory",
        "params": {
            "items": [
                {"sku": "CF-01", "name": "Café de Grano", "stock": 3, "avg_daily_sales": 2.0, "cost_unit": 70.0},
                {"sku": "TM-02", "name": "Té Matcha", "stock": 25, "avg_daily_sales": 0.5, "cost_unit": 150.0}
            ]
        }
    })
    proc.stdin.write(inv_req + "\n")
    proc.stdin.flush()
    inv_res = json.loads(proc.stdout.readline())
    cards = inv_res.get("result", {}).get("action_cards", [])
    assert len(cards) == 1, f"Se esperaba 1 tarjeta de stock crítico, pero llegaron: {len(cards)}"
    assert cards[0]["product_name"] == "Café de Grano"
    print(f"✅ Tarjeta de acción generada correctamente: {cards[0]['title']}")

    # 3. Test record_feedback
    fb_req = json.dumps({
        "id": 3,
        "method": "record_feedback",
        "params": {
            "feedback": {
                "card_id": cards[0]["card_id"],
                "decision": "approved",
                "notes": "Aprobado por el administrador"
            }
        }
    })
    proc.stdin.write(fb_req + "\n")
    proc.stdin.flush()
    fb_res = json.loads(proc.stdout.readline())
    assert fb_res.get("result", {}).get("status") == "success"
    print("✅ Decisión registrada exitosamente en memoria local.")

    proc.terminate()
    print("🎉 Todas las pruebas del sidecar pasaron.")


def test_canvas_schema_and_stream_router():
    from slices.task_ui.schemas import (
        canvas_has_cell_data,
        clean_visible_reply,
        sanitize_canvas_artifact,
    )
    from slices.ai_service.openrouter_client import (
        _StreamTagRouter,
        _extract_canvas_from_tool_calls,
        _resolve_canvas_artifact,
    )

    # 1. Columnas/filas objeto con highlight y badge
    c1 = sanitize_canvas_artifact(
        {
            "title": "Comparativa de Proveedores",
            "kind": "comparison",
            "columns": [
                {"id": "prov", "label": "Proveedor"},
                {"id": "precio", "label": "Precio", "kind": "currency"},
            ],
            "rows": [
                {
                    "id": "r1",
                    "highlight": "recommended",
                    "badge": "Mejor",
                    "cells": {"prov": "Alpha", "precio": "$100"},
                }
            ],
        },
        fallback_id="canvas_test_1",
    )
    assert c1 is not None
    assert c1["id"] == "canvas_test_1"
    assert c1["kind"] == "comparison"
    assert c1["columns"][1]["align"] == "right"
    assert c1["rows"][0]["highlight"] == "recommended"
    assert c1["rows"][0]["cells"]["precio"] == "$100"

    # 2. Columnas string + matriz de filas
    c2 = sanitize_canvas_artifact(
        {
            "title": "Inventario",
            "columns": ["SKU", "Stock"],
            "rows": [["A-1", "12"], ["B-2", "0"]],
        }
    )
    assert c2 is not None
    assert [col["id"] for col in c2["columns"]] == ["sku", "stock"]
    assert c2["columns"][1]["kind"] == "number"
    assert c2["rows"][0]["cells"] == {"sku": "A-1", "stock": "12"}

    # 3. Extracción desde Markdown pipe table
    c3 = sanitize_canvas_artifact(
        {
            "title": "Lista de precios",
            "markdown": "| Producto | Precio |\n| --- | --- |\n| Cafe | $45 |\n| Te | $30 |\n",
        }
    )
    assert c3 is not None
    assert len(c3["columns"]) == 2
    assert len(c3["rows"]) == 2
    assert c3["rows"][1]["cells"]["producto"] == "Te"

    # 4. _StreamTagRouter con <analisis> + <respuesta> + <canvas> + <acciones>
    reason_chunks = []
    reply_chunks = []
    phases = []
    router = _StreamTagRouter(reason_chunks.append, reply_chunks.append, phases.append)

    streamed = (
        "<analisis>Revisando costos</analisis>"
        "<respuesta>Aquí tienes el resumen.</respuesta>"
        '<canvas>{"title":"Tabla Test","columns":["A","B"],"rows":[["1","2"]]}</canvas>'
        '<acciones>{"actions":[{"title":"Revisar"}],"canvas":null}</acciones>'
    )
    for i in range(0, len(streamed), 7):
        router.feed(streamed[i : i + 7])
    router.flush()

    assert "Revisando costos" in "".join(reason_chunks)
    assert "".join(reply_chunks).strip() == "Aquí tienes el resumen."
    assert '"Tabla Test"' in router.canvas_buf
    assert '"Revisar"' in router.actions_buf
    assert "thinking" in phases and "talking" in phases and "canvas" in phases

    # 5. _extract_canvas_from_tool_calls + _resolve_canvas_artifact
    tool_calls = [
        {
            "id": "call_1",
            "type": "function",
            "function": {
                "name": "create_canvas",
                "arguments": '{"title":"Comparativa","kind":"comparison","columns":["Opción","Costo"],"rows":[["X","$10"]]}',
            },
        }
    ]
    extracted = _extract_canvas_from_tool_calls(tool_calls)
    assert extracted is not None
    assert extracted["title"] == "Comparativa"
    assert extracted["rows"][0]["cells"]["opcion"] == "X"

    promoted = _resolve_canvas_artifact(
        tool_calls=[],
        canvas_buf="",
        actions_canvas=None,
        full_reply="Comparación lista:\n\n| Opción | Precio |\n| --- | --- |\n| Plan A | $199 |\n| Plan B | $299 |\n",
        user_message="Hazme una tabla comparativa de planes",
    )
    assert promoted is not None
    assert promoted["kind"] == "table"
    assert len(promoted["rows"]) == 2
    assert promoted["rows"][0]["cells"] == {"opcion": "Plan A", "precio": "$199"}

    # 6. Alias headers/data y tool_calls con nombre duplicado + JSON doblemente serializado y coma final
    c_alias = sanitize_canvas_artifact(
        {
            "title": "Proveedores",
            "headers": ["Proveedor", "Costo"],
            "data": [["A", "$120"], ["B", "$95"]],
        }
    )
    assert c_alias is not None
    assert [col["label"] for col in c_alias["columns"]] == ["Proveedor", "Costo"]
    assert c_alias["rows"][1]["cells"]["costo"] == "$95"

    nested_with_trailing = '{"canvas":{"title":"Tipo de Cambio","columns":["Divisa","Valor"],"rows":[["USD","$20.85"],]},}'
    double_encoded = json.dumps(nested_with_trailing)
    dup_tool_calls = [
        {
            "id": "call_dup",
            "type": "function",
            "function": {
                "name": "create_canvascreate_canvas",
                "arguments": double_encoded,
            },
        }
    ]
    extracted_dup = _extract_canvas_from_tool_calls(dup_tool_calls)
    assert extracted_dup is not None
    assert extracted_dup["title"] == "Tipo de Cambio"
    assert extracted_dup["rows"][0]["cells"] == {"divisa": "USD", "valor": "$20.85"}

    # 7. Rechazar create_canvas con celdas vacías ({}) y recuperar tabla HTML huérfana (<tr><th>...</table></pdf>)
    empty_tool_calls = [
        {
            "id": "call_empty",
            "type": "function",
            "function": {
                "name": "create_canvas",
                "arguments": json.dumps(
                    {
                        "title": "Composición del PIB de México por Sector",
                        "kind": "table",
                        "columns": [{"id": "sector", "label": "Sector"}, {"id": "share", "label": "Share of GDP (%)"}],
                        "rows": [{"id": "row_1", "cells": {}}, {"id": "row_2", "cells": {}}, {"id": "row_3", "cells": {}}],
                    }
                ),
            },
        }
    ]
    assert _extract_canvas_from_tool_calls(empty_tool_calls) is None

    html_reply = (
        "<tr><th>Sector</th><th>Share of GDP (%)</th></tr>\n"
        "<tr><td>Primary (Agricultura)</td><td>22%</td></tr>\n"
        "<tr><td>Secondary (Industria y Construcción)</td><td>33%</td></tr>\n"
        "<tr><td>Tertiary (Servicios)</td><td>45%</td></tr>\n"
        "</table>\n</pdf>"
    )
    recovered = _resolve_canvas_artifact(
        tool_calls=empty_tool_calls,
        canvas_buf="",
        actions_canvas=None,
        full_reply=html_reply,
        user_message="composicion del PIB de Mexico",
    )
    assert recovered is not None
    assert recovered["title"] == "Composición del PIB de México por Sector"
    assert canvas_has_cell_data(recovered)
    assert len(recovered["rows"]) == 3
    assert recovered["rows"][0]["cells"] == {
        "sector": "Primary (Agricultura)",
        "share_of_gdp": "22%",
    }
    assert recovered["rows"][2]["cells"]["share_of_gdp"] == "45%"

    # 8. Sanitización de respuesta visible y flexibilidad en cells (lista, normalización, recommended_row)
    cleaned_md = clean_visible_reply(html_reply, strip_tables=False)
    assert "<tr" not in cleaned_md and "</pdf>" not in cleaned_md
    assert "| Sector | Share of GDP (%) |" in cleaned_md
    assert "| Tertiary (Servicios) | 45% |" in cleaned_md
    assert clean_visible_reply(html_reply, strip_tables=True) == ""

    c_flex = sanitize_canvas_artifact(
        {
            "title": "Flexible",
            "columns": [{"id": "col_a", "label": "Participación (%)"}, {"id": "col_b", "label": "Valor"}],
            "rows": [
                {"id": "r1", "cells": ["Servicios", {"value": "45%"}]},
                {"id": "r2", "cells": {"Participacion": "Industria", "valor": "33%"}},
            ],
            "recommended_row": 0,
            "recommended_badge": "Principal",
        }
    )
    assert c_flex is not None
    assert c_flex["rows"][0]["cells"] == {"col_a": "Servicios", "col_b": "45%"}
    assert c_flex["rows"][0]["highlight"] == "recommended"
    assert c_flex["rows"][0]["badge"] == "Principal"
    assert c_flex["rows"][1]["cells"] == {"col_a": "Industria", "col_b": "33%"}
    print("✅ Canvas schema, StreamTagRouter y tool_calls verificados correctamente.")


if __name__ == "__main__":
    test_sidecar_ping_and_inventory()
    test_canvas_schema_and_stream_router()

