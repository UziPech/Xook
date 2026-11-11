"""
XOOK Agentic Brain - Sidecar
Comunica con Rust Core vía stdio (JSON-RPC) para resolver análisis de negocio,
consultar la memoria local y generar tarjetas de acción sin tecnicismos.
"""

import sys
import json
from pathlib import Path

# Paths al contexto de negocio y memoria local
BASE_DIR = Path(__file__).resolve().parent.parent
CONTEXT_DIR = BASE_DIR / "context"
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

def handle_rpc_request(request_line):
    try:
        req = json.loads(request_line.strip())
        method = req.get("method")
        params = req.get("params", {})
        req_id = req.get("id")
        
        if method == "analyze_inventory":
            result = analyze_inventory_slice(params.get("items", []))
        elif method == "record_feedback":
            result = register_user_feedback(params.get("feedback", {}))
        elif method == "ping":
            result = {"status": "pong"}
        else:
            result = {"error": f"Método desconocido: {method}"}
            
        return json.dumps({"id": req_id, "result": result})
    except Exception as e:
        return json.dumps({"error": str(e)})

if __name__ == "__main__":
    for line in sys.stdin:
        if line.strip():
            response = handle_rpc_request(line)
            sys.stdout.write(response + "\n")
            sys.stdout.flush()

