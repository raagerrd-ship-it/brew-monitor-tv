---
name: BLE scanner do-not-regenerate
description: pi/brew-ble/ble_scanner.py uses Kegland 0x4152 PT-V2 format — never rewrite from scratch
type: constraint
---
`pi/brew-ble/ble_scanner.py` must NOT be regenerated or rewritten from scratch. It decodes the RAPT Pill Kegland manufacturer id 0x4152 "PT" V2 payload with exact byte offsets (temp = uint16 BE at [9:11] / 128 - 273.15 K; gravity = float32 BE at [11:15] / 1000; battery = uint16 BE at [21:23] / 256) plus a silent-stall watchdog (`STALL_RESTART_SEC`) that exits so systemd restarts BlueZ.

**Why:** the AI cannot see the real Kegland wire format; every speculative rewrite reintroduces a broken decoder (iBeacon-style parsing, wrong offsets, wrong scaling). The committed version is field-verified against a live pill.

**How to apply:** only make surgical edits to the existing file. If a change is needed, diff against the current committed version — never replace the whole file with a fresh implementation.