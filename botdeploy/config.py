"""
config.py — Kredensial dibaca dari environment variable (Secrets di hosting).

Nama atribut SAMA PERSIS dengan config lama, jadi semua file bot
(manager_bot.py, userbot.py, dll.) tidak perlu diubah.
"""

import json
import os
from pathlib import Path

from dotenv import load_dotenv

# Kalau ada file .env di folder yang sama (deploy non-Docker), ikutkan juga
load_dotenv(Path(__file__).parent / ".env")

# Boleh set CONFIG_JSON (JSON berisi semua nilai) ATAU variabel satuan.
_raw = os.environ.get("CONFIG_JSON", "").strip()
_VALUES: dict = {}
if _raw:
    try:
        _VALUES = json.loads(_raw)
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"CONFIG_JSON bukan JSON valid: {e}")


def _get(key: str, default=""):
    if key in _VALUES:
        return _VALUES[key]
    return os.environ.get(key, default)


def _get_int(key: str, default=0) -> int:
    try:
        return int(str(_get(key, default)).strip())
    except (TypeError, ValueError):
        return default


BOT_TOKEN = str(_get("BOT_TOKEN", ""))
API_ID = _get_int("API_ID", 0)
API_HASH = str(_get("API_HASH", ""))
OWNER_ID = _get_int("OWNER_ID", 0)

OWNER_IDS_LIST = []
_raw_ids = str(_get("OWNER_IDS", "") or "").strip()
if _raw_ids:
    try:
        OWNER_IDS_LIST = [int(x) for x in json.loads(_raw_ids)]
    except Exception:
        OWNER_IDS_LIST = [int(x) for x in _raw_ids.replace(";", ",").split(",") if x.strip().isdigit()]
elif OWNER_ID:
    OWNER_IDS_LIST = [OWNER_ID]

OWNER_IDS = OWNER_IDS_LIST

BRAND_NAME = str(_get("BRAND_NAME", "KAKO STORE"))
OWNER_USERNAME = str(_get("OWNER_USERNAME", ""))
CHANNEL_USERNAME = str(_get("CHANNEL_USERNAME", ""))
TRIAL_HOURS = _get_int("TRIAL_HOURS", 24)

REPORT_BOT_TOKEN = str(_get("REPORT_BOT_TOKEN", ""))
RESEND_API_KEY = str(_get("RESEND_API_KEY", ""))
OWNER_EMAIL = str(_get("OWNER_EMAIL", ""))

# Session string bot manajer (hasil make_secret.py / session_gen)
MANAGER_SESSION = str(_get("MANAGER_SESSION", ""))

# Penyimpanan JSON lokal (data user/payment/token ikut dibawa via DATA_B64 di runner)
USERS_FILE = str(_get("USERS_FILE", "users.json"))
MONGO_URL = str(_get("MONGO_URL", ""))
DB_NAME = str(_get("DB_NAME", "kakostore"))

# Fitur Nokos — hukum harga +30% dan cancel/refund pakai saldo.
NOKOS_API_KEY = str(_get("NOKOS_API_KEY", ""))
NOKOS_MARKUP_PCT = _get_int("NOKOS_MARKUP_PCT", 30)
NOKOS_CANCEL_WINDOW_SECONDS = _get_int("NOKOS_CANCEL_WINDOW_SECONDS", 180)
NOKOS_OTP_VALID_SECONDS = _get_int("NOKOS_OTP_VALID_SECONDS", 300)
if NOKOS_API_KEY:
    os.environ["NOKOS_API_KEY"] = NOKOS_API_KEY
if NOKOS_MARKUP_PCT:
    os.environ["NOKOS_MARKUP_PCT"] = str(NOKOS_MARKUP_PCT)
if NOKOS_CANCEL_WINDOW_SECONDS:
    os.environ["NOKOS_CANCEL_WINDOW_SECONDS"] = str(NOKOS_CANCEL_WINDOW_SECONDS)
if NOKOS_OTP_VALID_SECONDS:
    os.environ["NOKOS_OTP_VALID_SECONDS"] = str(NOKOS_OTP_VALID_SECONDS)

# Fitur panel Pterodactyl — ptero_service.py membaca langsung dari os.environ,
# jadi nilai dari CONFIG_JSON/secrets dipindahkan ke environment juga.
for _k in ("PTERO_PANEL_URL", "PTERO_APP_API_KEY", "PTERO_LOCATION_ID",
           "PTERO_NEST_ID", "PTERO_EGG_ID"):
    _v = _get(_k)
    if _v:
        os.environ[_k] = str(_v)

# Fitur Paymentku (panel, topup, dan pembayaran produk lainnya)
PAYMENTKU_API_KEY = str(_get("PAYMENTKU_API_KEY", ""))
if PAYMENTKU_API_KEY:
    os.environ["PAYMENTKU_API_KEY"] = PAYMENTKU_API_KEY
