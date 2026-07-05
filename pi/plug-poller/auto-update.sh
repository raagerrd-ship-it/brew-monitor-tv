#!/usr/bin/env bash
# Poll the git remote for new commits under pi/plug-poller/ and restart
# the affected services when something changed. Runs from the systemd
# timer `plug-autoupdate.timer` — no inbound ports, no manual git pull.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/home/pi/brew}"
SUBDIR="pi/plug-poller"
BRANCH="${BRANCH:-main}"

cd "$REPO_DIR"

# Fetch quietly; bail early if nothing changed on the remote.
git fetch --quiet origin "$BRANCH"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

# Figure out which files changed before we move HEAD forward.
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" -- "$SUBDIR")

echo "auto-update: $LOCAL -> $REMOTE"
git reset --hard "origin/$BRANCH"

if [ -z "$CHANGED" ]; then
  echo "auto-update: no changes under $SUBDIR — skipping restart"
  exit 0
fi

# If requirements.txt moved, refresh the venv before restarting.
if echo "$CHANGED" | grep -q "^$SUBDIR/requirements.txt$"; then
  echo "auto-update: requirements.txt changed — pip install"
  "$REPO_DIR/$SUBDIR/.venv/bin/pip" install -q -r "$REPO_DIR/$SUBDIR/requirements.txt"
fi

RESTART=()
if echo "$CHANGED" | grep -qE "^$SUBDIR/(poller\.py|requirements\.txt|\.env)$"; then
  RESTART+=("plug-poller")
fi
if echo "$CHANGED" | grep -qE "^$SUBDIR/(watchdog\.py|requirements\.txt|\.env)$"; then
  RESTART+=("plug-watchdog")
fi

for svc in "${RESTART[@]}"; do
  echo "auto-update: restarting $svc"
  sudo systemctl restart "$svc"
done

echo "auto-update: done"