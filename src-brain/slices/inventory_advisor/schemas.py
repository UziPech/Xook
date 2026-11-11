from pydantic import BaseModel, Field
from typing import Optional, Literal

class ActionCard(BaseModel):
    card_id: str = Field(description="Identificador único de la tarjeta de acción")
    title: str = Field(description="Título amigable de la acción para el usuario (ej. 'Reponer Café Chiapas')")
    description: str = Field(description="Explicación en lenguaje humano simple")
    urgency: Literal["alta", "media", "baja"] = Field(description="Nivel de prioridad operativa")
    
    # Detalle de la propuesta de negocio
    product_name: str
    current_stock: int
    recommended_order: int
    estimated_cost: float
    currency: str = "MXN"
    supplier_name: str
    
    # Razonamiento comprensible (sin tecnicismos)
    reasoning: str = Field(description="Por qué el asistente sugiere esto (ej. 'Quedan 4 unidades y vendes 2 por día')")

class DecisionFeedback(BaseModel):
    card_id: str
    decision: Literal["approved", "adjusted", "rejected"]
    adjusted_qty: Optional[int] = None
    notes: Optional[str] = None

