mod files;
mod serial;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(serial::SerialState::default())
        .manage(files::LogState::default())
        .invoke_handler(tauri::generate_handler![
            serial::list_ports,
            serial::open_port,
            serial::close_port,
            serial::write_port,
            serial::set_signals,
            files::log_start,
            files::log_write,
            files::log_stop,
            files::save_export,
            files::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
