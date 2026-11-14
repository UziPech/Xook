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
    assert len(clar["questions"][0]["options"]) == 2
    assert clar["questions"][1]["kind"] == "choice_or_text"
    assert len(clar["questions"][1]["options"]) >= 2

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


def test_desktop_app_launcher_tools_and_routing():
    import tempfile
    from slices.agent_tools.toolkit import AGENT_TOOL_DEFS, WorkspaceToolExecutor
    from slices.ai_service.model_router import classify_task_intent

    tool_names = {t["function"]["name"] for t in AGENT_TOOL_DEFS}
    assert "list_desktop_apps" in tool_names
    assert "open_desktop_app" in tool_names

    for prompt in [
        "Abre Notas",
        "Ábreme la app de Calendario",
        "¿Qué aplicaciones tengo?",
        "Por favor abre Recordatorios",
        "Apúntame una nota para comprar café",
        "¿Qué juntas tengo mañana en mi calendario?",
        "Agéndame una cita con Luis mañana a las 3pm",
    ]:
        intent = classify_task_intent(prompt, has_workspace=True, tools_available=True)
        assert intent.needs_tools is True, f"expected tools for {prompt!r}: {intent}"
        assert intent.task_kind == "agent_execution", intent

    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        captured = []

        def fake_bridge(payload):
            captured.append(payload)
            cb = payload.get("rpc_callback")
            if cb == "list_installed_apps":
                return {
                    "ok": True,
                    "apps": [{"displayName": "Notas", "bundleId": "com.apple.Notes"}],
                }
            if cb == "open_desktop_app":
                return {
                    "ok": True,
                    "status": "finished",
                    "app": {"displayName": "Notas", "bundleId": "com.apple.Notes"},
                    "message": "Se abrió Notas.",
                }
            if cb == "os_notes_list":
                return {"ok": True, "folders": ["Notas"], "notes": []}
            if cb == "os_notes_create":
                return {"ok": True, "title": payload.get("title"), "folder": "Notas"}
            if cb == "os_calendar_list":
                return {"ok": True, "calendars": [{"name": "Trabajo", "writable": True}], "events": []}
            if cb == "os_calendar_create_event":
                return {"ok": True, "title": payload.get("title"), "calendar": "Trabajo"}
            return {"ok": False, "error": "unexpected callback"}

        executor = WorkspaceToolExecutor(ws, command_bridge=fake_bridge)
        for req_name in ["os_list_notes", "os_create_note", "os_list_calendar_events", "os_create_calendar_event"]:
            assert req_name in tool_names

        listed = executor.execute("list_desktop_apps", {"query": "notas", "limit": 5})
        assert listed["ok"] is True
        assert captured[-1]["rpc_callback"] == "list_installed_apps"

        opened = executor.execute("open_desktop_app", {"app_name": "Notas"})
        assert opened["ok"] is True
        assert captured[-1]["rpc_callback"] == "open_desktop_app"

        n_list = executor.execute("os_list_notes", {"query": "café", "folder": "Compras", "limit": 10})
        assert n_list["ok"] is True
        assert captured[-1]["rpc_callback"] == "os_notes_list"
        assert captured[-1]["query"] == "café"
        assert captured[-1]["folder"] == "Compras"

        n_create = executor.execute(
            "os_create_note",
            {"title": "Compras", "body": "- Café\n- Filtros", "open_after": True},
        )
        assert n_create["ok"] is True
        assert captured[-1]["rpc_callback"] == "os_notes_create"
        assert captured[-1]["title"] == "Compras"
        assert captured[-1]["open_after"] is True
        assert executor.execute("os_create_note", {"title": "", "body": "x"})["ok"] is False

        c_list = executor.execute(
            "os_list_calendar_events",
            {"start_iso": "2026-11-13", "end_iso": "2026-11-14", "calendar_name": "Trabajo"},
        )
        assert c_list["ok"] is True
        assert captured[-1]["rpc_callback"] == "os_calendar_list"
        assert captured[-1]["start_iso"] == "2026-11-13"

        c_create = executor.execute(
            "os_create_calendar_event",
            {
                "title": "Junta con Luis",
                "start_iso": "2026-11-14T15:00:00",
                "reminder_minutes_before": 15,
                "location": "Oficina",
            },
        )
        assert c_create["ok"] is True
        assert captured[-1]["rpc_callback"] == "os_calendar_create_event"
        assert captured[-1]["reminder_minutes_before"] == 15
        assert executor.execute("os_create_calendar_event", {"title": "Sin fecha"})["ok"] is False

        invalid = executor.execute("open_desktop_app", {"app_name": ""})
        assert invalid["ok"] is False

    print("✅ Herramientas OS (apps, Notas, Calendario) y routing verificados.")


