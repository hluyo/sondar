# Architecture

FreeSerial is a [Tauri 2](https://tauri.app/) app: a Rust backend that owns the serial port and a React + TypeScript frontend rendered by the system web view.

```
┌──────────────── Rust (src-tauri) ────────────────┐      ┌────────────── Frontend (src) ──────────────┐
│ serial.rs                                        │      │ App.tsx                                    │
│  list_ports / open_port / close_port /           │ IPC  │  connect, send, auto-reconnect             │
│  write_port / set_signals    (Tauri commands)    │◄────►│                                            │
│                                                  │      │  Emitter<StreamEvent>  ("the stream")      │
│  reader thread ──batches bytes──► Channel ───────┼─────►│     ├─► TerminalRenderer → xterm.js        │
│                                                  │      │     └─► PlotStore → uPlot                  │
└──────────────────────────────────────────────────┘      └────────────────────────────────────────────┘
```

## Backend (`src-tauri/src`)

- `serial.rs`: all serial access, built on the [`serialport`](https://crates.io/crates/serialport) crate.
  - `open_port` opens the port and starts a reader thread. The thread reads with a short timeout and sends the bytes to the frontend through a Tauri `Channel`, batching them every ~16 ms (or 16 KB) so fast devices do not flood the UI.
  - When the port fails (cable pulled, board reset), the thread sends `Closed { reason }`. A user-initiated close sends `Closed { reason: None }`.
  - Writes go through a cloned handle held in `SerialState`.
- `lib.rs`: registers the commands and the shared state.

## Frontend (`src`)

- `lib/stream.ts`: `StreamEvent` (rx, tx, info, error) and a tiny `Emitter`. Every event on the link goes through one stream; the terminal and the plot both subscribe, which is what keeps them in sync.
- `lib/terminalRenderer.ts`: turns stream events into xterm.js writes: ASCII or HEX view, timestamps, echo, pause queue. Device ANSI sequences pass through.
- `lib/lineParser.ts`: extracts numeric channels from a text line (`name=value`, `name:value` or plain numbers).
- `lib/plotStore.ts`: column store for the plot (shared time axis + one array per channel), capped in size, plus per-window statistics.
- `lib/encoding.ts`: line endings and escape handling (`\r`, `\n`, `\xHH`…) for sent commands.
- `lib/serial.ts`: typed wrappers around the Tauri commands.
- `lib/settings.ts`: settings persisted in `localStorage`.
- `components/`: `ConnectionBar`, `QuickCommands`, `TerminalPanel` (toolbar, terminal, send bar), `PlotPanel`.

### Performance rules

Serial data never goes through React state. Bytes flow from the channel to the emitter and are drawn directly by xterm.js (terminal) and uPlot (plot, redrawn at most ~30 times per second inside `requestAnimationFrame`). React only re-renders for UI state and for small summaries (counters, channel stats) a few times per second.

## Packaging

`npm run tauri build` produces the Windows installers (NSIS `.exe` and `.msi`) in `src-tauri/target/release/bundle/`. The app has no runtime dependencies beyond WebView2, which ships with Windows 10/11.
