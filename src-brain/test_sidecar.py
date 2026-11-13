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


def test_task_normalization_and_clarification():
    from slices.task_ui.schemas import sanitize_clarification, sanitize_task_proposal
    from slices.ai_service.openrouter_client import _normalize_agent_actions

    # 1. Recuperación de checklist con strings propagados y schedule con items
    repaired = sanitize_task_proposal({
        "cardId": "card_agenda_entrega_01",
        "title": "Entregar tarea — viernes 13, 19:00",
        "category": "agenda",
        "urgency": "alta",
        "statusChip": "Mañana 19:00",
        "blocks": [
            {
                "type": "schedule",
                "title": "Bloque de entrega",
                "items": [
                    {"label": "Revisión final del archivo", "time": "18:00"},
                    {"label": "Entrega confirmada", "time": "19:00"},
                ],
            },
            {
                "type": "checklist",
                "title": "Antes de entregar",
                "items": [
                    {"0": "A", "1": "b", "2": "r", "3": "e", "done": True},
                    "Subir comprobante",
                ],
            },
            {
                "type": "note",
                "text": "Recordatorio 60m antes",
            },
        ],
        "intent": {"type": "schedule_event", "primaryLabel": "Agendar entrega", "targetLabel": "Entrega"},
    })

    sched = repaired["blocks"][0]
    assert sched["type"] == "schedule"
    assert sched["timeLabel"] == "19:00"
    assert "Revisión final" in sched["autoTriggerLabel"]

    chk = repaired["blocks"][1]
    assert len(chk["items"]) == 2
    assert chk["items"][0] == {"id": "chk_1", "label": "Abre", "done": True}
    assert chk["items"][1] == {"id": "chk_2", "label": "Subir comprobante", "done": False}

    note = repaired["blocks"][2]
    assert note == {"type": "note", "content": "Recordatorio 60m antes"}

    # 2. Aclaración Open Question vía tool call ask_clarification
    clar = sanitize_clarification({
        "title": "¿Qué agendamos?",
        "questions": [
            {"id": "que", "prompt": "¿Qué evento quieres crear?", "options": ["Entrega", "Llamada"]},
            {"id": "cuando", "prompt": "¿Para qué día y hora?"},
        ],
    })
    assert clar is not None
    assert clar["questions"][0]["kind"] == "choice_or_text"
    assert clar["questions"][1]["kind"] == "text"

    tasks_out, op, _mood, clar_out = _normalize_agent_actions(
        {"tasks": [{"cardId": "x"}], "operation": "add_tasks"},
        tool_calls=[
            {
                "id": "call_1",
                "function": {
                    "name": "ask_clarification",
                    "arguments": json.dumps({
                        "title": "¿Qué detalles definimos?",
                        "questions": [{"prompt": "¿Qué tarea quieres agendar?", "options": ["Entrega", "Corte"]}],
                    }),
                },
            }
        ],
        user_message="agenda algo",
    )
    assert op == "ask_clarification"
    assert tasks_out == []
    assert clar_out is not None and clar_out["originalQuery"] == "agenda algo"

    # 3. Recordatorio con fecha/hora de mañana etiquetado mal como start_timer debe pasar a schedule_event
    coerced = sanitize_task_proposal({
        "cardId": "card_aviso_01",
        "title": "Aviso previo — viernes 13, 18:00",
        "subtitle": "Recordatorio una hora antes para revisar y subir el trabajo.",
        "category": "reloj",
        "blocks": [{"type": "schedule", "mode": "alarm", "timeLabel": "viernes 13, 18:00"}],
        "intent": {"type": "start_timer", "primaryLabel": "Iniciar reloj"},
    })
    assert coerced["intent"]["type"] == "schedule_event"
    assert coerced["category"] == "agenda"
    assert coerced["blocks"][0]["mode"] == "alarm"

    real_timer = sanitize_task_proposal({
        "cardId": "card_timer_01",
        "title": "Temporizador de café — 15 min",
        "category": "reloj",
        "paramValues": {"duration_min": 15},
        "blocks": [{"type": "schedule", "mode": "timer", "timeLabel": "15:00", "durationSeconds": 900}],
        "intent": {"type": "start_timer", "primaryLabel": "Iniciar reloj"},
    })
    assert real_timer["intent"]["type"] == "start_timer"
    assert real_timer["category"] == "reloj"

    print("✅ Normalización de bloques TaskProposal y ask_clarification verificados.")


