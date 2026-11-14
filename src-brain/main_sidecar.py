"""
XOOK Agentic Brain - Sidecar
Comunica con Rust Core vía stdio (JSON-RPC) para resolver análisis de negocio,
consultar la memoria local y generar tarjetas de acción sin tecnicismos.
"""

import sys
import json
from pathlib import Path
from slices.task_ui.schemas import sanitize_task_proposal
from slices.ai_service.openrouter_client import (
    list_openrouter_models,
    list_provider_models,
    run_agent_completion,
    stream_agent_completion,
    test_openrouter_key,
    test_provider_key,
)

# Paths al contexto de negocio y memoria local
BASE_DIR = Path(__file__).resolve().parent.parent
CONTEXT_DIR = BASE_DIR / "context"
SKILLS_DIR = BASE_DIR / "skills"
PROFILES_FILE = CONTEXT_DIR / "business-profiles" / "store-profile.json"
MEMORY_FILE = CONTEXT_DIR / "memory" / "memory_store.json"

def load_business_profile():
    if PROFILES_FILE.exists():
        with open(PROFILES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def load_memory():
    if MEMORY_FILE.exists():
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"feedback_history": [], "inferred_patterns": []}

def save_memory(data):
    MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(MEMORY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def analyze_inventory_slice(inventory_items):
    """
    Evalúa inventario según las reglas del perfil de negocio y memoria del usuario.
    Retorna tarjetas de acción amigables para el administrador.
    """
    profile = load_business_profile()
    memory = load_memory()
    
    threshold_days = profile.get("stock_threshold_days", 7)
    cards = []
    
    for item in inventory_items:
        stock = item.get("stock", 0)
        daily_sales = item.get("avg_daily_sales", 1.0)
        days_left = stock / daily_sales if daily_sales > 0 else 999
        
        if days_left <= threshold_days:
            # Producto en riesgo de agotarse
            urgency = "alta" if stock <= 5 else "media"
            recommended_qty = int(daily_sales * 15) # Reabastecer para 15 días
            
            # Buscar proveedor sugerido
            suppliers = profile.get("preferred_suppliers", [])
            supplier = suppliers[0]["name"] if suppliers else "Proveedor por defecto"
            cost_per_unit = item.get("cost_unit", 50.0)
            estimated_cost = recommended_qty * cost_per_unit
            
            card = {
                "card_id": f"card_{item.get('sku', 'item')}_{len(cards)+1}",
                "title": f"Reponer {item.get('name')}",
                "description": f"El inventario actual ({stock} un.) se agotará en aprox. {int(days_left)} días.",
                "urgency": urgency,
                "product_name": item.get("name"),
                "current_stock": stock,
                "recommended_order": recommended_qty,
                "estimated_cost": estimated_cost,
                "currency": profile.get("currency", "MXN"),
                "supplier_name": supplier,
                "reasoning": f"Ritmo de venta de {daily_sales} un./día. Se sugiere reponer 15 días de stock."
            }
            cards.append(card)
            
    return {"status": "ok", "action_cards": cards}

def register_user_feedback(feedback):
    """
    Registra la decisión del administrador en la memoria local para aprendizaje continuo.
    """
    memory = load_memory()
    memory.setdefault("feedback_history", []).append(feedback)
    
    # Simple regla de aprendizaje: si ajustó cantidad, registrar tendencia
    if feedback.get("decision") == "adjusted":
        memory.setdefault("inferred_patterns", []).append({
            "pattern_id": f"pat_{len(memory.get('inferred_patterns', [])) + 1}",
            "description": f"El usuario ajustó la cantidad recomendada para {feedback.get('card_id')}. Prefiere órdenes más contenidas.",
            "confidence": 0.88
        })
        
    save_memory(memory)
    return {"status": "success", "message": "Aprendizaje registrado en memoria local"}

def build_generative_task_ui(inventory_items):
    """
    Construye propuestas declarativas (TaskProposal) usando bloques visuales seguros
    para que la UI pueda renderizarlas sin exponer JSON ni código al usuario final.
    """
    legacy = analyze_inventory_slice(inventory_items)
    profile = load_business_profile()
    suppliers = {s.get("name"): s for s in profile.get("preferred_suppliers", [])}
    max_budget = profile.get("max_budget_per_order", 50000.0)

    proposals = []
    for idx, card in enumerate(legacy.get("action_cards", [])):
        rec_qty = max(1, int(card.get("recommended_order", 1)))
        total_cost = float(card.get("estimated_cost", 0.0))
        unit_price = round(total_cost / rec_qty, 2) if rec_qty else 0.0
        supplier_name = card.get("supplier_name", "Proveedor")
        sup_meta = suppliers.get(supplier_name, {})
        lead_days = sup_meta.get("delivery_lead_time_days", 3)
        rating = sup_meta.get("rating", 4.5)
        stock = int(card.get("current_stock", 0))
        days_left = max(1, int(stock / 2))

        proposal = sanitize_task_proposal({
            "cardId": card.get("card_id"),
            "title": card.get("title"),
            "subtitle": card.get("description"),
            "category": "abastecimiento",
            "urgency": card.get("urgency", "media"),
            "statusChip": f"{days_left}d de stock",
            "defaultExpanded": idx == 0 and card.get("urgency") == "alta",
            "generatedBy": "Asesor de stock",
            "paramValues": {"order_qty": rec_qty},
            "intent": {
                "type": "stock_reorder",
                "targetLabel": card.get("product_name"),
                "primaryLabel": "Aprobar orden",
                "quantityParamKey": "order_qty",
                "unitPrice": unit_price,
                "currency": card.get("currency", "MXN"),
                "supplierName": supplier_name,
                "maxBudgetLimit": max_budget,
            },
            "blocks": [
                {
                    "type": "metrics_strip",
                    "items": [
                        {"label": "Stock actual", "value": f"{stock} un.", "tone": "critical" if card.get("urgency") == "alta" else "warning"},
                        {"label": "Sugerido", "value": f"+{rec_qty} un.", "tone": "neutral"},
                        {"label": "Total", "value": f"${total_cost:,.0f}", "sub": card.get("currency", "MXN"), "tone": "positive", "bindTotalFromParam": "order_qty"},
                    ],
                },
                {
                    "type": "coverage_bar",
                    "currentLabel": f"Cobertura: ~{days_left} días",
                    "targetLabel": f"Entrega proveedor: {lead_days}d",
                    "ratio": min(100, max(12, int((days_left / 10) * 100))),
                    "markerRatio": min(92, int((lead_days / 10) * 100)),
                    "tone": "critical" if days_left <= lead_days else "warning",
                },
                {
                    "type": "param_control",
                    "key": "order_qty",
                    "label": "Cantidad a pedir",
                    "kind": "stepper",
                    "value": rec_qty,
                    "min": 1,
                    "max": 500,
                    "step": 5,
                    "unit": "un.",
                    "unitPrice": unit_price,
                    "currency": card.get("currency", "MXN"),
                },
                {
                    "type": "kv_list",
                    "rows": [
                        {"label": "Proveedor", "value": supplier_name, "subtle": f"{rating}★ · {lead_days}d entrega"},
                        {"label": "Producto", "value": card.get("product_name", "")},
                    ],
                },
                {
                    "type": "insight",
                    "text": card.get("reasoning", ""),
                    "source": "Asesor de stock",
                },
            ],
        })
        proposals.append(proposal)

    return {"status": "ok", "task_proposals": proposals}


def handle_rpc_request(request_line):
    try:
        req = json.loads(request_line.strip())
        method = req.get("method")
        params = req.get("params", {})
        req_id = req.get("id")
        
        if method == "analyze_inventory":
            result = analyze_inventory_slice(params.get("items", []))
        elif method == "generate_task_ui":
            result = build_generative_task_ui(params.get("items", []))
        elif method == "ai_chat":
            ws_root = params.get("workspace_root")

            def _make_sync_bridge():
                def _bridge(req_payload):
                    sys.stdout.write(json.dumps({"stream": True, "stream_id": params.get("stream_id"), **req_payload}) + "\n")
                    sys.stdout.flush()
                    resp_line = sys.stdin.readline()
                    if not resp_line:
                        return {"ok": False, "error": "Canal de permisos cerrado."}
                    resp_obj = json.loads(resp_line.strip())
                    return resp_obj.get("result", resp_obj)

                return _bridge

            result = run_agent_completion(
                api_key=params.get("api_key", ""),
                model_id=params.get("model_id", "openrouter/free"),
                user_message=params.get("message", ""),
                history=params.get("history", []),
                context_dir=CONTEXT_DIR,
                skills_dir=SKILLS_DIR,
                current_tasks=params.get("current_tasks", []),
                agenda_items=params.get("agenda_items", []),
                attached_context=params.get("attached_context", []),
                user_profile=params.get("user_profile"),
                active_canvas=params.get("active_canvas"),
                workspace_root=ws_root,
                unified_memory=params.get("unified_memory"),
                command_bridge=_make_sync_bridge() if params.get("enable_command_bridge") else None,
                provider=params.get("provider", "openrouter"),
                provider_credentials=params.get("provider_credentials"),
                auto_failover=bool(params.get("auto_failover", True)),
                failover_order=params.get("failover_order"),
                provider_region=params.get("provider_region"),
            )
        elif method == "ai_chat_stream":
            stream_id = params.get("stream_id")
            ws_root = params.get("workspace_root")

            def _emit_stream(ev):
                payload = {"stream": True, "stream_id": stream_id, "event": ev}
                sys.stdout.write(json.dumps(payload) + "\n")
                sys.stdout.flush()

            def _stream_command_bridge(req_payload):
                payload = {"stream": True, "stream_id": stream_id, **req_payload}
                sys.stdout.write(json.dumps(payload) + "\n")
                sys.stdout.flush()
                resp_line = sys.stdin.readline()
                if not resp_line:
                    return {"ok": False, "status": "eof", "error": "Canal de permisos cerrado antes de responder."}
                resp_obj = json.loads(resp_line.strip())
                return resp_obj.get("result", resp_obj)

            result = stream_agent_completion(
                api_key=params.get("api_key", ""),
                model_id=params.get("model_id", "openrouter/free"),
                user_message=params.get("message", ""),
                history=params.get("history", []),
                context_dir=CONTEXT_DIR,
                skills_dir=SKILLS_DIR,
                emit_event=_emit_stream,
                current_tasks=params.get("current_tasks", []),
                agenda_items=params.get("agenda_items", []),
                attached_context=params.get("attached_context", []),
                user_profile=params.get("user_profile"),
                active_canvas=params.get("active_canvas"),
                workspace_root=ws_root,
                unified_memory=params.get("unified_memory"),
                command_bridge=_stream_command_bridge if params.get("enable_command_bridge", True) else None,
                provider=params.get("provider", "openrouter"),
                provider_credentials=params.get("provider_credentials"),
                auto_failover=bool(params.get("auto_failover", True)),
                failover_order=params.get("failover_order"),
                provider_region=params.get("provider_region"),
            )
        elif method == "test_ai_key":
            prov = str(params.get("provider") or "openrouter")
            if prov == "openrouter":
                result = test_openrouter_key(params.get("api_key", ""))
            else:
                result = test_provider_key(
                    prov,
                    params.get("api_key", ""),
                    region=params.get("region"),
                )
        elif method == "list_ai_models":
            prov = str(params.get("provider") or "openrouter")
            if prov == "openrouter":
                result = list_openrouter_models(
                    api_key=params.get("api_key"),
                    free_only=bool(params.get("free_only", False)),
                )
            else:
                result = list_provider_models(
                    provider=prov,
                    api_key=params.get("api_key"),
                    free_only=bool(params.get("free_only", False)),
                    region=params.get("region"),
                )
        elif method == "record_feedback":
            result = register_user_feedback(params.get("feedback", {}))
        elif method == "run_business_review":
            from slices.inventory_advisor.review_engine import run_workspace_review

            ws_root = params.get("workspace_root") or str(BASE_DIR)
            result = run_workspace_review(
                ws_root,
                trigger_source=params.get("trigger_source") or "manual",
                pending_dedup_keys=params.get("pending_dedup_keys"),
                recent_decided_dedup_keys=params.get("recent_decided_dedup_keys"),
            )
        elif method == "generate_pdf":
            from slices.agent_tools.toolkit import AUTONOMOUS_WRITE_ROOTS, resolve_workspace_path
            from slices.pdf_engine import generate_pdf_document

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            spec = params.get("spec") if isinstance(params.get("spec"), dict) else params
            result = generate_pdf_document(
                spec,
                workspace_root=ws_root,
                resolve_path_fn=resolve_workspace_path,
                autonomous_roots=AUTONOMOUS_WRITE_ROOTS,
            )
        elif method == "inspect_pdf":
            from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path
            from slices.pdf_engine import inspect_pdf_summary, read_pdf_document

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            raw_path = str(params.get("path") or "").strip()
            if not raw_path:
                result = {"ok": False, "error": "Falta el parámetro 'path' del PDF."}
            else:
                target, clean_rel, top_zone = resolve_workspace_path(ws_root, raw_path)
                if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
                    result = {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
                elif not target.is_file():
                    result = {"ok": False, "error": f"Archivo PDF no encontrado: {clean_rel}"}
                elif params.get("summary_only"):
                    summary = inspect_pdf_summary(target)
                    summary["ok"] = True
                    summary["path"] = clean_rel
                    result = summary
                else:
                    read_res = read_pdf_document(
                        target,
                        start_page=int(params.get("start_page") or 1),
                        end_page=int(params["end_page"]) if params.get("end_page") is not None else None,
                        include_tables=bool(params.get("include_tables", True)),
                        max_chars=int(params.get("max_chars") or 24000),
                        enable_ocr_fallback=bool(params.get("enable_ocr_fallback", True)),
                    )
                    read_res["path"] = clean_rel
                    result = read_res
        elif method == "render_pdf_preview":
            from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path
            from slices.pdf_engine import render_pdf_preview

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            raw_path = str(params.get("path") or "").strip()
            if not raw_path:
                result = {"ok": False, "error": "Falta el parámetro 'path' del PDF."}
            else:
                target, clean_rel, top_zone = resolve_workspace_path(ws_root, raw_path)
                if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
                    result = {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
                elif not target.is_file():
                    result = {"ok": False, "error": f"Archivo PDF no encontrado: {clean_rel}"}
                elif target.suffix.lower() != ".pdf":
                    result = {"ok": False, "error": f"El archivo no es un PDF válido: {clean_rel}"}
                else:
                    preview = render_pdf_preview(
                        target,
                        start_page=int(params.get("start_page") or 1),
                        max_pages=int(params.get("max_pages") or 8),
                        scale=float(params.get("scale") or 1.65),
                    )
                    preview["path"] = clean_rel
                    preview["filename"] = target.name
                    result = preview
        elif method == "load_pdf_editable_spec":
            from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path
            from slices.pdf_engine import load_pdf_editable_spec

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            raw_path = str(params.get("path") or "").strip()
            if not raw_path:
                result = {"ok": False, "error": "Falta el parámetro 'path' del PDF."}
            else:
                target, clean_rel, top_zone = resolve_workspace_path(ws_root, raw_path)
                if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
                    result = {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
                elif not target.is_file():
                    result = {"ok": False, "error": f"Archivo PDF no encontrado: {clean_rel}"}
                elif target.suffix.lower() != ".pdf":
                    result = {"ok": False, "error": f"El archivo no es un PDF válido: {clean_rel}"}
                else:
                    result = load_pdf_editable_spec(ws_root, target, clean_rel)
        elif method == "save_pdf_document":
            from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path
            from slices.pdf_engine import save_edited_pdf_document

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            raw_path = str(params.get("path") or "").strip()
            if not raw_path:
                result = {"ok": False, "error": "Falta el parámetro 'path' del PDF."}
            else:
                target, clean_rel, top_zone = resolve_workspace_path(ws_root, raw_path)
                if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
                    result = {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
                else:
                    payload = params.get("payload") if isinstance(params.get("payload"), dict) else params
                    result = save_edited_pdf_document(
                        ws_root,
                        target,
                        clean_rel,
                        payload,
                        resolve_workspace_path,
                    )
        elif method == "read_universal_document":
            from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path
            from slices.pdf_engine import read_universal_document

            ws_root = Path(params.get("workspace_root") or str(BASE_DIR)).resolve()
            raw_path = str(params.get("path") or "").strip()
            if not raw_path:
                result = {"ok": False, "error": "Falta el parámetro 'path' del documento."}
            else:
                target, clean_rel, top_zone = resolve_workspace_path(ws_root, raw_path)
                if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
                    result = {"ok": False, "error": f"Ruta reservada no accesible: {clean_rel}"}
                elif not target.is_file():
                    result = {"ok": False, "error": f"Archivo no encontrado: {clean_rel}"}
                else:
                    result = read_universal_document(target, clean_rel)
        elif method == "ping":
            result = {"status": "pong"}
        else:
            result = {"error": f"Método desconocido: {method}"}
            
        return json.dumps({"id": req_id, "result": result})
    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        if line.strip():
            response = handle_rpc_request(line)
            sys.stdout.write(response + "\n")
            sys.stdout.flush()

