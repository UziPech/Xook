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

if __name__ == "__main__":
    test_sidecar_ping_and_inventory()

