# 📦 Skill: Asesor de Inventario y Abastecimiento (`inventory-advisor`)

## 1. Propósito de Negocio
Este Skill asiste a los administradores de tienda o encargados de compras a supervisar el nivel de stock en almacén, identificar quiebres de inventario inminentes y formular propuestas de reabastecimiento en lenguaje natural y sin jerga técnica.

---

## 2. Flujo de Trabajo (Centrado en el Usuario)

```text
[Revisión de Stock] ➡️ [Detección de Bajo Stock] ➡️ [Tarjeta de Propuesta] ➡️ [Aprobación HITL]
```

1. **Monitoreo Silencioso:** El agente examina el estado del inventario contra el histórico de ventas y umbrales mínimos.
2. **Generación de Tarjeta de Acción:** Si un producto está por agotarse, el agente formula una propuesta clara:
   - Nombre común del producto y cantidad restante.
   - Proveedor habitual y precio sugerido.
   - Costo total de la orden.
3. **Decisión del Usuario (Human-in-the-Loop):** El usuario ve un botón simple:
   - `[Aprobar Orden]`
   - `[Ajustar Cantidad]`
   - `[Descartar por ahora]`
4. **Retroalimentación a Memoria:** Si el usuario rechaza o ajusta la cantidad, la capa de Machine Learning en `/context/memory` almacena la preferencia (ej. *"El usuario prefiere pedir menos unidades en fin de mes"*).

---

## 3. Contrato de Datos Simplificado (`schema.json`)

Los datos intercambiados con la interfaz no muestran IDs técnicos ni tokens; sólo entidades legibles:

```json
{
  "product_name": "string (ej. Café Chiapas 500g)",
  "current_stock": "number (ej. 4)",
  "recommended_order": "number (ej. 20)",
  "estimated_cost": "number (ej. 1400.00)",
  "supplier_name": "string (ej. Distribuidora del Sur)",
  "urgency": "alta | media | baja"
}
```

