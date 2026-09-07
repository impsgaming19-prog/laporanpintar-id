# -*- coding: utf-8 -*-
"""Monitor RAM VPS -> notif ke owner via Telegram kalau mau OOM.

Cek tiap 5 menit. Warning dikirim SEKALI per level (waspada 85% / bahaya 92%),
terus reset otomatis kalau RAM balik normal. State disimpan di file biar gak
nge-spam ulang tiap restart.
"""
import asyncio
import json
import logging
import tempfile
from datetime import datetime
from pathlib import Path

import config

log = logging.getLogger("v4mon")

STATE_FILE = Path(__file__).parent / "monitor_state.json"


def _load(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def _save(p, d):
    p.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")


def _mem_usage():
    """Baca /proc/meminfo -> (total_mb, available_mb, used_pct, swap_used_mb, swap_total_mb)."""
    vals = {}
    with open("/proc/meminfo", "r") as f:
        for line in f:
            k, _, v = line.partition(":")
            vals[k.strip()] = int(v.strip().split()[0])  # KB
    total = vals.get("MemTotal", 0)
    avail = vals.get("MemAvailable", vals.get("MemFree", 0))
    used_pct = 100.0 * (total - avail) / total if total else 0.0
    swap_total = vals.get("SwapTotal", 0)
    swap_free = vals.get("SwapFree", 0)
    return (
        total // 1024,
        avail // 1024,
        used_pct,
        max(0, swap_total - swap_free) // 1024,
        swap_total // 1024,
    )


async def monitor_loop(bot):
    """Jalan terus: cek RAM tiap 5 menit, notif owner kalau tinggi."""
    await asyncio.sleep(60)  # tunggu bot fully ready dulu
    while True:
        try:
            total_mb, avail_mb, used_pct, swap_used_mb, swap_total_mb = _mem_usage()
            now = datetime.now().strftime("%d/%m %H:%M")
            st = _load(STATE_FILE, {})
            last_level = int(st.get("level", 0))

            level = 0
            if used_pct >= 92:
                level = 2
            elif used_pct >= 85:
                level = 1

            if level and level != last_level:
                st["level"] = level
                _save(STATE_FILE, st)
                if level == 2:
                    msg = (
                        "🚨 **🆘 RAM VPS KRITIS!**\n\n"
                        f"🧠 Terpakai: **{used_pct:.0f}%** ({total_mb} MB)\n"
                        f"🆓 Available: {avail_mb} MB\n"
                        f"💾 Swap: {swap_used_mb}/{swap_total_mb} MB\n"
                        f"⏰ {now}\n\n"
                        "⚠️ Bot bisa kena OOM (mati tiba-tiba). "
                        "Segera upgrade RAM atau matikan proses berat!"
                    )
                else:
                    msg = (
                        "⚠️ **RAM VPS TINGGI**\n\n"
                        f"🧠 Terpakai: **{used_pct:.0f}%** ({total_mb} MB)\n"
                        f"🆓 Available: {avail_mb} MB\n"
                        f"💾 Swap: {swap_used_mb}/{swap_total_mb} MB\n"
                        f"⏰ {now}\n\n"
                        "🔎 Cek proses yang makan RAM — kalau naik lagi, bot bisa kena OOM."
                    )
                try:
                    await bot.send_message(config.OWNER_ID, msg)
                    log.info("Notif RAM level %d terkirim (%.0f%%)", level, used_pct)
                except Exception as e:
                    log.warning("Gagal kirim notif RAM: %s", e)
            elif level == 0 and last_level:
                st["level"] = 0
                _save(STATE_FILE, st)
                try:
                    await bot.send_message(
                        config.OWNER_ID,
                        f"✅ RAM udah normal lagi: **{used_pct:.0f}%** ({now})",
                    )
                except Exception:
                    pass
        except Exception as e:
            log.warning("monitor tick failed: %s", e)
        await asyncio.sleep(300)  # 5 menit


# ---------------- Backup satu ketukan (/backup) ----------------

def _buat_zip(dest):
    """Buat zip berisi file penting bot ke dest. Raise kalau gagal."""
    import subprocess
    base = Path(__file__).parent          # .../telegram_bot
    root = base.parent                     # .../app-conflict_040826_0349
    cmd = [
        "zip", "-r", "-q", str(dest),
        "telegram_bot", "backend", "run_bot.sh",
        "-x",
        "telegram_bot/venv/*", "backend/venv/*", "*/__pycache__/*",
        "*/patch_*", "*/test_*", "backend/tests/*", "*/pytest.ini",
        "*/*.bak*", "*/*.rusak*", "*/*.sementara*", "*/*.save*",
        "*/*.broken*", "*/*.BROKEN*", "*/*.v2final",
        "telegram_bot/panel_jual*", "telegram_bot/panel_menu.py",
    ]
    subprocess.run(cmd, cwd=str(root), check=True, capture_output=True, timeout=60)
    # tambah panduan migrasi + supervisor config (kalau ada)
    guide = root.parent / "CARA_MIGRASI.md"
    conf = root.parent / "kakostore.conf"
    add = []
    if guide.exists():
        add.append(str(guide))
    if conf.exists():
        add.append(str(conf))
    if add:
        subprocess.run(["zip", "-q", "-j", str(dest)] + add,
                       check=True, capture_output=True, timeout=30)
    return dest


def register_backup_handler(bot, is_owner):
    """Register /backup (owner only): kirim file backup ke Telegram owner."""
    from telethon import events

    @bot.on(events.NewMessage(pattern=r"^/backup$"))
    async def _backup(event):
        if not is_owner(event.sender_id):
            return
        m = await event.respond("⏳ Bikin file backup...")
        tmp = None
        try:
            from datetime import datetime as _dt
            stamp = _dt.now().strftime("%Y%m%d_%H%M")
            tmp = Path(tempfile.gettempdir()) / ("kakostore_backup_%s.zip" % stamp)
            _buat_zip(tmp)
            size = tmp.stat().st_size
            await bot.send_file(
                event.chat_id,
                str(tmp),
                caption=(
                    "📦 **Backup bot Kakostore** (%d KB)\n\n"
                    "Simpan di tempat aman (Google Drive / flashdisk) — "
                    "jangan di-share ke siapa pun ya kak 🙏" % (size // 1024)
                ),
            )
            try:
                await m.delete()
            except Exception:
                pass
        except Exception as e:
            try:
                await m.edit("❌ Gagal bikin backup: " + str(e))
            except Exception:
                pass
        finally:
            if tmp:
                try:
                    tmp.unlink()
                except Exception:
                    pass


if __name__ == "__main__":
    total_mb, avail_mb, used_pct, sw_u, sw_t = _mem_usage()
    print("total_mb=%d avail_mb=%d used_pct=%.1f swap=%d/%d MB" % (total_mb, avail_mb, used_pct, sw_u, sw_t))
