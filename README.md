# Sonda Serial

A free, open source serial terminal with live plotting, for working with microcontrollers over UART.

Install it, open it, pick a port and read. Send commands to your board and watch its signals plotted in real time from the same data stream, side by side.

> Status: early prototype. Windows first; macOS and Linux builds come from the same code.

## Features

- **All port settings in view.** Port, baud rate, data bits, parity, stop bits and flow control as grouped options you change with one click, like classic serial terminals. Once connected they fold into a one-line summary. The last configuration is remembered.
- **UART frame diagram.** Shows how a character travels on the wire with the current settings (start, data bits LSB first, parity, stop), plus bit time and maximum characters per second.
- **Terminal that behaves.** Auto-scroll that follows new data, stays put when you scroll up, and offers a "go to end" button. Pause without losing data.
- **ASCII and HEX views**, optional timestamps, echo of sent commands, ANSI colors from the device.
- **Send line** with history (↑/↓), line ending selector (none, CR, LF, CR+LF) and escapes for raw bytes: `\r`, `\n`, `\t`, `\0`, `\\`, `\xHH`.
- **Quick commands** with a name, editable in place, triggered with a click or F1–F12.
- **Live plot** of numeric lines: channels are detected automatically, with min/max/mean per channel and a 5–60 s time window. Pick which channels to show, and choose how the Y axis behaves: **Auto** (fits the visible data), **Expand** (grows to fit new peaks and never shrinks) or **Manual** (fixed min and max). Drag across the plot to zoom into a time span; double-click to go back to live data. Export the samples to CSV (`Documents/Sonda Serial/exports`).
- **Auto-reconnect** when the board is unplugged or reset.
- **Control lines.** DTR and RTS switches (reset a board or put it in bootloader mode without touching it) and live CTS, DSR, CD and RI indicators.
- **Session log** to a text file, one timestamped line per event (`RX`, `TX`, info), saved in `Documents/Sonda Serial/logs`.
- **Light and dark themes**, following the system setting by default.

### Plot format

Any line with numbers is plotted. The same formats as the Arduino Serial Plotter are understood:

```
temp=24.5 hum=40        named channels with "="
temp:24.5,hum:40        named channels with ":"
24.5,40                 unnamed → ch1, ch2 (comma, space, tab or semicolon)
```

Lines without numbers (logs, prompts) only go to the terminal.

## Development

Requirements: [Node.js](https://nodejs.org/) 20+, [Rust](https://rustup.rs/) (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS (on Windows: Microsoft C++ Build Tools and WebView2).

```sh
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # build the installer (src-tauri/target/release/bundle/)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized and [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.

## License

[MIT](LICENSE)