def test_review_engine_and_agent_tools():
    import tempfile
    from slices.agent_tools.toolkit import WorkspaceToolExecutor
    from slices.inventory_advisor.review_engine import run_workspace_review

    with tempfile.TemporaryDirectory(prefix="xox_test_ws_") as tmp:
        ws = Path(tmp)
        for d in (
            ".xook",
            "empresa/reglas",
            "datos",
            "memoria/diario",
            "agente/proyectos",
            "agente/borradores",
            "agente/revisiones",
            "habilidades",
        ):
            (ws / d).mkdir(parents=True, exist_ok=True)

        (ws / "empresa/perfil.json").write_text(
            json.dumps(
                {
                    "businessName": "Cafetería Test",
                    "currency": "MXN",
                    "maxBudgetPerOrder": 10000,
                    "minStockDaysDefault": 4,
                    "targetCoverageDays": 14,
                }
            ),
            encoding="utf-8",
        )
        (ws / "empresa/proveedores.json").write_text(
            json.dumps(
                [
                    {
                        "id": "prov_sur",
                        "name": "Distribuidora del Sur",
                        "leadTimeDays": 3,
                        "rating": 4.8,
                        "categories": ["cafe", "insumos"],
                    }
                ]
            ),
            encoding="utf-8",
        )

        # 1. Sin inventario en datos/ ni SQLite => 0 tarjetas mock
        empty_res = run_workspace_review(ws, trigger_source="test_empty")
        assert empty_res["analyzed_items_count"] == 0
        assert empty_res["tasks"] == []

        # 2. CSV real => cálculo exacto y reporte en agente/revisiones/
        (ws / "datos/inventario.csv").write_text(
            "sku,nombre,categoria,stock,venta_diaria,costo_unitario,proveedor_id\n"
            "CAF-500,Café Chiapas 500g,cafe,4,2.0,70,prov_sur\n"
            "VAS-01,Vasos 12oz,insumos,120,5.0,2,prov_sur\n",
            encoding="utf-8",
        )
        real_res = run_workspace_review(ws, trigger_source="test_real")
        assert real_res["analyzed_items_count"] == 2
        assert real_res["findings_count"] == 1
        assert len(real_res["tasks"]) == 1
        card = real_res["tasks"][0]
        assert card["dedupKey"] == "stock_reorder:CAF-500"
        assert card["stagingPayload"]["supplierName"] == "Distribuidora del Sur"
        assert (ws / real_res["report_path"]).exists()

        # 3. Tool loop boundaries & command_bridge
        recorded_cmds = []

        def fake_bridge(payload):
            recorded_cmds.append(payload)
            return {"ok": True, "status": "finished", "stdout": "inventario.csv\n", "stderr": "", "exitCode": 0}

        executor = WorkspaceToolExecutor(ws, command_bridge=fake_bridge)

        # Escritura permitida en agente/
        ok_write = executor.execute(
            "workspace_write_file",
            {"path": "agente/proyectos/resumen.md", "content": "# Resumen\nOK\n"},
        )
        assert ok_write["ok"] is True and executor.workspace_mutated is True
        assert (ws / "agente/proyectos/resumen.md").exists()

        # Bloqueo estricto sobre empresa/ directa y .xook/
        blocked_write = executor.execute(
            "workspace_write_file",
            {"path": "empresa/perfil.json", "content": "{}"},
        )
        assert blocked_write["ok"] is False
        blocked_secret = executor.execute(
            "workspace_read",
            {"path": ".xook/xook.db"},
        )
        assert blocked_secret["ok"] is False

        # Staging para empresa/ crea borrador en agente/borradores/ + propuesta HITL
        staged = executor.execute(
            "propose_company_file_edit",
            {
                "target_path": "empresa/reglas/politica.md",
                "title": "Actualizar política de compras",
                "new_content": "# Política\nMáximo 3d de entrega.\n",
                "reason": "Mejorar tiempos de reposición",
            },
        )
        assert staged["ok"] is True
        assert len(executor.staged_tasks) == 1
        assert executor.staged_tasks[0]["stagingPayload"]["kind"] == "file_edit"
        assert not (ws / "empresa/reglas/politica.md").exists()
        assert (ws / staged["draft_path"]).exists()

        # Delegación de comando por bridge
        cmd_res = executor.execute(
            "run_workspace_command",
            {"command": "ls datos", "purpose": "Listar archivos en datos"},
        )
        assert cmd_res["ok"] is True and len(recorded_cmds) == 1

        # Nuevas herramientas §5: propose_delete_path, propose_schedule_automation y propose_tasks
        del_res = executor.execute(
            "propose_delete_path",
            {
                "target_path": "datos/inventario.csv",
                "title": "Archivar inventario anterior",
                "reason": "Reemplazar por versión corregida",
            },
        )
        assert del_res["ok"] is True
        assert (ws / "datos/inventario.csv").exists()  # HITL: nada se mueve antes de aprobar
        assert any(
            t.get("stagingPayload", {}).get("kind") == "delete_path"
            for t in executor.staged_tasks
        )

        # Bloqueo sobre raíz o rutas inexistentes
        bad_del = executor.execute(
            "propose_delete_path",
            {"target_path": ".", "reason": "No permitido"},
        )
        assert bad_del["ok"] is False

        sched_res = executor.execute(
            "propose_schedule_automation",
            {
                "title": "Revisión nocturna automática",
                "time_label": "08:30 AM",
                "recurrence": "Diario",
                "reason": "Vigilar stock crítico cada mañana",
                "auto_run_review": True,
            },
        )
        assert sched_res["ok"] is True
        sched_card = executor.staged_tasks[-1]
        assert sched_card["paramValues"].get("auto_schedule") is True
        assert any(
            b.get("type") == "schedule" and b.get("autoSchedule") is True
            for b in sched_card.get("blocks", [])
        )

        prop_res = executor.execute(
            "propose_tasks",
            {
                "tasks": [
                    {
                        "title": "Revisar margen de café",
                        "subtitle": "Subió costo del grano 6%",
                        "category": "analisis",
                        "urgency": "media",
                        "intent": {"type": "add_task", "targetLabel": "CAF-500", "primaryLabel": "Aceptar"},
                    }
                ]
            },
        )
        assert prop_res["ok"] is True and prop_res["count"] == 1

        # Guardar reporte Markdown cuando create_canvas trae save_report=true
        from slices.ai_service.openrouter_client import _maybe_save_canvas_report

        report_rel = _maybe_save_canvas_report(
            ws,
            {
                "kind": "table",
                "title": "Comparativa proveedores Q4",
                "summary": "Resumen de precios.",
                "columns": [{"key": "nombre", "label": "Proveedor"}, {"key": "costo", "label": "Costo"}],
                "rows": [{"nombre": "Sur", "costo": "$70"}],
            },
            [
                {
                    "id": "call_canvas_1",
                    "type": "function",
                    "function": {
                        "name": "create_canvas",
                        "arguments": json.dumps({"save_report": True}),
                    },
                }
            ],
        )
        assert report_rel and report_rel.startswith("agente/reportes/")
        assert (ws / report_rel).is_file()

    print("✅ Motor real de revisiones y herramientas agénticas verificados.")


