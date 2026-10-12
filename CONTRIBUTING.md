# Contributing to Sondar

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Getting started

1. Install the requirements listed in the [README](README.md#development).
2. `npm install`, then `npm run tauri dev`.
3. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a map of the code.

## Before opening a pull request

- `npx tsc --noEmit` passes (frontend types).
- `cargo clippy` and `cargo fmt --check` pass inside `src-tauri/`.
- The change was tried against a real serial device when it touches the serial path.
- One topic per pull request, with a short description of what and why.

## Reporting bugs

Include your OS, the board or USB-serial adapter, the port settings (baud rate, frame) and, if possible, a sample of what the device sends.

## Code style

- TypeScript: strict mode, function components, no state libraries unless needed.
- Keep heavy data (serial bytes, plot samples) out of React state: it flows through the stream emitter and is drawn directly by xterm.js and uPlot.
- Rust: keep commands small; anything blocking runs on its own thread.
