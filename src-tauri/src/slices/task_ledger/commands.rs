use super::inventory::{
    self, ImportInventoryResult, InventoryItemDto, ReviewRunDto, RunReviewResult,
};
use super::migrations::open_workspace_db;
use super::store::{
    self, AgendaItemDto, AuditLogEntryDto, CompleteAgendaPayload, DecideTaskPayload,
    DecideTaskResult, DecisionHistoryDto, RecordHistoryPayload, TaskLedgerRecord,
    UpsertAgendaItemPayload, UpsertTaskPayload,
};
use crate::ai_vault;
use crate::slices::workspace_manager::registry::{WorkspaceEntry, ensure_active_workspace};
use chrono::Utc;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime};

pub const LEDGER_UPDATED_EVENT: &str = "xook:ledger-updated";
pub const WORKSPACE_UPDATED_EVENT: &str = "xox:workspace-updated";
pub const REVIEW_UPDATED_EVENT: &str = "review:updated";

pub(crate) fn open_active_db<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(WorkspaceEntry, PathBuf, rusqlite::Connection), String> {
    let (_, active) = ensure_active_workspace(app)?;
    let root = PathBuf::from(&active.root_path);
    let conn = open_workspace_db(&root)?;
    let _ = super::inventory::heal_workspace_from_db(&conn, &root, chrono::Utc::now());
    Ok((active, root, conn))
}

pub(crate) fn emit_ledger_updated<R: Runtime>(app: &AppHandle<R>, scope: &str) {
    let _ = app.emit(
        LEDGER_UPDATED_EVENT,
        serde_json::json!({ "scope": scope }),
    );
}

pub(crate) fn emit_workspace_updated<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    let _ = app.emit(
        WORKSPACE_UPDATED_EVENT,
        serde_json::json!({ "reason": reason }),
    );
}

#[tauri::command]
pub fn list_tasks<R: Runtime>(
    app: AppHandle<R>,
    status: Option<String>,
) -> Result<Vec<TaskLedgerRecord>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    store::list_tasks(&conn, status.as_deref())
}

#[tauri::command]
pub fn create_task<R: Runtime>(
    app: AppHandle<R>,
    payload: UpsertTaskPayload,
) -> Result<Option<TaskLedgerRecord>, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let saved = store::upsert_tasks_batch(&mut conn, vec![payload], false, Utc::now())?;
    emit_ledger_updated(&app, "tasks");
    Ok(saved.into_iter().next())
}

#[tauri::command]
pub fn create_tasks_batch<R: Runtime>(
    app: AppHandle<R>,
    items: Vec<UpsertTaskPayload>,
    replace_pending: Option<bool>,
) -> Result<Vec<TaskLedgerRecord>, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let saved = store::upsert_tasks_batch(
        &mut conn,
        items,
        replace_pending.unwrap_or(false),
        Utc::now(),
    )?;
    emit_ledger_updated(&app, "tasks");
    Ok(saved)
}

#[tauri::command]
pub fn update_task_proposal<R: Runtime>(
    app: AppHandle<R>,
    card_id: String,
    proposal: Value,
) -> Result<Option<TaskLedgerRecord>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    let updated = store::update_task_proposal(&conn, &card_id, &proposal, Utc::now())?;
    if updated.is_some() {
        emit_ledger_updated(&app, "tasks");
    }
    Ok(updated)
}

#[tauri::command]
pub fn decide_task_hitl<R: Runtime>(
    app: AppHandle<R>,
    payload: DecideTaskPayload,
) -> Result<DecideTaskResult, String> {
    let (active, root, mut conn) = open_active_db(&app)?;
    let res = store::decide_task_hitl_at(&mut conn, &root, &active.id, payload, Utc::now())?;
    emit_ledger_updated(&app, "all");
    emit_workspace_updated(&app, "hitl_decision");
    Ok(res)
}