def test_task_aware_model_router_and_failover():
    import tempfile
    from unittest.mock import patch
    from slices.ai_service import openrouter_client
    from slices.ai_service.model_router import (
        classify_task_intent,
        clear_router_runtime_state,
        mark_model_temporarily_unhealthy,
        select_best_models_for_task,
    )

    clear_router_runtime_state()

    p_agent = classify_task_intent(
        "Revisa mi inventario en datos/inventario.csv y propón órdenes",
        has_workspace=True,
        has_active_canvas=False,
        tools_available=True,
    )
    assert p_agent.task_kind == "agent_execution" and p_agent.needs_tools is True

    p_canvas = classify_task_intent(
        "Crea una tabla comparativa en Canvas de 3 proveedores",
        has_workspace=False,
        has_active_canvas=False,
        tools_available=True,
    )
    assert p_canvas.task_kind == "canvas_tabular" and p_canvas.needs_canvas is True

    p_deep = classify_task_intent(
        "Analiza a profundidad por qué cayó el margen y recomienda una estrategia financiera",
        has_workspace=False,
        has_active_canvas=False,
        tools_available=True,
    )
    assert p_deep.task_kind == "deep_analysis" and p_deep.needs_reasoning is True

    p_chat = classify_task_intent(
        "Hola, ¿qué puedes hacer hoy?",
        has_workspace=False,
        has_active_canvas=False,
        tools_available=True,
    )
    assert p_chat.task_kind == "fast_chat"

    mock_catalog = [
        {
            "id": "meta-llama/llama-guard-3-8b:free",
            "name": "Llama Guard",
            "is_free": True,
            "context_length": 131072,
            "prompt_price_per_million": 0.0,
            "supported_parameters": ["temperature"],
            "supports_tools": False,
            "supports_reasoning": False,
            "supports_structured": False,
        },
        {
            "id": "google/gemma-2-9b-it:free",
            "name": "Gemma 2 9B",
            "is_free": True,
            "context_length": 8192,
            "prompt_price_per_million": 0.0,
            "supported_parameters": ["temperature"],
            "supports_tools": False,
            "supports_reasoning": False,
            "supports_structured": False,
        },
        {
            "id": "qwen/qwen3-coder:free",
            "name": "Qwen3 Coder",
            "is_free": True,
            "context_length": 131072,
            "prompt_price_per_million": 0.0,
            "supported_parameters": ["tools", "structured_outputs"],
            "supports_tools": True,
            "supports_reasoning": False,
            "supports_structured": True,
        },
        {
            "id": "deepseek/deepseek-r1:free",
            "name": "DeepSeek R1",
            "is_free": True,
            "context_length": 64000,
            "prompt_price_per_million": 0.0,
            "supported_parameters": ["reasoning"],
            "supports_tools": False,
            "supports_reasoning": True,
            "supports_structured": False,
        },
        {
            "id": "anthropic/claude-3.5-sonnet",
            "name": "Claude 3.5 Sonnet",
            "is_free": False,
            "context_length": 200000,
            "prompt_price_per_million": 3.0,
            "supported_parameters": ["tools", "reasoning", "structured_outputs"],
            "supports_tools": True,
            "supports_reasoning": True,
            "supports_structured": True,
        },
    ]

    # 1. Automático (Gratis) para tarea con workspace elige Qwen3 Coder (tools=True), nunca Llama Guard/Gemma sin tools
    plan_free_agent = select_best_models_for_task(
        "openrouter/free",
        "Ejecuta revisión de inventario en datos/",
        has_workspace=True,
        has_active_canvas=False,
        tools_available=True,
        catalog_models=mock_catalog,
    )
    assert plan_free_agent.is_auto is True
    assert plan_free_agent.candidates[0] == "qwen/qwen3-coder:free"
    assert plan_free_agent.candidates[-1] == "openrouter/free"
    assert "anthropic/claude-3.5-sonnet" not in plan_free_agent.candidates

    # 2. Enfriamiento temporal tras error saca al candidato caído en el siguiente turno
    mark_model_temporarily_unhealthy("qwen/qwen3-coder:free", "429")
    plan_after_cooldown = select_best_models_for_task(
        "openrouter/free",
        "Ejecuta revisión de inventario en datos/",
        has_workspace=True,
        has_active_canvas=False,
        tools_available=True,
        catalog_models=mock_catalog,
    )
    assert "qwen/qwen3-coder:free" not in plan_after_cooldown.candidates
    clear_router_runtime_state()

    # 3. Automático (Estándar) para análisis profundo sin workspace elige razonamiento profundo
    plan_auto_deep = select_best_models_for_task(
        "openrouter/auto",
        "Analiza a profundidad el margen neto y estrategia anual",
        has_workspace=False,
        has_active_canvas=False,
        tools_available=True,
        catalog_models=mock_catalog,
    )
    assert plan_auto_deep.candidates[0] in ("deepseek/deepseek-r1:free", "anthropic/claude-3.5-sonnet")
    assert plan_auto_deep.candidates[-1] == "openrouter/auto"

    # 4. Modelo fijado manualmente se respeta intacto
    plan_manual = select_best_models_for_task(
        "openai/gpt-4o-mini",
        "Ejecuta revisión de inventario",
        has_workspace=True,
        has_active_canvas=False,
        tools_available=True,
        catalog_models=mock_catalog,
    )
    assert plan_manual.is_auto is False
    assert plan_manual.candidates == ["openai/gpt-4o-mini"]

    # 5. End-to-end failover en run_agent_completion: candidato 1 falla por 404 tools -> pasa al 2do manteniendo tools
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp) / "ws_failover"
        ws.mkdir(parents=True)
        for d in ("empresa", "datos", "agente", "memoria", "habilidades"):
            (ws / d).mkdir()
        (ws / "datos/ok.txt").write_text("hola", encoding="utf-8")

        attempted_models = []

        def fake_http_json(url, method="GET", api_key=None, payload=None, timeout=15):
            if url.endswith("/models"):
                return {
                    "data": [
                        {
                            "id": "vendor/first-free:free",
                            "name": "First Free",
                            "pricing": {"prompt": "0", "completion": "0"},
                            "context_length": 128000,
                            "supported_parameters": ["tools", "structured_outputs"],
                        },
                        {
                            "id": "qwen/qwen3-235b:free",
                            "name": "Qwen3 235B",
                            "pricing": {"prompt": "0", "completion": "0"},
                            "context_length": 131072,
                            "supported_parameters": ["tools", "structured_outputs"],
                        },
                    ]
                }
            model = (payload or {}).get("model")
            attempted_models.append((model, bool((payload or {}).get("tools"))))
            if model == "qwen/qwen3-235b:free":
                raise RuntimeError("Error HTTP 404: No endpoints found that support tool use")
            return {
                "model": model,
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({
                                "reply": "Failover automático exitoso con herramientas activas.",
                                "xox_mood": "success",
                                "operation": "none",
                                "tasks": [],
                            })
                        }
                    }
                ],
                "usage": {"total_tokens": 42},
            }

        clear_router_runtime_state()
        with patch.object(openrouter_client, "_http_json", side_effect=fake_http_json):
            out = openrouter_client.run_agent_completion(
                api_key="sk-or-v1-test1234567890",
                model_id="openrouter/free",
                user_message="Revisa datos/ok.txt en el espacio",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                workspace_root=str(ws),
            )
        assert out["status"] == "ok"
        assert len(attempted_models) == 2
        assert attempted_models[0] == ("qwen/qwen3-235b:free", True)
        assert attempted_models[1] == ("vendor/first-free:free", True)
        assert out["model_used"] == "vendor/first-free:free"

        clear_router_runtime_state()

        # 6. Pregunta estratégica profunda con mención de stock/inventario debe clasificar como deep_analysis
        #    y evitar elegir ERNIE-5.5-Flash-Preview sobre Qwen3/razonamiento con herramientas
        p_strat = classify_task_intent(
            "Analiza a profundidad qué riesgos financieros tengo si subo el stock mínimo de 7 a 14 días "
            "en productos perecederos frente al costo de quedarme sin inventario en fines de semana, y dame una estrategia paso a paso.",
            has_workspace=True,
            has_active_canvas=False,
            tools_available=True,
            history=[{"role": "assistant", "content": "Café en grano en nivel crítico en datos/inventario.csv"}],
        )
        assert p_strat.task_kind == "deep_analysis" and p_strat.needs_reasoning is True and p_strat.needs_tools is True

        strat_plan = select_best_models_for_task(
            "openrouter/free",
            "Analiza a profundidad qué riesgos financieros tengo si subo el stock mínimo de 7 a 14 días "
            "en productos perecederos frente al costo de quedarme sin inventario en fines de semana.",
            has_workspace=True,
            has_active_canvas=False,
            tools_available=True,
            catalog_models=[
                {
                    "id": "baidu/ernie-5.5-flash-preview:free",
                    "name": "ERNIE-5.5-Flash-Preview",
                    "is_free": True,
                    "context_length": 128000,
                    "prompt_price_per_million": 0.0,
                    "supported_parameters": ["tools", "reasoning"],
                    "supports_tools": True,
                    "supports_reasoning": True,
                    "supports_structured": False,
                },
                {
                    "id": "qwen/qwen3-235b:free",
                    "name": "Qwen3 235B",
                    "is_free": True,
                    "context_length": 131072,
                    "prompt_price_per_million": 0.0,
                    "supported_parameters": ["tools", "reasoning", "structured_outputs"],
                    "supports_tools": True,
                    "supports_reasoning": True,
                    "supports_structured": True,
                },
            ],
        )
        assert strat_plan.candidates[0] == "qwen/qwen3-235b:free"

        # 7. Auto-continuación cuando un modelo promete "Antes de darte números concretos, reviso..." sin llamar tool_calls
        turn_calls = {"n": 0}

        def fake_continuation_http(url, method="GET", api_key=None, payload=None, timeout=15):
            turn_calls["n"] += 1
            if turn_calls["n"] == 1:
                return {
                    "model": "qwen/qwen3-235b:free",
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": json.dumps({
                                    "reply": "Antes de darte números concretos, reviso qué hay realmente en el workspace para no inventar datos.",
                                    "xox_mood": "talking",
                                    "operation": "none",
                                    "tasks": [],
                                })
                            },
                        }
                    ],
                }
            if turn_calls["n"] == 2:
                return {
                    "model": "qwen/qwen3-235b:free",
                    "choices": [
                        {
                            "finish_reason": "tool_calls",
                            "message": {
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "call_list_1",
                                        "type": "function",
                                        "function": {"name": "workspace_list", "arguments": '{"path":"datos"}'},
                                    }
                                ],
                            },
                        }
                    ],
                }
            return {
                "model": "qwen/qwen3-235b:free",
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps({
                                "reply": "Riesgo 1: inmovilización de capital y merma en perecederos. Estrategia paso a paso completada.",
                                "xox_mood": "success",
                                "operation": "none",
                                "tasks": [],
                            })
                        },
                    }
                ],
            }

        clear_router_runtime_state()
        with patch.object(openrouter_client, "_http_json", side_effect=fake_continuation_http):
            cont_out = openrouter_client.run_agent_completion(
                api_key="sk-or-v1-test1234567890",
                model_id="qwen/qwen3-235b:free",
                user_message="Analiza a profundidad qué riesgos financieros tengo si subo el stock mínimo.",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                workspace_root=str(ws),
            )
        assert turn_calls["n"] == 3
        assert "Estrategia paso a paso completada" in cont_out["reply"]

        # 6. Priorización real frente a nombres engañosos ("thinkingmachines", "-omni-", "-vl:")
        import urllib.request
        from slices.ai_service.model_router import select_best_models_for_task

        realistic_catalog = [
            {
                "id": "thinkingmachines/inkling-2-small:free",
                "name": "Thinking Machines Inkling 2 Small",
                "is_free": True,
                "context_length": 1_048_576,
                "supports_tools": True,
                "supports_reasoning": True,
            },
            {
                "id": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
                "name": "Nemotron 3 Nano Omni",
                "is_free": True,
                "context_length": 256_000,
                "supports_tools": True,
                "supports_reasoning": True,
            },
            {
                "id": "nvidia/nemotron-3.5-super-vl:free",
                "name": "Nemotron 3.5 Super VL",
                "is_free": True,
                "context_length": 1_000_000,
                "supports_tools": True,
                "supports_reasoning": True,
            },
            {
                "id": "baidu/ernie-5.5-flash-preview:free",
                "name": "ERNIE 5.5 Flash Preview",
                "is_free": True,
                "context_length": 1_024_000,
                "supports_tools": True,
                "supports_reasoning": True,
            },
            {
                "id": "google/gemma-4-31b-it:free",
                "name": "Gemma 4 31B",
                "is_free": True,
                "context_length": 262_144,
                "supports_tools": True,
                "supports_reasoning": True,
            },
            {
                "id": "google/gemma-4-26b-a4b-it:free",
                "name": "Gemma 4 26B",
                "is_free": True,
                "context_length": 262_144,
                "supports_tools": True,
                "supports_reasoning": True,
            },
        ]
        gemma_plan = select_best_models_for_task(
            "openrouter/free",
            "Analiza a profundidad qué riesgos financieros tengo si subo el stock mínimo de 7 a 14 días.",
            has_workspace=True,
            has_active_canvas=False,
            tools_available=True,
            catalog_models=realistic_catalog,
        )
        assert gemma_plan.candidates[0] == "google/gemma-4-31b-it:free", gemma_plan.candidates
        assert "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free" not in gemma_plan.candidates
        assert "nvidia/nemotron-3.5-super-vl:free" not in gemma_plan.candidates

        # 7. Failover en streaming tras TimeoutError con reasoning parcial -> reasoning_reset
        class _FakeTimeoutAfterReasoningStream:
            def __init__(self, should_timeout: bool, content_json: str = ""):
                self._should_timeout = should_timeout
                self._content_json = content_json

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def __iter__(self):
                if self._should_timeout:
                    yield (
                        "data: "
                        + json.dumps({
                            "choices": [{"delta": {"reasoning": "Pensamiento parcial interrumpido..."}}]
                        })
                        + "\n"
                    ).encode("utf-8")
                    raise TimeoutError("timed out reading OpenRouter SSE")
                yield (
                    "data: "
                    + json.dumps({
                        "choices": [{"delta": {"content": self._content_json}, "finish_reason": "stop"}]
                    })
                    + "\n"
                ).encode("utf-8")
                yield b"data: [DONE]\n"

        stream_attempts = []

        def fake_stream_urlopen(req, context=None, timeout=None):
            payload = json.loads(req.data.decode("utf-8"))
            model_used = payload.get("model")
            stream_attempts.append((model_used, timeout))
            if len(stream_attempts) == 1:
                return _FakeTimeoutAfterReasoningStream(should_timeout=True)
            return _FakeTimeoutAfterReasoningStream(
                should_timeout=False,
                content_json=json.dumps({
                    "reply": "Análisis resiliente completado.",
                    "xox_mood": "success",
                    "operation": "none",
                    "tasks": [],
                }),
            )

        clear_router_runtime_state()
        stream_events = []
        with patch.object(
            openrouter_client,
            "list_openrouter_models",
            return_value={"models": realistic_catalog},
        ), patch.object(urllib.request, "urlopen", side_effect=fake_stream_urlopen):
            stream_out = openrouter_client.stream_agent_completion(
                api_key="sk-or-v1-test1234567890",
                model_id="openrouter/free",
                user_message="Analiza a profundidad qué riesgos financieros tengo si subo el stock mínimo de 7 a 14 días.",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                emit_event=stream_events.append,
                workspace_root=str(ws),
            )
        assert [m for m, _ in stream_attempts] == [
            "google/gemma-4-31b-it:free",
            "google/gemma-4-26b-a4b-it:free",
        ], stream_attempts
        assert any(ev.get("type") == "reasoning_reset" for ev in stream_events), stream_events
        assert "Análisis resiliente completado." in stream_out["reply"]
        assert "Pensamiento parcial interrumpido" not in (stream_out.get("reasoning") or "")
        assert stream_out["model_used"] == "google/gemma-4-26b-a4b-it:free"

    clear_router_runtime_state()
    print("✅ Evaluador/enrutador inteligente y failover verificados.")


if __name__ == "__main__":
    test_sidecar_ping_and_inventory()
    test_canvas_schema_and_stream_router()
    test_task_normalization_and_clarification()
    test_review_engine_and_agent_tools()
    test_task_aware_model_router_and_failover()

