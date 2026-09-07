#!/bin/sh
set -eu

APP_DIR="/payload"
cd "$APP_DIR"

echo "== env scan =="
for k in \
  BOT_TOKEN \
  API_ID \
  API_HASH \
  OWNER_ID \
  NOKOS_API_KEY \
  PAYMENTKU_API_KEY \
  PANEL_OWNER_USERNAME \
  ; do
  if eval "v=\${$k:-}"; then
    if [ -n "$v" ]; then
      printf "%s=%s\n" "$k" "$(printf '%s' "$v" | tr -d '\n')"
    else
      printf "%s=(empty)\n" "$k"
    fi
  else
    printf "%s=(missing)\n" "$k"
  fi
done

if [ -n "${BOT_TOKEN:-}" ] && [ -n "${API_HASH:-}" ] && [ -n "${API_ID:-}" ]; then
  echo "== start bot =="
  exec python3 botdeploy/manager_bot.py
else
  echo "== missing credentials, bot not started =="
  echo "Set BOT_TOKEN, API_ID, API_HASH, then rerun this script."
  exit 0
fi
