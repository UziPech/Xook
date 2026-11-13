use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

mod ai_vault;
mod quick_summon;
mod workspace_store;

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

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceContextFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub path: String,
    pub content: String,
    pub exists: bool,
}

fn get_project_root() -> PathBuf {
    let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if current_dir.ends_with("src-tauri") {
        current_dir
            .parent()
            .map(PathBuf::from)
            .unwrap_or(current_dir)
    } else {
        current_dir
    }
}

// Helper para encontrar el directorio base del proyecto
fn get_context_dir() -> PathBuf {
    get_project_root().join("context")
}

#[tauri::command]
fn get_workspace_context() -> Vec<WorkspaceContextFile> {
    let root = get_project_root();
    let specs = [
        (
            "ctx_profile",
            "store-profile.json",
            "profile",
            "context/business-profiles/store-profile.json",
        ),
        (
            "ctx_memory",
            "memory_store.json",
            "memory",
            "context/memory/memory_store.json",
        ),
        (
            "ctx_skill",
            "inventory-advisor",
            "skill",
            "skills/inventory-advisor/SKILL.md",
        ),
    ];

    specs
        .into_iter()
        .filter_map(|(id, name, item_type, rel_path)| {
            let full_path = root.join(rel_path);
            let content = fs::read_to_string(&full_path).ok()?;
            Some(WorkspaceContextFile {
                id: id.to_string(),
                name: name.to_string(),
                item_type: item_type.to_string(),
                path: rel_path.to_string(),
                content,
                exists: true,
            })
        })
        .collect()
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
            get_workspace_context,
            ai_vault::get_ai_config,
            ai_vault::save_ai_config,
            ai_vault::test_ai_connection,
            ai_vault::fetch_openrouter_models,
            ai_vault::run_xox_chat,
            ai_vault::run_xox_chat_stream,
            workspace_store::get_local_user,
            workspace_store::save_local_user,
            workspace_store::clear_local_user,
            workspace_store::list_conversations,
            workspace_store::save_conversation,
            workspace_store::delete_conversation,
            quick_summon::quick_bar_ready,
            quick_summon::set_quick_state,
            quick_summon::hide_quick_bar,
            quick_summon::toggle_quick_bar_cmd,
            quick_summon::open_main_workspace,
            quick_summon::begin_quick_drag,
            quick_summon::step_quick_drag,
            quick_summon::end_quick_drag,
            quick_summon::reset_quick_position
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(quick_summon::handle_run_event);
}
