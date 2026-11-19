#!/bin/sh
# Run by the .deb and .rpm packages after installing or removing Sondar, so
# the serial port rules apply to boards that are already plugged in.
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload-rules || true
  udevadm trigger --subsystem-match=tty || true
fi
exit 0
