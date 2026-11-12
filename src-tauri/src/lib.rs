use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

mod quick_summon;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActionCard {
    pub card_id: String,
    pub title: String,
    pub description: String,
    pub urgency: String,
    pub product_name: String,
    pub current_stock: i32,
    pub recommended_order: i32,
    pub estimated_cost: f64,
    pub currency: String,
    pub supplier_name: String,
    pub reasoning: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DecisionPayload {
    pub card_id: String,
    pub decision: String, // "approved" | "rejected" | "adjusted"
    pub adjusted_qty: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryPattern {
    pub pattern_id: String,
    pub description: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemorySummary {
    pub total_decisions: usize,
    pub patterns: Vec<MemoryPattern>,
}

// Helper para encontrar el directorio base del proyecto
fn get_context_dir() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    // Si estamos corriendo dentro de src-tauri, subimos un nivel
    if current_dir.ends_with("src-tauri") {
        current_dir.parent().unwrap().join("context")
    } else {
        current_dir.join("context")
    }
}

#[tauri::command]
fn get_mock_action_cards() -> Vec<ActionCard> {
    vec![
        ActionCard {
            card_id: "card_cafe_01".into(),
            title: "Reponer Café Chiapas 500g".into(),
            description: "El stock actual (4 bolsas) se agotará en aproximadamente 2 días.".into(),
            urgency: "alta".into(),
            product_name: "Café de Grano Chiapas 500g".into(),
            current_stock: 4,
            recommended_order: 20,
            estimated_cost: 1400.0,
            currency: "MXN".into(),
            supplier_name: "Distribuidora del Sur".into(),
            reasoning: "Venta promedio de 2 un./día. Se sugiere reponer 15 días de stock para evitar desabasto.".into(),
        },
        ActionCard {
            card_id: "card_te_02".into(),
            title: "Reabastecer Té Matcha 100g".into(),
            description: "Quedan 6 unidades en bodega. El proveedor tarda 5 días hábiles en entregar.".into(),
            urgency: "media".into(),
            product_name: "Té Matcha Premium 100g".into(),
            current_stock: 6,
            recommended_order: 15,
            estimated_cost: 2250.0,
            currency: "MXN".into(),
            supplier_name: "Comercializadora Bajío".into(),
            reasoning: "Plazo de entrega de 5 días. Si se espera al viernes habrá quiebre de stock.".into(),
        },
    ]
}

#[tauri::command]
fn approve_action(payload: DecisionPayload) -> Result<String, String> {
    let context_dir = get_context_dir();
    let memory_file = context_dir.join("memory").join("memory_store.json");

    println!("🛡️ [HITL Guard] Decisión del Administrador: {:?}", payload);

    if memory_file.exists() {
        if let Ok(content) = fs::read_to_string(&memory_file) {
            if let Ok(mut json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                let entry = serde_json::json!({
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                    "action_type": "stock_reorder",
                    "card_id": payload.card_id,
                    "decision": payload.decision,
                    "adjusted_qty": payload.adjusted_qty,
                    "notes": payload.notes
                });

                if let Some(history) = json_val.get_mut("feedback_history").and_then(|v| v.as_array_mut()) {
                    history.push(entry);
                    let _ = fs::write(&memory_file, serde_json::to_string_pretty(&json_val).unwrap());
                }
            }
        }
    }

    Ok(format!(
        "Acción '{}' autorizada con éxito por el usuario y guardada en memoria local.",
        payload.card_id
    ))
}

#[tauri::command]
fn get_learned_patterns() -> Vec<MemoryPattern> {
    let context_dir = get_context_dir();
    let memory_file = context_dir.join("memory").join("memory_store.json");

    if memory_file.exists() {
        if let Ok(content) = fs::read_to_string(&memory_file) {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(patterns) = json_val.get("inferred_patterns").and_then(|v| v.as_array()) {
                    return patterns
                        .iter()
                        .filter_map(|p| {
                            Some(MemoryPattern {
                                pattern_id: p.get("pattern_id")?.as_str()?.to_string(),
                                description: p.get("description")?.as_str()?.to_string(),
                                confidence: p.get("confidence")?.as_f64()?,
                            })
                        })
                        .collect();
                }
            }
        }
    }

    vec![MemoryPattern {
        pattern_id: "pat_init".into(),
        description: "El sistema prioriza proveedores calificados con más de 4.5 estrellas.".into(),
        confidence: 0.95,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(quick_summon::SummonState::default())
        .setup(|app| {
            quick_summon::setup_quick_summon(app.handle())?;
            Ok(())
        })
        .on_window_event(quick_summon::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            get_mock_action_cards,
            approve_action,
            get_learned_patterns,
            quick_summon::hide_quick_bar,
            quick_summon::toggle_quick_bar_cmd,
            quick_summon::open_main_workspace
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(quick_summon::handle_run_event);
}
