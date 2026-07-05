# Plug poller

Runs on the Pi. Polls Supabase `plug_commands`, executes them on the local
Tuya plug, and reports plug state to `plug_state`. No inbound ports.

## Install

```bash
# on the Pi
cd ~
git clone <this repo> brew && cd brew/pi/plug-poller   # or scp the folder
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cp env.example .env
nano .env   # fill in TUYA_DEVICE_ID, TUYA_LOCAL_KEY, TUYA_IP, TUYA_VERSION
```

### Get the Tuya credentials

```bash
.venv/bin/python -m tinytuya wizard
```

Pick the right plug from `devices.json` (the one that power-cycles the RAPT
controller). Copy `id` → `TUYA_DEVICE_ID`, `key` → `TUYA_LOCAL_KEY`, `ip` →
`TUYA_IP`, `version` → `TUYA_VERSION` (usually 3.3 or 3.4).

## Test

```bash
.venv/bin/python poller.py
```

Then in the app header press "Sätt på" / "Stäng av" — the plug should react
within ~10s and the status pill should flip.

## Run as a service

```bash
sudo cp systemd/plug-poller.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plug-poller
journalctl -u plug-poller -f
```

Adjust paths in the service file if you didn't install to `/home/pi/plug-poller`.

## What it does

| Loop | Interval | Action |
| --- | --- | --- |
| Command poll | `POLL_INTERVAL_SEC` (10s) | fetch `plug_commands` where status=pending, run on/off/restart, mark done/error |
| State report | `STATE_REPORT_INTERVAL_SEC` (30s) | read plug DP 1, PATCH `plug_state.is_on` |
| Restart | `RESTART_OFF_SECONDS` (8s) | off → wait → on |

Outbound only: HTTPS to Supabase + UDP/TCP to the plug's LAN IP.

## Watchdog

`watchdog.py` runs alongside the poller. Every `WATCHDOG_INTERVAL_SEC`
(default 5 min) it checks the freshest `last_update` across all
`rapt_temp_controllers`. If older than `WATCHDOG_STALE_MIN` (default 31)
it inserts a `restart` command with `source='watchdog'`. A
`WATCHDOG_COOLDOWN_MIN` (default 20) guard prevents repeated restarts
while the controller is rebooting.

Install as a second service:

```bash
sudo cp systemd/plug-watchdog.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plug-watchdog
journalctl -u plug-watchdog -f
```

Test by stopping the poller and manually setting a controller's
`last_update` to >31 min ago, or just watch the log for the next real outage.

## Auto-update (no more manual git pull)

`auto-update.sh` + `plug-autoupdate.timer` poll the git remote every 5 min.
If new commits under `pi/plug-poller/` land on `main`, the Pi does
`git reset --hard`, reinstalls deps if `requirements.txt` changed, and
restarts only the affected service (`plug-poller` and/or `plug-watchdog`).
No inbound ports, no webhook.

### Install

```bash
chmod +x /home/pi/brew/pi/plug-poller/auto-update.sh

# allow the service unit (running as root by default) to restart the workers
sudo cp systemd/plug-autoupdate.service /etc/systemd/system/
sudo cp systemd/plug-autoupdate.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plug-autoupdate.timer

# verify
systemctl list-timers plug-autoupdate.timer
journalctl -u plug-autoupdate -f
```

If the repo lives somewhere other than `/home/pi/brew`, edit `REPO_DIR`
at the top of `auto-update.sh` (or set it in the service unit with
`Environment=REPO_DIR=/path/to/repo`).

### Force an update now

```bash
sudo systemctl start plug-autoupdate.service
```