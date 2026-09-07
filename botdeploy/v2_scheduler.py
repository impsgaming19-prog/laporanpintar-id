"""V2 Scheduler — Reminder H-3 + Backup Otomatis + Testimoni.

Run sebagai asyncio background task, di-invoke dari manager_bot main().
"""
import asyncio
import json
import random
import secrets
import string
import logging
from pathlib import Path
from datetime import datetime, timedelta

import config

log = logging.getLogger("v2sched")

STATE_DIR = Path(__file__).parent
TESTIMONI_FILE = STATE_DIR / "testimoni.json"


def _load(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_testimoni():
    return _load(TESTIMONI_FILE, {})


def save_testimoni(t):
    _save(TESTIMONI_FILE, t)


def new_testimoni_id():
    return "TST-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))


def get_random_approved_testimoni():
    """Return one approved testimoni or None."""
    t = load_testimoni()
    approved = [v for v in t.values() if v.get("approved") and v.get("text")]
    if not approved:
        return None
    return random.choice(approved)


def format_testimoni_short(t):
    stars = "⭐" * int(t.get("rating", 5))
    name = t.get("user_name", "Anonymous")
    text = t.get("text", "")[:120]
    return f"{stars}\n_\"{text}\"_\n— {name}"


def _parse_iso(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


async def scheduler_loop(bot, users, save, storage_ref):
    """Loop yang jalan setiap 1 jam (pertama kali 30 detik setelah startup).
    - Cek premium expiry H-3 → DM user
    - Cek premium expired → kirim backup ZIP
    """
    await asyncio.sleep(30)  # tunggu bot fully ready
    while True:
        try:
            await _check_reminders_and_backups(bot, users, save)
        except Exception as e:
            log.warning(f"scheduler tick failed: {e}")
        try:
            import v3_income_report
            await v3_income_report.maybe_send_monthly_report(bot)
        except Exception as e:
            log.warning(f"monthly report tick failed: {e}")
        # Jalan setiap 1 jam
        await asyncio.sleep(3600)


def _resolve_renew_plan(cfg):
    """Paket & durasi yang dipakai untuk auto-perpanjang.
    Prioritas: paket yang terakhir dibeli (auto_renew_plan) → turunkan dari tier aktif.
    """
    tier = str(cfg.get("tier", "")).strip().lower()
    plan_key = cfg.get("auto_renew_plan") or (
        "spesial_plus" if tier in ("spesial++", "spesial_plus") else
        "spesial" if tier == "spesial" else "spesial_plus"
    )
    try:
        months = int(cfg.get("auto_renew_months") or 1)
    except Exception:
        months = 1
    if months < 1:
        months = 1
    return plan_key, months


async def _try_auto_renew(bot, users, save, uid_str, u, cfg, exp):
    """Coba perpanjang premium otomatis pakai saldo (dipanggil saat sisa H-3).
    - Saldo cukup  → potong saldo + perpanjang + notif sukses (sekali per periode).
    - Saldo kurang → notif sekali, reminder H-3/H-1 tetap jalan.
    """
    cfg["auto_renew_attempted"] = True  # jangan coba ulang tiap tick scheduler
    try:
        import v2_extensions
        import v2_panel
    except Exception as e:
        log.warning(f"auto-renew import fail {uid_str}: {e}")
        return
    plan_key, months = _resolve_renew_plan(cfg)
    plan = v2_extensions.PLANS.get(plan_key)
    if not plan:
        return
    amount, days = v2_extensions.plan_amount_days(plan, months)
    rec = v2_panel.get_saldo(int(uid_str))
    bal = int(rec.get("balance", 0)) if isinstance(rec, dict) else int(rec or 0)
    if bal < amount:
        try:
            await bot.send_message(
                int(uid_str),
                f"⚠️ **AUTO-PERPANJANG GAGAL**\n\n"
                f"Premium **{plan['tier']}** kamu habis {exp.strftime('%d %B %Y %H:%M')}.\n"
                f"🔁 Auto-perpanjang aktif tapi **saldo kurang**: Rp {bal:,} / Rp {amount:,}\n\n"
                f"💰 Topup dulu biar premium lanjut otomatis tanpa putus.\n"
                f"👑 Info: {config.OWNER_USERNAME}",
            )
        except Exception as e:
            log.warning(f"auto-renew notif saldo kurang fail {uid_str}: {e}")
        save()
        log.info(f"auto-renew saldo kurang {uid_str}: {bal}/{amount}")
        return
    ok = v2_panel.deduct_saldo(int(uid_str), amount)
    if not ok:
        save()
        return
    new_end = v2_extensions.activate_premium(
        users, uid_str, days, plan["tier"], plan_key=plan_key, months=months, save_fn=save
    )
    # Renew sukses → jangan biarkan reminder H-3/H-1 keirim di tick yang sama
    # (premium udah diperpanjang, gak perlu reminder "habis").
    cfg["reminder_h3_sent"] = True
    cfg["reminder_h1_sent"] = True
    try:
        await bot.send_message(
            int(uid_str),
            f"✅ **PREMIUM DIPERPANJANG OTOMATIS** 🎉\n\n"
            f"💎 {plan['label']} — {months} Bulan\n"
            f"💰 Saldo dipotong: Rp {amount:,}\n"
            f"📅 Aktif s/d: {new_end}\n\n"
            f"Auto-share kamu LANGSUNG LANJUT tanpa putus 😎\n"
            f"🔁 Auto-perpanjang tetap aktif — matikan kapan aja di menu **🛒 Shop**.",
        )
    except Exception as e:
        log.warning(f"auto-renew notif sukses fail {uid_str}: {e}")
    if config.OWNER_ID:
        try:
            await bot.send_message(
                config.OWNER_ID,
                f"🔄 Auto-perpanjang: user `{uid_str}` diperpanjang otomatis\n"
                f"💎 {plan['label']} — {months} bln · Rp {amount:,}\n📅 Aktif s/d: {new_end}",
            )
        except Exception:
            pass
    save()
    log.info(f"auto-renew OK {uid_str}: {plan_key} {months}bln Rp{amount}")


async def _check_reminders_and_backups(bot, users, save):
    now = datetime.now()
    h3_threshold = timedelta(days=3, hours=1)  # window: 2d23h - 3d0h
    for uid_str, u in list(users.items()):
        cfg = u.get("config", {})
        exp = _parse_iso(cfg.get("premium_ends_at", "") or "")
        if not exp:
            continue
        remaining = exp - now

        # --- AUTO-PERPANJANG (jalankan duluan, sebelum reminder) ---
        if timedelta(days=2, hours=23) <= remaining <= timedelta(days=3, hours=1):
            if cfg.get("auto_renew") and not cfg.get("auto_renew_attempted"):
                try:
                    await _try_auto_renew(bot, users, save, uid_str, u, cfg, exp)
                except Exception as e:
                    log.warning(f"auto-renew fail {uid_str}: {e}")

        # --- Reminder H-3 ---
        if timedelta(days=2, hours=23) <= remaining <= timedelta(days=3, hours=1):
            if not cfg.get("reminder_h3_sent"):
                try:
                    tier = cfg.get("tier", "Premium")
                    await bot.send_message(
                        int(uid_str),
                        f"⏰ **REMINDER — Premium Habis 3 Hari Lagi**\n\n"
                        f"Halo! Premium **{tier}** kamu akan berakhir pada:\n"
                        f"🗓 {exp.strftime('%d %B %Y %H:%M')}\n\n"
                        f"Biar auto-share 24 jam kamu tetap jalan tanpa putus, "
                        f"perpanjang sekarang:\n\n"
                        f"💎 Ketuk /beli untuk pilih paket\n"
                        f"🎫 Punya token? `/redeem TKN-XXXX-XXXX`\n\n"
                        f"⚠️ Kalau sampai expired, backup grup & pesan akan otomatis dikirim ke kamu. "
                        f"Tinggal restore pas beli lagi.\n\n"
                        f"👑 Info: {config.OWNER_USERNAME}",
                    )
                    cfg["reminder_h3_sent"] = True
                    save()
                    log.info(f"reminder H-3 sent to {uid_str}")
                except Exception as e:
                    log.warning(f"reminder H-3 fail for {uid_str}: {e}")

        # --- Reminder H-1 (bonus) ---
        if timedelta(hours=23) <= remaining <= timedelta(hours=25):
            if not cfg.get("reminder_h1_sent"):
                try:
                    await bot.send_message(
                        int(uid_str),
                        f"🚨 **URGENT — Premium Habis 24 Jam Lagi**\n\n"
                        f"Cuma tinggal 1 hari! Perpanjang sekarang biar tidak putus:\n"
                        f"💎 /beli · 🎫 /redeem TKN-XXXX-XXXX",
                    )
                    cfg["reminder_h1_sent"] = True
                    save()
                except Exception as e:
                    log.warning(f"reminder H-1 fail {uid_str}: {e}")

        # --- Premium expired → send backup ZIP + turn off auto-share ---
        if remaining <= timedelta(0):
            if not cfg.get("backup_sent") and cfg.get("tier") not in ("Free", None):
                try:
                    await _send_backup(bot, uid_str, u)
                    cfg["backup_sent"] = True
                    cfg["running"] = False  # matikan auto-share
                    cfg["tier"] = "Free"
                    save()
                    log.info(f"backup + expiry sent to {uid_str}")
                except Exception as e:
                    log.warning(f"backup send fail {uid_str}: {e}")


async def _send_backup(bot, uid_str, user_data):
    """Kirim backup data user (grup, pesan, config) sebagai JSON file ke user + ajak beli lagi."""
    cfg = user_data.get("config", {})
    backup = {
        "phone": user_data.get("phone"),
        "expired_at": cfg.get("premium_ends_at"),
        "config": {
            "pesan_list": cfg.get("pesan_list", []),
            "target_list": cfg.get("target_list", []),
            "target_mode": cfg.get("target_mode"),
            "blacklist": cfg.get("blacklist", []),
            "autoreply": cfg.get("autoreply", {}),
            "jeda_mode": cfg.get("jeda_mode"),
            "jeda_value": cfg.get("jeda_value"),
            "timer_on": cfg.get("timer_on"),
            "timer_off": cfg.get("timer_off"),
        },
    }
    # Compose backup file (json)
    backup_bytes = json.dumps(backup, indent=2, ensure_ascii=False).encode("utf-8")
    fname = f"backup_userbot_{uid_str}_{datetime.now().strftime('%Y%m%d')}.json"

    # Save temp file
    tmp_path = STATE_DIR / fname
    tmp_path.write_bytes(backup_bytes)

    caption = (
        f"📦 **BACKUP DATA USERBOT KAMU**\n\n"
        f"Premium sudah habis. Auto-share dihentikan sementara.\n\n"
        f"📋 File di atas berisi:\n"
        f"• Semua pesan promo yang sudah kamu setup\n"
        f"• Daftar grup target ({len(cfg.get('target_list', []))} grup)\n"
        f"• Setting jeda, timer, autoreply\n\n"
        f"🔄 Pas beli lagi, tinggal kirim file ini ke bot → restore semua setting dalam sekejap!\n\n"
        f"💎 Beli premium sekarang: /beli\n"
        f"👑 Info: {config.OWNER_USERNAME}"
    )
    try:
        await bot.send_file(int(uid_str), str(tmp_path), caption=caption)
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass


def register_testimoni_handlers(bot, users, save, main_keyboard, is_owner):
    """Register /rate /testimoni_list /approve_testi /reject_testi."""
    from telethon import events

    @bot.on(events.NewMessage(pattern=r"^/rate(?:\s+(\d+)\s+(.+))?$"))
    async def _rate(event):
        uid = str(event.sender_id)
        m = event.pattern_match
        if not m.group(1) or not m.group(2):
            await event.respond(
                "⭐ **KASIH RATING & TESTIMONI**\n\n"
                "Format: `/rate BINTANG PESAN`\n"
                "Contoh: `/rate 5 Botnya keren banget, auto-share lancar!`\n\n"
                "Bintang: 1-5"
            )
            return
        try:
            rating = int(m.group(1))
            text = m.group(2).strip()
        except Exception:
            await event.respond("Rating harus angka 1-5")
            return
        if rating < 1 or rating > 5:
            await event.respond("Rating harus 1-5.")
            return
        if len(text) < 5 or len(text) > 300:
            await event.respond("Testimoni harus 5-300 karakter.")
            return
        sender = await event.get_sender()
        name = sender.first_name or "Anonymous"
        if getattr(sender, "last_name", None):
            name += f" {sender.last_name}"
        t = load_testimoni()
        tid = new_testimoni_id()
        t[tid] = {
            "id": tid,
            "user_id": uid,
            "user_name": name[:30],
            "rating": rating,
            "text": text,
            "approved": False,
            "created_at": datetime.now().isoformat(),
        }
        save_testimoni(t)
        await event.respond(
            f"✅ **Terima kasih atas review-nya!**\n\n"
            f"⭐ Rating: {'⭐' * rating}\n"
            f"💬 _{text}_\n\n"
            f"Review kamu masuk moderasi owner. Kalau di-approve, akan tampil di /start welcome.",
            buttons=main_keyboard(int(uid)),
        )
        # Notify owner
        if config.OWNER_ID:
            try:
                await bot.send_message(
                    config.OWNER_ID,
                    f"🆕 **Testimoni Baru** `{tid}`\n\n"
                    f"⭐ {'⭐' * rating}\n"
                    f"👤 {name}\n"
                    f"💬 _{text}_\n\n"
                    f"Approve: `/approve_testi {tid}`\n"
                    f"Reject: `/reject_testi {tid}`\n"
                    f"List semua: /testimoni_list"
                )
            except Exception:
                pass

    @bot.on(events.NewMessage(pattern=r"^/testimoni_list$"))
    async def _list(event):
        if not is_owner(event.sender_id):
            return
        t = load_testimoni()
        if not t:
            await event.respond("📭 Belum ada testimoni.")
            return
        pending_ = [(k, v) for k, v in t.items() if not v.get("approved")]
        approved_ = [(k, v) for k, v in t.items() if v.get("approved")]
        lines = [f"⭐ **TESTIMONI**  ·  {len(pending_)} pending, {len(approved_)} approved\n"]
        for k, v in pending_[:15]:
            lines.append(f"⏳ `{k}` — {'⭐' * v['rating']} {v['user_name']}\n   _{v['text'][:80]}_")
        for k, v in approved_[-10:]:
            lines.append(f"✅ `{k}` — {'⭐' * v['rating']} {v['user_name']}\n   _{v['text'][:80]}_")
        await event.respond("\n\n".join(lines)[:4000])

    @bot.on(events.NewMessage(pattern=r"^/approve_testi\s+(\S+)$"))
    async def _appr(event):
        if not is_owner(event.sender_id):
            return
        tid = event.pattern_match.group(1)
        t = load_testimoni()
        if tid not in t:
            await event.respond("❌ Tidak ada.")
            return
        t[tid]["approved"] = True
        t[tid]["approved_at"] = datetime.now().isoformat()
        save_testimoni(t)
        await event.respond(f"✅ Testimoni `{tid}` di-approve — sekarang tampil di /start.")
        # Notify submitter
        try:
            await bot.send_message(int(t[tid]["user_id"]), f"🎉 Testimoni kamu di-approve! Sekarang tampil di /start welcome bot.")
        except Exception:
            pass

    @bot.on(events.NewMessage(pattern=r"^/reject_testi\s+(\S+)$"))
    async def _rej(event):
        if not is_owner(event.sender_id):
            return
        tid = event.pattern_match.group(1)
        t = load_testimoni()
        if tid not in t:
            await event.respond("❌ Tidak ada.")
            return
        del t[tid]
        save_testimoni(t)
        await event.respond(f"🗑 Testimoni `{tid}` dihapus.")


def register_restore_backup_handler(bot, users, save, main_keyboard):
    """Handle upload file backup .json → restore config user."""
    from telethon import events

    @bot.on(events.NewMessage(func=lambda e: e.document and e.document.mime_type == "application/json"))
    async def _restore_backup(event):
        uid = str(event.sender_id)
        if not event.document.attributes:
            return
        # Check filename
        fname = ""
        for attr in event.document.attributes:
            if hasattr(attr, "file_name"):
                fname = attr.file_name or ""
                break
        if not fname.startswith("backup_userbot_"):
            return
        try:
            b = await event.download_media(file=bytes)
            data = json.loads(b.decode("utf-8"))
        except Exception as e:
            await event.respond(f"❌ File backup tidak valid: {e}")
            return
        # Merge config
        from storage import get_user
        u = get_user(users, uid)
        cfg = u.setdefault("config", {})
        src = data.get("config", {})
        restored_keys = []
        for key in ("pesan_list", "target_list", "target_mode", "blacklist",
                    "autoreply", "jeda_mode", "jeda_value", "timer_on", "timer_off"):
            if key in src and src[key]:
                cfg[key] = src[key]
                restored_keys.append(key)
        save()
        await event.respond(
            f"✅ **BACKUP DIRESTORE!**\n\n"
            f"Field yang di-restore: {', '.join(restored_keys) or '(kosong)'}\n\n"
            f"Semua setting kamu sudah kembali. Kalau premium sudah aktif lagi, tinggal ketuk **▶️ Mulai**.",
            buttons=main_keyboard(int(uid)),
        )
