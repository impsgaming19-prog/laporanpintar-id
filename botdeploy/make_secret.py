"""
make_secret.py — bikin nilai CONFIG_JSON + DATA_B64 dari backup bot kamu.

Jalankan DI FOLDER backup (yang ada config.py, .session, users.json, dll.),
misal di Termux:

    cd ~/kakostore/telegram_bot
    python3 make_secret.py

Output: dua blok teks -> tempel ke Secrets di hosting (lihat DEPLOY.md).
Nilai tidak pernah dikirim ke mana pun — hanya dicetak di layar.
"""

import base64
import io
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# Nilai yang diambil dari config.py lama (file asli milikmu)
CONFIG_KEYS = [
    "BOT_TOKEN", "API_ID", "API_HASH", "OWNER_ID", "OWNER_IDS",
    "BRAND_NAME", "OWNER_USERNAME", "CHANNEL_USERNAME", "TRIAL_HOURS",
    "REPORT_BOT_TOKEN", "RESEND_API_KEY", "OWNER_EMAIL",
    "MANAGER_SESSION", "USERS_FILE", "MONGO_URL", "DB_NAME",
]

# File data/session yang dibawa ke hosting
DATA_FILES = [
    "users.json", "payments.json", "saldo.json", "tokens.json",
    "referrals.json", "redeem_codes.json", "testimoni.json",
    "user_panels.json", "panel_orders.json", "monitor_state.json",
    "report_state.json", "whitelist.json",
    "manager_session.session", "report_bot_session.session",
]


def read_old_config() -> dict:
    """Eksekusi config.py lama dan ambil nilainya (tanpa mencetaknya)."""
    path = os.path.join(HERE, "config.py")
    if not os.path.exists(path):
        path = os.path.join(HERE, "..", "telegram_bot", "config.py")
    ns: dict = {}
    with open(path, encoding="utf-8") as f:
        exec(compile(f.read(), path, "exec"), ns)
    return ns


def parse_env_file(path: str) -> dict:
    """Baca file .env sederhana (KEY=VALUE) tanpa dependensi ekstra."""
    out = {}
    try:
        for line in open(path, encoding="utf-8", errors="replace"):
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, _, v = s.partition("=")
            v = v.strip().strip('"').strip("'")
            if v:
                out[k.strip()] = v
    except OSError:
        pass
    return out


def build_config_json(old: dict) -> str:
    """Gabungkan nilai dari config.py + file .env di backup (API_HASH, BOT_TOKEN,
    REPORT_BOT_TOKEN biasanya ada di backend/.env, bukan di config.py)."""
    # Kandidat lokasi .env: folder ini, ../backend, ../telegram_bot
    env_vals: dict = {}
    for cand in (
        os.path.join(HERE, ".env"),
        os.path.join(HERE, "..", "backend", ".env"),
        os.path.join(HERE, "..", "telegram_bot", ".env"),
    ):
        if os.path.exists(cand):
            env_vals.update(parse_env_file(cand))

    out = {}
    for k in CONFIG_KEYS:
        v = old.get(k)
        if v is None or v == "":
            v = env_vals.get(k, "")
        if v is None or v == "":
            continue
        out[k] = v
    return json.dumps(out, ensure_ascii=False)


def build_data_b64() -> str:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in DATA_FILES:
            p = os.path.join(HERE, name)
            if os.path.exists(p):
                zf.write(p, arcname=name)
                print(f"  + {name}")
            else:
                print(f"  - {name} (tidak ada, dilewati)")
    return base64.b64encode(buf.getvalue()).decode()


def main():
    print("Membaca config lama...")
    old = read_old_config()
    cfg = build_config_json(old)
    print("Membungkus data & session...")
    data = build_data_b64()

    print()
    print("=" * 64)
    print("SECRET 1 — CONFIG_JSON (satu baris):")
    print("=" * 64)
    print(cfg)
    print()
    print("=" * 64)
    print("SECRET 2 — DATA_B64 (satu baris, panjang tidak apa-apa):")
    print("=" * 64)
    print(data)
    print()
    print("Salin dua nilai di atas ke Secrets hosting (lihat DEPLOY.md).")
    print("JANGAN pernah membagikan/meng-upload nilai ini ke mana pun!")


if __name__ == "__main__":
    main()