def test_pdf_engine_and_multimodal_pipeline():
    import os
    import platform
    import subprocess
    import sys
    import tempfile
    from PIL import Image as PILImage, ImageDraw, ImageFont
    from pypdf import PdfWriter
    from slices.agent_tools.toolkit import (
        AGENT_TOOL_DEFS,
        AUTONOMOUS_WRITE_ROOTS,
        WorkspaceToolExecutor,
        resolve_workspace_path,
    )
    from slices.ai_service.model_router import classify_task_intent, score_model_for_task
    from slices.ai_service.openrouter_client import (
        _extract_attached_flags,
        _format_model_entry,
        _messages_have_images,
        _sanitize_attached_context_for_prompt,
        _strip_image_parts,
    )
    from slices.pdf_engine import (
        generate_pdf_document,
        inspect_pdf_summary,
        read_pdf_document,
    )

    tool_names = {t["function"]["name"] for t in AGENT_TOOL_DEFS}
    assert "pdf_read" in tool_names
    assert "pdf_generate" in tool_names

    with tempfile.TemporaryDirectory(prefix="xook_pdf_test_") as tmp:
        ws = Path(tmp)
        for rel in ("empresa", "datos/documentos", "memoria", "habilidades", "agente/adjuntos", "agente/reportes"):
            (ws / rel).mkdir(parents=True, exist_ok=True)

        # Crear imágenes de prueba: hero horizontal + logo RGBA con transparencia + JPEG con EXIF orientación
        hero_path = ws / "agente/adjuntos/portada_tienda.jpg"
        hero_img = PILImage.new("RGB", (1200, 720), color=(28, 78, 148))
        draw_hero = ImageDraw.Draw(hero_img)
        draw_hero.rectangle([60, 60, 1140, 660], outline=(240, 180, 70), width=8)
        hero_img.save(hero_path, format="JPEG", quality=90)

        logo_path = ws / "agente/adjuntos/logo_marca.png"
        logo_img = PILImage.new("RGBA", (320, 320), color=(0, 0, 0, 0))
        draw_logo = ImageDraw.Draw(logo_img)
        draw_logo.ellipse([24, 24, 296, 296], fill=(16, 185, 129, 255))
        logo_img.save(logo_path, format="PNG")

        # JPEG vertical rotado por EXIF (tag 274 = 6)
        exif_path = ws / "agente/adjuntos/foto_exif.jpg"
        exif_img = PILImage.new("RGB", (400, 220), color=(180, 60, 60))
        exif = exif_img.getexif()
        exif[274] = 6
        exif_img.save(exif_path, format="JPEG", exif=exif.tobytes())

        # 1. Generar PDF completo con portada full_bleed + resolución inteligente por nombre + acentos + KPIs + tabla + imagen inline
        gen_full = generate_pdf_document(
            {
                "title": "Diagnóstico Operativo Café Central",
                "subtitle": "Análisis trimestral de rotación, márgenes y reposición — México",
                "author": "XOOK Copiloto",
                "theme": "executive",
                "output_path": "empresa/no_debe_escribir_aqui.pdf",  # debe redirigirse a agente/reportes/
                "cover": {
                    "enabled": True,
                    "image_path": "portada_tienda.jpg",  # búsqueda inteligente por nombre
                    "layout": "full_bleed",
                    "eyebrow": "REPORTE EJECUTIVO",
                },
                "blocks": [
                    {
                        "type": "kpi_strip",
                        "metrics": [
                            {"label": "Ventas Q3", "value": "$482,900", "detail": "+14.2% anual"},
                            {"label": "Margen bruto", "value": "38.5%", "detail": "Óptimo"},
                            {"label": "SKUs críticos", "value": "4", "detail": "Reponer hoy"},
                        ],
                    },
                    {"type": "heading", "level": 1, "text": "1. Resumen estratégico"},
                    {"type": "heading", "level": 2, "text": "1.1 Hallazgos clave en sucursales"},
                    {
                        "type": "paragraph",
                        "text": "Se evaluaron **42 productos** clave con actualización de precios y costos en Español: café, té, cacao y empaques.",
                    },
                    {
                        "type": "bullets",
                        "items": [
                            "**Café Chiapas**: mayor contribución marginal.",
                            "Filtros V60: cobertura menor a 4 días.",
                        ],
                    },
                    {
                        "type": "table",
                        "headers": ["SKU", "Producto", "Stock", "Estado"],
                        "rows": [
                            ["CAF-01", "Café en grano 1kg", "18", "Óptimo"],
                            ["FLT-04", "Filtros V60 x100", "3", "Crítico"],
                        ],
                        "caption": "Tabla 1: Inventario verificado.",
                    },
                    {
                        "type": "image",
                        "path": "agente/adjuntos/foto_exif.jpg",
                        "size": "medium",
                        "caption": "Evidencia visual con orientación EXIF corregida.",
                    },
                    {
                        "type": "callout",
                        "tone": "warning",
                        "title": "Acción inmediata",
                        "text": "Emitir orden de compra para Filtros V60 antes del viernes.",
                    },
                ],
            },
            workspace_root=ws,
            resolve_path_fn=resolve_workspace_path,
            autonomous_roots=AUTONOMOUS_WRITE_ROOTS,
        )
        assert gen_full["ok"] is True
        assert gen_full["path"].startswith("agente/reportes/")
        assert not (ws / "empresa/no_debe_escribir_aqui.pdf").exists()
        assert gen_full["has_cover"] is True
        assert gen_full["page_count"] >= 2
        assert gen_full["tables_count"] == 1
        assert gen_full["images_embedded"] == 2
        assert gen_full["size_bytes"] > 5000

        # Probar layouts centered (auto RGBA), hero_top, split y markdown directo sin portada
        for layout_name, img_rel, out_rel in [
            ("auto", "agente/adjuntos/logo_marca.png", "agente/reportes/auto_logo.pdf"),
            ("hero_top", "agente/adjuntos/portada_tienda.jpg", "agente/reportes/hero.pdf"),
            ("split", "agente/adjuntos/portada_tienda.jpg", "agente/reportes/split.pdf"),
        ]:
            g = generate_pdf_document(
                {
                    "title": f"Prueba {layout_name}",
                    "output_path": out_rel,
                    "cover": {"enabled": True, "image_path": img_rel, "layout": layout_name},
                    "blocks": [{"type": "paragraph", "text": "Contenido de verificación."}],
                },
                workspace_root=ws,
                resolve_path_fn=resolve_workspace_path,
                autonomous_roots=AUTONOMOUS_WRITE_ROOTS,
            )
            assert g["ok"] is True
            assert g["page_count"] >= 2

        g_md = generate_pdf_document(
            {
                "title": "Minuta rápida",
                "output_path": "agente/reportes/minuta.pdf",
                "cover": {"enabled": False},
                "markdown": "# Acuerdos\n## Próximos pasos\n- Confirmar entrega\n\n| Área | Responsable |\n| --- | --- |\n| Compras | Ana |",
            },
            workspace_root=ws,
            resolve_path_fn=resolve_workspace_path,
            autonomous_roots=AUTONOMOUS_WRITE_ROOTS,
        )
        assert g_md["ok"] is True
        assert g_md["tables_count"] == 1

        # 2. Leer PDF generado y verificar texto + tablas + paginación + inspect_pdf_summary
        pdf_abs = ws / gen_full["path"]
        summary = inspect_pdf_summary(pdf_abs)
        assert summary["page_count"] >= 2
        assert summary["has_selectable_text"] is True

        read_p1 = read_pdf_document(pdf_abs, start_page=1, end_page=1)
        assert read_p1["ok"] is True
        assert read_p1["has_more_pages"] is True
        assert read_p1["next_start_page"] == 2
        assert "Diagnóstico" in read_p1["pages"][0]["text"] or "XOOK" in read_p1["pages"][0]["text"]

        read_all = read_pdf_document(pdf_abs, start_page=1, end_page=5)
        combined_text = "\n".join(p["text"] for p in read_all["pages"])
        assert "Resumen estratégico" in combined_text
        assert "Café" in combined_text
        all_tables = [tbl for p in read_all["pages"] for tbl in p["tables"]]
        assert len(all_tables) >= 1
        assert any("Filtros V60 x100" in str(tbl) for tbl in all_tables)

        # PDF cifrado -> error amigable
        enc_pdf = ws / "datos/documentos/protegido.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        writer.encrypt("clave123")
        with open(enc_pdf, "wb") as f:
            writer.write(f)
        enc_res = read_pdf_document(enc_pdf)
        assert enc_res["ok"] is False
        assert "contraseña" in enc_res["error"].lower() or "cifrado" in enc_res["error"].lower()

        # OCR fallback en PDF escaneado (en macOS con Swift Vision disponible)
        if platform.system() == "Darwin" and Path("/usr/bin/swift").is_file():
            scan_canvas = PILImage.new("RGB", (900, 320), color=(255, 255, 255))
            d_scan = ImageDraw.Draw(scan_canvas)
            try:
                f_ocr = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 52)
            except Exception:
                f_ocr = ImageFont.load_default()
            d_scan.text((48, 110), "XOOK OCR 2026 FACTURA", fill=(0, 0, 0), font=f_ocr)
            scan_pdf = ws / "datos/documentos/escaneado.pdf"
            scan_canvas.save(scan_pdf, "PDF", resolution=150.0)
            ocr_res = read_pdf_document(scan_pdf, start_page=1, end_page=1, enable_ocr_fallback=True)
            assert ocr_res["ok"] is True
            assert ocr_res["pages"][0]["source"] == "ocr"
            assert "XOOK" in ocr_res["pages"][0]["text"].upper() or "2026" in ocr_res["pages"][0]["text"]

        # 3. Integración con WorkspaceToolExecutor (pdf_read, pdf_generate, workspace_read sobre PDF e imagen)
        events: List[Dict[str, Any]] = []
        executor = WorkspaceToolExecutor(ws, emit_event=events.append)

        exec_gen = executor.execute(
            "pdf_generate",
            {
                "title": "Informe desde Executor",
                "blocks": [{"type": "heading", "level": 1, "text": "Prueba Executor"}],
            },
        )
        assert exec_gen["ok"] is True
        assert executor.workspace_mutated is True
        assert len(executor.generated_pdfs) == 1
        assert any(e.get("type") == "pdf_generated" for e in events)
        assert any(e.get("type") == "workspace_changed" for e in events)

        exec_read_pdf = executor.execute("pdf_read", {"path": exec_gen["path"]})
        assert exec_read_pdf["ok"] is True
        assert "Prueba Executor" in "\n".join(p["text"] for p in exec_read_pdf["pages"])

        ws_read_pdf = executor.execute("workspace_read", {"path": exec_gen["path"]})
        assert ws_read_pdf["ok"] is True and "pages" in ws_read_pdf

        ws_read_img = executor.execute("workspace_read", {"path": "agente/adjuntos/logo_marca.png"})
        assert ws_read_img["ok"] is True
        assert ws_read_img["kind"] == "image"
        assert ws_read_img["width"] == 320 and ws_read_img["height"] == 320
        assert ws_read_img["has_alpha"] is True

        blocked_pdf = executor.execute("pdf_read", {"path": ".xook/oculto.pdf"})
        assert blocked_pdf["ok"] is False

        # 4. Router y helpers multimodales
        vis_profile = classify_task_intent(
            "mira esto",
            has_workspace=True,
            has_attachments=True,
            has_images=True,
        )
        assert vis_profile.task_kind == "agent_execution"
        assert vis_profile.needs_tools is True
        assert vis_profile.needs_vision is True

        m_vis = _format_model_entry({
            "id": "google/gemini-2.5-flash",
            "name": "Gemini 2.5 Flash",
            "context_length": 1000000,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": ["tools", "structured_outputs"],
            "architecture": {"input_modalities": ["text", "image"]},
        })
        m_txt = _format_model_entry({
            "id": "qwen/qwen3-coder:free",
            "name": "Qwen3 Coder",
            "context_length": 128000,
            "pricing": {"prompt": "0", "completion": "0"},
            "supported_parameters": ["tools", "structured_outputs"],
            "architecture": {"input_modalities": ["text"]},
        })
        assert m_vis is not None and m_vis["supports_vision"] is True
        assert m_txt is not None and m_txt["supports_vision"] is False
        assert score_model_for_task(m_vis, vis_profile) > score_model_for_task(m_txt, vis_profile)

        sample_att = [
            {
                "name": "logo.png",
                "type": "image/png",
                "kind": "image",
                "workspacePath": "agente/adjuntos/logo_marca.png",
                "imageDataUrl": "data:image/png;base64,AAAA",
            }
        ]
        has_att, img_parts = _extract_attached_flags(sample_att)
        assert has_att is True and len(img_parts) == 1
        sanitized_prompt_att = _sanitize_attached_context_for_prompt(sample_att)
        assert "imageDataUrl" not in sanitized_prompt_att[0]
        assert sanitized_prompt_att[0]["hasInlineImage"] is True

        mm_msgs = [{"role": "user", "content": [{"type": "text", "text": "Hola"}, *img_parts]}]
        assert _messages_have_images(mm_msgs) is True
        stripped_msgs = _strip_image_parts(mm_msgs)
        assert _messages_have_images(stripped_msgs) is False
        assert isinstance(stripped_msgs[0]["content"], str) and "Hola" in stripped_msgs[0]["content"]

        # 5. Subproceso RPC JSON-RPC completo en main_sidecar.py (generate_pdf + inspect_pdf)
        sidecar_script = Path(__file__).resolve().parent / "main_sidecar.py"
        rpc_req = json.dumps({
            "id": 91,
            "method": "generate_pdf",
            "params": {
                "workspace_root": str(ws),
                "spec": {
                    "title": "PDF por RPC",
                    "output_path": "agente/reportes/rpc_doc.pdf",
                    "blocks": [{"type": "heading", "level": 1, "text": "Generado vía JSON-RPC"}],
                },
            },
        }) + "\n"
        proc = subprocess.run(
            [sys.executable, str(sidecar_script)],
            input=rpc_req,
            capture_output=True,
            text=True,
            check=True,
        )
        rpc_resp = json.loads(proc.stdout.strip().splitlines()[0])
        assert rpc_resp["result"]["ok"] is True
        assert rpc_resp["result"]["path"] == "agente/reportes/rpc_doc.pdf"

        rpc_inspect_req = json.dumps({
            "id": 92,
            "method": "inspect_pdf",
            "params": {
                "workspace_root": str(ws),
                "path": "agente/reportes/rpc_doc.pdf",
                "summary_only": True,
            },
        }) + "\n"
        proc2 = subprocess.run(
            [sys.executable, str(sidecar_script)],
            input=rpc_inspect_req,
            capture_output=True,
            text=True,
            check=True,
        )
        rpc_resp2 = json.loads(proc2.stdout.strip().splitlines()[0])
        assert rpc_resp2["result"]["ok"] is True
        assert rpc_resp2["result"]["page_count"] == 1

    print("✅ Motor PDF (lectura, generación, OCR, portada/imágenes, vision router y JSON-RPC) verificado.")


