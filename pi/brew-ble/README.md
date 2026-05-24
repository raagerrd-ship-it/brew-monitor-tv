# Brew BLE Sniffer (Raspberry Pi 5)

Passively scans RAPT Pill BLE advertisements and forwards them to Lovable Cloud once per minute.

## Install on Pi

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip sqlite3 bluez
sudo mkdir -p /opt/brew-ble && sudo chown $USER /opt/brew-ble
cp -r ./* /opt/brew-ble/
cd /opt/brew-ble
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
sqlite3 readings.db < schema.sql

# Configure secrets
cp env.example /opt/brew-ble/.env
nano /opt/brew-ble/.env   # paste PI_BLE_INGEST_SECRET

# Install systemd units
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now brew-ble-scanner.service
sudo systemctl enable --now brew-ble-uploader.timer
```

## Logs

```bash
journalctl -u brew-ble-scanner -f
journalctl -u brew-ble-uploader -f
sqlite3 /opt/brew-ble/readings.db "SELECT COUNT(*), SUM(synced) FROM pill_readings;"
```

## Cloud endpoint

`POST https://plwchuzidrjgyuepwdcl.supabase.co/functions/v1/ingest-pill-ble`

Header: `x-pi-secret: <PI_BLE_INGEST_SECRET>`

Body:
```json
{
  "readings": [
    {"mac":"aabbccddeeff","temp_c":18.52,"gravity_sg":1.048,"battery_pct":82,"rssi":-65,"recorded_at":"2026-05-24T12:34:56Z"}
  ]
}
```