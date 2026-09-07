"""V2 Extensions — Trial / Premium / Redeem Token / Payment / Bug #001 sync.

Dipanggil dari manager_bot.py setelah `bot` object dibuat. Register handler
tambahan tanpa menyentuh flow existing (auto-share, autoreply, dll).
"""
import asyncio
import json
import secrets
import string
import hmac
import hashlib
import os
import logging
import requests
from datetime import datetime, timedelta
from pathlib import Path

from telethon import events, Button

import config

PAYMENTKU_API_KEY = os.environ.get("PAYMENTKU_API_KEY", "").strip()
PAYMENTKU_BASE = "https://paymenku.com/api/v1"
WEBHOOK_URL = os.environ.get("PAYMENTKU_WEBHOOK_URL", "").strip()
# Bila WEBHOOK_URL kosong, backend FastAPI kita di preview akan handle:
# https://<host>/api/webhooks/paymentku (set via env di production).

log = logging.getLogger("v2ext")

STATE_DIR = Path(__file__).parent
TOKENS_FILE = STATE_DIR / "tokens.json"
PAYMENTS_FILE = STATE_DIR / "payments.json"
REDEEM_CODES_FILE = STATE_DIR / "redeem_codes.json"  # backup access codes per user


def _load(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_tokens():
    return _load(TOKENS_FILE, {})


def save_tokens(t):
    _save(TOKENS_FILE, t)


def load_payments():
    return _load(PAYMENTS_FILE, {})


def save_payments(p):
    _save(PAYMENTS_FILE, p)


def load_redeem_codes():
    return _load(REDEEM_CODES_FILE, {})


def save_redeem_codes(r):
    _save(REDEEM_CODES_FILE, r)


# ---------- helpers ----------
def gen_token():
    chars = string.ascii_uppercase + string.digits
    return "TKN-" + "".join(secrets.choice(chars) for _ in range(4)) + "-" + "".join(secrets.choice(chars) for _ in range(4))


def gen_redeem_backup():
    chars = string.ascii_uppercase + string.digits
    return "UBM-" + "-".join("".join(secrets.choice(chars) for _ in range(4)) for _ in range(3))


def now_ts():
    return datetime.now()


def add_days(days):
    return datetime.now() + timedelta(days=days)


def parse_iso(s):
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def fmt_time(dt):
    if not dt:
        return "—"
    return dt.strftime("%d %b %Y %H:%M")


def fmt_remaining(dt):
    if not dt:
        return "—"
    delta = dt - datetime.now()
    if delta.total_seconds() <= 0:
        return "kedaluwarsa"
    d = delta.days
    h = delta.seconds // 3600
    m = (delta.seconds % 3600) // 60
    if d > 0:
        return f"{d}h {h}j"
    if h > 0:
        return f"{h}j {m}m"
    return f"{m} menit"


# ---------- Pricing (Rp per BULAN) ----------
# Durasi 1–12 bulan dipilih user → total otomatis (harga × n bulan).
#   Spesial   : Rp 20.000/bulan — ada watermark promo bot + TIDAK bisa pakai
#               Bagikan (share/forward) untuk teks promo (harus ketik/copy-paste).
#   Spesial++ : Rp 35.000/bulan — TANPA watermark, bebas Bagikan, semua fitur.
PLANS = {
    "spesial": {"amount_month": 20000, "tier": "Spesial", "label": "🥈 Spesial"},
    "spesial_plus": {"amount_month": 35000, "tier": "Spesial++", "label": "🥇 Spesial++"},
}
DURATION_MONTHS = list(range(1, 13))  # 1–12 bulan


def plan_amount_days(plan, months):
    """Total harga & durasi (hari) untuk n bulan."""
    months = int(months or 1)
    if months < 1:
        months = 1
    return plan["amount_month"] * months, 30 * months


async def show_beli_menu(event, is_edit=False):
    """Menu pilih paket premium (Spesial / Spesial++)."""
    text = (
        "💎 **PILIH PAKET PREMIUM**\n\n"
        "**🥈 SPESIAL — Rp 20.000/bulan**\n"
        "  ✅ Semua fitur (jeda, timer, autoreply, target, dll)\n"
        "  🏷️ Watermark `• Promote By @Kakostore_Bot` nempel di pesan promo\n"
        "  ⛔ Tidak bisa pakai **Bagikan** (share/forward) untuk teks — harus ketik/copy-paste\n\n"
        "**🥇 SPESIAL++ — Rp 35.000/bulan** 🔥 Recommended\n"
        "  ✅ Semua fitur Spesial\n"
        "  🚫 **Tanpa watermark** — teks bebas\n"
        "  ✅ Bebas pakai **Bagikan** (share dari channel / grup / chat)\n\n"
        "📚 Setelah pilih paket, pilih **durasi 1–12 bulan** — total otomatis.\n"
        "Ketuk paket di bawah:"
    )
    kb = [[Button.inline(f"💎 {p['label']} — Rp {p['amount_month']:,}/bln", f"beli:{k}".encode())]
          for k, p in PLANS.items()]
    kb.append([Button.inline("⬅️ Kembali", b"menu")])
    if is_edit:
        await event.edit(text, buttons=kb)
    else:
        await event.respond(text, buttons=kb)


# ---------- Access lifecycle ----------
def compute_access(users, uid_str, whitelist):
    """Return (has_access, source, expiry_dt).
    source: 'owner' | 'lifetime' | 'premium' | 'trial' | 'whitelist' | None
    ROBUST: exception-safe, case-insensitive tier check, defensive parsing.
    """
    try:
        if config.OWNER_ID and int(uid_str) == config.OWNER_ID:
            return True, "owner", None
    except Exception:
        pass
    try:
        u = users.get(uid_str) or users.get(str(uid_str))
        if not u:
            return False, None, None
        cfg = u.get("config", {}) or {}
        # lifetime — case-insensitive + string variants
        tier_val = str(cfg.get("tier", "")).strip().lower()
        if tier_val in ("lifetime", "life", "seumur", "ltd", "permanen"):
            return True, "lifetime", None
        # premium (regular)
        exp_p = parse_iso(cfg.get("premium_ends_at", "") or "")
        if exp_p and exp_p > now_ts():
            return True, "premium", exp_p
        # trial
        exp_t = parse_iso(cfg.get("trial_ends_at", "") or "")
        if exp_t and exp_t > now_ts():
            return True, "trial", exp_t
        # whitelist entry (from owner adduser flow)
        entry = (whitelist or {}).get(uid_str) or (whitelist or {}).get(str(uid_str))
        if entry:
            exp = entry.get("expired")
            if exp is None:
                return True, "whitelist", None
            exp_dt = parse_iso(exp)
            if exp_dt and exp_dt > now_ts():
                return True, "whitelist", exp_dt
    except Exception as e:
        log.exception(f"compute_access err uid={uid_str}: {e}")
    return False, None, None


def activate_premium(users, uid_str, days, tier="Spesial++", plan_key=None, save_fn=None, months=None):
    """Aktifkan premium untuk user. Kalau plan_key & save_fn diberikan,
    juga trigger referral reward untuk referrer (kalau ada pending).

    Auto-perpanjang: kalau plan_key diketahui, simpan paket & durasi yang dipakai
    (auto_renew_plan / auto_renew_months) — dipakai scheduler buat perpanjang
    otomatis pakai saldo sebelum expired.
    """
    from storage import get_user
    u = get_user(users, uid_str)
    cfg = u.setdefault("config", {})
    base = now_ts()
    cur = parse_iso(cfg.get("premium_ends_at", "") or "")
    if cur and cur > base:
        base = cur
    new_end = base + timedelta(days=days)
    cfg["premium_ends_at"] = new_end.isoformat()
    cfg["tier"] = tier
    cfg["expired"] = new_end.strftime("%H:%M, %d %B %Y")
    # Reset reminder flags biar bisa fire lagi di periode berikut
    cfg.pop("reminder_h3_sent", None)
    cfg.pop("reminder_h1_sent", None)
    cfg.pop("backup_sent", None)
    # Simpan paket & durasi untuk auto-perpanjang + reset flag percobaan
    if plan_key:
        try:
            cfg["auto_renew_plan"] = plan_key
            cfg["auto_renew_months"] = months or max(1, int(round(days / 30)))
        except Exception:
            pass
    cfg.pop("auto_renew_attempted", None)
    # Trigger referral reward
    if plan_key and save_fn:
        try:
            import v2_referral
            import asyncio as _a
            referrer, reward = v2_referral.award_referral_on_purchase(
                users, save_fn, uid_str, plan_key, notify_fn=None
            )
            if referrer and reward > 0:
                # Schedule async notification
                loop = _a.get_event_loop()
                if loop.is_running():
                    _a.create_task(v2_referral.notify_referrer_via_bot(
                        referrer, reward, plan_key,
                        v2_referral.get_balance(users, referrer)
                    ))
        except Exception as e:
            import logging
            logging.getLogger("v2ext").warning(f"referral hook fail: {e}")
    return new_end


def activate_trial(users, uid_str):
    """Trial 24 jam — HANYA 1x SEUMUR HIDUP per Telegram ID.
    Return (end_dt, backup_code) — backup_code hanya di-generate SEKALI per akun.
    Return (None, None) kalau sudah pernah claim.
    """
    from storage import get_user
    u = get_user(users, uid_str)
    cfg = u.setdefault("config", {})
    if cfg.get("trial_used"):
        return None, None
    end = add_days(0) + timedelta(hours=config.TRIAL_HOURS)
    cfg["trial_used"] = True
    cfg["trial_ends_at"] = end.isoformat()
    cfg["tier"] = "Trial"
    cfg["expired"] = end.strftime("%H:%M, %d %B %Y")
    # Auto-generate backup code (Token Login)
    codes = load_redeem_codes()
    backup = codes.get(uid_str, {}).get("code")
    if not backup:
        backup = gen_redeem_backup()
        codes[uid_str] = {"code": backup, "created_at": now_ts().isoformat(), "source": "trial"}
        save_redeem_codes(codes)
    return end, backup


def get_or_create_backup_code(uid_str, source="premium"):
    """Ambil / generate backup Token Login untuk user (dipakai pas payment sukses)."""
    codes = load_redeem_codes()
    existing = codes.get(uid_str, {}).get("code")
    if existing:
        return existing, False  # existed, not new
    backup = gen_redeem_backup()
    codes[uid_str] = {"code": backup, "created_at": now_ts().isoformat(), "source": source}
    save_redeem_codes(codes)
    return backup, True  # new


# ---------- Register handlers ----------
def register(bot, ctx):
    """ctx = dict with keys: users, save, whitelist, main_keyboard, is_owner, notify"""
    users = ctx["users"]
    save = ctx["save"]
    whitelist = ctx["whitelist"]
    main_keyboard = ctx["main_keyboard"]
    is_owner = ctx["is_owner"]

    tokens = load_tokens()
    payments = load_payments()
    redeem_codes = load_redeem_codes()

    # ---------- /trial ----------
    @bot.on(events.NewMessage(pattern=r"^/trial$"))
    async def _trial(event):
        uid = event.sender_id
        end, backup = activate_trial(users, str(uid))
        if end is None:
            await event.respond(
                "❌ **Trial sudah pernah dipakai.**\n\n"
                "⚠️ Trial 24 jam **HANYA 1x seumur hidup** untuk 1 akun Telegram.\n"
                "Tidak bisa diklaim ulang.\n\n"
                "💎 Beli premium: `/beli`\n"
                "🎫 Punya token? `/redeem TKN-XXXX-XXXX`",
                buttons=main_keyboard(uid),
            )
            return
        save()
        await event.respond(
            f"🎁 **TRIAL 24 JAM AKTIF!**\n\n"
            f"⏰ Berakhir: {fmt_time(end)}\n"
            f"⏳ Sisa: {fmt_remaining(end)}\n\n"
            "⚠️ Trial ini **HANYA 1x seumur hidup**. Setelah habis harus beli premium.",
            buttons=main_keyboard(uid),
        )
        # KIRIM TOKEN LOGIN (backup code) — auto-generate sekali per akun
        await event.respond(
            f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
            f"`{backup}`\n\n"
            "⚠️ **SIMPAN BAIK-BAIK!** Kode ini dipakai untuk **restore akses** kalau:\n"
            "• Kamu logout dari bot\n"
            "• Ganti akun / device Telegram\n"
            "• Kehilangan akses akun\n\n"
            "Cara pakai: chat bot dari akun baru → `/restore " + backup + "` → akses & premium kamu pindah otomatis.\n\n"
            "🔒 Kode ini rahasia. Jangan share ke siapa pun!"
        )

    # ---------- /kode - lihat kode backup (info aja) ----------
    @bot.on(events.NewMessage(pattern=r"^/kode$"))
    async def _kode(event):
        uid = str(event.sender_id)
        codes = load_redeem_codes()
        existing = codes.get(uid)
        if existing:
            await event.respond(
                f"🔑 **TOKEN LOGIN KAMU**\n\n"
                f"`{existing['code']}`\n\n"
                f"Dibuat: {existing['created_at'][:10]} (dari {existing.get('source', '?')})\n\n"
                "Pakai `/restore KODE` dari akun Telegram baru untuk restore akses.\n"
                "🔒 Rahasiakan kode ini!"
            )
        else:
            await event.respond(
                "❓ Kamu **belum punya Token Login backup**.\n\n"
                "Token Login otomatis dikasih pas:\n"
                "• Klaim trial (`/trial`) — sekali seumur hidup\n"
                "• Sukses bayar premium\n\n"
                "Kalau butuh untuk kondisi lain, hubungi owner: " + config.OWNER_USERNAME
            )

    # ---------- /restore CODE - migrate akses ke Telegram ID baru ----------
    @bot.on(events.NewMessage(pattern=r"^/restore(?:\s+(\S+))?$"))
    async def _restore(event):
        uid_new = str(event.sender_id)
        arg = (event.pattern_match.group(1) or "").strip().upper()
        if not arg:
            await event.respond("Format: `/restore UBM-XXXX-XXXX-XXXX`")
            return
        codes = load_redeem_codes()
        # Cari owner kode ini
        old_uid = None
        for k, v in codes.items():
            if v.get("code") == arg:
                old_uid = k
                break
        if not old_uid:
            await event.respond("❌ Token Login tidak ditemukan.")
            return
        if old_uid == uid_new:
            await event.respond("ℹ️ Token ini milik akun kamu sendiri — tidak perlu restore.")
            return
        # Transfer data user lama → user baru
        from storage import get_user
        u_old = users.get(old_uid, {})
        cfg_old = u_old.get("config", {})
        if not cfg_old:
            await event.respond("❌ Data akun lama kosong. Tidak ada yang bisa direstore.")
            return
        u_new = get_user(users, uid_new)
        # Copy tier/expiry/session ke akun baru
        u_new["session"] = u_old.get("session")
        u_new["phone"] = u_old.get("phone")
        cfg_new = u_new.setdefault("config", {})
        for key in ("tier", "trial_used", "trial_ends_at", "premium_ends_at", "expired",
                    "pesan_list", "target_list", "target_mode", "blacklist",
                    "autoreply", "jeda_mode", "jeda_value", "timer_on", "timer_off"):
            if key in cfg_old:
                cfg_new[key] = cfg_old[key]
        # Non-aktifkan token lama, generate baru untuk akun baru
        codes[uid_new] = {"code": arg, "created_at": codes[old_uid].get("created_at"),
                          "source": codes[old_uid].get("source", "restored"),
                          "restored_from": old_uid}
        # Hapus data akun lama biar tidak double
        users.pop(old_uid, None)
        codes.pop(old_uid, None)
        save_redeem_codes(codes)
        ctx["save"]()
        await event.respond(
            f"✅ **AKSES BERHASIL DIRESTORE!**\n\n"
            f"🏷️ Tier: **{cfg_new.get('tier', 'Free')}**\n"
            f"⏰ Berakhir: {cfg_new.get('expired', '—')}\n"
            f"📱 Nomor userbot: {u_new.get('phone', '—')}\n\n"
            "Akses & premium kamu sudah pindah ke akun Telegram ini.\n"
            "Ketuk /start untuk lihat menu.",
        )

    # V2 additions: auto-send Token Login backup pas /redeem sukses (kalau belum punya)
    @bot.on(events.NewMessage(pattern=r"^/redeem(?:\s+(\S+))?$"))
    async def _redeem(event):
        uid = str(event.sender_id)
        m = event.pattern_match
        arg = (m.group(1) or "").strip().upper()
        if not arg:
            await event.respond("Format: `/redeem TKN-XXXX-XXXX`")
            return
        t = tokens.get(arg)
        if not t:
            await event.respond("❌ Token tidak ditemukan.")
            return
        if t.get("used"):
            await event.respond("❌ Token sudah pernah dipakai.")
            return
        # 1 token = 1 orang: akun yang sudah pernah claim token tidak boleh claim lagi
        already = next((k for k, v in tokens.items() if v.get("used_by") == uid), None)
        if already:
            await event.respond(
                "❌ **1 token = 1 orang** — kamu sudah pernah pakai token "
                f"(`{already}`).\n\n"
                "Token lain tidak bisa diklaim di akun yang sama.\n"
                "Perpanjang lewat `/beli` atau hubungi owner ya 😊"
            )
            return
        new_end = activate_premium(users, uid, t["days"], t["tier"], plan_key=None, save_fn=save)
        t["used"] = True
        t["used_by"] = uid
        t["used_at"] = now_ts().isoformat()
        save_tokens(tokens)
        save()
        backup, is_new = get_or_create_backup_code(uid, source="redeem_token")
        await event.respond(
            f"✅ **PREMIUM AKTIF!**\n\n"
            f"🏷️ Tier: **{t['tier']}**\n"
            f"⏰ Berakhir: {fmt_time(new_end)}\n"
            f"⏳ Sisa: {fmt_remaining(new_end)}",
            buttons=main_keyboard(int(uid)),
        )
        if is_new:
            await event.respond(
                f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                f"`{backup}`\n\n"
                "⚠️ **SIMPAN!** Untuk restore akses kalau ganti akun / logout.\n"
                f"Cara pakai: `/restore {backup}` dari akun baru.\n"
                "🔒 Rahasiakan!"
            )

    # ---------- /beli - beli premium via Paymentku ----------
    @bot.on(events.NewMessage(pattern=r"^/beli$"))
    async def _beli(event):
        await show_beli_menu(event, is_edit=False)

    @bot.on(events.CallbackQuery(pattern=rb"^beli_plans$"))
    async def _beli_plans_cb(event):
        await show_beli_menu(event, is_edit=True)

    async def _create_paymentku_transaction(uid, plan_key, plan, channel_code, discount_tokens=0, months=1):
        """Call Paymentku API asli untuk buat transaksi. Return (order_id, response_data, error)."""
        if not PAYMENTKU_API_KEY:
            return None, None, "PAYMENTKU_API_KEY belum diset di .env"
        order_id = "ORD-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(10))
        total_amount, days = plan_amount_days(plan, months)
        # Hitung diskon token
        try:
            import v2_referral
            balance = v2_referral.get_balance(users, uid)
        except Exception:
            balance = 0
        max_discount = total_amount // 2  # max 50%
        applied_discount = min(discount_tokens * 1000, balance * 1000, max_discount)
        applied_tokens = applied_discount // 1000
        final_amount = total_amount - applied_discount
        if applied_tokens > 0:
            try:
                v2_referral.spend_tokens(users, ctx["save"], uid, applied_tokens)
            except Exception:
                applied_tokens = 0
                final_amount = total_amount
        try:
            me = await bot.get_entity(int(uid))
            cust_name = (me.first_name or "User") + (f" {me.last_name}" if getattr(me, "last_name", None) else "")
        except Exception:
            cust_name = f"User {uid}"
        body = {
            "channel_code": channel_code,
            "amount": final_amount,
            "reference_id": order_id,
            "customer_name": cust_name[:50],
            "customer_email": f"tg{uid}@userbot.local",
            "return_url": "https://t.me/" + (config.OWNER_USERNAME.lstrip("@") or "Kakostore_Bot"),
        }
        headers = {
            "Authorization": f"Bearer {PAYMENTKU_API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Idempotency-Key": order_id,
        }
        try:
            r = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: requests.post(f"{PAYMENTKU_BASE}/transaction/create",
                                      json=body, headers=headers, timeout=20),
            )
        except Exception as e:
            return order_id, None, f"Network error: {e}"
        if r.status_code != 200:
            try:
                err = r.json().get("message", r.text[:200])
            except Exception:
                err = r.text[:200]
            return order_id, None, f"HTTP {r.status_code}: {err}"
        try:
            data = r.json().get("data", {})
        except Exception:
            return order_id, None, "Response invalid"
        # Persist local record
        payments[order_id] = {
            "user_id": uid,
            "plan": plan_key,
            "months": months,
            "amount": final_amount,
            "original_amount": total_amount,
            "discount_tokens": applied_tokens,
            "channel": channel_code,
            "trx_id": data.get("trx_id"),
            "days": days,
            "tier": plan["tier"],
            "status": "pending",
            "pay_url": data.get("pay_url"),
            "payment_info": data.get("payment_info", {}),
            "created_at": now_ts().isoformat(),
            "provider": "paymentku",
        }
        save_payments(payments)
        return order_id, data, None

    @bot.on(events.CallbackQuery(pattern=rb"^beli:(.+)$"))
    async def _beli_cb(event):
        plan_key = event.pattern_match.group(1).decode()
        plan = PLANS.get(plan_key)
        if not plan:
            await event.answer("Paket tidak valid", alert=True)
            return
        # Pilih durasi 1–12 bulan (kayak Flensiza — tombol angka, total otomatis)
        kb = []
        row = []
        for m in DURATION_MONTHS:
            row.append(Button.inline(str(m), f"dur:{plan_key}:{m}".encode()))
            if len(row) == 3:
                kb.append(row)
                row = []
        if row:
            kb.append(row)
        kb.append([Button.inline("⬅️ Kembali", b"beli_plans")])
        await event.edit(
            f"📦 **{plan['label']} — Rp {plan['amount_month']:,}/bulan**\n\n"
            "📚 Pilih **durasi (bulan)** di bawah:\n"
            f"💵 Total otomatis = Rp {plan['amount_month']:,} × n bulan",
            buttons=kb,
        )

    @bot.on(events.CallbackQuery(pattern=rb"^dur:([^:]+):(\d+)$"))
    async def _dur_cb(event):
        plan_key = event.pattern_match.group(1).decode()
        months = int(event.pattern_match.group(2).decode())
        plan = PLANS.get(plan_key)
        if not plan:
            await event.answer("Paket tidak valid", alert=True)
            return
        amount, _days = plan_amount_days(plan, months)
        kb = [
            [Button.inline("🟢 Bayar QRIS", f"paych:{plan_key}:{months}:qris".encode())],
            [Button.inline("💰 Bayar pakai Saldo", f"belisaldo:{plan_key}:{months}".encode())],
            [Button.inline("⬅️ Batal", b"beli_plans")],
        ]
        await event.edit(
            f"💎 **{plan['label']} — {months} Bulan**\n"
            f"💵 Rp {plan['amount_month']:,} × {months} = **Rp {amount:,}**\n\n"
            "Pilih metode pembayaran:",
            buttons=kb,
        )

    @bot.on(events.CallbackQuery(pattern=rb"^belisaldo:([^:]+):(\d+)$"))
    async def _beli_saldo_cb(event):
        uid = event.sender_id
        plan_key = event.pattern_match.group(1).decode()
        months = int(event.pattern_match.group(2).decode())
        plan = PLANS.get(plan_key)
        if not plan:
            await event.answer("Paket tidak valid", alert=True); return
        amount, days = plan_amount_days(plan, months)
        import v2_panel
        rec = v2_panel.get_saldo(uid)
        bal = int(rec.get("balance", 0)) if isinstance(rec, dict) else int(rec or 0)
        if bal < amount:
            await event.edit(
                f"❌ Saldo tidak cukup.\n💰 Saldo: Rp {bal:,}\n💎 Harga: Rp {amount:,}\n➖ Kurang: Rp {amount-bal:,}\n\nSilakan Topup Saldo dulu.",
                buttons=[[Button.inline("⬅️ Menu", b"menu")]])
            return
        v2_panel.deduct_saldo(uid, amount)
        new_end = activate_premium(users, str(uid), days, plan["tier"], plan_key=plan_key, save_fn=ctx["save"])
        _label = plan["label"]
        await event.edit(
            f"✅ Premium AKTIF!\n💎 {_label} — {months} Bulan\n💰 Saldo dipotong: Rp {amount:,}\n📅 Aktif s/d: {new_end}\n\nTerima kasih 🙏",
            buttons=[[Button.inline("⬅️ Menu", b"menu")]])
        try:
            _bc, _is_new = get_or_create_backup_code(str(uid), source="premium")
        except Exception:
            _bc, _is_new = None, False
        if _bc and _is_new:
            await event.respond(
                f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                f"`{_bc}`\n\n"
                "⚠️ **SIMPAN!** Kode ini untuk restore akses kalau logout / ganti akun.\n"
                f"Cara pakai: `/restore {_bc}` dari akun baru.\n\n"
                "🔒 Rahasiakan!")

    @bot.on(events.CallbackQuery(pattern=rb"^paych:([^:]+):(\d+):(.+)$"))
    async def _paych_cb(event):
        uid = str(event.sender_id)
        plan_key = event.pattern_match.group(1).decode()
        months = int(event.pattern_match.group(2).decode())
        channel = event.pattern_match.group(3).decode()
        plan = PLANS.get(plan_key)
        if not plan:
            await event.answer("Paket tidak valid", alert=True)
            return
        amount, _days = plan_amount_days(plan, months)
        # Cek saldo token → tawarkan pakai token untuk potong harga
        try:
            import v2_referral
            balance = v2_referral.get_balance(users, uid)
        except Exception:
            balance = 0
        max_use = min(balance, amount // 2 // 1000)  # max 50% dari harga
        if max_use > 0:
            kb = [
                [Button.inline(f"💰 Pakai {max_use} token (−Rp {max_use * 1000:,})", f"paypay:{plan_key}:{months}:{channel}:{max_use}".encode())],
                [Button.inline("💳 Bayar Full (tanpa token)", f"paypay:{plan_key}:{months}:{channel}:0".encode())],
                [Button.inline("⬅️ Batal", b"beli_plans")],
            ]
            await event.edit(
                f"💎 **{plan['label']} — {months} Bulan**\n"
                f"Harga normal: Rp {amount:,}\n\n"
                f"💰 Kamu punya **{balance} token** (Rp {balance * 1000:,}).\n"
                f"Bisa dipakai untuk potong harga (max 50% = {max_use} token = Rp {max_use * 1000:,}).\n\n"
                "Pilih:",
                buttons=kb,
            )
        else:
            await _do_create_invoice(event, uid, plan_key, plan, channel, months=months, discount_tokens=0)

    @bot.on(events.CallbackQuery(pattern=rb"^paypay:([^:]+):(\d+):([^:]+):(.+)$"))
    async def _paypay_cb(event):
        uid = str(event.sender_id)
        plan_key = event.pattern_match.group(1).decode()
        months = int(event.pattern_match.group(2).decode())
        channel = event.pattern_match.group(3).decode()
        discount = int(event.pattern_match.group(4).decode())
        plan = PLANS.get(plan_key)
        if not plan:
            await event.answer("Paket tidak valid", alert=True)
            return
        await _do_create_invoice(event, uid, plan_key, plan, channel, months=months, discount_tokens=discount)

    async def _do_create_invoice(event, uid, plan_key, plan, channel, months=1, discount_tokens=0):
        await event.edit("⏳ Membuat invoice Paymentku...", buttons=None)
        order_id, data, err = await _create_paymentku_transaction(uid, plan_key, plan, channel, discount_tokens=discount_tokens, months=months)
        if err:
            await event.edit(
                f"❌ **Gagal buat invoice**\n\n`{err}`\n\n"
                "Silakan coba lagi atau pilih channel lain.",
                buttons=[[Button.inline("⬅️ Kembali", b"menu")]],
            )
            return
        pinfo = data.get("payment_info", {})
        p = payments[order_id]
        lines = [
            f"🧾 **INVOICE DIBUAT** ({channel.upper()})",
            "",
            f"🆔 Order: `{order_id}`",
            f"💎 Paket: **{plan['label']} — {months} Bulan**",
        ]
        if p.get("discount_tokens", 0) > 0:
            lines.append(f"💰 Diskon token: -{p['discount_tokens']} token (−Rp {p['discount_tokens']*1000:,})")
        lines.extend([
            f"💰 Total: **Rp {int(float(data.get('amount', p['amount']))):,}** (sudah termasuk fee)",
            "",
        ])
        if pinfo.get("va_number"):
            lines += [f"🏦 Bank: **{pinfo.get('bank', channel.upper())}**",
                      f"🔢 VA Number: `{pinfo['va_number']}`",
                      f"⏰ Kadaluarsa: {pinfo.get('expiration_date', '-')}"]
        elif pinfo.get("qr_url"):
            lines += [f"🔗 Scan QR: {pinfo['qr_url']}",
                      f"⏰ Kadaluarsa: {pinfo.get('expiration_date', '-')}"]
        elif pinfo.get("checkout_url"):
            lines += [f"🔗 Buka aplikasi: {pinfo['checkout_url']}",
                      f"⏰ Kadaluarsa: {pinfo.get('expiration_date', '-')}"]
        lines += ["",
                  f"🌐 Atau bayar via link: {data.get('pay_url', '-')}",
                  "",
                  "✅ Setelah bayar, premium **aktif otomatis** dalam <5 detik.",
                  f"🔍 Cek status: `/cekbayar {order_id}`"]
        kb = [
            [Button.url("💳 Buka Halaman Bayar", data.get("pay_url", "https://paymenku.com"))],
            [Button.inline("🔄 Cek Status", f"cekbayar:{order_id}".encode())],
            [Button.inline("⬅️ Kembali", b"menu")],
        ]
        await event.edit("\n".join(lines), buttons=kb)

    async def _check_payment_status(order_id):
        """Panggil Paymentku check-status API. Return (status, data, error)."""
        if not PAYMENTKU_API_KEY:
            return None, None, "API key kosong"
        try:
            r = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: requests.get(
                    f"{PAYMENTKU_BASE}/check-status/{order_id}",
                    headers={"Authorization": f"Bearer {PAYMENTKU_API_KEY}"},
                    timeout=15,
                ),
            )
        except Exception as e:
            return None, None, f"Network: {e}"
        if r.status_code != 200:
            return None, None, f"HTTP {r.status_code}"
        try:
            j = r.json().get("data", {})
            return j.get("status"), j, None
        except Exception:
            return None, None, "Bad response"

    @bot.on(events.NewMessage(pattern=r"^/cekbayar(?:\s+(\S+))?$"))
    async def _cekbayar_cmd(event):
        arg = (event.pattern_match.group(1) or "").strip()
        if not arg:
            await event.respond("Format: `/cekbayar ORDER_ID`")
            return
        await _cekbayar_impl(event, arg, is_callback=False)

    @bot.on(events.CallbackQuery(pattern=rb"^cekbayar:(.+)$"))
    async def _cekbayar_cb(event):
        oid = event.pattern_match.group(1).decode()
        await _cekbayar_impl(event, oid, is_callback=True)

    async def _cekbayar_impl(event, oid, is_callback):
        p = payments.get(oid)
        if not p:
            msg = f"❌ Order `{oid}` tidak ditemukan."
            if is_callback: await event.answer(msg, alert=True)
            else: await event.respond(msg)
            return
        if p["status"] == "paid":
            msg = f"✅ Order `{oid}` sudah **PAID**. Premium sudah aktif."
            if is_callback: await event.answer(msg, alert=True)
            else: await event.respond(msg)
            return
        # Poll Paymentku live
        status, data, err = await _check_payment_status(oid)
        if err:
            msg = f"⚠️ Gagal cek status: {err}"
            if is_callback: await event.answer(msg, alert=True)
            else: await event.respond(msg)
            return
        if status == "paid" and p["status"] != "paid":
            new_end = activate_premium(users, p["user_id"], p["days"], p["tier"], plan_key=p.get("plan"), save_fn=ctx["save"])
            p["status"] = "paid"
            p["paid_at"] = now_ts().isoformat()
            save_payments(payments)
            ctx["save"]()
            try:
                await bot.send_message(
                    int(p["user_id"]),
                    f"✅ **PAYMENT DITERIMA!** (via manual poll)\n\n"
                    f"Order: `{oid}`\n"
                    f"Tier: **{p['tier']}**\n"
                    f"Berakhir: {fmt_time(new_end)}",
                    buttons=main_keyboard(int(p["user_id"])),
                )
            except Exception:
                pass
            if is_callback: await event.answer("✅ PAID — premium aktif!", alert=True)
            else: await event.respond("✅ **PAID** — premium sudah aktif!")
        else:
            msg = f"⏳ Status: **{status or 'pending'}**\nBelum ada pembayaran masuk."
            if is_callback: await event.answer(msg, alert=True)
            else: await event.respond(msg)

    @bot.on(events.NewMessage(pattern=r"^/approve\s+(\S+)$"))
    async def _approve(event):
        if not is_owner(event.sender_id):
            return
        oid = event.pattern_match.group(1)
        p = payments.get(oid)
        if not p:
            await event.respond(f"❌ Order `{oid}` tidak ditemukan.")
            return
        if p["status"] == "paid":
            await event.respond("Sudah paid.")
            return
        p["status"] = "paid"
        p["paid_at"] = now_ts().isoformat()
        save_payments(payments)
        new_end = activate_premium(users, p["user_id"], p["days"], p["tier"])
        save()
        backup_code, is_new = get_or_create_backup_code(str(p["user_id"]), source="premium")
        try:
            await bot.send_message(
                int(p["user_id"]),
                f"✅ **PAYMENT DITERIMA!**\n\n"
                f"Order: `{oid}`\n"
                f"Tier: **{p['tier']}**\n"
                f"Berakhir: {fmt_time(new_end) if new_end else '♾️ Lifetime'}\n\n"
                "Terima kasih! Premium sudah aktif.",
                buttons=main_keyboard(int(p["user_id"])),
            )
            if is_new:
                await bot.send_message(
                    int(p["user_id"]),
                    f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                    f"`{backup_code}`\n\n"
                    "⚠️ **SIMPAN BAIK-BAIK!** Kode ini untuk restore akses kalau logout / ganti akun.\n"
                    f"Cara pakai: `/restore {backup_code}` dari akun baru.\n\n"
                    "🔒 Rahasiakan!"
                )
        except Exception:
            pass
        await event.respond(f"✅ Order `{oid}` di-approve. User dinotify.")

    # ---------- /gentoken N days tier ----------
    @bot.on(events.NewMessage(pattern=r"^/gentoken(?:\s+(.+))?$"))
    async def _gentoken(event):
        if not is_owner(event.sender_id):
            return
        arg = (event.pattern_match.group(1) or "").strip()
        parts = arg.split()
        if len(parts) < 2:
            await event.respond(
                "Format: `/gentoken JUMLAH HARI [TIER]`\n"
                "Contoh: `/gentoken 5 30 Spesial++`\n"
                "Tier: Spesial | Spesial++ | Lifetime"
            )
            return
        try:
            n = int(parts[0])
            days = int(parts[1])
            tier = parts[2] if len(parts) > 2 else "Spesial"
        except ValueError:
            await event.respond("Jumlah/hari harus angka.")
            return
        n = min(max(n, 1), 100)
        generated = []
        for _ in range(n):
            tk = gen_token()
            tokens[tk] = {
                "days": days,
                "tier": tier,
                "used": False,
                "created_at": now_ts().isoformat(),
            }
            generated.append(tk)
        save_tokens(tokens)
        lines = [f"🎫 **{n} TOKEN DIBUAT** ({tier}, {days}h)\n"]
        for tk in generated:
            lines.append(f"`{tk}`")
        lines.append("\nUser tukar dengan: `/redeem TOKEN`")
        await event.respond("\n".join(lines))

    @bot.on(events.NewMessage(pattern=r"^/tokens$"))
    async def _list_tokens(event):
        if not is_owner(event.sender_id):
            return
        if not tokens:
            await event.respond("📭 Belum ada token.")
            return
        unused = [(k, v) for k, v in tokens.items() if not v.get("used")]
        used = [(k, v) for k, v in tokens.items() if v.get("used")]
        lines = [f"🎫 **TOKEN LIST**  ·  {len(unused)} unused, {len(used)} used\n"]
        for k, v in unused[:30]:
            lines.append(f"• `{k}` — {v['days']}h {v['tier']}")
        if used:
            lines.append(f"\n_Used ({min(len(used), 10)} terbaru):_")
            for k, v in used[-10:]:
                lines.append(f"~ `{k}` — by `{v.get('used_by', '?')}`")
        text = "\n".join(lines)
        await event.respond(text[:4000])

    # ---------- /status_v2 - status akses + info user ----------
    @bot.on(events.NewMessage(pattern=r"^/akses$"))
    async def _akses(event):
        uid = str(event.sender_id)
        has, source, exp = compute_access(users, uid, whitelist)
        if not has:
            u = users.get(uid, {})
            trial_used = u.get("config", {}).get("trial_used", False)
            msg = "🚫 **BELUM PUNYA AKSES**\n\n"
            if not trial_used:
                msg += "🎁 Klaim gratis dengan `/trial` (24 jam)\n"
            msg += "💎 Beli premium dengan `/beli`\n"
            msg += "🎫 Punya token? `/redeem TKN-XXXX-XXXX`"
            await event.respond(msg)
            return
        u = users.get(uid, {})
        cfg = u.get("config", {})
        text = (
            f"✅ **AKSES ANDA**\n\n"
            f"🏷️ Tier: **{cfg.get('tier', source)}**\n"
            f"📌 Sumber: `{source}`\n"
            f"⏰ Berakhir: {fmt_time(exp)}\n"
            f"⏳ Sisa: {fmt_remaining(exp) if exp else '♾️ selamanya'}\n\n"
            f"🎁 Trial used: {'ya' if cfg.get('trial_used') else 'belum'}\n"
            f"🤖 Userbot: {'aktif' if u.get('session') else 'belum dibuat'}"
        )
        await event.respond(text)

    # ---------- /help ----------
    @bot.on(events.NewMessage(pattern=r"^/help$"))
    async def _help(event):
        base = (
            "📖 **PERINTAH V2**\n\n"
            "**User:**\n"
            "• /trial — Klaim trial 24 jam gratis (1x seumur hidup)\n"
            "• /beli — Beli premium (Paymentku, 9 channel)\n"
            "• /redeem TOKEN — Tukar token premium\n"
            "• /kode — Lihat Token Login backup kamu\n"
            "• /restore UBM-XXXX — Restore akses di akun baru\n"
            "• /akses — Cek status akses & tier\n"
            "• /cekbayar ORDER_ID — Cek status pembayaran\n"
            "• /ref atau /undang — Ajak teman, dapat token (Rp 1.000/token)\n"
            "• /saldo — Cek saldo token kamu\n"
            "• /rate 5 pesan — Kasih testimoni\n"
        )
        if is_owner(event.sender_id):
            base += (
                "\n**Owner:**\n"
                "• /akseskan USER_ID [HARI] [TIER] — Kasih akses instan (paling simpel!)\n"
                "• /hapusakses USER_ID — Cabut akses user\n"
                "• /gentoken N HARI TIER — Bikin token premium\n"
                "• /tokens — List semua token\n"
                "• /approve ORDER_ID — Approve payment manual\n"
                "• /ref_top — Leaderboard referrer\n"
                "• /testimoni_list — Kelola testimoni\n"
                "• /approve_testi TST-XXXX — Approve testimoni\n"
                "• /reject_testi TST-XXXX — Reject testimoni\n"
                "• /setowner @username — Ganti username owner\n"
                "• /setchannel @channel — Ganti channel testimoni\n"
            )
        base += "\n**Panel utama:** ketuk tombol di bawah untuk buat userbot & atur auto-share."
        await event.respond(base)

    @bot.on(events.NewMessage(pattern=r"^/setowner(?:\s+(\S+))?$"))
    async def _setowner(event):
        if not is_owner(event.sender_id):
            return
        arg = (event.pattern_match.group(1) or "").strip()
        if not arg:
            await event.respond(
                "Format: `/setowner @UsernameOwner`\n\n"
                f"Sekarang: **{config.OWNER_USERNAME}**\n\n"
                "Ganti akan mengubah semua pesan bot yg nyebut owner (di /help, tolak akses, /trial dll).\n"
                "Setting persistent via config runtime — reset kalau bot restart. Untuk permanen edit `/app/backend/.env` → `OWNER_USERNAME`."
            )
            return
        if not arg.startswith("@"):
            arg = "@" + arg
        config.OWNER_USERNAME = arg
        await event.respond(f"✅ Owner username diganti jadi **{arg}**.\n\nUntuk permanen (survive restart), edit `/app/backend/.env` → `OWNER_USERNAME=\"{arg}\"` lalu `sudo supervisorctl restart telegram_bot`.")

    @bot.on(events.NewMessage(pattern=r"^/setchannel(?:\s+(\S+))?$"))
    async def _setchannel(event):
        if not is_owner(event.sender_id):
            return
        arg = (event.pattern_match.group(1) or "").strip()
        if not arg:
            await event.respond(f"Format: `/setchannel @channel`\nSekarang: **{config.CHANNEL_USERNAME}**")
            return
        if not arg.startswith("@"):
            arg = "@" + arg
        config.CHANNEL_USERNAME = arg
        await event.respond(f"✅ Channel diganti jadi **{arg}**.")

    # ---------- /akseskan USER_ID [DAYS] [TIER] — cara paling simpel kasih akses ----------
    @bot.on(events.NewMessage(pattern=r"^/akseskan(?:\s+(.+))?$"))
    async def _akseskan(event):
        if not is_owner(event.sender_id):
            return
        arg = (event.pattern_match.group(1) or "").strip()
        if not arg:
            await event.respond(
                "🎁 **KASIH AKSES PREMIUM KE USER (SIMPEL)**\n\n"
                "Format: `/akseskan USER_ID [HARI] [TIER]`\n\n"
                "Contoh:\n"
                "• `/akseskan 123456789` — Lifetime\n"
                "• `/akseskan 123456789 30` — Spesial++ 30 hari\n"
                "• `/akseskan 123456789 90 Spesial` — Spesial 90 hari\n"
                "• `/akseskan 123456789 lifetime` — sama dengan tanpa hari\n\n"
                "USER_ID dapet dari @userinfobot (user chat @userinfobot → dia kasih ID)."
            )
            return
        parts = arg.split()
        try:
            uid = int(parts[0])
        except ValueError:
            await event.respond("❌ USER_ID harus angka. Contoh: `/akseskan 123456789`")
            return
        days_arg = parts[1] if len(parts) > 1 else "lifetime"
        tier_arg = " ".join(parts[2:]) if len(parts) > 2 else "Spesial++"
        # Lifetime
        if days_arg.lower() in ("lifetime", "seumur", "seumurhidup", "ltd"):
            from storage import get_user
            u = get_user(users, str(uid))
            cfg = u.setdefault("config", {})
            cfg["tier"] = "Lifetime"
            cfg["premium_ends_at"] = None
            cfg["expired"] = "♾️ Lifetime"
            save()
            await event.respond(
                f"✅ **AKSES LIFETIME DIBERIKAN**\n\n"
                f"👤 User ID: `{uid}`\n"
                f"🏷️ Tier: **Lifetime** (tidak pernah expired)\n\n"
                f"User bisa langsung buat userbot & pakai semua fitur."
            )
            try:
                await bot.send_message(
                    uid,
                    f"🎉 **KAMU DAPAT AKSES LIFETIME dari Owner!**\n\n"
                    f"🏷️ Tier: **Lifetime**\n"
                    f"⏰ Berakhir: **♾️ Selamanya**\n\n"
                    f"Ketuk **📚 Buat Userbot** untuk mulai!\n"
                    f"👑 Owner: {config.OWNER_USERNAME}",
                    buttons=main_keyboard(uid),
                )
            except Exception:
                pass
            return
        # Hari-based
        try:
            days = int(days_arg)
        except ValueError:
            await event.respond(f"❌ HARI harus angka atau 'lifetime'. Kamu ketik: `{days_arg}`")
            return
        new_end = activate_premium(users, str(uid), days, tier_arg, plan_key=None, save_fn=save)
        save()
        await event.respond(
            f"✅ **AKSES PREMIUM DIBERIKAN**\n\n"
            f"👤 User ID: `{uid}`\n"
            f"🏷️ Tier: **{tier_arg}**\n"
            f"⏰ Berakhir: **{fmt_time(new_end)}**\n"
            f"⏳ Durasi: {days} hari"
        )
        try:
            await bot.send_message(
                uid,
                f"🎉 **KAMU DAPAT AKSES PREMIUM dari Owner!**\n\n"
                f"🏷️ Tier: **{tier_arg}**\n"
                f"⏰ Berakhir: {fmt_time(new_end)}\n"
                f"⏳ Sisa: {fmt_remaining(new_end)}\n\n"
                f"Ketuk **📚 Buat Userbot** untuk mulai!\n"
                f"👑 Owner: {config.OWNER_USERNAME}",
                buttons=main_keyboard(uid),
            )
        except Exception:
            pass

    # ---------- /hapusakses USER_ID ----------
    @bot.on(events.NewMessage(pattern=r"^/hapusakses(?:\s+(\d+))?$"))
    async def _hapusakses(event):
        if not is_owner(event.sender_id):
            return
        arg = event.pattern_match.group(1)
        if not arg:
            await event.respond("Format: `/hapusakses USER_ID`")
            return
        uid = arg
        u = users.get(uid)
        if not u:
            await event.respond(f"❌ User `{uid}` tidak ditemukan.")
            return
        cfg = u.setdefault("config", {})
        cfg["tier"] = "Free"
        cfg["premium_ends_at"] = None
        cfg["expired"] = None
        cfg["running"] = False
        save()
        await event.respond(f"✅ Akses user `{uid}` dicabut.")

    log.info("V2 extensions registered: /trial, /beli, /redeem, /kode, /gentoken, /tokens, /approve, /akses, /help, /restore, /setowner, /setchannel, /akseskan, /hapusakses")