def test_spaced_xml_tags_and_live_pdf_preview():
    import subprocess
    import tempfile
    from slices.agent_tools.toolkit import resolve_workspace_path
    from slices.ai_service.openrouter_client import _StreamTagRouter, _extract_partial_pdf_draft
    from slices.pdf_engine import generate_pdf_document, render_pdf_preview
    from slices.task_ui.schemas import clean_visible_reply

    # 1. Etiquetas XML con espacios internos fragmentadas entre chunks en _StreamTagRouter
    reasonings: list[str] = []
    replies: list[str] = []
    phases: list[str] = []
    router = _StreamTagRouter(reasonings.append, replies.append, phases.append)
    chunks = [
        "< analisis >Rev",
        "isando",
        "</ analisis>",
        "< respuesta >¿Cómo te ayudo",
        " de esta manera?\n</",
        " respuesta>",
        "< canvas >{\"title\":\"T\",\"columns\":[\"A\"],\"rows\":[[\"1\"]]}< / canvas >",
        "< acciones >{\"operation\":\"none\",\"tasks\":[]}< / acciones >",
    ]
    for ch in chunks:
        router.feed(ch)
    router.flush()

    joined_reply = "".join(replies)
    joined_reason = "".join(reasonings)
    assert "Revisando" in joined_reason
    assert "manera?" in joined_reply
    assert "respuesta" not in joined_reply.lower()
    assert "</" not in joined_reply
    assert '"T"' in router.canvas_buf
    assert '"operation"' in router.actions_buf

    # También debe preservar operadores matemáticos normales y limpiar clean_visible_reply
    assert "a < 50" in clean_visible_reply("a < 50\n</ respuesta>")
    assert "</" not in clean_visible_reply("Hola\n< / respuesta >\n</ analisis>")
    assert clean_visible_reply("Listo\n</ respuesta") == "Listo"

    # 2. Parser de borrador parcial en vivo de pdf_generate durante tool_call streaming
    partial_cover_only = (
        '{"title": "Reporte Parcial", "cover": {"enabled": true, "image_path": "agente/adjuntos/logo.png"'
    )
    draft_cov = _extract_partial_pdf_draft(partial_cover_only)
    assert draft_cov is not None
    assert draft_cov["title"] == "Reporte Parcial"
    assert draft_cov["has_cover"] is True
    assert draft_cov["cover"]["image_path"] == "agente/adjuntos/logo.png"

    partial_with_blocks = (
        '{"title": "Reporte Mensual", "subtitle": "Resumen Q2", "theme": "modern", '
        '"cover": {"enabled": true, "image_path": "agente/adjuntos/logo.png"}, '
        '"blocks": [{"type": "heading", "level": 1, "text": "Panorama {clave}"}, '
        '{"type": "paragraph", "text": "El margen subió'
    )
    draft = _extract_partial_pdf_draft(partial_with_blocks)
    assert draft is not None
    assert draft["title"] == "Reporte Mensual"
    assert draft["has_cover"] is True
    assert draft["cover"]["image_path"] == "agente/adjuntos/logo.png"
    assert len(draft["blocks"]) == 2
    assert draft["blocks"][0]["type"] == "heading" and "{clave}" in draft["blocks"][0]["text"]
    assert draft["blocks"][1]["type"] == "paragraph" and draft["blocks"][1].get("streaming") is True

    # 3. progress_callback + render_pdf_preview (pypdfium2) + RPC render_pdf_preview
    with tempfile.TemporaryDirectory(prefix="xox_pdf_prev_") as tmp:
        ws = Path(tmp)
        (ws / "agente/reportes").mkdir(parents=True, exist_ok=True)
        progress_events: list[dict] = []
        gen = generate_pdf_document(
            {
                "title": "Documento con Vista Previa",
                "output_path": "agente/reportes/preview_test.pdf",
                "cover": {"enabled": True, "eyebrow": "XOOK LIVE"},
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Sección Uno"},
                    {"type": "paragraph", "text": "Contenido verificado para vista previa."},
                ],
            },
            workspace_root=ws,
            resolve_path_fn=resolve_workspace_path,
            progress_callback=progress_events.append,
        )
        assert gen["ok"] is True and gen["page_count"] == 2
        stages = [e.get("stage") for e in progress_events]
        assert "building_cover" in stages
        assert "building_blocks" in stages
        assert "rendering_pdf" in stages

        pdf_abs = ws / "agente/reportes/preview_test.pdf"
        prev1 = render_pdf_preview(pdf_abs, start_page=1, max_pages=1)
        assert prev1["ok"] is True
        assert prev1["page_count"] == 2
        assert prev1["rendered_count"] == 1
        assert prev1["has_more"] is True
        assert prev1["pages"][0]["data_url"].startswith("data:image/jpeg;base64,")

        sidecar_script = Path(__file__).resolve().parent / "main_sidecar.py"
        rpc_req = json.dumps({
            "id": 93,
            "method": "render_pdf_preview",
            "params": {
                "workspace_root": str(ws),
                "path": "agente/reportes/preview_test.pdf",
                "start_page": 1,
                "max_pages": 4,
            },
        }) + "\n"
        proc = subprocess.run(
            [sys.executable, str(sidecar_script)],
            input=rpc_req,
            capture_output=True,
            text=True,
            check=True,
        )
        rpc_resp = json.loads(proc.stdout.strip().splitlines()[0])
        assert rpc_resp["result"]["ok"] is True
        assert rpc_resp["result"]["rendered_count"] == 2
        assert rpc_resp["result"]["has_more"] is False

    print("✅ Etiquetas XML espaciadas, streaming draft PDF y render_pdf_preview verificados.")


