"""
runner.py — menjalankan KAKO STORE bot di hosting gratis (HF Spaces / Docker).

Fitur:
- Keep-alive HTTP server (biar Space tidak tidur; ping pakai UptimeRobot)
- Restore data JSON + file .session dari secret DATA_B64 (zip base64)
- Auto-restart: bot crash -> otomatis jalan lagi
- Hanya butuh 2 secret utama:
    CONFIG_JSON = {"BOT_TOKEN": "...", "API_ID": 123, "API_HASH": "...",
                   "MANAGER_SESSION": "...", "OWNER_ID": 123, ...}
    DATA_B64    = base64 dari zip berisi users.json, payments.json, *.session, dll.
                  (dibuat dengan make_secret.py di komputer/Termux)

Data ditulis kembali ke DATA_FILE_AFTER_RUN tidak dilakukan (read-only host),
jadi perubahan data tersimpan di memori selama Space hidup. Untuk backup rutin,
bot owner bisa dipasang nanti (opsional).
"""

import base64
import io
import logging
import os
import subprocess
import sys
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

BOT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BOT_DIR)
sys.path.insert(0, BOT_DIR)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("runner")

# Kurangi noise warning telethon (koneksi mobile/VPS sering reconnect)
for _lg in ("telethon.network.connection", "telethon.network.mtprotosender"):
    logging.getLogger(_lg).setLevel(logging.ERROR)


# ---------------------------------------------------------------- keep-alive
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"kakostore bot is running")

    def log_message(self, *args):
        pass


def start_keepalive():
    port = int(os.environ.get("PORT", "7860"))
    try:
        server = HTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        log.info("Keep-alive HTTP jalan di port %s", port)
    except OSError as e:
        log.warning("Keep-alive tidak bisa bind port %s: %s", port, e)


# ---------------------------------------------------------------- data restore
def restore_data():
    """Unzip DATA_B64 (isi users.json, *.session, dll.) ke folder bot."""
    b64 = os.environ.get("DATA_B64", "").strip()
    if not b64:
        log.warning("DATA_B64 kosong — data lama (users, saldo, session) tidak dipulihkan")
        return
    try:
        zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
        zf.extractall(BOT_DIR)
        names = zf.namelist()
        log.info("Data dipulihkan: %d file (%s...)", len(names), ", ".join(names[:5]))
    except Exception as e:
        log.error("Gagal restore DATA_B64: %s", e)


# ---------------------------------------------------------------- bot process
def run_bot():
    env = os.environ.copy()
    # Pastikan Python tidak buffering output (log tampil di hosting)
    env["PYTHONUNBUFFERED"] = "1"
    cmd = [sys.executable, "-u", "manager_bot.py"]
    log.info("Menjalankan: %s", " ".join(cmd))
    proc = subprocess.Popen(cmd, env=env, cwd=BOT_DIR)
    return proc.wait()


def main():
    start_keepalive()
    restore_data()

    if not os.environ.get("CONFIG_JSON"):
        log.error(
            "CONFIG_JSON belum diset! Isi Secrets di hosting "
            "(lihat DEPLOY.md / make_secret.py)"
        )
        sys.exit(1)

    delay = 0
    while True:
        if delay:
            log.info("Restart dalam %s detik...", delay)
            time.sleep(delay)
        log.info("=== KAKO STORE bot start ===")
        try:
            code = run_bot()
        except KeyboardInterrupt:
            log.info("Dihentikan manual.")
            break
        log.warning("Bot keluar (kode %s) — restart otomatis.", code)
        delay = min(60, 5 + delay)


if __name__ == "__main__":
    main()
