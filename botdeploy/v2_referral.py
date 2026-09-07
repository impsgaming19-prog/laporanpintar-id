"""V2 Referral System — /undang teman → dapat token, 1 token = Rp 1.000 potongan beli premium.

Cara pakai:
- User A ketik /ref → dapat kode referral unik (mis: REF-A1B2)
- User A share link: https://t.me/BOTNAME?start=REF-A1B2
- User B klik link → /start REF-A1B2 → tercatat pending referral
- User B beli premium (via /beli, /redeem, /approve) → User A dapat bonus token
- Reward per paket:
    Spesial 7 hari  → 1 token
    Spesial 30 hari → 3 token
    Spesial++ 30 hari → 5 token
    Spesial++ 90 hari → 10 token
    Lifetime → 50 token
- User pakai token saat /beli untuk potong harga (max 50% dari total)
"""
import json
import secrets
import string
import logging
from pathlib import Path
from datetime import datetime

import config

log = logging.getLogger("v2ref")

STATE_DIR = Path(__file__).parent
REFERRALS_FILE = STATE_DIR / "referrals.json"

# 1 token = Rp 1.000
TOKEN_VALUE_IDR = 1000

# Bonus token per paket premium (owner boleh customize di /setrefbonus)
REF_REWARDS = {
    "spesial_7d": 1,
    "spesial_30d": 3,
    "spesial_plus_30d": 5,
    "spesial_plus_90d": 10,
    "lifetime": 50,
    "spesial": 2,
    "spesial_plus": 4,
}