def test_ready_cover_full_page_and_content_enforcement() -> None:
    import tempfile
    from PIL import Image, ImageDraw
    from slices.agent_tools.toolkit import WorkspaceToolExecutor
    from slices.ai_service.openrouter_client import _extract_partial_pdf_draft, _parse_tool_args
    from slices.pdf_engine import read_pdf_document, render_pdf_preview

    # 1. Recuperación y detección explícita de errores JSON en _parse_tool_args
    assert _parse_tool_args("") == {}
    assert _parse_tool_args(None) == {}
    recovered = _parse_tool_args('```json\n{"title": "POO", "blocks": [],}\n```')
    assert recovered.get("title") == "POO"
    broken = _parse_tool_args('{"title": "POO", "blocks": [{"type": "heading"')
    assert "__parse_error__" in broken

    # 2. Preview parser soporta bullet_list, bullets y code
    partial_code = _extract_partial_pdf_draft(
        '{"title": "Guía POO", "blocks": [{"type": "bullet_list", "items": ["Abstracción"]}, {"type": "code", "language": "python", "code": "class Perro:\\n    pass"}]}'
    )
    assert partial_code is not None
    assert partial_code["blocks"][0]["type"] == "bullet_list"
    assert partial_code["blocks"][1]["type"] == "code"
    assert partial_code["blocks"][1]["language"] == "python"

    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "agente/adjuntos").mkdir(parents=True, exist_ok=True)
        (ws / "agente/reportes").mkdir(parents=True, exist_ok=True)

        # Imagen tipo portada/carátula universitaria (642x912 RGBA opaca, fondo blanco + marco/trazos oscuros)
        cover_path = ws / "agente/adjuntos/portada_utm.png"
        cov = Image.new("RGBA", (642, 912), (255, 255, 255, 255))
        draw = ImageDraw.Draw(cov)
        draw.rectangle([28, 28, 614, 884], outline=(20, 20, 20, 255), width=4)
        draw.rectangle([420, 24, 610, 76], fill=(16, 125, 78, 255))
        for y in (120, 210, 320, 560, 620, 740):
            draw.rectangle([120, y, 520, y + 24], fill=(25, 25, 25, 255))
        cov.save(cover_path, format="PNG")

        events: list[dict] = []
        executor = WorkspaceToolExecutor(ws, emit_event=events.append)

        # 3. Rechazar PDF con portada y blocks vacío (no guardar 1 página vacía)
        empty_res = executor.execute(
            "pdf_generate",
            {
                "title": "Programación Orientada a Objetos (POO)",
                "output_path": "agente/reportes/vacio_fallido.pdf",
                "cover": {
                    "enabled": True,
                    "image_path": "agente/adjuntos/portada_utm.png",
                    "layout": "full_bleed",
                },
            },
        )
        assert empty_res["ok"] is False
        assert not (ws / "agente/reportes/vacio_fallido.pdf").exists()
        assert not any(e.get("type") == "pdf_generated" for e in events)

        # 3b. También rechazar stub mínimo de 1 sola línea cuando hay portada
        stub_res = executor.execute(
            "pdf_generate",
            {
                "title": "Solo Portada con Stub",
                "output_path": "agente/reportes/stub_fallido.pdf",
                "cover": {
                    "enabled": True,
                    "image_path": "agente/adjuntos/portada_utm.png",
                },
                "blocks": [{"type": "paragraph", "text": "Resumen corto."}],
            },
        )
        assert stub_res["ok"] is False
        assert not (ws / "agente/reportes/stub_fallido.pdf").exists()

        # 4. Generar PDF completo con bullet_list + code y layout='full_bleed' autopromovido a 'full_page'
        full_res = executor.execute(
            "pdf_generate",
            {
                "title": "Programación Orientada a Objetos (POO)",
                "subtitle": "Fundamentos y ejemplos prácticos",
                "output_path": "agente/reportes/poo_completo.pdf",
                "cover": {
                    "enabled": True,
                    "image_path": "agente/adjuntos/portada_utm.png",
                    "layout": "full_bleed",
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "1. ¿Qué es la POO?"},
                    {
                        "type": "paragraph",
                        "text": "La Programación Orientada a Objetos organiza el código alrededor de clases y objetos que encapsulan estado y comportamiento.",
                    },
                    {
                        "type": "bullet_list",
                        "items": [
                            "Encapsulamiento: protege el estado interno",
                            "Abstracción: expone solo la interfaz esencial",
                            "Herencia: reutiliza y especializa comportamiento",
                            "Polimorfismo: una misma interfaz, distintas formas",
                        ],
                    },
                    {"type": "heading", "level": 2, "text": "Ejemplo en Python"},
                    {
                        "type": "code",
                        "language": "python",
                        "caption": "Definición básica de clase",
                        "code": "class CuentaBancaria:\n    def __init__(self, titular: str, saldo: float = 0.0):\n        self.titular = titular\n        self._saldo = saldo",
                    },
                ],
            },
        )
        assert full_res["ok"] is True, full_res
        assert full_res["cover_layout"] == "full_page", full_res
        assert full_res["page_count"] >= 2
        assert any(e.get("type") == "pdf_generated" for e in events)

        pdf_abs = ws / "agente/reportes/poo_completo.pdf"
        read_p1 = read_pdf_document(pdf_abs, start_page=1, end_page=1, enable_ocr_fallback=False)
        assert "Programación Orientada a Objetos" not in read_p1["pages"][0]["text"]

        read_p2 = read_pdf_document(pdf_abs, start_page=2, end_page=2, enable_ocr_fallback=False)
        p2_text = read_p2["pages"][0]["text"]
        assert "¿Qué es la POO?" in p2_text
        assert "Encapsulamiento" in p2_text
        assert "CuentaBancaria" in p2_text

        # Verificar que página 1 renderizada se mantiene blanca/luminosa (sin velo gris 0.86)
        import base64, io as pyio
        prev = render_pdf_preview(pdf_abs, start_page=1, max_pages=1)
        b64 = prev["pages"][0]["data_url"].split(",", 1)[1]
        rendered_p1 = Image.open(pyio.BytesIO(base64.b64decode(b64))).convert("RGB")
        rw, rh = rendered_p1.size
        sample_px = rendered_p1.getpixel((rw // 2, rh - 10))
        assert min(sample_px) >= 235, f"Se esperaba fondo claro sin oscurecer, got {sample_px}"

        # 5. overlay_text=True permite conservar full_bleed si se solicita explícitamente
        overlay_res = executor.execute(
            "pdf_generate",
            {
                "title": "Con texto superpuesto",
                "output_path": "agente/reportes/overlay.pdf",
                "cover": {
                    "enabled": True,
                    "image_path": "agente/adjuntos/portada_utm.png",
                    "layout": "full_bleed",
                    "overlay_text": True,
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Sección de desarrollo"},
                    {
                        "type": "paragraph",
                        "text": "Documento de prueba con portada full_bleed intencional solicitada mediante overlay_text=True y desarrollo suficiente.",
                    },
                ],
            },
        )
        assert overlay_res["ok"] is True
        assert overlay_res["cover_layout"] == "full_bleed"

        # 6. cover_only=True permite explícitamente generar solo portada
        cover_only_res = executor.execute(
            "pdf_generate",
            {
                "title": "Solo Portada",
                "output_path": "agente/reportes/solo_portada.pdf",
                "cover_only": True,
                "cover": {
                    "enabled": True,
                    "image_path": "agente/adjuntos/portada_utm.png",
                    "layout": "full_page",
                },
                "blocks": [],
            },
        )
        assert cover_only_res["ok"] is True
        assert cover_only_res["page_count"] == 1

        # 7. Rescate de `blocks` stringificado/truncado sin imprimir JSON literal en el PDF
        from slices.ai_service.openrouter_client import (
            _collapse_tool_history_to_text,
            _is_recoverable_candidate_error,
            _sanitize_tool_calls_for_history,
        )
        from slices.pdf_engine.generator import _coerce_block_list_value

        broken_str_blocks = (
            '[{"type": "heading", "level": 1, "text": "Qué es la POO"}, '
            '{"type": "paragraph", "text": "La Programación Orientada a Objetos modela entidades reales."}, '
            '{"type": "bullet_list", "items": ["Encapsulamiento", "Herencia"]}, '
            '{"type": "paragraph", "text": "Texto truncado sin cerrar'
        )
        rescued = _coerce_block_list_value(broken_str_blocks)
        assert isinstance(rescued, list) and len(rescued) == 3
        assert rescued[0]["text"] == "Qué es la POO"

        unrecoverable_json_str = '[{"type": "heading", "text": "sin cerrar'
        assert _coerce_block_list_value(unrecoverable_json_str) == []

        str_blocks_res = executor.execute(
            "pdf_generate",
            {
                "title": "POO Rescatado",
                "output_path": "agente/reportes/poo_rescatado.pdf",
                "cover": {"enabled": False},
                "blocks": broken_str_blocks,
            },
        )
        assert str_blocks_res["ok"] is True
        read_rescued = read_pdf_document(
            ws / "agente/reportes/poo_rescatado.pdf",
            start_page=1,
            end_page=2,
            enable_ocr_fallback=False,
        )
        rescued_txt = read_rescued["pages"][0]["text"]
        assert "Qué es la POO" in rescued_txt
        assert '"type":' not in rescued_txt and "[{" not in rescued_txt

        # 8. Preview parcial con `blocks` stringificado
        draft_from_str = _extract_partial_pdf_draft(
            json.dumps({
                "title": "POO Stream",
                "blocks": '[{"type": "heading", "level": 1, "text": "Sección Uno"}, {"type": "paragraph", "text": "Hola"}]',
            })
        )
        assert draft_from_str is not None and len(draft_from_str["blocks"]) == 2

        # 9. Blindaje HTTP 400: sanitización de tool_calls rotos y colapso multi-turno
        raw_tcs = [
            {"id": "call_bad", "type": "function", "function": {"name": "pdf_generate", "arguments": '{"title": "POO", "blocks": [INCOMPLETO'}}
        ]
        sanitized_tcs, all_failed = _sanitize_tool_calls_for_history(
            raw_tcs,
            [{"__parse_error__": "truncado"}],
        )
        assert all_failed is True
        assert json.loads(sanitized_tcs[0]["function"]["arguments"]) == {}
        assert _is_recoverable_candidate_error("HTTP 400: Provider returned error") is True

        collapsed = _collapse_tool_history_to_text([
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "haz pdf"},
            {"role": "assistant", "content": "", "tool_calls": sanitized_tcs},
            {"role": "tool", "tool_call_id": "call_bad", "content": '{"ok": true}'},
        ])
        assert all(m["role"] in ("system", "user", "assistant") for m in collapsed)
        assert not any("tool_calls" in m for m in collapsed)

    print("✅ Portada íntegra full_page, rescate JSON y blindaje HTTP 400 verificados.")


def test_free_form_response_and_stray_tag_cleanup() -> None:
    from pathlib import Path
    import tempfile
    from slices.ai_service.openrouter_client import _StreamTagRouter, _build_system_prompt
    from slices.task_ui.schemas import clean_visible_reply

    with tempfile.TemporaryDirectory() as tmp:
        prompt = _build_system_prompt(Path(tmp) / "ctx", Path(tmp) / "skills", [], [], [], stream_mode=True)
        assert "plena libertad expresiva" in prompt
        assert "NUNCA envuelvas tu respuesta en etiquetas XML" in prompt
        assert "FORMATO DE RESPUESTA EN VIVO (OBLIGATORIO)" not in prompt
        assert "NO uses emojis" not in prompt

    # 1. Respuesta libre en Markdown puro (sin <analisis>/<respuesta>) con código HTML y comparaciones matemáticas
    free_md = (
        "# Portada Académica UTM 📄\n\n"
        "- **Alumno:** Uziel Isaac Pech Balam\n"
        "- Condición: a < 50 y b > 10\n\n"
        "```html\n<output>42</output>\n```\n\n"
        "Etiqueta `<answer>` explicada sin censura."
    )
    replies_free: list[str] = []
    router_free = _StreamTagRouter(
        on_reasoning=lambda _s: None,
        on_reply=replies_free.append,
        on_phase=lambda _p: None,
    )
    for i in range(0, len(free_md), 7):
        router_free.feed(free_md[i : i + 7])
    router_free.flush()
    streamed_free = clean_visible_reply("".join(replies_free))
    assert streamed_free == free_md, f"Se alteró Markdown libre: {streamed_free!r}"

    # 2. Etiquetas alucinadas como <posta>...</posta> o < / posta > deben eliminarse por completo
    replies_posta: list[str] = []
    router_posta = _StreamTagRouter(
        on_reasoning=lambda _s: None,
        on_reply=replies_posta.append,
        on_phase=lambda _p: None,
    )
    for chunk in ("<po", "sta>\nLa imagen es", " de UTM.\n< / ", "posta>"):
        router_posta.feed(chunk)
    router_posta.flush()
    streamed_posta = clean_visible_reply("".join(replies_posta)).strip()
    assert streamed_posta == "La imagen es de UTM.", f"Fuga <posta>: {streamed_posta!r}"

    # 3. Limpieza de wrappers genéricos sin dañar bloques de código ni inline code
    assert clean_visible_reply("<reply>Hola mundo</reply>") == "Hola mundo"
    assert clean_visible_reply("<output>\nContenido libre\n</output>") == "Contenido libre"
    html_snippet = "Usa `<output>` en HTML:\n```html\n<output>ok</output>\n```"
    assert clean_visible_reply(html_snippet) == html_snippet

    print("✅ Respuesta libre Markdown y limpieza de etiquetas residuales (<posta>) verificadas.")


def test_screen_reading_tools_and_unified_memory():
    import tempfile
    from pathlib import Path
    from slices.agent_tools.toolkit import WorkspaceToolExecutor
    from slices.ai_service.model_router import classify_task_intent
    from slices.ai_service.openrouter_client import _append_transient_tool_images, _build_system_prompt

    prof = classify_task_intent("lee la pantalla por favor", has_workspace=True, tools_available=True)
    assert prof.needs_tools is True, f"Se esperaba needs_tools=True para lectura de pantalla: {prof}"
    assert prof.task_kind == "agent_execution", prof

    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "memoria").mkdir(parents=True, exist_ok=True)
        long_hechos = ("- [general] Relleno histórico operativo.\n" * 60) + "- [precios] Envío Monterrey cuesta $190.\n"
        (ws / "memoria" / "hechos.md").write_text(long_hechos, encoding="utf-8")

        rpc_calls = []

        def fake_bridge(payload):
            rpc_calls.append(payload)
            cb = payload.get("rpc_callback")
            if cb == "read_screen_now":
                return {
                    "ok": True,
                    "permissionGranted": True,
                    "blockedSensitive": False,
                    "appName": "Google Chrome",
                    "windowTitle": "Factura #108",
                    "captureMode": "display",
                    "text": "App activa: Google Chrome — Factura #108\nTotal: $1,250 MXN",
                    "ocrText": "Total: $1,250 MXN",
                    "axText": "",
                    "imageDataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
                }
            if cb == "query_screen_memory":
                return {
                    "ok": True,
                    "count": 1,
                    "observations": [{"appName": "Safari", "contentText": "Catálogo proveedores"}],
                }
            if cb == "memory_search":
                return {
                    "ok": True,
                    "factsCount": 1,
                    "facts": [{"category": "precios", "content": "Envío Monterrey cuesta $190."}],
                    "screenSummary": "[hace 1 min · Safari] Catálogo proveedores",
                }
            return {"ok": False}

        executor = WorkspaceToolExecutor(ws, command_bridge=fake_bridge)
        scr_res = executor.execute("read_screen_now", {"mode": "display", "include_image": True})
        assert scr_res.get("ok") is True
        assert scr_res.get("has_visual_image") is True
        assert "imageDataUrl" not in scr_res, "No debe quedar base64 dentro del payload JSON textual del tool"
        assert len(executor.transient_tool_images) == 1

        msgs = [{"role": "tool", "tool_call_id": "tc_1", "content": "{}"}]
        _append_transient_tool_images(executor, msgs, vision_supported=True)
        assert len(msgs) == 2 and msgs[1]["role"] == "user"
        assert any(p.get("type") == "image_url" for p in msgs[1]["content"])
        assert executor.transient_tool_images == []

        mem_res = executor.execute("query_screen_memory", {"query": "proveedores", "limit": 3})
        assert mem_res.get("ok") is True and mem_res.get("count") == 1

        search_res = executor.execute("memory_search", {"query": "Monterrey"})
        assert search_res.get("ok") is True and search_res.get("factsCount") == 1

        prompt = _build_system_prompt(
            context_dir=ws,
            skills_dir=ws,
            current_tasks=[],
            agenda_items=[],
            attached_context=[],
            stream_mode=True,
            workspace_root=ws,
            unified_memory={
                "facts": [{"category": "precios", "content": "Envío Monterrey cuesta $190 MXN."}],
                "screen_summary": "[hace 1 min · Google Chrome] Factura #108 Total $1,250 MXN",
            },
        )
        assert "Envío Monterrey cuesta $190 MXN." in prompt
        assert "CONTEXTO RECIENTE EN PANTALLA" in prompt
        assert "read_screen_now" in prompt
        assert "Factura #108" in prompt

    print("✅ Lectura de pantalla en tiempo real, FTS5 unificado y manejo seguro de imágenes en RAM verificados.")


