mod files;
mod serial;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer shows a blank window with some GPU drivers
    // (NVIDIA, virtual machines). The fallback renderer is plenty for this app.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: called first thing in `run`, before any other thread exists.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }

    tauri::Builder::default()
        .manage(serial::SerialState::default())
        .manage(files::LogState::default())
        .invoke_handler(tauri::generate_handler![
            serial::list_ports,
            serial::open_port,
            serial::close_port,
            serial::write_port,
            serial::set_signals,
            serial::set_rx_idle,
            files::log_start,
            files::log_write,
            files::log_stop,
            files::save_export,
            files::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
