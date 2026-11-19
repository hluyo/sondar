# Changelog

All notable changes to Sondar are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). While the version starts with 0, Sondar is in beta and anything may change.

## [0.1.1] - 2026-11-19

Bug fixes for the terminal. Install it over 0.1.0: your settings and quick commands are kept.

### Fixed

- A short answer such as `OK` could be shown split over two lines (`O` and `K`) when it arrived in two pieces. Received bytes are now joined into one line, closed at CR, LF or CR LF, or after a short silence for messages with no line ending.
- A sent command could be shown after the answer to it. Sent lines are now logged with the time they were sent, before any later answer.
- Lines ending only in CR overwrote each other in the terminal; they are now separate lines, also in the log, the plot and the map.

### Added

- **More settings → End a received line after … ms without data** (30 ms by default; 0 = only at CR or LF), for exercises that send fixed-length messages with no line ending.

### Changed

- README: the quick start now says that the installer is all you need (Node.js and the other development tools are only for building Sondar from source).

## [0.1.0] - 2026-10-12

First public version (beta). Windows 10 and 11.

### Added

- **Connection bar**: Connect button, connection state with elapsed time, and drop-downs for port, baud rate and frame (all combinations of 5–8 data bits, parity and 1 or 2 stop bits). ST-LINK boards are recognized, and the port is picked automatically when the choice is obvious.
- **More settings**: custom baud rate, flow control (RTS/CTS, XON/XOFF), auto-reconnect when the board is unplugged or reset, DTR/RTS switches, CTS/DSR/CD/RI indicators, a diagram of the UART frame with bit time and maximum characters per second, and "Reset everything".
- **Terminal**: RX and TX lines tagged in color with millisecond timestamps, ASCII and HEX views, ANSI colors, auto-scroll that stops when you scroll up, and pause without losing data.
- **Sending**: command line with history and selectable line ending, escapes for raw bytes (`\r`, `\n`, `\t`, `\0`, `\\`, `\xHH`), and named quick commands run with a click or F1–F12.
- **Session log** to a text file in `Documents\Sondar\logs`.
- **Live plot** of any line with numbers (`temp=24.5`, `temp:24.5`, `24.5,40`), with channel selection, Auto / Expand / Manual Y axis, 5–60 s window, drag to zoom, per-channel statistics and CSV export to `Documents\Sondar\exports`.
- **GPS route player**: plays a recorded route (one NMEA burst per second) to the board, checks each `POS,<lat>,<lon>` or `NOFIX` answer against a reference CSV, shows the result on an OpenStreetMap map and gives a 0–10 grade. Fault injection (altered checksum, lost bytes, signal loss) and export of the received route as CSV or GPX.
- **Synthetic GPS**: generates GGA sentences on a fixed point, a circle or a straight line at 1–10 Hz, with fault injection (bad checksum, truncated sentences, garbage bytes, lost fix, silence), and warns when the board reports a position far from the one sent.
- **Spanish and English** interface, and **light and dark** themes that follow Windows by default.
- **Quick guide** with five steps, opened with the "?" button.

[0.1.1]: ../../releases/tag/v0.1.1
[0.1.0]: ../../releases/tag/v0.1.0