def test_multi_provider_registry_anthropic_and_failover():
    import io
    import tempfile
    import urllib.error
    import urllib.request
    from unittest.mock import patch

    from slices.ai_service import openrouter_client
    from slices.ai_service.anthropic_adapter import (
        build_anthropic_request_payload,
        iter_anthropic_sse_as_openai_events,
    )
    from slices.ai_service.model_router import clear_router_runtime_state
    from slices.ai_service.provider_registry import (
        PROVIDER_SPECS,
        build_openai_compat_chat_payload,
        build_provider_headers,
        classify_provider_error,
        detect_provider_from_key,
        enrich_model_with_tariffs,
        is_provider_in_cooldown,
        normalize_provider_id,
    )

    # 1. Registro de 6 proveedores, detección de prefijos, cabeceras y tarifas
    assert set(PROVIDER_SPECS.keys()) == {"openrouter", "deepseek", "openai", "anthropic", "groq", "gemini"}
    assert normalize_provider_id("claude") == "anthropic"
    assert normalize_provider_id("google-gemini") == "gemini"
    assert normalize_provider_id("chatgpt") == "openai"

    assert detect_provider_from_key("sk-or-v1-abcd1234567890") == "openrouter"
    assert detect_provider_from_key("sk-ant-api03-abcd1234567890") == "anthropic"
    assert detect_provider_from_key("gsk_abcd1234567890abcd") == "groq"
    assert detect_provider_from_key("AIzaSyD-1234567890abcdefghijk") == "gemini"
    assert detect_provider_from_key("sk-proj-abcd1234567890abcd") == "openai"
    assert detect_provider_from_key("sk-1234567890abcdefghij1234") is None  # DeepSeek vs OpenAI legacy

    ant_headers = build_provider_headers("anthropic", "sk-ant-api03-test1234567890")
    assert ant_headers.get("x-api-key") == "sk-ant-api03-test1234567890"
    assert ant_headers.get("anthropic-version") == "2023-06-01"
    assert "Authorization" not in ant_headers

    or_headers = build_provider_headers("openrouter", "sk-or-v1-test1234567890")
    assert or_headers.get("Authorization") == "Bearer sk-or-v1-test1234567890"
    assert "HTTP-Referer" in or_headers and "X-Title" in or_headers

    o3_payload = build_openai_compat_chat_payload(
        "openai",
        "o3-mini",
        {"model": "o3-mini", "messages": [], "max_tokens": 4096, "temperature": 0.2},
    )
    assert "max_tokens" not in o3_payload and o3_payload.get("max_completion_tokens") == 4096
    assert "temperature" not in o3_payload

    ds_model = enrich_model_with_tariffs("deepseek", {"id": "deepseek-chat", "name": "DeepSeek Chat"})
    assert ds_model.get("prompt_price_per_million") == 0.15
    assert ds_model.get("cache_price_per_million") == 0.014
    gem_model = enrich_model_with_tariffs("gemini", {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash"})
    assert gem_model.get("is_free") is True

    assert classify_provider_error("HTTP 402 credit balance is too low", "deepseek")["kind"] == "quota_exhausted"
    assert classify_provider_error("RESOURCE_EXHAUSTED 429 rate limit", "gemini")["kind"] == "rate_limited"

    # 2. Orden estático de system prompt para maximizar Prompt Caching
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "empresa").mkdir(parents=True, exist_ok=True)
        (ws / "habilidades").mkdir(parents=True, exist_ok=True)
        with patch.object(openrouter_client, "_current_local_datetime_label", return_value="2026-11-13 10:00"):
            p1 = openrouter_client._build_system_prompt(ws / "empresa", ws / "habilidades", [], [], [], stream_mode=True, workspace_root=ws)
        with patch.object(openrouter_client, "_current_local_datetime_label", return_value="2026-11-13 10:45"):
            p2 = openrouter_client._build_system_prompt(ws / "empresa", ws / "habilidades", [], [], [], stream_mode=True, workspace_root=ws)
        marker = "FECHA Y HORA LOCAL ACTUAL DEL SISTEMA:"
        assert marker in p1 and marker in p2
        prefix_1 = p1.split(marker, 1)[0]
        prefix_2 = p2.split(marker, 1)[0]
        assert len(prefix_1) > 1500 and prefix_1 == prefix_2

    # 3. Adaptador nativo Anthropic /v1/messages (prompt + tools + cache_control + SSE)
    ant_req = build_anthropic_request_payload(
        {
            "model": "claude-sonnet-4-6",
            "max_tokens": 2048,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": "Instrucciones fijas de XOOK."},
                {"role": "user", "content": "Consulta 1"},
                {"role": "user", "content": "Consulta 2"},
                {
                    "role": "assistant",
                    "content": "Llamando herramienta",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "workspace_list", "arguments": "{\"path\": \".\"}"},
                        }
                    ],
                },
                {"role": "tool", "tool_call_id": "call_1", "content": "{\"files\": [\"a.txt\"]}"},
            ],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "workspace_list",
                        "description": "Lista archivos",
                        "parameters": {"type": "object", "properties": {"path": {"type": "string"}}},
                    },
                }
            ],
        },
        stream=True,
    )
    assert ant_req["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert ant_req["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    assert [m["role"] for m in ant_req["messages"]] == ["user", "assistant", "user"]
    assert ant_req["messages"][1]["content"][-1]["type"] == "tool_use"
    assert ant_req["messages"][2]["content"][0]["type"] == "tool_result"

    class _FakeAnthropicStreamResp:
        def __init__(self, sse_lines: list):
            self._lines = [ln.encode("utf-8") for ln in sse_lines]

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def __iter__(self):
            return iter(self._lines)

    fake_ant_sse = _FakeAnthropicStreamResp([
        "event: message_start\n",
        'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":120,"cache_read_input_tokens":80}}}\n\n',
        "event: content_block_delta\n",
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Analizando..."}}\n\n',
        "event: content_block_start\n",
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"workspace_list"}}\n\n',
        "event: content_block_delta\n",
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\".\\"}"}}\n\n',
        "event: content_block_delta\n",
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Listo"}}\n\n',
        "event: message_delta\n",
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}\n\n',
    ])
    translated_events = list(iter_anthropic_sse_as_openai_events(fake_ant_sse, default_model="claude-sonnet-4-6"))
    assert any(ev["choices"][0]["delta"].get("reasoning_content") == "Analizando..." for ev in translated_events)
    assert any(ev["choices"][0]["delta"].get("content") == "Listo" for ev in translated_events)
    assert any(
        ev["choices"][0]["delta"].get("tool_calls", [{}])[0].get("function", {}).get("name") == "workspace_list"
        for ev in translated_events
    )
    assert translated_events[-1].get("usage", {}).get("prompt_tokens_details", {}).get("cached_tokens") == 80

    # 4. Failover automático ante cuota agotada (no-stream DeepSeek -> Groq + cooldown)
    clear_router_runtime_state()
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "empresa").mkdir(parents=True, exist_ok=True)
        (ws / "habilidades").mkdir(parents=True, exist_ok=True)
        nonstream_providers_called = []

        def fake_provider_http(provider_arg, url, *, method="GET", api_key=None, payload=None, timeout=60):
            if method == "GET":
                return {"data": []}
            nonstream_providers_called.append(provider_arg)
            if provider_arg == "deepseek":
                raise RuntimeError("HTTP 402 error: credit balance is too low")
            return {
                "model": "llama-3.3-70b-versatile",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "Respondido desde Groq tras respaldo.",
                        }
                    }
                ],
                "usage": {"prompt_tokens": 50, "completion_tokens": 12},
            }

        with patch.object(openrouter_client, "_provider_http_json", side_effect=fake_provider_http):
            nonstream_out = openrouter_client.run_agent_completion(
                api_key="sk-deepseek-test1234567890",
                model_id="deepseek-chat",
                user_message="Hola, responde breve.",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                workspace_root=str(ws),
                provider="deepseek",
                provider_credentials={
                    "deepseek": {"api_key": "sk-deepseek-test1234567890", "model_id": "deepseek-chat"},
                    "groq": {"api_key": "gsk_groq_test1234567890", "model_id": "llama-3.3-70b-versatile"},
                },
                auto_failover=True,
                failover_order=["deepseek", "groq"],
            )

        assert nonstream_providers_called == ["deepseek", "groq"], nonstream_providers_called
        assert nonstream_out["provider_used"] == "groq", nonstream_out
        assert is_provider_in_cooldown("deepseek") is True
        assert nonstream_out["exhausted_providers"][0]["provider"] == "deepseek"
        assert nonstream_out["failover_events"][0]["to_provider"] == "groq"
        assert "DeepSeek" in (nonstream_out.get("failover_notice") or "")
        assert "Groq" in (nonstream_out.get("failover_notice") or "")

    # 5. Failover automático en streaming (OpenAI 429 quota -> Anthropic nativo + evento provider_failover)
    clear_router_runtime_state()
    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "empresa").mkdir(parents=True, exist_ok=True)
        (ws / "habilidades").mkdir(parents=True, exist_ok=True)
        stream_events = []

        def fake_openai_quota_urlopen(req, context=None, timeout=None):
            err_body = json.dumps({"error": {"message": "You exceeded your current quota (insufficient_quota)"}}).encode("utf-8")
            raise urllib.error.HTTPError(
                url=req.full_url,
                code=429,
                msg="Too Many Requests",
                hdrs={},
                fp=io.BytesIO(err_body),
            )

        def fake_ant_stream(api_key_arg, openai_payload_arg, timeout_sec=60):
            return _FakeAnthropicStreamResp([
                "event: message_start\n",
                'data: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":40}}}\n\n',
                "event: content_block_delta\n",
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Respuesta desde Claude tras respaldo."}}\n\n',
                "event: message_delta\n",
                'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n',
            ])

        with patch.object(
            openrouter_client,
            "list_provider_models",
            return_value={"ok": True, "provider": "openai", "models": [{"id": "gpt-4o", "name": "GPT-4o", "supports_tools": True}]},
        ), patch.object(urllib.request, "urlopen", side_effect=fake_openai_quota_urlopen), patch.object(
            openrouter_client, "open_anthropic_stream", side_effect=fake_ant_stream
        ):
            stream_out = openrouter_client.stream_agent_completion(
                api_key="sk-proj-test1234567890",
                model_id="gpt-4o",
                user_message="Dime hola.",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                emit_event=stream_events.append,
                workspace_root=str(ws),
                provider="openai",
                provider_credentials={
                    "openai": {"api_key": "sk-proj-test1234567890", "model_id": "gpt-4o"},
                    "anthropic": {"api_key": "sk-ant-test1234567890", "model_id": "claude-sonnet-4-6"},
                },
                auto_failover=True,
                failover_order=["openai", "anthropic"],
            )

        assert stream_out["provider_used"] == "anthropic", stream_out
        assert "Respuesta desde Claude tras respaldo." in stream_out["reply"]
        assert stream_out["exhausted_providers"][0]["provider"] == "openai"
        failover_sse = [ev for ev in stream_events if ev.get("type") == "provider_failover"]
        assert len(failover_sse) == 1, stream_events
        assert failover_sse[0]["from_provider"] == "openai" and failover_sse[0]["to_provider"] == "anthropic"
        assert "OpenAI" in (stream_out.get("failover_notice") or "")
        assert "Anthropic" in (stream_out.get("failover_notice") or "")

    # 6. Extracción de clave con prefijo ENV= + herramienta configure_ai_vault + SSE vault_action
    from slices.ai_service.provider_registry import normalize_provider_api_key

    assert normalize_provider_api_key('DEEPSEEK_API_KEY="sk-1234567890abcdef1234"') == "sk-1234567890abcdef1234"
    extracted_va = openrouter_client._extract_vault_action_from_tool_calls([
        {
            "id": "tc_vault_1",
            "type": "function",
            "function": {
                "name": "configure_ai_vault",
                "arguments": json.dumps({"provider": "deepseek", "action": "prompt_key", "note": "Usa tu clave sk-..."}),
            },
        }
    ])
    assert extracted_va == {"provider": "deepseek", "intent": "prompt_key", "note": "Usa tu clave sk-..."}, extracted_va

    with tempfile.TemporaryDirectory() as tmp:
        ws = Path(tmp)
        (ws / "empresa").mkdir(parents=True, exist_ok=True)
        (ws / "habilidades").mkdir(parents=True, exist_ok=True)
        sys_prompt = openrouter_client._build_system_prompt(
            ws / "empresa", ws / "habilidades", [], [], [], stream_mode=True, workspace_root=ws
        )
        assert "configure_ai_vault" in sys_prompt
        assert "PROHIBIDO decirle que edite un archivo `.env`" in sys_prompt

        class _FakeVaultToolStream:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def __iter__(self):
                chunk_tc = {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_vault_1",
                                        "type": "function",
                                        "function": {
                                            "name": "configure_ai_vault",
                                            "arguments": json.dumps({"provider": "deepseek", "action": "prompt_key"}),
                                        },
                                    }
                                ]
                            },
                            "finish_reason": "tool_calls",
                        }
                    ]
                }
                yield ("data: " + json.dumps(chunk_tc) + "\n").encode("utf-8")
                yield b"data: [DONE]\n"

        vault_events = []
        with patch.object(
            openrouter_client,
            "list_provider_models",
            return_value={"ok": True, "provider": "openrouter", "models": [{"id": "openrouter/free", "name": "Auto", "supports_tools": True}]},
        ), patch.object(urllib.request, "urlopen", return_value=_FakeVaultToolStream()):
            vault_res = openrouter_client.stream_agent_completion(
                api_key="sk-or-v1-test1234567890",
                model_id="openrouter/free",
                user_message="Ayúdame a poner deepseek en tu bóveda.",
                history=[],
                context_dir=ws / "empresa",
                skills_dir=ws / "habilidades",
                emit_event=vault_events.append,
                workspace_root=str(ws),
                provider="openrouter",
            )
        assert vault_res.get("vault_action", {}).get("provider") == "deepseek", vault_res
        assert any(ev.get("type") == "vault_action" and ev["vault_action"]["provider"] == "deepseek" for ev in vault_events), vault_events

    clear_router_runtime_state()
    print("✅ Registro multi-proveedor, adaptador Anthropic, bóveda en chat y failover automático verificados.")


