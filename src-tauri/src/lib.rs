mod serial;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(serial::SerialState::default())
        .invoke_handler(tauri::generate_handler![
            serial::list_ports,
            serial::open_port,
            serial::close_port,
            serial::write_port,
            serial::set_signals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