def _load(path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def load_referrals():
    return _load(REFERRALS_FILE, {
        "codes": {},        # code -> uid (owner of code)
        "pending": {},      # invited_uid -> {"referrer": uid, "at": iso}
        "history": [],      # [{referrer, invited, plan, reward, at}]
    })


def save_referrals(r):
    _save(REFERRALS_FILE, r)


def gen_ref_code():
    return "REF-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def get_or_create_ref_code(uid_str):
    r = load_referrals()
    # Cari kode existing untuk user ini
    for code, owner in r["codes"].items():
        if owner == uid_str:
            return code, r
    # Generate baru
    while True:
        code = gen_ref_code()
        if code not in r["codes"]:
            r["codes"][code] = uid_str
            save_referrals(r)
            return code, r


def track_pending_referral(invited_uid_str, ref_code):
    """User baru klik link ref → simpan pending."""
    r = load_referrals()
    ref_code = ref_code.strip().upper()
    if ref_code not in r["codes"]:
        return False, "Kode referral tidak valid"
    referrer_uid = r["codes"][ref_code]
    if referrer_uid == invited_uid_str:
        return False, "Tidak bisa pakai kode referral sendiri"
    if invited_uid_str in r["pending"]:
        return False, "Sudah pernah tercatat"
    # Cek: kalau user sudah pernah tercatat ke referrer manapun → skip
    for h in r["history"]:
        if h["invited"] == invited_uid_str:
            return False, "Sudah pernah dapat referrer sebelumnya"
    r["pending"][invited_uid_str] = {
        "referrer": referrer_uid,
        "code": ref_code,
        "at": datetime.now().isoformat(),
    }
    save_referrals(r)
    return True, referrer_uid


def award_referral_on_purchase(users, save_users_fn, invited_uid_str, plan_key, notify_fn=None):
    """Panggil ini di dalam activate_premium / /approve / redeem.
    Beri bonus token ke referrer kalau user ini punya pending referral.
    Return (referrer_uid, reward_tokens) atau (None, 0).
    """
    r = load_referrals()
    pending = r["pending"].get(invited_uid_str)
    if not pending:
        return None, 0
    referrer_uid = pending["referrer"]
    reward = REF_REWARDS.get(plan_key, 0)
    if reward <= 0:
        return referrer_uid, 0
    # Beri token ke referrer
    from storage import get_user
    ref_user = get_user(users, referrer_uid)
    ref_cfg = ref_user.setdefault("config", {})
    ref_cfg["balance_tokens"] = int(ref_cfg.get("balance_tokens", 0)) + reward
    save_users_fn()
    # Log history & remove pending
    r["history"].append({
        "referrer": referrer_uid,
        "invited": invited_uid_str,
        "plan": plan_key,
        "reward": reward,
        "at": datetime.now().isoformat(),
    })
    r["pending"].pop(invited_uid_str, None)
    save_referrals(r)
    log.info(f"referral awarded: {referrer_uid} +{reward} tokens (from {invited_uid_str}'s {plan_key})")
    # Notify referrer
    if notify_fn:
        try:
            notify_fn(referrer_uid, reward, plan_key, ref_cfg["balance_tokens"])
        except Exception as e:
            log.warning(f"notify referrer fail: {e}")
    return referrer_uid, reward


def get_balance(users, uid_str):
    from storage import get_user
    u = get_user(users, uid_str)
    return int(u.get("config", {}).get("balance_tokens", 0))


def spend_tokens(users, save_fn, uid_str, amount):
    from storage import get_user
    u = get_user(users, uid_str)
    cfg = u.setdefault("config", {})
    cur = int(cfg.get("balance_tokens", 0))
    if cur < amount:
        return False
    cfg["balance_tokens"] = cur - amount
    save_fn()
    return True


def register(bot, users, save, main_keyboard, is_owner, bot_username=None):
    from telethon import events

    async def notify_referrer(referrer_uid, reward, plan, new_balance):
        try:
            await bot.send_message(
                int(referrer_uid),
                f"🎉 **REFERRAL SUKSES!**\n\n"
                f"Teman kamu baru saja beli paket **{plan}**.\n"
                f"💰 Bonus kamu: **+{reward} token**\n"
                f"💳 Saldo sekarang: **{new_balance} token** (senilai Rp {new_balance * TOKEN_VALUE_IDR:,})\n\n"
                f"Pakai token pas /beli untuk potong harga (max 50%).",
            )
        except Exception:
            pass

    # Simpan callback ke module supaya bisa dipanggil dari activate_premium hook
    _register.notify_referrer = notify_referrer

    @bot.on(events.NewMessage(pattern=r"^/(ref|undang)$"))
    async def _ref(event):
        uid = str(event.sender_id)
        code, _ = get_or_create_ref_code(uid)
        balance = get_balance(users, uid)
        # count referred
        r = load_referrals()
        my_history = [h for h in r["history"] if h["referrer"] == uid]
        total_earned = sum(h["reward"] for h in my_history)
        bot_name = bot_username or "Kakostore_Bot"
        link = f"https://t.me/{bot_name}?start={code}"
        await event.respond(
            f"🎁 **REFERRAL KAMU**\n\n"
            f"🔗 Kode: `{code}`\n"
            f"🔗 Link ajak teman:\n{link}\n\n"
            f"💰 **Saldo token:** {balance} (senilai Rp {balance * TOKEN_VALUE_IDR:,})\n"
            f"👥 Total teman yg beli: {len(my_history)}\n"
            f"🏆 Total token diterima: {total_earned}\n\n"
            f"**REWARD PER TEMAN YG BELI:**\n"
            f"• Spesial 7 hari → 1 token\n"
            f"• Spesial 30 hari → 3 token\n"
            f"• Spesial++ 30 hari → 5 token\n"
            f"• Spesial++ 90 hari → 10 token\n"
            f"• Lifetime → 50 token\n\n"
            f"💡 1 token = Rp {TOKEN_VALUE_IDR:,} potongan harga (max 50% per transaksi)."
        )

    @bot.on(events.NewMessage(pattern=r"^/saldo$"))
    async def _saldo(event):
        uid = str(event.sender_id)
        balance = get_balance(users, uid)
        await event.respond(
            f"💳 **SALDO TOKEN KAMU**\n\n"
            f"💰 Token: **{balance}**\n"
            f"💵 Nilai: **Rp {balance * TOKEN_VALUE_IDR:,}**\n\n"
            f"Pakai saat /beli untuk potong harga (max 50%).\n"
            f"Dapat token dengan /ref (ajak teman beli premium)."
        )

    @bot.on(events.NewMessage(pattern=r"^/ref_top$"))
    async def _ref_top(event):
        if not is_owner(event.sender_id):
            return
        r = load_referrals()
        # Aggregate per referrer
        agg = {}
        for h in r["history"]:
            k = h["referrer"]
            agg[k] = agg.get(k, {"count": 0, "tokens": 0})
            agg[k]["count"] += 1
            agg[k]["tokens"] += h["reward"]
        if not agg:
            await event.respond("📭 Belum ada referral yg sukses.")
            return
        top = sorted(agg.items(), key=lambda x: x[1]["tokens"], reverse=True)[:15]
        lines = ["🏆 **TOP REFERRER**\n"]
        for i, (uid, s) in enumerate(top, 1):
            lines.append(f"{i}. `{uid}` — {s['count']} teman, {s['tokens']} token")
        await event.respond("\n".join(lines))

    log.info("V2 referral registered: /ref /undang /saldo /ref_top")


class _register:
    """Namespace holder for module-level callback references."""
    notify_referrer = None


async def notify_referrer_via_bot(referrer_uid, reward, plan, new_balance):
    """Alias — dipanggil dari activate_premium hook."""
    cb = _register.notify_referrer
    if cb:
        await cb(referrer_uid, reward, plan, new_balance)
