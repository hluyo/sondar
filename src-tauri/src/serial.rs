//! Serial port access: listing, opening, reading in a background thread and writing.
//!
//! Incoming bytes are batched (at most every `FLUSH_INTERVAL` or `MAX_BATCH` bytes)
//! and streamed to the frontend through a Tauri channel, so a fast device does not
//! flood the UI with one message per byte.

use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serialport::{DataBits, FlowControl, Parity, SerialPort, SerialPortType, StopBits};
use tauri::State;
use tauri::ipc::Channel;

const READ_TIMEOUT: Duration = Duration::from_millis(10);
const FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const MAX_BATCH: usize = 16 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    name: String,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortConfig {
    port: String,
    baud_rate: u32,
    data_bits: u8,
    /// "none" | "odd" | "even"
    parity: String,
    stop_bits: u8,
    /// "none" | "hardware" | "software"
    flow_control: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SerialEvent {
    Data { bytes: Vec<u8> },
    Closed { reason: Option<String> },
}

struct Connection {
    writer: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

impl Connection {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.reader.take() {
            let _ = handle.join();
        }
    }
}

#[derive(Default)]
pub struct SerialState(Mutex<Option<Connection>>);

#[tauri::command]
pub fn list_ports() -> Result<Vec<PortInfo>, String> {
    let mut ports = serialport::available_ports().map_err(|e| e.to_string())?;
    ports.sort_by_key(|p| natural_key(&p.port_name));
    Ok(ports
        .into_iter()
        .map(|p| {
            let description = match p.port_type {
                SerialPortType::UsbPort(usb) => usb
                    .product
                    .or(usb.manufacturer)
                    .unwrap_or_else(|| format!("USB {:04X}:{:04X}", usb.vid, usb.pid)),
                SerialPortType::BluetoothPort => "Bluetooth".into(),
                SerialPortType::PciPort => "PCI".into(),
                SerialPortType::Unknown => String::new(),
            };
            PortInfo {
                name: p.port_name,
                description,
            }
        })
        .collect())
}

/// Sort key so that COM10 comes after COM9.
fn natural_key(name: &str) -> (String, u32) {
    let digits = name.trim_start_matches(|c: char| !c.is_ascii_digit());
    let prefix = &name[..name.len() - digits.len()];
    (prefix.to_string(), digits.parse().unwrap_or(0))
}

#[tauri::command]
pub fn open_port(
    state: State<'_, SerialState>,
    config: PortConfig,
    on_event: Channel<SerialEvent>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(previous) = guard.take() {
        previous.shutdown();
    }

    let port = serialport::new(&config.port, config.baud_rate)
        .data_bits(match config.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            _ => DataBits::Eight,
        })
        .parity(match config.parity.as_str() {
            "odd" => Parity::Odd,
            "even" => Parity::Even,
            _ => Parity::None,
        })
        .stop_bits(if config.stop_bits == 2 {
            StopBits::Two
        } else {
            StopBits::One
        })
        .flow_control(match config.flow_control.as_str() {
            "hardware" => FlowControl::Hardware,
            "software" => FlowControl::Software,
            _ => FlowControl::None,
        })
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| format!("{}: {}", config.port, e))?;

    let reader_port = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let reader = {
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("serial-reader".into())
            .spawn(move || read_loop(reader_port, stop, on_event))
            .map_err(|e| e.to_string())?
    };

    *guard = Some(Connection {
        writer: port,
        stop,
        reader: Some(reader),
    });
    Ok(())
}

fn read_loop(mut port: Box<dyn SerialPort>, stop: Arc<AtomicBool>, channel: Channel<SerialEvent>) {
    let mut buf = [0u8; 4096];
    let mut batch: Vec<u8> = Vec::with_capacity(MAX_BATCH);
    let mut last_flush = Instant::now();

    let flush = |batch: &mut Vec<u8>, last_flush: &mut Instant| {
        if !batch.is_empty() {
            let bytes = std::mem::replace(batch, Vec::with_capacity(MAX_BATCH));
            let _ = channel.send(SerialEvent::Data { bytes });
        }
        *last_flush = Instant::now();
    };

    let reason = loop {
        if stop.load(Ordering::Relaxed) {
            break None;
        }
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => batch.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == ErrorKind::TimedOut || e.kind() == ErrorKind::Interrupted => {}
            Err(e) => break Some(e.to_string()),
        }
        if batch.len() >= MAX_BATCH || last_flush.elapsed() >= FLUSH_INTERVAL {
            flush(&mut batch, &mut last_flush);
        }
    };

    flush(&mut batch, &mut last_flush);
    let _ = channel.send(SerialEvent::Closed { reason });
}

#[tauri::command]
pub fn close_port(state: State<'_, SerialState>) -> Result<(), String> {
    let connection = state.0.lock().map_err(|e| e.to_string())?.take();
    if let Some(connection) = connection {
        connection.shutdown();
    }
    Ok(())
}

#[tauri::command]
pub fn write_port(state: State<'_, SerialState>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let connection = guard.as_mut().ok_or("Port is not open")?;
    connection
        .writer
        .write_all(&data)
        .map_err(|e| e.to_string())?;
    connection.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_signals(
    state: State<'_, SerialState>,
    dtr: Option<bool>,
    rts: Option<bool>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let connection = guard.as_mut().ok_or("Port is not open")?;
    if let Some(level) = dtr {
        connection
            .writer
            .write_data_terminal_ready(level)
            .map_err(|e| e.to_string())?;
    }
    if let Some(level) = rts {
        connection
            .writer
            .write_request_to_send(level)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