#[tauri::command]
pub fn list_agenda_items<R: Runtime>(app: AppHandle<R>) -> Result<Vec<AgendaItemDto>, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    store::list_agenda_items_at(&mut conn, Utc::now())
}

#[tauri::command]
pub fn upsert_agenda_item<R: Runtime>(
    app: AppHandle<R>,
    payload: UpsertAgendaItemPayload,
) -> Result<AgendaItemDto, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let item = store::upsert_agenda_item_at(&mut conn, payload, true, Utc::now())?;
    emit_ledger_updated(&app, "agenda");
    Ok(item)
}

#[tauri::command]
pub fn toggle_timer_state<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<AgendaItemDto, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let item = store::toggle_timer_state_at(&mut conn, &id, Utc::now())?;
    emit_ledger_updated(&app, "agenda");
    Ok(item)
}

#[tauri::command]
pub fn reset_timer_state<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<AgendaItemDto, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let item = store::reset_timer_state_at(&mut conn, &id, Utc::now())?;
    emit_ledger_updated(&app, "agenda");
    Ok(item)
}

#[tauri::command]
pub fn complete_agenda_item<R: Runtime>(
    app: AppHandle<R>,
    payload: CompleteAgendaPayload,
) -> Result<DecisionHistoryDto, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let history = store::complete_agenda_item_at(&mut conn, payload, Utc::now())?;
    emit_ledger_updated(&app, "agenda_history");
    Ok(history)
}

#[tauri::command]
pub fn delete_agenda_item<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    store::delete_agenda_item_at(&mut conn, &id, Utc::now())?;
    emit_ledger_updated(&app, "agenda");
    Ok(())
}

#[tauri::command]
pub fn list_task_history<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<i64>,
) -> Result<Vec<DecisionHistoryDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    store::list_task_history(&conn, limit)
}

#[tauri::command]
pub fn record_history_entry<R: Runtime>(
    app: AppHandle<R>,
    payload: RecordHistoryPayload,
) -> Result<DecisionHistoryDto, String> {
    let (_, _, mut conn) = open_active_db(&app)?;
    let entry = store::record_history_entry_at(&mut conn, payload, Utc::now())?;
    emit_ledger_updated(&app, "history");
    Ok(entry)
}

#[tauri::command]
pub fn get_audit_log<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<i64>,
) -> Result<Vec<AuditLogEntryDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    store::get_audit_log(&conn, limit)
}

#[tauri::command]
pub fn import_inventory_file<R: Runtime>(
    app: AppHandle<R>,
    filename: Option<String>,
    content: String,
) -> Result<ImportInventoryResult, String> {
    let (_, root, mut conn) = open_active_db(&app)?;
    crate::slices::scheduler::mark_internal_datos_write();
    let result =
        inventory::import_inventory_file_at(&mut conn, &root, filename.as_deref(), &content, Utc::now())?;
    emit_workspace_updated(&app, "inventory_imported");
    Ok(result)
}

#[tauri::command]
pub fn list_inventory_items<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<InventoryItemDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    inventory::list_inventory_items(&conn)
}

#[tauri::command]
pub fn list_review_runs<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<i64>,
) -> Result<Vec<ReviewRunDto>, String> {
    let (_, _, conn) = open_active_db(&app)?;
    inventory::list_review_runs(&conn, limit)
}

#[tauri::command]
pub fn run_business_review<R: Runtime>(
    app: AppHandle<R>,
    trigger_source: Option<String>,
) -> Result<RunReviewResult, String> {
    let (_, root, mut conn) = open_active_db(&app)?;
    let script_path = ai_vault::find_sidecar_script(&app).ok();
    let trigger = trigger_source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("manual");
    let res = inventory::execute_workspace_review(
        &mut conn,
        &root,
        trigger,
        script_path.as_ref(),
        Utc::now(),
    )?;
    emit_ledger_updated(&app, "tasks");
    emit_workspace_updated(&app, "review_completed");
    let _ = app.emit(REVIEW_UPDATED_EVENT, &res);
    Ok(res)
}

