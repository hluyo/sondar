# Architecture

Sonda Serial is a [Tauri 2](https://tauri.app/) app: a Rust backend that owns the serial port and a React + TypeScript frontend rendered by the system web view.

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
  - Writes are queued to the same thread. On Windows the read and write timeouts are one setting shared by every handle of the port, so the thread raises the timeout for the length of each write (wire time ×2 plus 1 s) and puts the 10 ms read timeout back afterwards; otherwise a 500-byte burst (~45 ms at 115200 baud) would be cut and fail with "semaphore timeout" (os error 121). A cloned handle in `SerialState` is kept for the control lines.
- `serial.rs` also asserts DTR and RTS on open (RTS is left to the driver with hardware flow control) and, from the reader thread, checks the input lines (CTS, DSR, CD, RI) every 100 ms, sending `Signals` only when they change.
- `files.rs`: session log (`log_start` / `log_write` / `log_stop`), plot exports (`save_export`) and `open_folder`. Files go under `Documents/Sonda Serial/{logs,exports}`.
- `lib.rs`: registers the commands and the shared state.

## Frontend (`src`)

- `lib/stream.ts`: `StreamEvent` (rx, tx, info, error) and a tiny `Emitter`. Every event on the link goes through one stream; the terminal and the plot both subscribe, which is what keeps them in sync.
- `lib/terminalRenderer.ts`: turns stream events into xterm.js writes: ASCII or HEX view, timestamps, echo, pause queue. Device ANSI sequences pass through.
- `lib/lineParser.ts`: extracts numeric channels from a text line (`name=value`, `name:value` or plain numbers).
- `lib/plotStore.ts`: column store for the plot (shared time axis + one array per channel), capped in size, plus per-window statistics.
- `lib/encoding.ts`: line endings and escape handling (`\r`, `\n`, `\xHH`…) for sent commands.
- `lib/serial.ts`: typed wrappers around the Tauri commands.
- `lib/sessionLog.ts`: subscribes to the stream, splits received bytes into timestamped lines (ANSI codes removed) and sends them to the backend in batches.
- `lib/files.ts`: typed wrappers for the file commands.
- `lib/settings.ts`: settings persisted in `localStorage`.
- `lib/i18n.ts` and `lib/i18n.es.ts`: translations. `t("English text", vars)` looks the English string up in the Spanish dictionary, so a missing entry simply shows English; `{name}` placeholders are filled from `vars`. The language follows the system (`auto`) or the user's choice; App sets it on every render before its children render, and also uses it for the window title.
- `lib/theme.ts`: resolves the light/dark preference (or the OS setting) and sets `data-theme` on the root element. Colors are CSS tokens in `index.css`; light mode redefines the same tokens. The terminal and the plot get the theme explicitly, since xterm.js and uPlot take colors from JavaScript. The tokens follow Windows 11's Fluent look: system fonts (Segoe UI Variable, Cascadia Mono, with system fallbacks elsewhere), 4 px controls and 8 px cards, and Windows' accent blue; the terminal uses Windows Terminal's Campbell palette.
- `lib/nmea.ts`: builds and parses NMEA GGA sentences (checksum, degrees ↔ ddmm.mmmm).
- `lib/gpsSimulator.ts`: `GpsSimulator`, a timer that builds GGA sentences along a track (fixed, circle, line), applies fault injection and hands each frame to a `send` callback. App writes the frame to the port and emits it as a `tx` event (with a `note` when a fault was injected), so it appears in the terminal and the log. The simulator lives in App, not in its panel, so it keeps sending while another tab is shown, and it stops when the port closes.
- `lib/positionTracker.ts`: subscribes to received lines and keeps the last position and track the device reports, from `lat`/`lon` keys or GGA sentences.
- `lib/routeData.ts`: loads a recorded route from a folder (`<input webkitdirectory>`) or a ZIP ([fflate](https://github.com/101arrowz/fflate)), validates it against `ruta_referencia.csv`, remembers the last one in `localStorage`, and builds the fault-injected bursts (altered GGA checksum, lost bytes, a no-fix burst with the right time and valid checksums).
- `lib/routePlayer.ts`: `RoutePlayer` sends one burst per period (1 s / speed), byte for byte as stored. Each answer line (`POS,…` / `NOFIX`, anything else is ignored) belongs to the last burst sent; a burst closes after 800 ms or when the next one goes out, and is graded: correct, correct with rounding (< 0.0000015°), wrong (with the distance), format error, no response or duplicate. Bursts with an injected checksum or byte fault expect no answer; signal loss expects `NOFIX`. Also builds the CSV and GPX exports.
- `components/GpsPanel.tsx`: the GPS tab. Route steps or header, the map, the player (or the synthetic GPS controls) and folded sections. It composes the pieces in `RoutePanel.tsx` (route loader, guided steps, player card, faults, results, live details, export) and `SimulatorPanel.tsx` (synthetic GPS card, settings, last sentence).
- `components/SidePanel.tsx`: right-hand tabs (Plot, GPS) with a draggable left edge; the width is saved in the settings. Hidden panels stay mounted.
- `components/MapPanel.tsx`: [Leaflet](https://leafletjs.com/) map with OpenStreetMap tiles (dark mode inverts the tiles with a CSS filter). Draws the reported position as a rotated arrow and, depending on the source, the reference route with start/end pins and wrong answers in red, or the position the synthetic GPS sent. Its toggles float over the map.
- `components/HelpDialog.tsx`: the five-step quick guide behind the "?" button.
- `components/`: `TitleBar` (custom title bar: the window has no native decorations; logo, name, connection state and the caption buttons, with `data-tauri-drag-region` to move the window), `ConnectionBar` (command bar with Connect, state and port/baud/frame drop-downs, the only place those are set; "More settings" is a flyout over the window with custom baud, flow control, auto-reconnect, control lines and the frame diagram;) `FrameDiagram` (UART frame for the current settings), `TerminalPanel` (`ReceivePanel`: the terminal with its toolbar and first-run hint; `SendPanel`: quick commands and the command line), `PlotPanel`.

### Performance rules

Serial data never goes through React state. Bytes flow from the channel to the emitter and are drawn directly by xterm.js (terminal) and uPlot (plot, redrawn at most ~30 times per second inside `requestAnimationFrame`). React only re-renders for UI state and for small summaries (counters, channel stats) a few times per second.

## Network use

The app works offline except for the map tiles, which are loaded from `tile.openstreetmap.org` following the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (attribution shown, no bulk downloads). Without a connection the map still draws positions on an empty background.

## Packaging

`npm run tauri build` produces the Windows installers (NSIS `.exe` and `.msi`) in `src-tauri/target/release/bundle/`. The app has no runtime dependencies beyond WebView2, which ships with Windows 10/11.
