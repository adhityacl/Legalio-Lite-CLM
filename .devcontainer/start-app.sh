#!/usr/bin/env bash
# Dijalankan otomatis setiap Codespace dimulai (postStartCommand).
# Tujuan: aplikasi langsung menyala tanpa Anda mengetik apa pun di terminal.
#
# Log ada di: /tmp/legalio-dev.log

set -u

cd /workspaces/NEW-CLM 2>/dev/null || cd "$(pwd)"

wait_for_http() {
  local retries=${1:-30}
  local i
  for ((i=1; i<=retries; i++)); do
    if curl -fsS http://127.0.0.1:3000 >/tmp/legalio-health.html 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Pastikan port 3000 benar-benar menyediakan app yang sehat sebelum kita
# menganggap app sudah siap di GitHub preview.
if lsof -ti:3000 >/dev/null 2>&1; then
  if wait_for_http 5; then
    echo "Aplikasi sudah berjalan dan merespons di port 3000."
    if [ -n "${CODESPACE_NAME:-}" ]; then
      echo "Preview GitHub: https://${CODESPACE_NAME}-3000.app.github.dev"
    fi
    exit 0
  fi
  echo "Port 3000 sudah terpakai, tapi tidak merespons dengan benar. Menjalankan ulang proses app..."
fi

if [ ! -d node_modules ]; then
  echo "Memasang dependensi (sekali saja)..."
  npm install >/tmp/legalio-install.log 2>&1
fi

nohup env PORT=3000 npm run dev >/tmp/legalio-dev.log 2>&1 &

if wait_for_http 45; then
  echo "Aplikasi berjalan. Log: /tmp/legalio-dev.log"
  if [ -n "${CODESPACE_NAME:-}" ]; then
    echo "Preview GitHub: https://${CODESPACE_NAME}-3000.app.github.dev"
  fi
else
  echo "Aplikasi belum berjalan atau tidak merespons. 20 baris terakhir log:"
  tail -20 /tmp/legalio-dev.log
  exit 1
fi
