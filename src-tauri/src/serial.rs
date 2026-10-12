//! Serial port access: listing, opening, reading in a background thread and writing.
//!
//! Incoming bytes are batched (at most every `FLUSH_INTERVAL` or `MAX_BATCH` bytes)
//! and streamed to the frontend through a Tauri channel, so a fast device does not
//! flood the UI with one message per byte.
//!
//! Writes also go through the reader thread. On Windows the read and write timeouts
//! are one setting shared by every handle of the port, and the short read timeout
//! would cut long writes (a 500-byte burst takes ~45 ms at 115200 baud). The thread
//! raises the timeout for the length of each write and puts it back afterwards;
//! bytes received meanwhile wait in the driver's buffer.

use std::io::{ErrorKind, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
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
/// How often the input lines (CTS, DSR, CD, RI) are checked.
const SIGNAL_INTERVAL: Duration = Duration::from_millis(100);
/// Extra time allowed for a write on top of what the bytes take on the wire.
const WRITE_MARGIN: Duration = Duration::from_millis(1000);

/// A write handed to the reader thread, with where to report how it went.
struct WriteRequest {
    data: Vec<u8>,
    done: Sender<Result<(), String>>,
}

/// Time the bytes take on the wire, counting 12 bits per byte (start, 8 data, parity, 2 stop)
/// so it is never short, doubled for USB and driver latency, plus a fixed margin.
fn write_timeout(len: usize, baud_rate: u32) -> Duration {
    let wire_ms = (len as u64 * 12 * 1000) / u64::from(baud_rate.max(1));
    Duration::from_millis(wire_ms * 2) + WRITE_MARGIN
}

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
    Data {
        bytes: Vec<u8>,
    },
    /// Input control lines, sent when any of them changes.
    Signals {
        cts: bool,
        dsr: bool,
        cd: bool,
        ri: bool,
    },
    Closed {
        reason: Option<String>,
    },
}

struct Connection {
    /// Used for the control lines only; data writes go through `writes`.
    writer: Box<dyn SerialPort>,
    writes: Sender<WriteRequest>,
    baud_rate: u32,
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

    let mut port = serialport::new(&config.port, config.baud_rate)
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

    // Assert DTR and RTS on open, like most terminals do. Many boards expect it:
    // on ESP32 dev boards, for example, both asserted means "run".
    // With hardware flow control the driver owns RTS, so it is left alone.
    let _ = port.write_data_terminal_ready(true);
    if config.flow_control != "hardware" {
        let _ = port.write_request_to_send(true);
    }

    let reader_port = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let (writes, write_queue) = mpsc::channel();
    let baud_rate = config.baud_rate;
    let reader = {
        let stop = stop.clone();
        std::thread::Builder::new()
            .name("serial-io".into())
            .spawn(move || io_loop(reader_port, baud_rate, stop, write_queue, on_event))
            .map_err(|e| e.to_string())?
    };

    *guard = Some(Connection {
        writer: port,
        writes,
        baud_rate,
        stop,
        reader: Some(reader),
    });
    Ok(())
}

fn io_loop(
    mut port: Box<dyn SerialPort>,
    baud_rate: u32,
    stop: Arc<AtomicBool>,
    write_queue: Receiver<WriteRequest>,
    channel: Channel<SerialEvent>,
) {
    let mut buf = [0u8; 4096];
    let mut batch: Vec<u8> = Vec::with_capacity(MAX_BATCH);
    let mut last_flush = Instant::now();
    let mut last_signals: Option<(bool, bool, bool, bool)> = None;
    let mut last_signal_check = Instant::now() - SIGNAL_INTERVAL;

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
        while let Ok(request) = write_queue.try_recv() {
            let result = write_with_timeout(&mut *port, &request.data, baud_rate);
            let _ = request.done.send(result);
        }
        if last_signal_check.elapsed() >= SIGNAL_INTERVAL {
            last_signal_check = Instant::now();
            // Some drivers do not report the input lines; those are shown as off.
            let now = (
                port.read_clear_to_send().unwrap_or(false),
                port.read_data_set_ready().unwrap_or(false),
                port.read_carrier_detect().unwrap_or(false),
                port.read_ring_indicator().unwrap_or(false),
            );
            if last_signals != Some(now) {
                last_signals = Some(now);
                let (cts, dsr, cd, ri) = now;
                let _ = channel.send(SerialEvent::Signals { cts, dsr, cd, ri });
            }
        }
    };

    flush(&mut batch, &mut last_flush);
    let _ = channel.send(SerialEvent::Closed { reason });
}

fn write_with_timeout(
    port: &mut dyn SerialPort,
    data: &[u8],
    baud_rate: u32,
) -> Result<(), String> {
    port.set_timeout(write_timeout(data.len(), baud_rate))
        .map_err(|e| e.to_string())?;
    let result = port.write_all(data).and_then(|_| port.flush());
    // Back to the short timeout so reads stay responsive, even if the write failed.
    let restored = port.set_timeout(READ_TIMEOUT);
    result.map_err(|e| e.to_string())?;
    restored.map_err(|e| e.to_string())
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
    let (done, result) = mpsc::channel();
    let wait = {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        let connection = guard.as_ref().ok_or("Port is not open")?;
        let wait = write_timeout(data.len(), connection.baud_rate) + WRITE_MARGIN;
        connection
            .writes
            .send(WriteRequest { data, done })
            .map_err(|_| "Port is not open")?;
        wait
    };
    // The lock is released while waiting, so closing the port is never blocked by a write.
    match result.recv_timeout(wait) {
        Ok(outcome) => outcome,
        Err(mpsc::RecvTimeoutError::Timeout) => Err("Write timed out".into()),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err("Port closed during the write".into()),
    }
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
