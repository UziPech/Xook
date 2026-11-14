mod ai_vault;
mod quick_summon;
mod slices;
mod workspace_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(quick_summon::SummonState::default())
        .manage(slices::command_runner::runner::CommandPermissionBroker::default())
        .manage(slices::screen_context::watcher::ScreenContextState::default())
        .setup(|app| {
            if let Ok((_, active)) =
                slices::workspace_manager::registry::ensure_active_workspace(app.handle())
            {
                let root = std::path::PathBuf::from(&active.root_path);
                if let Ok(mut conn) = slices::task_ledger::migrations::open_workspace_db(&root) {
                    let _ = slices::screen_context::store::sync_business_facts_from_workspace(
                        &mut conn, &root,
                    );
                }
            }
            quick_summon::setup_quick_summon(app.handle())?;
            slices::scheduler::start_background_automation(app.handle().clone());
            slices::screen_context::watcher::start_screen_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(quick_summon::handle_window_event)
        .invoke_handler(tauri::generate_handler![
            slices::workspace_manager::commands::get_workspace_overview,
            slices::workspace_manager::commands::create_workspace,
            slices::workspace_manager::commands::switch_workspace,
            slices::workspace_manager::commands::rename_workspace,
            slices::workspace_manager::commands::read_workspace_file,
            slices::workspace_manager::commands::save_workspace_file,
            slices::workspace_manager::commands::create_workspace_folder,
            slices::workspace_manager::commands::open_workspace_folder,
            slices::workspace_manager::commands::open_workspace_file,
            slices::workspace_manager::commands::stage_workspace_attachment,
            slices::workspace_manager::commands::read_workspace_binary_preview,
            slices::workspace_manager::commands::export_canvas_pdf,
            slices::workspace_manager::commands::render_pdf_preview,
            slices::workspace_manager::commands::load_pdf_editable_spec,
            slices::workspace_manager::commands::save_pdf_document,
            slices::workspace_manager::commands::download_workspace_file,
            slices::workspace_manager::commands::download_text_artifact,
            slices::workspace_manager::commands::read_universal_document,
            slices::workspace_manager::commands::record_workspace_decision,
            slices::task_ledger::commands::list_tasks,
            slices::task_ledger::commands::create_task,
            slices::task_ledger::commands::create_tasks_batch,
            slices::task_ledger::commands::update_task_proposal,
            slices::task_ledger::commands::decide_task_hitl,
            slices::task_ledger::commands::list_agenda_items,
            slices::task_ledger::commands::upsert_agenda_item,
            slices::task_ledger::commands::toggle_timer_state,
            slices::task_ledger::commands::reset_timer_state,
            slices::task_ledger::commands::complete_agenda_item,
            slices::task_ledger::commands::delete_agenda_item,
            slices::task_ledger::commands::list_task_history,
            slices::task_ledger::commands::record_history_entry,
            slices::task_ledger::commands::get_audit_log,
            slices::task_ledger::commands::import_inventory_file,
            slices::task_ledger::commands::list_inventory_items,
            slices::task_ledger::commands::list_review_runs,
            slices::task_ledger::commands::run_business_review,
            slices::command_runner::commands::get_command_permissions,
            slices::command_runner::commands::enable_readonly_command_preset,
            slices::command_runner::commands::update_command_permission_rule,
            slices::command_runner::commands::remove_command_permission_rule,
            slices::command_runner::commands::update_command_default_policy,
            slices::command_runner::commands::list_command_executions_cmd,
            slices::command_runner::commands::resolve_command_permission,
            slices::app_launcher::commands::list_installed_apps,
            ai_vault::get_ai_config,
            ai_vault::save_ai_config,
            ai_vault::test_ai_connection,
            ai_vault::fetch_openrouter_models,
            ai_vault::get_ai_usage_ledger,
            ai_vault::set_provider_usage_limits,
            ai_vault::reset_provider_usage_ledger,
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
            quick_summon::reset_quick_position,
            slices::screen_context::commands::get_screen_reader_status,
            slices::screen_context::commands::set_screen_reader_config,
            slices::screen_context::commands::request_screen_permission_cmd,
            slices::screen_context::commands::open_screen_permission_settings,
            slices::screen_context::commands::capture_screen_context_now,
            slices::screen_context::commands::query_screen_memory_cmd,
            slices::screen_context::commands::clear_screen_memory_cmd,
            slices::screen_context::commands::get_unified_memory_context_cmd
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(quick_summon::handle_run_event);
}
