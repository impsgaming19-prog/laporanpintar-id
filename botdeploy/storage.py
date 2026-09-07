"""Penyimpanan data user & konfigurasi userbot (JSON persisten)."""
import json
import os

import config

# Struktur config default untuk tiap userbot milik user
DEFAULT_CONFIG = {
    "running": False,
    "jeda_tipe": "semua",       # "semua" | "grup" | "aman"
    "jeda_semua_menit": 20,
    "jeda_grup_detik": 30,
    # Jeda Aman (acak seperti manusia) — rentang detik antar grup & pause putaran
    "aman_grup_min": 25,
    "aman_grup_max": 75,
    "aman_pause_min": 300,      # jeda putaran min (detik) = 5 menit
    "aman_pause_max": 900,      # jeda putaran max (detik) = 15 menit
    "slowly": True,
    "mode": "Forward",
    "pesan_list": [],           # [{"type":"text","text":..} | {"type":"forward","chat_id":..,"msg_id":..}]
    "pesan_index": 0,
    "blacklist": [],            # id grup di-skip
    "blacklist_info": [],       # [{"id":..,"name":..}]
    # Target grup share
    "target_mode": "semua",     # "semua" (auto semua grup) | "pilih" (hanya target_list)
    "target_list": [],          # [{"id":..,"name":..}] grup terpilih
    "limit": 0,                 # 0 = semua, >0 = maksimal N grup per putaran
    "timer": None,              # {"on":"08:00","off":"23:00"}
    "replies": [],              # [{"trigger":..,"response":..}]
    "total_terkirim": 0,
    "tier": "Spesial++",
    "expired": "Null",
    "channel": 0,               # jumlah channel dipantau (autoreply)
    "extra": 0,                 # set siaran tambahan
    "notification": "Kirim ke Saya",
    "email": None,
    "admin": 0,
    "ads": "Join channel resmi @Kakostore_Bot",
}


def _path():
    return os.path.join(os.path.dirname(__file__), config.USERS_FILE)


def load_users():
    p = _path()
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_users(users):
    with open(_path(), "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2, ensure_ascii=False)


def get_user(users, uid):
    """Ambil / buat entri user."""
    uid = str(uid)
    if uid not in users:
        users[uid] = {"session": None, "phone": None, "config": dict(DEFAULT_CONFIG)}
    # pastikan semua key config ada (migrasi)
    cfg = users[uid].setdefault("config", dict(DEFAULT_CONFIG))
    for k, v in DEFAULT_CONFIG.items():
        cfg.setdefault(k, v if not isinstance(v, (list, dict)) else type(v)())
    return users[uid]
