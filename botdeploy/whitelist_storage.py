"""Manajemen whitelist akses bot — siapa yang boleh pakai & kapan expired."""
import json
import os
from datetime import datetime, timedelta

import config

WHITELIST_FILE = os.path.join(os.path.dirname(__file__), "whitelist.json")


def load() -> dict:
    if os.path.exists(WHITELIST_FILE):
        try:
            with open(WHITELIST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save(wl: dict):
    with open(WHITELIST_FILE, "w", encoding="utf-8") as f:
        json.dump(wl, f, indent=2, ensure_ascii=False)


def parse_durasi(durasi_str: str) -> datetime | None:
    """Ubah string durasi ke datetime expired.
    Format: '1d', '7d', '30d', '365d', '1h', '24h', 'selamanya'
    """
    s = durasi_str.strip().lower()
    if s in ("selamanya", "forever", "unlimited"):
        return None   # None = tidak pernah expired
    now = datetime.now()
    if s.endswith("d"):
        try:
            return now + timedelta(days=int(s[:-1]))
        except ValueError:
            return None
    if s.endswith("h"):
        try:
            return now + timedelta(hours=int(s[:-1]))
        except ValueError:
            return None
    # Coba parse langsung sebagai tanggal "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM"
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def fmt_expired(dt: datetime | None) -> str:
    if dt is None:
        return "Selamanya ♾️"
    return dt.strftime("%d %b %Y %H:%M")


def is_allowed(uid: int, wl: dict) -> tuple[bool, str]:
    """Cek apakah uid boleh akses bot.
    Return: (boleh: bool, alasan: str)
    """
    # Owner selalu boleh
    if config.OWNER_ID and uid == config.OWNER_ID:
        return True, "owner"

    key = str(uid)
    if key not in wl:
        return False, "not_in_whitelist"

    entry = wl[key]
    exp_str = entry.get("expired")
    if exp_str is None:
        return True, "selamanya"

    try:
        exp_dt = datetime.fromisoformat(exp_str)
        if datetime.now() > exp_dt:
            return False, "expired"
        return True, "ok"
    except Exception:
        return True, "ok"   # format tidak dikenal, izinkan


def add_user(uid: int | str, nama: str, durasi_str: str, wl: dict) -> str:
    """Tambah user ke whitelist. Return string expired untuk ditampilkan."""
    exp_dt = parse_durasi(durasi_str)
    wl[str(uid)] = {
        "nama": nama,
        "expired": exp_dt.isoformat() if exp_dt else None,
        "added_at": datetime.now().isoformat(timespec="minutes"),
    }
    save(wl)
    return fmt_expired(exp_dt)


def remove_user(uid: int | str, wl: dict) -> bool:
    key = str(uid)
    if key in wl:
        del wl[key]
        save(wl)
        return True
    return False


def list_users(wl: dict) -> list[dict]:
    """Return list entry lengkap dengan status expired."""
    now = datetime.now()
    result = []
    for uid_str, entry in wl.items():
        exp_str = entry.get("expired")
        if exp_str is None:
            status = "aktif ♾️"
            expired_label = "Selamanya"
        else:
            try:
                exp_dt = datetime.fromisoformat(exp_str)
                if now > exp_dt:
                    status = "❌ expired"
                else:
                    sisa = exp_dt - now
                    hari = sisa.days
                    jam = sisa.seconds // 3600
                    status = f"✅ sisa {hari}h {jam}j" if hari > 0 else f"✅ sisa {jam} jam"
                expired_label = exp_dt.strftime("%d %b %Y %H:%M")
            except Exception:
                status = "✅ aktif"
                expired_label = exp_str or "?"
        result.append({
            "uid": uid_str,
            "nama": entry.get("nama", "?"),
            "expired_label": expired_label,
            "status": status,
        })
    return result