def test_unified_host_fs_tools_and_anti_injection():
    import tempfile
    from slices.agent_tools.toolkit import WorkspaceToolExecutor
    from slices.ai_service import openrouter_client

    with tempfile.TemporaryDirectory() as tmp_ws, tempfile.TemporaryDirectory() as tmp_host:
        ws = Path(tmp_ws)
        host = Path(tmp_host)
        for sub in ("empresa", "datos", "memoria", "habilidades", "agente"):
            (ws / sub).mkdir(parents=True, exist_ok=True)
        (ws / "agente/nota.md").write_text("Hola workspace\nlinea dos\n", encoding="utf-8")
        (ws / "datos/precios.csv").write_text("sku,precio\nA1,100\n", encoding="utf-8")

        secret_val = "xook-super-session-secret-998877"
        ext_file = host / "doc_externo.txt"
        ext_file.write_text(
            f"Notas proyecto\nClave filtrada: sk-or-v1-abcdef1234567890\nSession: {secret_val}\n",
            encoding="utf-8",
        )

        rpc_calls = []

        def fake_bridge(payload: dict) -> dict:
            rpc_calls.append(payload)
            cb = payload.get("rpc_callback")
            if cb == "host_fs_list":
                return {"ok": True, "path": payload["path"], "outside_workspace": True, "entries": [{"name": "doc_externo.txt", "kind": "file"}]}
            if cb == "host_fs_search":
                return {"ok": True, "base_path": payload["path"], "outside_workspace": True, "matches": [{"path": str(ext_file), "match_type": "filename"}]}
            if cb == "host_fs_authorize_read":
                return {"ok": True, "authorized_path": str(ext_file), "outside_workspace": True}
            if cb == "host_fs_edit":
                return {"ok": True, "path": payload["path"], "edited": True, "outside_workspace": True}
            if cb == "host_fs_write":
                return {"ok": True, "path": payload["path"], "bytes_written": len(payload["content"]), "outside_workspace": True}
            if cb == "host_fs_mkdir":
                return {"ok": True, "created_dir": payload["path"], "outside_workspace": True}
            if cb == "run_workspace_command":
                return {
                    "ok": True,
                    "status": "finished",
                    "cwdRel": payload["cwd"],
                    "stdout": f"leak=AIzaSyDummyKey1234567890123456 {secret_val}\n",
                    "stderr": "",
                    "exitCode": 0,
                }
            return {"ok": False, "error": f"RPC inesperado: {cb}"}

        executor = WorkspaceToolExecutor(ws, command_bridge=fake_bridge, active_secrets=[secret_val])

        # 1. workspace_list, workspace_search y workspace_read con rutas externas + redacción de secretos
        ls_ext = executor.execute("workspace_list", {"path": "~/Downloads", "filter": "doc"})
        assert ls_ext["ok"] is True and ls_ext["trust_level"] == "external_untrusted_data", ls_ext
        assert rpc_calls[-1]["rpc_callback"] == "host_fs_list" and rpc_calls[-1]["path"] == "~/Downloads"

        sr_ext = executor.execute("workspace_search", {"path": "~/Documents", "query": "doc", "mode": "name"})
        assert sr_ext["ok"] is True and sr_ext["trust_level"] == "external_untrusted_data"
        assert rpc_calls[-1]["rpc_callback"] == "host_fs_search" and rpc_calls[-1]["mode"] == "name"

        rd_ext = executor.execute("workspace_read", {"path": str(ext_file)})
        assert rd_ext["ok"] is True and rd_ext["outside_workspace"] is True
        assert rd_ext["trust_level"] == "external_untrusted_data"
        assert "sk-or-v1-abcdef" not in rd_ext["content"]
        assert secret_val not in rd_ext["content"]
        assert "[REDACTED_API_KEY]" in rd_ext["content"]
        assert "[REDACTED_SESSION_SECRET]" in rd_ext["content"]

        # 2. workspace_edit_file autónomo en agente/, HITL en datos/ y bridge en ruta externa
        ed_local = executor.execute(
            "workspace_edit_file",
            {"path": "agente/nota.md", "old_text": "linea dos", "new_text": "linea actualizada"},
        )
        assert ed_local["ok"] is True
        assert "linea actualizada" in (ws / "agente/nota.md").read_text(encoding="utf-8")

        ed_hitl = executor.execute(
            "workspace_edit_file",
            {"path": "datos/precios.csv", "old_text": "A1,100", "new_text": "A1,125"},
        )
        assert ed_hitl["ok"] is True
        assert any(t.get("stagingPayload", {}).get("kind") == "file_edit" for t in executor.staged_tasks)

        ed_ext = executor.execute(
            "workspace_edit_file",
            {"path": "~/Documents/notas.md", "old_text": "viejo", "new_text": "nuevo"},
        )
        assert ed_ext["ok"] is True and rpc_calls[-1]["rpc_callback"] == "host_fs_edit"

        # 3. write/mkdir externos delegan al Guardián
        wr_ext = executor.execute("workspace_write_file", {"path": "~/Desktop/hola.txt", "content": "hola"})
        assert wr_ext["ok"] is True and rpc_calls[-1]["rpc_callback"] == "host_fs_write"
        mk_ext = executor.execute("workspace_mkdir", {"path": "~/Desktop/NuevaCarpeta"})
        assert mk_ext["ok"] is True and rpc_calls[-1]["rpc_callback"] == "host_fs_mkdir"

        # 4. run_workspace_command preserva cwd externo (`~/Downloads` o `/...`) y redacta stdout
        cmd_ext = executor.execute(
            "run_workspace_command",
            {"purpose": "Listar descargas", "command": "ls -la", "cwd": "~/Downloads"},
        )
        assert cmd_ext["ok"] is True
        assert rpc_calls[-1]["cwd"] == "~/Downloads"
        assert "AIzaSyDummy" not in cmd_ext["stdout"]
        assert secret_val not in cmd_ext["stdout"]
        assert cmd_ext["trust_level"] == "external_untrusted_data"

        # 5. Prompt unificado y regla anti-prompt-injection presentes
        sp = openrouter_client._build_system_prompt(
            ws / "empresa", ws / "habilidades", [], [], [], stream_mode=True, workspace_root=ws
        )
        assert "~/Desktop" in sp and "SEGURIDAD ANTI-PROMPT-INJECTION" in sp

    print("✅ Herramientas unificadas de archivos del equipo, edición y limpieza anti-prompt-injection verificadas.")


if __name__ == "__main__":
    test_sidecar_ping_and_inventory()
    test_canvas_schema_and_stream_router()
    test_task_normalization_and_clarification()
    test_review_engine_and_agent_tools()
    test_task_aware_model_router_and_failover()
    test_desktop_app_launcher_tools_and_routing()
    test_pdf_engine_and_multimodal_pipeline()
    test_spaced_xml_tags_and_live_pdf_preview()
    test_ready_cover_full_page_and_content_enforcement()
    test_free_form_response_and_stray_tag_cleanup()
    test_screen_reading_tools_and_unified_memory()
    test_multi_provider_registry_anthropic_and_failover()
    test_unified_host_fs_tools_and_anti_injection()

