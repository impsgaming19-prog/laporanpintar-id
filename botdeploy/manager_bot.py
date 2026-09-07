#!/usr/bin/env python3
# =============================================================
#   BOT MANAJER (BOTFATHER) + PEMBUAT USERBOT INSTAN
#   Alur: chat bot -> "Buat Userbot" -> kirim nomor -> OTP ->
#   password 2FA (jika ada) -> userbot aktif & dikontrol via tombol.
# =============================================================
import asyncio
import logging
import re
import secrets
import signal
import traceback

from telethon import TelegramClient, events, Button
from telethon import utils as tg_utils
from telethon.tl.types import PeerChannel

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    level=logging.WARNING,
)
# Kurangi noise log: warning 'missing message mappings' dsb. (pesan tetap terkirim)
for _lg in ("telethon.client.messageparse", "telethon.network.mtprotosender"):
    try:
        logging.getLogger(_lg).setLevel(logging.ERROR)
    except Exception:
        pass
log = logging.getLogger("manager")
from telethon.sessions import StringSession
from telethon import errors as tg_errors

import config
import storage
import whitelist_storage as wl_store
from userbot import UserBot
from entities_util import serialize_entities

# ------------------------------------------------------------------
bot = TelegramClient(config.MANAGER_SESSION, config.API_ID, config.API_HASH)

users = storage.load_users()          # {uid: {session, phone, config}}
userbots = {}                          # {uid(int): UserBot}
pending = {}                           # {uid(int): {"step":.., ...}}
whitelist = wl_store.load()            # {uid_str: {nama, expired, added_at}}


def save():
    storage.save_users(users)


# ---- V2 extensions (Trial, Premium, Redeem Token, Payment) ----
v2_extensions = None
try:
    import v2_extensions as _v2ext
    v2_extensions = _v2ext
except Exception as _e:
    log.warning(f"v2_extensions unavailable: {_e}")



async def notify(uid, text):
    try:
        await bot.send_message(int(uid), text)
    except Exception:
        pass


def get_ub(uid):
    return userbots.get(int(uid))


async def _shutdown_graceful():
    """Matikan semua userbot + bot utama dengan rapi. Mengurangi error
    asyncio 'Task was destroyed' & 'database is locked' saat restart."""
    print("[OK] Shutdown: memutus semua userbot dengan aman...")
    for _ub in list(userbots.values()):
        try:
            await _ub.disconnect()
        except Exception:
            pass
    try:
        await bot.disconnect()
    except Exception:
        pass
    await asyncio.sleep(1)


# ------------------------------------------------------------------
#  MENU (tombol inline)
# ------------------------------------------------------------------
def is_owner(uid):
    """Cek apakah uid adalah owner bot."""
    return bool(config.OWNER_IDS) and (uid in config.OWNER_IDS)


def main_keyboard(uid):
    """Keyboard PERMANEN di bawah — SIMPLE style (kayak Flensiza).
    User belum ada userbot / belum ada akses → menu awal simpel.
    User punya userbot + akses aktif → menu lengkap (kontrol auto-share)."""
    # Cek: user punya userbot AND punya akses?
    has_ub = get_ub(uid) is not None
    has_access = False
    try:
        if v2_extensions:
            ok, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
            has_access = ok
    except Exception:
        pass

    if not (has_ub and has_access):
        # ===== MENU AWAL — SIMPLE =====
        kb = [
            [Button.text("🛒 Shop", resize=True), Button.text("❓ Bantuan", resize=True)],
            [Button.text("📱 Nokos", resize=True), Button.text("🔑 Token Login", resize=True)],
            [Button.text("📚 Buat Userbot", resize=True), Button.text("🔍 Cari Grup", resize=True)],
            [Button.text("⚙️ Settings", resize=True), Button.text("🎁 Trial", resize=True)],
        ]
        if is_owner(uid):
            kb.append([Button.text("👑 Panel Owner", resize=True)])
        return kb

    # ===== MENU LENGKAP — user aktif =====
    kb = [
        [Button.text("▶️ Mulai", resize=True), Button.text("⏹️ Berhenti", resize=True)],
        [Button.text("📝 Atur Pesan", resize=True), Button.text("🎯 Atur Grup", resize=True)],
        [Button.text("⏲️ Jeda", resize=True), Button.text("⏱️ Timer", resize=True)],
        [Button.text("💬 Autoreply", resize=True), Button.text("📊 Status", resize=True)],
        [Button.text("🛒 Shop", resize=True), Button.text("📱 Nokos", resize=True)],
        [Button.text("🏠 Menu", resize=True), Button.text("❓ Bantuan", resize=True)],
    ]
    if is_owner(uid):
        kb.append([Button.text("👑 Panel Owner", resize=True)])
    return kb


def shop_menu():
    """Sub-menu Shop — semua produk beli-membeli + menu Nokos."""
    return [
        [Button.inline("💎 Beli Premium (Auto-share)", b"beli_inline")],
        [Button.inline("📱 Nokos — Jual Nomor OTP", b"nk_menu")],
        [Button.inline("🛒 Beli Panel Pterodactyl", b"panel_beli")],
        [Button.inline("🖥️ Panel Saya", b"panel_saya")],
        [Button.inline("💰 Topup Saldo", b"topup")],
        [Button.inline("🔁 Auto-perpanjang Premium", b"autorenew")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def settings_menu():
    """Sub-menu Settings — info user, token login, referral, akses."""
    return [
        [Button.inline("ℹ️ Akses Saya", b"akses_inline")],
        [Button.inline("🔑 Token Login (info)", b"tokeninfo")],
        [Button.inline("👥 Referral (/ref)", b"ref_info")],
        [Button.inline("💰 Cek Saldo (/saldo)", b"saldo_info")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def main_menu(uid):
    has_ub = get_ub(uid) is not None
    has_access = False
    try:
        if v2_extensions:
            ok, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
            has_access = ok
    except Exception:
        pass
    if not (has_ub and has_access):
        kb = [
            [Button.inline("🛒 Shop", b"shop"), Button.inline("❓ Bantuan", b"bantuan")],
            [Button.inline("📱 Nokos", b"nk_menu"), Button.inline("🔑 Token Login", b"tokeninfo")],
            [Button.inline("📚 Buat Userbot", b"buat"), Button.inline("🔍 Cari Grup", b"carigrup_info")],
            [Button.inline("⚙️ Settings", b"settings"), Button.inline("🎁 Trial 24 Jam", b"trial_inline")],
        ]
    else:
        kb = [
            [Button.inline("📝 Atur Pesan", b"pesan"), Button.inline("🎯 Atur Grup", b"grup")],
            [Button.inline("⏲️ Jeda", b"jeda"), Button.inline("⏱️ Timer", b"timer")],
            [Button.inline("💬 Autoreply", b"autoreply"), Button.inline("📊 Status", b"status")],
            [Button.inline("▶️ Mulai", b"start"), Button.inline("⏹️ Berhenti", b"stop")],
            [Button.inline("🛒 Shop", b"shop"), Button.inline("📱 Nokos", b"nk_menu")],
            [Button.inline("⚙️ Settings", b"settings"), Button.inline("❓ Bantuan", b"bantuan")],
        ]
    # Owner: tombol panel owner juga tersedia di menu inline
    if is_owner(uid):
        kb.append([Button.inline("👑 Panel Owner", b"owner_panel")])
    return kb


def menu_header(uid):
    """Header ringkasan status untuk menu utama — rapi & informatif."""
    ub = get_ub(uid)
    lines = ["📋 **MENU UTAMA**", "━━━━━━━━━━━━━━━━━━━━"]
    if ub:
        cfg = users.get(str(uid), {}).get("config", {})
        status = "🟢 **RUNNING**" if cfg.get("running") else "🔴 **STOP**"
        jeda = ub.fmt_jeda()
        n_pesan = len(cfg.get("pesan_list", []))
        if cfg.get("target_mode") != "pilih":
            target = "🌐 Semua grup"
        else:
            target = f"🎯 {len(cfg.get('target_list', []))} grup"
        lines.append(f"• Status: {status}  |  Jeda: `{jeda}`")
        lines.append(f"• Pesan: **{n_pesan}**  |  Target: {target}")
        lines.append("")
    lines.append("Silakan pilih menu di bawah 👇")
    return "\n".join(lines)


def pesan_menu():
    return [
        [Button.inline("✍️ Set / Ganti Pesan", b"settext")],
        [Button.inline("➕ Tambah Pesan (rotasi)", b"addtext")],
        [Button.inline("📌 Ambil dari Saved Messages", b"setsaved")],
        [Button.inline("📋 List Pesan", b"listpesan"), Button.inline("🗑️ Hapus Pesan", b"hapuspesan")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def grup_menu(cfg):
    mode = cfg.get("target_mode", "semua")
    tanda = "✅ " if mode != "pilih" else ""
    tanda_p = "✅ " if mode == "pilih" else ""
    return [
        [Button.inline(f"{tanda}🌐 Simpan SEMUA Grup (Auto)", b"target_semua")],
        [Button.inline(f"{tanda_p}✍️ Isi Grup Manual (ID / Link)", b"target_add")],
        [Button.inline("🗑️ Hapus Grup (dari daftar nomor)", b"bl_pick")],
        [Button.inline("📋 List Grup", b"target_list"), Button.inline("🧹 Kosongkan", b"target_clear")],
        [Button.inline("🔢 Batasi Jumlah", b"target_limit"), Button.inline("🔍 Cari Grup", b"carigrup")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def jeda_menu():
    return [
        [Button.inline("⏱️ Per GRUP (detik)", b"jeda_grup")],
        [Button.inline("🕒 Per SEMUA grup (menit)", b"jeda_semua")],
        [Button.inline("🛡️ Jeda AMAN (otomatis, mirip manusia)", b"jeda_aman")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def autoreply_menu():
    return [
        [Button.inline("➕ Tambah", b"addreply"), Button.inline("📋 List", b"listreply")],
        [Button.inline("🗑️ Hapus", b"delreply")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def blacklist_menu():
    return [
        [Button.inline("🗑️ Pilih Grup utk Hapus (daftar)", b"bl_pick")],
        [Button.inline("➕ Skip via kata kunci", b"skip"), Button.inline("📋 List", b"listbl")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def owner_panel_menu():
    """Panel Owner — tombol berkelompok 2 kolom, rapi & lengkap."""
    return [
        [Button.inline("🎁 Kasih Akses User", b"owner_akseskan_help"),
         Button.inline("🔐 Kelola Izin", b"owner_listizin")],
        [Button.inline("💰 Tambah Saldo", b"owner_addsaldo_help")],
        [Button.inline("📱 Nokos — Cek & Set Harga", b"nk_owner")],
        [Button.inline("📋 Daftar Userbot", b"owner_listuser"),
         Button.inline("🖥️ Bikin Panel Gratis", b"owner_makepanel")],
        [Button.inline("🎫 Generate Token", b"owner_gentoken_help"),
         Button.inline("📊 Statistik Bot", b"owner_stats")],
        [Button.inline("📢 Broadcast", b"owner_broadcast"),
         Button.inline("🔄 Restart Userbot", b"owner_restart")],
        [Button.inline("⭐ Kelola Testimoni", b"owner_testi_help"),
         Button.inline("🏆 Top Referrer", b"owner_reftop_help")],
        [Button.inline("🗑️ Hapus Userbot", b"owner_deluser")],
        [Button.inline("⬅️ Kembali", b"menu")],
    ]


def welcome_text(nama):
    # Ambil random testimoni (kalau ada yang di-approve)
    testi_block = ""
    try:
        import v2_scheduler
        t = v2_scheduler.get_random_approved_testimoni()
        if t:
            testi_block = (
                "\n\n💬 **Testimoni User Premium:**\n"
                f"{v2_scheduler.format_testimoni_short(t)}\n"
            )
    except Exception:
        pass
    return (
        f"👋 Hai, **{nama}**!\n\n"
        f"Selamat datang di **{config.BRAND_NAME}**.\n"
        "Saya bisa membuat **Userbot Auto Share** secara instan.\n\n"
        f"👑 Owner: {config.OWNER_USERNAME}\n"
        f"📢 Channel: {config.CHANNEL_USERNAME}\n\n"
        "🎁 Coba gratis: `/trial` (24 jam)\n"
        "💎 Beli premium: `/beli`\n"
        "🎫 Punya token? `/redeem TOKEN`\n"
        "📖 Bantuan: `/help`\n"
        "⭐ Kasih testimoni: `/rate 5 pesan kamu`"
        + testi_block +
        "\nTekan tombol **📚 Buat Userbot** untuk mulai."
    )


BANTUAN = (
    "❓ **BANTUAN**\n"
    "━━━━━━━━━━━━━━━━━━━━\n"
    "1️⃣ Tekan **Buat Userbot** → kirim nomor HP (contoh `+628123456789`).\n"
    "2️⃣ Bot mengirim **kode OTP** ke Telegram-mu. Balas kodenya "
    "(ketik pakai spasi biar aman, contoh `1 2 3 4 5`).\n"
    "3️⃣ Jika akun punya **verifikasi 2 langkah**, kirim passwordnya.\n"
    "4️⃣ Userbot aktif! Atur pesan & jeda lalu tekan **Mulai**.\n\n"
    "**Pesan promo:**\n"
    "• `Set Teks` / `Tambah Teks` → kirim teks promo.\n"
    "• `Set dari Saved` → ambil pesan terakhir di Saved Messages (bisa media).\n\n"
    "**Jeda anti-banned:**\n"
    "• Per SEMUA grup (menit) → grup sedikit (<30), aman 20 menit ke atas.\n"
    "• Per GRUP (detik) → grup banyak (50+), contoh 30 detik.\n\n"
    "⚠️ Gunakan jeda wajar agar akun tidak terbanned!"
)


# ------------------------------------------------------------------
#  /start
# ------------------------------------------------------------------
def cek_akses(uid: int) -> tuple[bool, str]:
    """Cek apakah uid boleh akses bot. Return (boleh, alasan).
    V2: cek trial_ends_at & premium_ends_at + fallback whitelist lama.
    """
    # Owner selalu boleh
    if uid in config.OWNER_IDS:
        return True, "owner"
    if v2_extensions:
        has, source, _exp = v2_extensions.compute_access(users, str(uid), whitelist)
        if has:
            return True, source
        # cek apakah trial pernah dipakai untuk pesan tolak
        u = users.get(str(uid), {})
        if u.get("config", {}).get("trial_used"):
            return False, "no_access"
        return False, "no_access_trial_available"
    return wl_store.is_allowed(uid, whitelist)


async def tolak_akses(event, alasan: str):
    if alasan == "expired":
        msg = (
            "😔 **Ups! Langganan Premium Kamu sudah habis.**\n\n"
            "Kamu bukan akun premium aktif. Jika ingin akses fitur ini kembali, "
            "silakan **perpanjang langganan** ya:\n\n"
            "💎 Beli premium: `/beli` (mulai Rp 10rb)\n"
            "🎫 Punya token? `/redeem TKN-XXXX-XXXX`\n\n"
            f"👑 Info & bantuan hubungi owner: {config.OWNER_USERNAME}"
        )
    else:
        msg = (
            "👋 **Halo! Kamu belum jadi akun premium.**\n\n"
            "Jika ingin akses fitur ini, silakan **beli langganan** dulu ya. "
            "Fiturnya lengkap: auto-share 24 jam, autoreply, timer, dll — "
            "cocok banget buat promosi bisnis kamu 🚀\n\n"
            "💎 Beli premium: `/beli` (Rp 10rb / 30rb / 50rb / 120rb / Lifetime)\n"
            "🎁 Coba gratis 24 jam: `/trial` (sekali per akun)\n"
            "🎫 Punya token? `/redeem TKN-XXXX-XXXX`\n\n"
            f"👑 Info & bantuan hubungi owner: {config.OWNER_USERNAME}"
        )
    await event.respond(msg, buttons=main_keyboard(event.sender_id))


# ------------------------------------------------------------------
#  /start
# ------------------------------------------------------------------
@bot.on(events.NewMessage(pattern=r"^/start(?:\s+(\S+))?$"))
async def _start_cmd(event):
    uid = event.sender_id
    ref_arg = (event.pattern_match.group(1) or "").strip().upper() if event.pattern_match.group(1) else ""
    # V2: semua user boleh /start dan lihat welcome.
    sender = await event.get_sender()
    nama = sender.first_name or "User"
    storage.get_user(users, uid)
    # Handle referral param
    ref_msg = ""
    if ref_arg.startswith("REF-"):
        try:
            import v2_referral
            ok, info = v2_referral.track_pending_referral(str(uid), ref_arg)
            if ok:
                ref_msg = f"\n\n🎁 Kamu terhubung ke referral **{ref_arg}**. Kalau kamu beli premium, referrer dapat bonus token!"
            else:
                # sudah tercatat / self / invalid — silent
                ref_msg = ""
        except Exception:
            pass
    save()
    await event.respond(welcome_text(nama) + ref_msg, buttons=main_keyboard(uid))


# ------------------------------------------------------------------
#  CALLBACK TOMBOL
# ------------------------------------------------------------------
@bot.on(events.CallbackQuery)
async def _callback(event):
    try:
        await _callback_impl(event)
    except tg_errors.MessageNotModifiedError:
        try:
            await event.answer()   # isi sama = abaikan, jangan tampilkan error
        except Exception:
            pass
    except Exception as e:
        traceback.print_exc()
        try:
            await event.answer(f"ERROR: {e}"[:190], alert=True)
        except Exception:
            pass


async def _callback_impl(event):
    uid = event.sender_id
    data = event.data.decode()
    ub = get_ub(uid)
    log.info(f"[CB] uid={uid} data={data}")

    # V2: cek akses HANYA untuk aksi yang perlu akses aktif
    ACCESS_REQUIRED_CB = {"buat", "start"}
    if data in ACCESS_REQUIRED_CB:
        boleh, alasan = cek_akses(uid)
        if not boleh:
            await tolak_akses(event, alasan)
            return

    # V2: aksi yang butuh userbot dulu — kasih pesan alur jelas
    butuh_ub = {"pesan", "grup", "jeda", "timer", "autoreply", "status", "start", "stop"}
    if data in butuh_ub and not ub:
        # Cek apakah user sudah punya akses
        has_access = False
        if v2_extensions:
            has_access, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
        if not has_access:
            await event.answer("Klaim trial atau beli premium dulu — lihat pesan di bawah.", alert=False)
            await event.respond(
                "🔒 **FITUR INI TERKUNCI**\n\n"
                "Ikuti alur ini biar semua fitur bisa dipakai:\n\n"
                "1️⃣ Klaim **🎁 Trial** (gratis 24 jam) atau **💎 Beli Premium**\n"
                "2️⃣ **📚 Buat Userbot** (nomor HP + OTP + 2FA)\n"
                "3️⃣ Bot kirim **🔑 Token Login backup**\n"
                "4️⃣ Semua fitur unlock ✅",
                buttons=main_keyboard(uid),
            )
        else:
            await event.answer("Buat userbot dulu.", alert=True)
            await event.respond(
                "📚 **BUAT USERBOT DULU**\n\nKetuk **📚 Buat Userbot** untuk mulai (nomor HP + OTP + 2FA).",
                buttons=main_keyboard(uid),
            )
        return

    # ---- perlu userbot dulu ----
    butuh_ub = {
        "settext", "addtext", "setsaved", "listpesan", "hapuspesan", "jeda",
        "jeda_semua", "jeda_grup", "jeda_aman", "timer", "start", "stop", "status",
        "carigrup", "autoreply", "addreply", "listreply", "blacklist", "skip", "listbl",
        "bl_pick", "target", "target_semua", "target_pilih", "target_add", "target_pick",
        "target_list", "target_hapus", "target_limit", "target_clear",
    }
    if data in butuh_ub and not ub:
        await event.answer("Buat userbot dulu (📚 Buat Userbot).", alert=True)
        return
    if data == "menu":
        await event.edit(menu_header(uid), buttons=main_menu(uid))

    elif data == "panel_beli":
        try:
            import v2_panel
            await event.edit(
                "🛒 **CREATE PANEL — Rp 15.000**\n\n"
                "Panel hosting bot pribadi, siap 24/7.\n"
                "⚖️ Max **3 panel** per user.\n\n"
                "Pilih tipe panel (🐍 Python / 📦 Node.js) lalu RAM:",
                buttons=v2_panel.panel_beli_menu(),
            )
        except Exception as e:
            await event.edit(f"❌ Panel service error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "panel_saya":
        try:
            import v2_panel
            panels = v2_panel.get_user_panels(uid)
        except Exception:
            panels = []
        if not panels:
            await event.edit(
                "🖥️ **PANEL SAYA**\n\nBelum ada panel aktif.\n"
                "🛒 Order lewat **🛒 Beli Panel** — otomatis siap dalam <1 menit setelah bayar.",
                buttons=[[Button.inline("🛒 Beli Panel", b"panel_beli")],
                         [Button.inline("⬅️ Kembali", b"menu")]],
            )
        else:
            aktif = [p for p in panels if p.get("status") != "deleted"]
            n_del = len(panels) - len(aktif)
            lines = [f"\U0001F5A5\uFE0F **PANEL SAYA** ({len(aktif)} aktif)\n"]
            if n_del:
                lines.append(f"\U0001F5D1\uFE0F {n_del} panel lama sudah terhapus di server (tidak aktif).")
            from datetime import datetime as _dt
            for i, p in enumerate(aktif, 1):
                stat = p.get("status", "active")
                stat_icon = {"active": "🟢 Aktif", "suspended": "⛔ Suspended", "deleted": "🗑️ Deleted"}.get(stat, stat)
                exp_str = p.get("expires_at", "-")
                sisa = ""
                try:
                    exp_dt = _dt.fromisoformat(exp_str)
                    days = (exp_dt - _dt.now()).days
                    sisa = f" ({days}h lagi)" if days >= 0 else f" ({-days}h lewat)"
                except Exception:
                    pass
                lines.append(
                    f"**{i}. {p.get('ptype_label') or p.get('package_label', 'Panel')}{(' · RAM ' + str(p['ram_label'])) if p.get('ram_label') else ''}** — {stat_icon}\n"
                    f"🔗 {p['panel_url']}\n"
                    f"👤 `{p['username']}` · 🔑 `{p['password']}`\n"
                    f"📅 Dibuat: {p.get('created_at', '-')[:10]}\n"
                    f"⏰ Expired: {exp_str[:10]}{sisa}\n")
            await event.edit("\n".join(lines),
                             buttons=[[Button.inline("🗑️ Hapus Panel", b"panel_hapus")],
                                      [Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "panel_hapus":
        try:
            import v2_panel as _vp
            _panels = [pp for pp in _vp.get_user_panels(uid) if pp.get("status") != "deleted"]
        except Exception:
            _panels = []
        if not _panels:
            await event.edit("🖥️ Tidak ada panel aktif untuk dihapus.",
                             buttons=[[Button.inline("⬅️ Kembali", b"panel_saya")]])
            return
        _plines = ["🗑️ **HAPUS PANEL**\nPilih panel yang mau dihapus permanen:\n"]
        _pkb = []
        for _i, _pp in enumerate(_panels, 1):
            _plabel = _pp.get("ptype_label") or _pp.get("package_label", "Panel")
            _pram = f" · RAM {_pp['ram_label']}" if _pp.get("ram_label") else ""
            _plines.append(f"**{_i}. {_plabel}{_pram}**\n🔗 {_pp.get('panel_url', '')}\n⏰ Expired: {(_pp.get('expires_at', '-') or '-')[:10]}")
            _pkb.append([Button.inline(f"🗑️ Hapus {_i}. {_plabel}", f"phapus:{_pp.get('server_id')}".encode())])
        _pkb.append([Button.inline("⬅️ Kembali", b"panel_saya")])
        await event.edit("\n".join(_plines), buttons=_pkb)

    elif data.startswith("phapus:"):
        _sid = data.split(":", 1)[1]
        _plabel = _sid
        try:
            import v2_panel as _vp
            for _pp in _vp.get_user_panels(uid):
                if str(_pp.get("server_id")) == str(_sid):
                    _plabel = _pp.get("ptype_label") or _pp.get("package_label", "Panel")
                    break
        except Exception:
            pass
        await event.edit(
            f"⚠️ **YAKIN MAU HAPUS PANEL?**\n\n"
            f"📦 {_plabel} (`{_sid}`)\n\n"
            "Server, data & konfigurasi di Pterodactyl akan **dihapus permanen**. Tidak bisa dibatalkan.",
            buttons=[[Button.inline("✅ Ya, Hapus", f"phapus_yes:{_sid}".encode())],
                     [Button.inline("⬅️ Batal", b"panel_hapus")]],
        )

    elif data.startswith("phapus_yes:"):
        _sid = data.split(":", 1)[1]
        try:
            import ptero_service as _ps
            _ok, _err = await _ps.delete_server(_sid)
        except Exception as _e:
            _ok, _err = False, str(_e)
        if not _ok:
            if "404" in str(_err):
                # Server sudah tidak ada di panel — tinggal bersihkan data lokal
                try:
                    import v2_panel as _vp
                    _vp.delete_user_panel(uid, _sid)
                except Exception:
                    pass
                await event.edit("✅ **Panel dihapus.**\n\nServer sudah tidak ada di panel (mungkin sudah terhapus sebelumnya).",
                                 buttons=[[Button.inline("🖥️ Panel Saya", b"panel_saya")],
                                          [Button.inline("⬅️ Menu", b"menu")]])
                return
            await event.edit(f"❌ Gagal hapus server: {_err}\n\nCoba lagi atau hubungi owner.",
                             buttons=[[Button.inline("⬅️ Kembali", b"panel_saya")]])
            return
        try:
            import v2_panel as _vp
            _vp.delete_user_panel(uid, _sid)
        except Exception:
            pass
        await event.edit("✅ **Panel berhasil DIHAPUS PERMANEN.**\n\nServer di Pterodactyl sudah dihapus.",
                         buttons=[[Button.inline("🖥️ Panel Saya", b"panel_saya")],
                                  [Button.inline("⬅️ Menu", b"menu")]])

    elif data == "topup":
        try:
            import v2_panel
            await event.edit(
                "💰 **TOPUP SALDO**\n\n"
                "Isi saldo → buat beli panel / premium / apa pun.\n"
                f"💎 Bonus: topup ≥ Rp 100rb dapat diskon **{v2_panel.DISCOUNT_PERCENT}%** untuk pembelian.\n\n"
                "Pilih nominal:",
                buttons=v2_panel.topup_menu(),
            )
        except Exception as e:
            await event.edit(f"❌ Topup error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "topup_custom":
        pending[uid] = {"step": "topup_custom"}
        await event.edit(
            "✍️ **TOPUP NOMINAL BEBAS**\n\n"
            "Kirim nominal (angka Rupiah).\n"
            "Minimal: **Rp 1.000**\n\n"
            "Contoh: `15000` → Rp 15.000\n"
            "`100000` → Rp 100.000\n\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Batal", b"menu")]],
        )

    elif data == "bantuan":
        await event.edit(BANTUAN, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "shop":
        await event.edit(
            "🛒 **SHOP KAKOSTORE**\n\n"
            "Pilih produk yang mau kamu beli:\n\n"
            "💎 **Premium** — unlock auto-share tanpa batas\n"
            "🛒 **Panel Pterodactyl** — hosting bot pribadi 24/7\n"
            "💰 **Topup Saldo** — isi saldo, beli apa pun cepat\n"
            "🔁 **Auto-perpanjang** — premium lanjut otomatis pakai saldo",
            buttons=shop_menu(),
        )

    elif data == "autorenew":
        cfg = users.get(str(uid), {}).get("config", {}) or {}
        on = bool(cfg.get("auto_renew"))
        plan_key = cfg.get("auto_renew_plan")
        months = int(cfg.get("auto_renew_months") or 1)
        label = "—"
        try:
            import v2_extensions as _v2
            if plan_key and plan_key in _v2.PLANS:
                label = f"{_v2.PLANS[plan_key]['label']} — {months} bln"
        except Exception:
            pass
        status = "🟢 AKTIF" if on else "🔴 NONAKTIF"
        await event.edit(
            f"🔁 **AUTO-PERPANJANG PREMIUM**\n\n"
            f"Status: **{status}**\n"
            f"Paket terakhir: {label}\n\n"
            f"Fitur ini otomatis memotong **saldo** kamu untuk memperpanjang "
            f"premium sebelum habis (H-3), jadi auto-share kamu gak pernah putus.\n\n"
            f"✅ Aman — kalau saldo kurang, bot cuma kasih tau, gak ada "
            f"potongan diam-diam.\n\n"
            f"Pilih status:",
            buttons=[
                [Button.inline("✅ Aktifkan", b"autorenew_on")],
                [Button.inline("❌ Matikan", b"autorenew_off")],
                [Button.inline("⬅️ Kembali", b"shop")],
            ],
        )

    elif data == "autorenew_on":
        u = users.setdefault(str(uid), {}).setdefault("config", {})
        u["auto_renew"] = True
        save()
        await event.edit(
            "✅ **AUTO-PERPANJANG AKTIF**\n\n"
            "Sebelum premium habis, bot otomatis potong saldo & perpanjang.\n"
            "Pastikan saldo kamu cukup ya 👍",
            buttons=[[Button.inline("⬅️ Kembali", b"autorenew")]],
        )

    elif data == "autorenew_off":
        u = users.setdefault(str(uid), {}).setdefault("config", {})
        u["auto_renew"] = False
        save()
        await event.edit(
            "❌ **AUTO-PERPANJANG DIMATIKAN**\n\n"
            "Premium nanti harus diperpanjang manual. Ingat reminder H-3 ya!",
            buttons=[[Button.inline("⬅️ Kembali", b"autorenew")]],
        )

    elif data == "settings":
        await event.edit(
            "⚙️ **SETTINGS**\n\n"
            "Info akun, akses, token login, referral & saldo kamu.",
            buttons=settings_menu(),
        )

    elif data == "carigrup_info":
        await event.edit(
            "🔍 **CARI GRUP**\n\n"
            "Fitur ini butuh userbot aktif. Buat dulu userbot kamu lewat **📚 Buat Userbot**.\n\n"
            "Setelah userbot aktif, tombol **🔍 Cari Grup** akan mencari grup di akun kamu berdasarkan kata kunci.",
            buttons=[[Button.inline("📚 Buat Userbot", b"buat")],
                     [Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "trial_inline":
        # Alihkan ke handler label "🎁 Trial 24 Jam"
        await event.answer()
        await handle_keyboard(event, uid, "🎁 Trial 24 Jam")

    elif data == "beli_inline":
        # Tampilkan menu premium (Spesial 25k / Spesial++ 40k per bulan + durasi 1-12)
        try:
            import v2_extensions as _v2
            await _v2.show_beli_menu(event, is_edit=True)
        except Exception as e:
            await event.edit(f"❌ Error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "tokeninfo":
        await event.edit(
            "🔑 **TOKEN LOGIN**\n\n"
            "Token Login = kode backup untuk **restore akses & premium** kalau:\n"
            "• Kamu logout dari bot\n"
            "• Ganti akun / device Telegram\n\n"
            "**Cara dapat:**\n"
            "🎁 Klaim `/trial` — auto dapat token\n"
            "💎 Bayar premium — auto dapat token setelah sukses\n\n"
            "**Perintah:**\n"
            "• `/kode` — lihat token kamu\n"
            "• `/restore UBM-XXXX-XXXX-XXXX` — restore akses dari akun baru",
            buttons=[[Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "akses_inline":
        try:
            import v2_extensions as _v2
            has, source, exp = _v2.compute_access(users, str(uid), whitelist)
            if not has:
                trial_used = users.get(str(uid), {}).get("config", {}).get("trial_used", False)
                msg = "🚫 **BELUM PUNYA AKSES**\n\n"
                if not trial_used:
                    msg += "🎁 Klaim trial 24 jam gratis dengan `/trial`\n"
                msg += "💎 Atau beli premium via **🛒 Shop**"
                await event.edit(msg, buttons=[[Button.inline("🛒 Shop", b"shop")],
                                                [Button.inline("⬅️ Kembali", b"menu")]])
                return
            cfg = users.get(str(uid), {}).get("config", {})
            text = (
                f"✅ **AKSES KAMU**\n\n"
                f"🏷️ Tier: **{cfg.get('tier', source)}**\n"
                f"📌 Sumber: `{source}`\n"
                f"⏰ Berakhir: {_v2.fmt_time(exp)}\n"
                f"⏳ Sisa: {_v2.fmt_remaining(exp) if exp else '♾️ selamanya'}"
            )
            await event.edit(text, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])
        except Exception as e:
            await event.edit(f"❌ Error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "ref_info":
        await event.edit(
            "👥 **REFERRAL / UNDANG TEMAN**\n\n"
            "Ajak teman & dapat **token** tiap mereka beli premium.\n\n"
            "**Perintah:**\n"
            "• `/ref` atau `/undang` — dapetin link referral kamu\n"
            "• `/saldo` — cek saldo token\n"
            "• `/ref_top` — lihat leaderboard\n\n"
            "1 token = Rp 1.000 diskon (max 50% harga premium).",
            buttons=[[Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "saldo_info":
        try:
            import v2_panel
            rec = v2_panel.get_saldo(uid)
        except Exception:
            rec = {"balance": 0, "is_reseller": False, "deposit_total": 0}
        await event.edit(
            f"💰 **SALDO KAMU**\n\n"
            f"Balance: **Rp {rec.get('balance', 0):,}**\n"
            f"Total deposit: Rp {rec.get('deposit_total', 0):,}",
            buttons=[[Button.inline("💰 Topup", b"topup")],
                     [Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "buat":
        if ub:
            await event.answer("Userbot sudah ada.", alert=True)
            return
        pending[uid] = {"step": "phone"}
        await event.edit(
            "📱 Kirim **nomor HP** akun yang mau dijadikan userbot.\n"
            "Format: `+628xxxxxxxxxx`\n\n"
            "(Ketik /cancel untuk batal)",
            buttons=[[Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "settext":
        pending[uid] = {"step": "set_text"}
        if not _boleh_bagikan(uid):
            await event.edit(
                "✍️ Kirim **teks promo** sekarang (mengganti semua):\n"
                "• **Ketik / paste teks** (bold/italic/link/quote tetap terjaga).\n"
                "• ⛔ Forward / Bagikan **otomatis ditolak** di paket Spesial (biar watermark nempel)."
            )
        else:
            await event.edit(
                "✍️ Kirim **pesan promo** sekarang (mengganti semua):\n"
                "• **Forward** pesan dari channelmu → tampil PERSIS (custom emoji utuh), atau\n"
                "• Ketik/paste teks (bold/italic/link/quote tetap terjaga)."
            )

    elif data == "addtext":
        pending[uid] = {"step": "add_text"}
        if not _boleh_bagikan(uid):
            await event.edit(
                "➕ Kirim **teks promo** untuk ditambahkan (rotasi):\n"
                "• **Ketik / paste teks** — ⛔ Forward / Bagikan otomatis ditolak di paket Spesial."
            )
        else:
            await event.edit(
                "➕ Kirim **pesan promo** untuk ditambahkan (rotasi):\n"
                "• **Forward** dari channel (custom emoji utuh), atau ketik teks."
            )

    elif data == "setsaved":
        if not _boleh_bagikan(uid):
            await event.edit(TEXT_SPECIAL_BAGIKAN_BLOCK,
                             buttons=[[Button.inline("✍️ Set Teks", b"settext")],
                                      [Button.inline("⬅️ Kembali", b"menu")]])
            return
        await event.answer("Mengambil pesan dari Saved Messages...")
        ok = await set_dari_saved(uid)
        if ok:
            await event.edit("📌 Pesan diambil dari Saved Messages (pesan terakhir).",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])
        else:
            await event.edit("❌ Gagal / Saved Messages kosong.",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "listpesan":
        cfg = users[str(uid)]["config"]
        lst = cfg.get("pesan_list", [])
        if not lst:
            teks = "📭 Belum ada pesan."
        else:
            baris = [f"📚 **DAFTAR PESAN ({len(lst)})**"]
            for i, p in enumerate(lst, 1):
                if p.get("type") == "text":
                    baris.append(f"{i}. [teks] {p['text'][:50]}")
                else:
                    baris.append(f"{i}. [forward] dari Saved")
            teks = "\n".join(baris)
        await event.edit(teks, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "hapuspesan":
        pending[uid] = {"step": "hapus_pesan"}
        await event.edit("🗑️ Kirim **nomor** pesan yang mau dihapus (lihat List Pesan).")

    elif data == "jeda":
        cfg = users[str(uid)]["config"]
        await event.edit(
            "⏲️ **PILIH TIPE JEDA**\n\n"
            "📚 Saran:\n"
            "• **Per GRUP (detik)**: grup banyak (50+), contoh 30 detik.\n"
            "• **Per SEMUA grup (menit)**: grup sedikit (<30), aman 20 menit ke atas.\n"
            "• **🛡️ Jeda AMAN**: otomatis acak seperti manusia (kadang 30 dtk, kadang "
            "1-2 mnt), rehat acak tiap putaran. Paling aman untuk 24 jam biar tak "
            "terdeteksi bot.\n\n"
            f"Aktif: **{ub.fmt_jeda()}**",
            buttons=jeda_menu(),
        )

    elif data == "jeda_aman":
        cfg = users[str(uid)]["config"]
        cfg["jeda_tipe"] = "aman"
        save()
        await event.edit(
            "🛡️ **Jeda AMAN (RANDOM) diaktifkan!**\n\n"
            "Pola jeda dibuat **acak total (rendem)** mirip manusia:\n"
            "• Sering **cepat** (~3-12 dtk) → share beberapa grup beruntun\n"
            "• Kadang **sedang** (~20-60 dtk)\n"
            "• Sesekali **rehat lama** (~1,5-4 menit, seolah lagi buka HP)\n"
            "• Tiap putaran selesai: rehat acak ~1-5 menit\n\n"
            "Karena polanya tidak tetap, **tidak terlihat seperti bot** — aman "
            "dipakai 24 jam. 👍",
            buttons=[[Button.inline("⬅️ Kembali", b"menu")]],
        )

    elif data == "jeda_semua":
        pending[uid] = {"step": "jeda_semua"}
        await event.edit("Kirim jumlah **menit** jeda per putaran. Contoh: `20`")

    elif data == "jeda_grup":
        pending[uid] = {"step": "jeda_grup"}
        await event.edit("Kirim jumlah **detik** jeda antar grup. Contoh: `30`")

    elif data == "timer":
        await event.edit(
            "⏱️ **TIMER OTOMATIS**\nKirim jam ON & OFF. Contoh: `08:00 23:00`\n"
            "Ketik `off` untuk mematikan timer.",
        )
        pending[uid] = {"step": "timer"}

    elif data == "autoreply":
        await event.edit("💬 **AUTOREPLY**", buttons=autoreply_menu())

    elif data == "delreply":
        cfg = users[str(uid)]["config"]
        lst = cfg.get("replies", [])
        if not lst:
            await event.edit("📭 Belum ada autoreply untuk dihapus.", buttons=autoreply_menu())
        else:
            rows = []
            for i, r in enumerate(lst):
                trig = r.get("trigger", "?") if isinstance(r, dict) else str(r)
                rows.append([Button.inline(f"🗑️ {i+1}. {trig[:25]}", f"delr_{i}".encode())])
            rows.append([Button.inline("⬅️ Kembali", b"autoreply")])
            await event.edit("🗑️ **Pilih autoreply yang mau dihapus:**", buttons=rows)
    elif data.startswith("delr_"):
        cfg = users[str(uid)]["config"]
        lst = cfg.setdefault("replies", [])
        idx = int(data.split("_", 1)[1])
        if 0 <= idx < len(lst):
            lst.pop(idx)
            save()
        if not lst:
            await event.edit("✅ Terhapus. Autoreply sudah kosong.", buttons=autoreply_menu())
        else:
            rows = []
            for i, r in enumerate(lst):
                trig = r.get("trigger", "?") if isinstance(r, dict) else str(r)
                rows.append([Button.inline(f"🗑️ {i+1}. {trig[:25]}", f"delr_{i}".encode())])
            rows.append([Button.inline("⬅️ Kembali", b"autoreply")])
            await event.edit("✅ Terhapus. Pilih lagi atau Kembali:", buttons=rows)
    elif data == "addreply":
        pending[uid] = {"step": "addreply"}
        await event.edit("➕ Kirim format: `pemicu | balasan`\nContoh: `harga | Cek pinned ya kak`")

    elif data == "listreply":
        cfg = users[str(uid)]["config"]
        lst = cfg.get("replies", [])
        teks = "📭 Belum ada autoreply." if not lst else "\n".join(
            [f"{i}. `{r['trigger']}` → {r['response']}" for i, r in enumerate(lst, 1)]
        )
        await event.edit(teks, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "blacklist":
        await event.edit("⛔ **BLACKLIST GRUP**", buttons=blacklist_menu())

    elif data == "skip":
        pending[uid] = {"step": "skip"}
        await event.edit("➕ Kirim **kata kunci** nama grup yang mau di-skip. Contoh: `jualan`")

    elif data == "bl_pick":
        await kirim_daftar_grup(event, uid, "bl_pick",
                                "🗑️ Pilihlah Grup yang ingin anda HAPUS dari share!")

    elif data == "listbl":
        cfg = users[str(uid)]["config"]
        info = cfg.get("blacklist_info", [])
        teks = "✅ Blacklist kosong." if not info else "\n".join(
            [f"{i}. {x['name']}" for i, x in enumerate(info, 1)]
        )
        await event.edit(teks, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "carigrup":
        pending[uid] = {"step": "carigrup"}
        await event.edit("🔍 Kirim **kata kunci** nama grup yang mau dicari.")

    # ---------------- ATUR PESAN / GRUP (submenu) ----------------
    elif data == "pesan":
        await event.edit(
            "📝 **ATUR PESAN**\nPilih aksi:",
            buttons=pesan_menu(),
        )

    elif data == "grup":
        cfg = users[str(uid)]["config"]
        mode = "Semua grup (auto)" if cfg.get("target_mode") != "pilih" else f"Pilih ({len(cfg.get('target_list', []))} grup)"
        lim = cfg.get("limit", 0) or 0
        limtxt = f"{lim} grup/putaran" if lim > 0 else "Tanpa batas"
        await event.edit(
            "🎯 **ATUR GRUP**\n\n"
            f"• Mode aktif: **{mode}**\n"
            f"• Limit: **{limtxt}**\n\n"
            "🌐 **Pakai SEMUA Grup** = otomatis kirim ke semua grup di akun (tak perlu simpan satu-satu).\n"
            "🔢 **Pilih dari Daftar** = pilih grup lewat nomor.\n"
            "➕ **Tambah via Link** = masukkan link grup.\n"
            "🗑️ **Hapus Grup dari Share** = pilih nomor grup yang tak mau dikirimi.",
            buttons=grup_menu(cfg),
        )

    # ---------------- TARGET GRUP ----------------
    elif data == "target":
        cfg = users[str(uid)]["config"]
        await event.edit("🎯 **ATUR GRUP**", buttons=grup_menu(cfg))

    elif data == "target_semua":
        cfg = users[str(uid)]["config"]
        cfg["target_mode"] = "semua"
        save()
        await event.edit(
            "🌐 **Siap!** Semua grup di akun otomatis dipakai untuk share.\n"
            "Tidak perlu simpan satu-satu. 👍",
            buttons=grup_menu(cfg),
        )

    elif data == "target_pilih":
        cfg = users[str(uid)]["config"]
        cfg["target_mode"] = "pilih"
        save()
        await event.edit(
            f"🎯 Mode: **Pilih grup** ({len(cfg.get('target_list', []))} grup).",
            buttons=grup_menu(cfg),
        )

    elif data == "target_add":
        pending[uid] = {"step": "add_link"}
        await event.edit(
            "✍️ Kirim **ID grup** atau **link/username** grup (userbot akan join & jadikan target).\n"
            "Contoh:\n`-1001234567890`  (ID grup)\n`@namagrup`\n`https://t.me/namagrup`\n"
            "`https://t.me/+kodeInvite`\n\nBisa banyak sekaligus (satu per baris)."
        )

    elif data == "target_pick":
        await kirim_daftar_grup(event, uid, "target_pick",
                                "🎯 Pilihlah Grup untuk dijadikan TARGET share!")

    elif data == "target_clear":
        cfg = users[str(uid)]["config"]
        cfg["target_list"] = []
        cfg["target_mode"] = "semua"
        save()
        await event.edit(
            "🧹 **Target dikosongkan.**\nMode kembali ke **Semua Grup (auto)**.\n"
            "Silakan atur ulang grup yang diinginkan.",
            buttons=grup_menu(cfg),
        )

    elif data == "target_list":
        cfg = users[str(uid)]["config"]
        tl = cfg.get("target_list", [])
        teks = "📭 Belum ada target. Tambah via link." if not tl else \
            "🎯 **TARGET GRUP:**\n" + "\n".join(f"{i}. {t['name']}" for i, t in enumerate(tl, 1))
        await event.edit(teks, buttons=[[Button.inline("⬅️ Kembali", b"target")]])

    elif data == "target_hapus":
        pending[uid] = {"step": "hapus_target"}
        await event.edit("🗑️ Kirim **nomor** target yang mau dihapus (lihat List Target).")

    elif data == "target_limit":
        pending[uid] = {"step": "set_limit"}
        await event.edit("🔢 Kirim **jumlah maksimal** grup per putaran (0 = tanpa batas). Contoh: `10`")

    elif data == "start":
        cfg = users[str(uid)]["config"]
        if not cfg.get("pesan_list"):
            await event.answer("Set pesan promo dulu.", alert=True)
            return
        cfg["running"] = True
        save()
        ub.start_share()
        await event.edit(f"🟢 Auto share **DIMULAI**!\nJeda: {ub.fmt_jeda()}",
                         buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "stop":
        cfg = users[str(uid)]["config"]
        cfg["running"] = False
        save()
        await event.edit("🔴 Auto share **DIHENTIKAN**.",
                         buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    elif data == "status":
        await event.answer("Mengambil status...")
        teks = await ub.status_text()
        await event.edit(teks, buttons=[[Button.inline("⬅️ Kembali", b"menu")]])

    # ------------------------------------------------------------------
    #  PANEL OWNER CALLBACKS
    # ------------------------------------------------------------------
    elif data == "owner_listuser" or data.startswith("olist:"):
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        if data == "owner_listuser":
            cat, page = "all", 0
        else:
            try:
                _parts = data.split(":")
                cat = _parts[1]
                page = int(_parts[2])
            except Exception:
                cat, page = "all", 0

        def _ucat(u_data):
            from datetime import datetime as _dt2
            cfg = u_data.get("config", {})
            tier = str(cfg.get("tier", "")).strip().lower()
            now = _dt2.now()
            if tier in ("lifetime", "seumur", "seumurhidup", "ltd", "permanen"):
                return "premium"
            if tier == "trial":
                try:
                    _te = _dt2.fromisoformat(cfg.get("trial_ends_at", "") or "")
                    if _te > now:
                        return "trial"
                except Exception:
                    pass
                return "exp"
            if tier in ("spesial", "spesial++", "spesial +"):
                try:
                    _pe = _dt2.fromisoformat(cfg.get("premium_ends_at", "") or "")
                    if _pe > now:
                        return "premium"
                except Exception:
                    pass
                return "exp"
            return "exp"

        if not users:
            await event.edit("📋 Belum ada user terdaftar.", buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]])
            return
        items = [it for it in users.items() if cat == "all" or _ucat(it[1]) == cat]
        per_page = 10
        total = len(items)
        max_page = max(0, (total - 1) // per_page) if total else 0
        page = max(0, min(page, max_page))
        start = page * per_page
        chunk = items[start:start + per_page]
        labels = {"all": "🌐 Semua", "premium": "💎 Premium", "trial": "🎁 Trial", "exp": "⏰ Exp"}
        baris = [f"📋 **DAFTAR USERBOT — {labels.get(cat, cat)}** (total {total})\n"]
        for j, (u_id, u_data) in enumerate(chunk, start + 1):
            phone = u_data.get("phone") or "—"
            sesi = "✅" if u_data.get("session") else "❌"
            running_status = "🟢" if u_data.get("config", {}).get("running") else "⚫"
            tier = u_data.get("config", {}).get("tier", "Free")
            expired = u_data.get("config", {}).get("expired", "Null")
            baris.append(f"{j}. `{u_id}` | {phone}\n   Sesi: {sesi} | Status: {running_status} | {tier} (exp: {expired})")
        teks = "\n".join(baris)
        if len(teks) > 3900:
            teks = teks[:3900] + "\n…(dipotong)"
        _tabs = []
        for _c, _l in labels.items():
            _mark = "✅ " if cat == _c else ""
            _tabs.append(Button.inline(_mark + _l, f"olist:{_c}:0".encode()))
        kb = [_tabs]
        nav = []
        if page > 0:
            nav.append(Button.inline("⬅️ Prev", f"olist:{cat}:{page - 1}".encode()))
        if page < max_page:
            nav.append(Button.inline("➡️ Next", f"olist:{cat}:{page + 1}".encode()))
        if nav:
            kb.append(nav)
        kb.append([Button.inline(f"📄 {page + 1}/{max_page + 1}", b"noop"),
                   Button.inline("⬅️ Kembali", b"owner_back")])
        await event.edit(teks, buttons=kb)

    elif data == "owner_stats":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        total = len(users)
        aktif = sum(1 for u in users.values() if u.get("session"))
        running_count = sum(1 for u in users.values() if u.get("config", {}).get("running"))
        tier_counts = {}
        for u in users.values():
            t = u.get("config", {}).get("tier", "Free")
            tier_counts[t] = tier_counts.get(t, 0) + 1
        tier_str = "\n".join(f"  • {t}: {c}" for t, c in tier_counts.items()) or "  —"
        await event.edit(
            f"📊 **STATISTIK BOT — {config.BRAND_NAME}**\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Total user: **{total}**\n"
            f"✅ Punya sesi aktif: **{aktif}**\n"
            f"🟢 Sedang auto share: **{running_count}**\n\n"
            f"🏷️ Distribusi tier:\n{tier_str}",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_settier":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        pending[uid] = {"step": "owner_settier"}
        await event.edit(
            "🎫 **ATUR TIER & EXPIRED USER**\n\n"
            "Kirim dalam format:\n"
            "`<user_id> <tier> <expired>`\n\n"
            "Contoh:\n"
            "`7605731610 Spesial++ 13:41, 02 Agustus 2027`\n\n"
            "Tier yang tersedia: Free, Spesial, Spesial++\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_deluser":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        pending[uid] = {"step": "owner_deluser"}
        await event.edit(
            "🗑️ **HAPUS USER**\n\n"
            "Kirim **ID Telegram** user yang mau dihapus.\n"
            "(Userbot-nya juga akan dimatikan)\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_broadcast":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        pending[uid] = {"step": "owner_broadcast"}
        await event.edit(
            "📢 **BROADCAST KE SEMUA USER**\n\n"
            "Kirim pesan yang ingin dikirim ke semua user terdaftar.\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_akseskan_help":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        pending[uid] = {"step": "quick_akseskan"}
        await event.edit(
            "🎁 **KASIH AKSES KE USER**\n\n"
            "Kirim data user dalam 1 pesan:\n\n"
            "**Format:** `USER_ID [HARI] [TIER]`\n\n"
            "**Contoh:**\n"
            "• `8394402690` → Lifetime\n"
            "• `8394402690 30` → Spesial++ 30 hari\n"
            "• `8394402690 90 Spesial` → Spesial 90 hari\n"
            "• `8394402690 lifetime` → Lifetime\n\n"
            "_USER_ID dapat dari @userinfobot_\n\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Batal", b"owner_panel")]],
        )
    elif data == "owner_addsaldo_help":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        pending[uid] = {"step": "owner_addsaldo"}
        await event.edit(
            "\U0001F4B0 **TAMBAH SALDO USER**\n\n"
            "Kirim dalam 1 pesan:\n\n"
            "**Format:** `USER_ID NOMINAL`\n\n"
            "**Contoh:**\n"
            "\u2022 `7605731610 50000` \u2192 saldo +Rp 50.000\n"
            "\u2022 `7605731610 100000` \u2192 saldo +Rp 100.000\n\n"
            "_Hanya untuk user yang sudah pernah akses bot._\n"
            "_Saldo langsung masuk & bisa dipakai beli apa saja._\n\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Batal", b"owner_panel")]],
        )
    elif data == "owner_gentoken_help":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        await event.edit(
            "🎫 **GENERATE TOKEN PREMIUM**\n\n"
            "Ketik command:\n\n"
            "`/gentoken 5 30 Spesial++`\n"
            "= bikin **5 token**, masing-masing 30 hari Spesial++\n\n"
            "Format: `/gentoken JUMLAH HARI TIER`\n"
            "TIER: `Spesial` / `Spesial++` / `Lifetime`\n\n"
            "Lihat semua: `/tokens`",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]],
        )
    elif data == "owner_testi_help":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        await event.edit(
            "⭐ **KELOLA TESTIMONI**\n\n"
            "• `/testimoni_list` — Lihat semua (pending + approved)\n"
            "• `/approve_testi TST-XXXX` — Tampilkan di /start\n"
            "• `/reject_testi TST-XXXX` — Hapus\n\n"
            "User kasih review dengan `/rate 5 pesan_mereka`",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]],
        )
    elif data == "owner_reftop_help":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        await event.edit(
            "🏆 **TOP REFERRER**\n\nKetik `/ref_top` di chat untuk leaderboard.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]],
        )
    elif data == "owner_panel":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        total = len(users)
        aktif = sum(1 for u in users.values() if u.get("session"))
        running = sum(1 for u in users.values() if u.get("config", {}).get("running"))
        await event.edit(
            f"👑 **PANEL OWNER — {config.BRAND_NAME}**\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Total user: **{total}**\n"
            f"✅ Punya userbot: **{aktif}**\n"
            f"🟢 Sedang running: **{running}**\n\n"
            "Pilih aksi:",
            buttons=owner_panel_menu(),
        )

    elif data == "owner_makepanel":
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        try:
            import v2_panel as _vp
            lines = ["🖥️ **BIKIN PANEL GRATIS (OWNER)**\n",
                     "Bikin panel Pterodactyl tanpa bayar buat siapa aja.\n",
                     "**Kirim USER_ID target** (dari @userinfobot):\n",
                     "Contoh: `7605731610`\n\n",
                     "Setelah kirim ID → pilih tipe (🐍 Python / 📦 Node.js) & RAM → panel auto-created + login dikirim ke user.\n\n",
                     "**Tipe tersedia:**\n",
                     "• 🐍 Python\n",
                     "• 📦 Node.js\n",
                     "RAM: 3GB–10GB / UNLI\n\n",
                     "/cancel untuk batal."]
            pending[uid] = {"step": "owner_makepanel_id"}
            await event.edit("\n".join(lines),
                             buttons=[[Button.inline("⬅️ Batal", b"owner_panel")]])
        except Exception as e:
            await event.edit(f"❌ Error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]])

    elif data.startswith("own_mpt:"):
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        try:
            _, target_uid, ptype = data.split(":", 2)
        except ValueError:
            await event.answer("Format invalid", alert=True); return
        try:
            import v2_panel as _vp
            if ptype not in _vp.PANEL_TYPES:
                await event.answer("Tipe invalid", alert=True); return
            icon = "🐍" if ptype == "python" else "📦"
            kb = [[Button.inline(f"{icon} {r['label']}", f"own_mp:{target_uid}:{ptype}:{r['key']}".encode())]
                  for r in _vp.PANEL_RAM_OPTIONS]
            kb.append([Button.inline("⬅️ Batal", b"owner_panel")])
            await event.edit(
                f"🖥️ **BIKIN PANEL GRATIS untuk `{target_uid}`**\n\n"
                f"Tipe: {_vp.PANEL_TYPES[ptype]['label']}\n"
                "Pilih RAM:",
                buttons=kb)
        except Exception as e:
            await event.edit(f"❌ Error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]])

    elif data.startswith("own_mp:"):
        if not is_owner(uid):
            await event.answer("⛔", alert=True); return
        try:
            _, target_uid, ptype, ram_key = data.split(":", 3)
        except ValueError:
            await event.answer("Format invalid", alert=True); return
        try:
            import v2_panel as _vp
            ram = _vp._ram_by_key(ram_key)
            if ptype not in _vp.PANEL_TYPES or not ram:
                await event.answer("Paket invalid", alert=True); return
            await event.edit(
                f"⏳ Bikin panel `{_vp.PANEL_TYPES[ptype]['label']} · RAM {ram['label']}` buat user `{target_uid}`...\n"
                f"Tunggu ~30 detik, jangan tutup.",
                buttons=None,
            )
            fake_order = {
                "order_id": f"OWNER-{secrets.token_hex(4).upper()}",
                "type": "panel",
                "user_id": target_uid,
                "ptype": ptype,
                "ram": ram_key,
                "amount": 0,
                "channel": "gift",
                "status": "paid",
                "created_at": v2_extensions.now_ts().isoformat() if v2_extensions else "",
            }
            ok, result = await _vp._provision_panel(bot, fake_order)
            if not ok:
                await event.edit(
                    f"❌ Provisioning gagal:\n`{result}`",
                    buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]])
                return
            rec = result
            # Notify target user
            try:
                await bot.send_message(int(target_uid),
                    f"🎁 **HADIAH PANEL DARI OWNER!**\n\n"
                    f"📦 Paket: **{rec['ptype_label']} · RAM {rec['ram_label']}**\n\n"
                    f"🔗 **URL Panel:** {rec['panel_url']}\n"
                    f"👤 **Username:** `{rec['username']}`\n"
                    f"📧 **Email:** `{rec['email']}`\n"
                    f"🔑 **Password:** `{rec['password']}`\n\n"
                    f"🖥️ Server: `{rec['server_name']}`\n\n"
                    "✅ Login sekarang & mulai deploy!\n"
                    "⚠️ **SIMPAN INFO INI** — tidak dikirim ulang.")
            except Exception:
                pass
            await event.edit(
                f"✅ **PANEL DIBUAT!**\n\n"
                f"👤 Target: `{target_uid}`\n"
                f"📦 Paket: {rec['ptype_label']} · RAM {rec['ram_label']}\n"
                f"🔗 {rec['panel_url']}\n"
                f"👤 `{rec['username']}`\n"
                f"🔑 `{rec['password']}`\n\n"
                "Info login sudah dikirim ke user.",
                buttons=[[Button.inline("⬅️ Panel Owner", b"owner_panel")]])
        except Exception as e:
            await event.edit(f"❌ Error: {e}",
                             buttons=[[Button.inline("⬅️ Kembali", b"owner_panel")]])

    elif data == "owner_adduser":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        pending[uid] = {"step": "owner_adduser_id"}
        await event.edit(
            "➕ **TAMBAH IZIN AKSES**\n\n"
            "Kirim **ID Telegram** user yang mau diberi akses.\n"
            "_(Minta mereka chat @userinfobot untuk dapat ID-nya)_\n\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_listizin":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        entries = wl_store.list_users(whitelist)
        if not entries:
            await event.edit(
                "📋 **LIST IZIN AKSES**\n\nBelum ada user yang diberi izin.",
                buttons=[[Button.inline("➕ Tambah Izin", b"owner_adduser"), Button.inline("⬅️ Kembali", b"owner_back")]]
            )
            return
        baris = ["📋 **LIST IZIN AKSES**\n"]
        for i, e in enumerate(entries, 1):
            baris.append(f"{i}. `{e['uid']}` — {e['nama']}\n   Expired: {e['expired_label']} | {e['status']}")
        teks = "\n".join(baris)
        if len(teks) > 4000:
            teks = teks[:4000] + "\n…(dipotong)"
        await event.edit(teks, buttons=[
            [Button.inline("➕ Tambah Izin", b"owner_adduser"), Button.inline("🚫 Cabut Akses", b"owner_cabutakses")],
            [Button.inline("⬅️ Kembali", b"owner_back")]
        ])

    elif data == "owner_cabutakses":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        pending[uid] = {"step": "owner_cabutakses"}
        await event.edit(
            "🚫 **CABUT AKSES USER**\n\n"
            "Kirim **ID Telegram** user yang mau dicabut aksesnya.\n"
            "/cancel untuk batal.",
            buttons=[[Button.inline("⬅️ Kembali", b"owner_back")]]
        )

    elif data == "owner_restart":
        # Restart SEMUA userbot (putus & sambungkan ulang sesi aktif)
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        await event.edit("🔄 **Restart semua userbot...**\nMohon tunggu sebentar.", buttons=None)
        ok_count, fail_count = 0, 0
        for u_id, u in list(users.items()):
            if not u.get("session"):
                continue
            try:
                old = userbots.pop(int(u_id), None)
                if old:
                    try:
                        await old.disconnect()
                    except Exception:
                        pass
                ub = UserBot(int(u_id), u["session"], u["config"], config.API_ID,
                             config.API_HASH, notify=notify, on_save=save)
                ok = await ub.connect()
                if ok:
                    userbots[int(u_id)] = ub
                    ok_count += 1
                else:
                    fail_count += 1
            except Exception:
                fail_count += 1
            await asyncio.sleep(0.3)
        await event.edit(
            f"🔄 **Restart selesai!**\n\n"
            f"✅ Berhasil: **{ok_count}** userbot\n"
            f"❌ Gagal: **{fail_count}**\n\n"
            "Userbot yang gagal biasanya karena sesi expired — bisa dibuat ulang.",
            buttons=owner_panel_menu(),
        )

    elif data == "owner_back":
        if not is_owner(uid):
            await event.answer("⛔ Tidak diizinkan.", alert=True)
            return
        total_izin = len(whitelist)
        aktif_izin = sum(1 for e in wl_store.list_users(whitelist) if "aktif" in e["status"] or "sisa" in e["status"])
        total_ub = len(users)
        running_count = sum(1 for u in users.values() if u.get("config", {}).get("running"))
        await event.edit(
            f"👑 **PANEL OWNER — {config.BRAND_NAME}**\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🔐 Izin akses: **{total_izin}** user ({aktif_izin} aktif)\n"
            f"🤖 Userbot terdaftar: **{total_ub}**\n"
            f"🟢 Sedang running: **{running_count}**\n\n"
            "Pilih aksi:",
            buttons=owner_panel_menu()
        )

    await event.answer()


# ------------------------------------------------------------------
# ------------------------------------------------------------------
#  BAGIKAN (share/forward) — hanya Spesial++ / Lifetime / Owner
# ------------------------------------------------------------------
def _tier_of(uid):
    """Tier user (lowercase, safe)."""
    try:
        return str((users.get(str(uid), {}).get("config", {}) or {}).get("tier", "")).strip().lower()
    except Exception:
        return ""


def _boleh_bagikan(uid):
    """Paket Spesial TIDAK boleh pakai Bagikan (share/forward) — harus ketik/copy-paste.
    Spesial++ / Lifetime / Owner bebas."""
    if is_owner(uid):
        return True
    return _tier_of(uid) in ("spesial++", "spesial plus", "lifetime", "life", "seumur", "permanen")


TEXT_SPECIAL_BAGIKAN_BLOCK = (
    "⛔ **PAKET SPESIAL — TIDAK BISA PAKAI BAGIKAN**\n\n"
    "Di paket **Spesial**, teks promo harus **diketik / copy-paste** (pakai tombol ✍️ Set Teks).\n"
    "Alasannya: ada **watermark promo** yang wajib nempel di pesanmu.\n\n"
    "🔥 Upgrade ke **Spesial++ (Rp 35rb/bln)** biar bebas:\n"
    "✅ Tanpa watermark\n"
    "✅ Bisa Bagikan / share dari channel, grup, atau chat"
)


#  SET PESAN DARI SAVED MESSAGES
# ------------------------------------------------------------------
def build_promo_item(msg):
    """Bangun item promo.

    Jika pesan adalah FORWARD dari channel -> simpan sumbernya (channel+post)
    supaya userbot mem-forward persis aslinya (custom emoji/premium tetap utuh).
    Selain itu -> simpan teks + format (entities).
    """
    fwd = getattr(msg, "fwd_from", None)
    post_id = getattr(fwd, "channel_post", None) if fwd else None
    from_id = getattr(fwd, "from_id", None) if fwd else None
    if post_id and isinstance(from_id, PeerChannel):
        return {
            "type": "forward",
            "chat_id": tg_utils.get_peer_id(from_id),
            "msg_id": post_id,
            "src": "channel",
        }, "channel"
    return {
        "type": "text",
        "text": msg.message or "",
        "entities": serialize_entities(msg.entities),
    }, "text"


async def kirim_daftar_grup(event, uid, step, judul):
    """Tampilkan daftar grup bernomor (id | nama) lalu simpan urutannya.
    User membalas dengan nomor untuk memilih/menghapus."""
    ub = get_ub(uid)
    grup = await ub.get_all_groups()
    if not grup:
        await event.edit("❌ Tidak ada grup ditemukan.", buttons=[[Button.inline("⬅️ Kembali", b"menu")]])
        return
    order = [(g.id, g.name or "?") for g in grup]
    pending[uid] = {"step": step, "grup_order": order}
    baris = [f"**{judul}**", ""]
    for i, (gid, name) in enumerate(order, 1):
        baris.append(f"• {i}. {gid} | {name}")
    teks = "\n".join(baris)
    if len(teks) > 3900:
        teks = teks[:3900] + "\n…(dipotong)"
    teks += "\n\nBalas dengan **nomor** (boleh banyak, pisah spasi/koma).\nContoh: `27` atau `1 5 9`"
    await event.edit(teks)


async def set_dari_saved(uid):
    ub = get_ub(uid)
    if not ub:
        return False
    try:
        msgs = await ub.client.get_messages("me", limit=1)
        if not msgs:
            return False
        msg = msgs[0]
        me = await ub.client.get_me()
        cfg = users[str(uid)]["config"]
        cfg["pesan_list"] = [{"type": "forward", "chat_id": me.id, "msg_id": msg.id}]
        cfg["pesan_index"] = 0
        save()
        return True
    except Exception:
        return False


# ------------------------------------------------------------------
#  HANDLER INPUT TEKS (alur login & pengaturan)
# ------------------------------------------------------------------
KEYBOARD_LABELS = {
    "▶️ Mulai", "⏹️ Berhenti", "📝 Atur Pesan", "🎯 Atur Grup", "⏲️ Jeda",
    "⏱️ Timer", "📊 Status", "💬 Autoreply", "❓ Bantuan", "🏠 Menu", "📚 Buat Userbot",
    "👑 Panel Owner",
    # Simple menu awal (kayak Flensiza)
    "🛒 Shop", "⚙️ Settings", "🔍 Cari Grup", "🎁 Trial",
    "📱 Nokos",
    # Legacy V2 labels (kalo user tekan lewat menu lama)
    "🎁 Trial 24 Jam", "💎 Beli Premium", "🔑 Token Login", "ℹ️ Akses Saya",
    "🛒 Beli Panel", "🖥️ Panel Saya", "💰 Topup Saldo",
}


async def _send_backup_code_if_new(bot, target_uid, source="premium"):
    """Generate & kirim Token Login backup ke user kalau belum punya."""
    try:
        import v2_extensions as _v2e
        _bc, _is_new = _v2e.get_or_create_backup_code(str(target_uid), source=source)
    except Exception:
        return
    if not (_bc and _is_new):
        return
    try:
        await bot.send_message(target_uid,
            f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
            f"`{_bc}`\n\n"
            "⚠️ **SIMPAN BAIK-BAIK!** Kode ini untuk restore akses kalau logout / ganti akun Telegram.\n"
            f"Cara pakai: `/restore {_bc}` dari akun baru.\n\n"
            "🔒 Rahasiakan!")
    except Exception:
        pass


async def handle_keyboard(event, uid, label):
    """Aksi dari tombol keyboard bawah permanen (tanpa ketik manual)."""
    ub = get_ub(uid)
    # ===== SIMPLE MENU LABELS =====
    if label == "🛒 Shop":
        await event.respond(
            "🛒 **SHOP KAKOSTORE**\n\n"
            "Pilih produk yang mau kamu beli:\n\n"
            "💎 **Premium** — unlock auto-share tanpa batas\n"
            "🛒 **Panel Pterodactyl** — hosting bot pribadi 24/7\n"
            "💰 **Topup Saldo** — isi saldo, beli apa pun cepat",
            buttons=shop_menu(),
        )
        return
    if label == "📱 Nokos":
        try:
            import v2_nokos
            txt = v2_nokos.summary_text()
            if not v2_nokos.enabled():
                await event.respond(txt,
                    buttons=[[Button.inline("📱 Coba Buka Nokos", b"nk_menu")],
                             [Button.inline("⬅️ Menu", b"menu")]])
            else:
                await event.respond(txt, buttons=v2_nokos.nokos_menu())
        except Exception as e:
            await event.respond(f"❌ Nokos error: {e}", buttons=main_keyboard(uid))
        return
    if label == "⚙️ Settings":
        await event.respond(
            "⚙️ **SETTINGS**\n\n"
            "Info akun, akses, token login, referral & saldo kamu.",
            buttons=settings_menu(),
        )
        return
    if label == "🔍 Cari Grup":
        if not ub:
            await event.respond(
                "🔍 **CARI GRUP**\n\n"
                "Butuh userbot aktif. Buat dulu userbot lewat **📚 Buat Userbot**.",
                buttons=main_keyboard(uid))
            return
        pending[uid] = {"step": "carigrup"}
        await event.respond("🔍 Kirim **kata kunci** nama grup yang mau dicari.")
        return
    if label == "🎁 Trial":
        # Alias ke "🎁 Trial 24 Jam"
        return await handle_keyboard(event, uid, "🎁 Trial 24 Jam")

    # V2 quick-action labels
    if label == "🎁 Trial 24 Jam":
        if v2_extensions:
            end, backup = v2_extensions.activate_trial(users, str(uid))
            if end is None:
                await event.respond(
                    "❌ **Trial sudah pernah dipakai.**\n\n"
                    "⚠️ Trial 24 jam **HANYA 1x seumur hidup** untuk 1 akun Telegram. "
                    "Tidak bisa diklaim ulang.\n\n"
                    "💎 Beli premium: ketuk **💎 Beli Premium**\n"
                    "🎫 Tukar token: `/redeem TKN-XXXX-XXXX`\n"
                    f"👑 Info: {config.OWNER_USERNAME}",
                    buttons=main_keyboard(uid),
                )
                return
            save()
            await event.respond(
                f"🎁 **TRIAL 24 JAM AKTIF!**\n\n"
                f"⏰ Berakhir: {v2_extensions.fmt_time(end)}\n"
                f"⏳ Sisa: {v2_extensions.fmt_remaining(end)}\n\n"
                "⚠️ Trial ini **HANYA 1x seumur hidup**. Setelah habis harus beli premium.",
                buttons=main_keyboard(uid),
            )
            # AUTO-KIRIM TOKEN LOGIN BACKUP
            await event.respond(
                f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                f"`{backup}`\n\n"
                "⚠️ **SIMPAN BAIK-BAIK!** Kode ini untuk **restore akses** kalau:\n"
                "• Logout dari bot\n"
                "• Ganti akun / device Telegram\n\n"
                f"Cara pakai: chat bot dari akun baru → `/restore {backup}` → akses pindah otomatis.\n\n"
                "🔒 Rahasiakan — jangan share ke siapa pun!"
            )
        return
    if label == "💎 Beli Premium":
        text = (
            "💎 **PILIH PAKET PREMIUM**\n\n"
            "**📊 Perbandingan Paket:**\n\n"
            "🥈 **SPESIAL** (Rp 10rb–30rb)\n"
            "  ✅ Auto-share ke semua grup\n"
            "  ✅ Autoreply\n"
            "  ✅ Timer ON/OFF\n"
            "  ✅ Atur pesan (rotasi)\n"
            "  ⏱ Jeda standar (per grup / per putaran)\n\n"
            "🥇 **SPESIAL++** (Rp 50rb–120rb) — 🔥 Recommended\n"
            "  ✅ Semua fitur Spesial\n"
            "  🛡️ **Jeda AMAN RANDOM** — pola acak mirip manusia, anti-banned 24 jam\n"
            "  🚀 Grup unlimited (tanpa batas)\n"
            "  💬 Welcome message otomatis\n"
            "  🔕 Anti-delete (notif pesan grup dihapus)\n"
            "  ⚡ Prioritas support dari owner\n\n"
            "💎 **LIFETIME** (Rp 500rb) — Bayar sekali, pakai selamanya\n\n"
            "Ketuk paket di bawah untuk buat order:"
        )
        kb = []
        if v2_extensions:
            kb = [[Button.inline(f"💎 {p['label']}", f"beli:{k}".encode())] for k, p in v2_extensions.PLANS.items()]
        kb.append([Button.inline("⬅️ Kembali", b"menu")])
        await event.respond(text, buttons=kb)
        return
    if label == "🛒 Beli Panel":
        try:
            import v2_panel
            await event.respond(
                "🛒 **BELI PANEL PTERODACTYL**\n\n"
                "Panel hosting bot pribadi, siap 24/7.\n"
                "Pilih paket — auto-created setelah bayar:",
                buttons=v2_panel.panel_beli_menu(),
            )
        except Exception as e:
            await event.respond(f"❌ Panel service error: {e}",
                                buttons=main_keyboard(uid))
        return
    if label == "🖥️ Panel Saya":
        try:
            import v2_panel
            panels = v2_panel.get_user_panels(uid)
        except Exception:
            panels = []
        if not panels:
            await event.respond(
                "🖥️ **PANEL SAYA**\n\nBelum ada panel aktif.\n"
                "🛒 Ketuk **🛒 Beli Panel** — otomatis siap <1 menit setelah bayar.",
                buttons=main_keyboard(uid))
        else:
            aktif = [p for p in panels if p.get("status") != "deleted"]
            n_del = len(panels) - len(aktif)
            lines = [f"\U0001F5A5\uFE0F **PANEL SAYA** ({len(aktif)} aktif)\n"]
            if n_del:
                lines.append(f"\U0001F5D1\uFE0F {n_del} panel lama sudah terhapus di server (tidak aktif).")
            from datetime import datetime as _dt
            for i, p in enumerate(aktif, 1):
                stat = p.get("status", "active")
                stat_icon = {"active": "🟢 Aktif", "suspended": "⛔ Suspended", "deleted": "🗑️ Deleted"}.get(stat, stat)
                exp_str = p.get("expires_at", "-")
                sisa = ""
                try:
                    exp_dt = _dt.fromisoformat(exp_str)
                    days = (exp_dt - _dt.now()).days
                    sisa = f" ({days}h lagi)" if days >= 0 else f" ({-days}h lewat)"
                except Exception:
                    pass
                lines.append(
                    f"**{i}. {p.get('ptype_label') or p.get('package_label', 'Panel')}{(' · RAM ' + str(p['ram_label'])) if p.get('ram_label') else ''}** — {stat_icon}\n"
                    f"🔗 {p['panel_url']}\n"
                    f"👤 `{p['username']}` · 🔑 `{p['password']}`\n"
                    f"📅 Dibuat: {p.get('created_at', '-')[:10]}\n"
                    f"⏰ Expired: {exp_str[:10]}{sisa}\n")
            await event.respond("\n".join(lines), buttons=main_keyboard(uid))
        return
    if label == "💰 Topup Saldo":
        try:
            import v2_panel
            await event.respond(
                "💰 **TOPUP SALDO**\n\n"
                "Isi saldo → buat beli panel / premium / apa pun.\n"
                f"💎 Bonus: topup ≥ Rp 100rb dapat diskon **{v2_panel.DISCOUNT_PERCENT}%** untuk pembelian.\n\n"
                "Pilih nominal:",
                buttons=v2_panel.topup_menu(),
            )
        except Exception as e:
            await event.respond(f"❌ Topup error: {e}", buttons=main_keyboard(uid))
        return
    if label == "🔑 Token Login":
        await event.respond(
            "🔑 **TOKEN LOGIN**\n\n"
            "Token Login = kode backup untuk **restore akses & premium** kalau:\n"
            "• Kamu logout dari bot\n"
            "• Ganti akun / device Telegram\n\n"
            "**Cara dapat:**\n"
            "🎁 Klaim /trial — auto dapat token\n"
            "💎 Bayar premium — auto dapat token setelah sukses\n\n"
            "**Perintah:**\n"
            "• `/kode` — lihat token kamu\n"
            "• `/restore UBM-XXXX-XXXX-XXXX` — restore akses dari akun baru",
            buttons=main_keyboard(uid),
        )
        return
    if label == "ℹ️ Akses Saya":
        if v2_extensions:
            has, source, exp = v2_extensions.compute_access(users, str(uid), whitelist)
            if not has:
                trial_used = users.get(str(uid), {}).get("config", {}).get("trial_used", False)
                msg = "🚫 **BELUM PUNYA AKSES**\n\n"
                if not trial_used:
                    msg += "🎁 Klaim trial 24 jam gratis dengan tombol **🎁 Trial 24 Jam**\n"
                msg += "💎 Atau beli premium dengan **💎 Beli Premium**\n"
                msg += "🎫 Punya token? `/redeem TKN-XXXX-XXXX`"
                await event.respond(msg, buttons=main_keyboard(uid))
                return
            cfg = users.get(str(uid), {}).get("config", {})
            await event.respond(
                f"✅ **AKSES ANDA**\n\n"
                f"🏷️ Tier: **{cfg.get('tier', source)}**\n"
                f"📌 Sumber: `{source}`\n"
                f"⏰ Berakhir: {v2_extensions.fmt_time(exp)}\n"
                f"⏳ Sisa: {v2_extensions.fmt_remaining(exp) if exp else '♾️ selamanya'}\n"
                f"🎁 Trial used: {'ya' if cfg.get('trial_used') else 'belum'}\n"
                f"🤖 Userbot: {'aktif' if users.get(str(uid), {}).get('session') else 'belum dibuat'}",
                buttons=main_keyboard(uid),
            )
        return

    if label == "📚 Buat Userbot":
        # V2: cek akses dulu sebelum buat userbot
        if v2_extensions:
            has, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
            if not has:
                await tolak_akses(event, "no_access")
                return
        if ub:
            await event.respond("ℹ️ Userbot sudah ada.", buttons=main_keyboard(uid))
            return
        pending[uid] = {"step": "phone"}
        await event.respond("📱 Kirim **nomor HP** akun userbot (contoh `+628xxxx`).\n/cancel untuk batal.")
        return
    if label == "❓ Bantuan":
        await event.respond(BANTUAN, buttons=main_keyboard(uid))
        return
    if label == "🏠 Menu":
        await event.respond(menu_header(uid), buttons=main_keyboard(uid))
        return
    if not ub:
        # Cek apakah user sudah punya trial/premium — kasih pesan alur yang tepat
        has_access = False
        if v2_extensions:
            has_access, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
        if not has_access:
            await event.respond(
                "🔒 **FITUR INI TERKUNCI**\n\n"
                "Ikuti alur ini biar semua fitur bisa dipakai:\n\n"
                "1️⃣ **Klaim akses:**\n"
                "   • 🎁 Ketuk **Trial 24 Jam** (gratis, sekali seumur hidup)\n"
                "   • Atau 💎 **Beli Premium**\n"
                "   • Atau `/redeem TKN-XXXX-XXXX`\n\n"
                "2️⃣ **📚 Buat Userbot** — masukkan nomor HP + OTP + 2FA Telegram\n\n"
                "3️⃣ Setelah userbot aktif → bot kirim **🔑 Token Login backup** ke kamu\n\n"
                "4️⃣ Semua fitur (Atur Pesan, Atur Grup, Jeda, Timer, Autoreply, Mulai auto-share 24 jam) langsung bisa dipakai.\n\n"
                "👑 Info & bantuan: " + config.OWNER_USERNAME,
                buttons=main_keyboard(uid),
            )
        else:
            await event.respond(
                "📚 **BUAT USERBOT DULU**\n\n"
                "Akses kamu aktif ✅, tapi userbot belum dibuat.\n"
                "Ketuk **📚 Buat Userbot** → masukkan nomor HP → OTP → 2FA → selesai.\n\n"
                "Setelah userbot aktif, semua fitur (Jeda, Timer, Atur Pesan, dll) langsung bisa dipakai.",
                buttons=main_keyboard(uid),
            )
        return
    cfg = users[str(uid)]["config"]
    if label == "📝 Atur Pesan":
        await event.respond("📝 **ATUR PESAN** — pilih aksi:", buttons=pesan_menu())
    elif label == "🎯 Atur Grup":
        await event.respond("🎯 **ATUR GRUP** — pilih aksi:", buttons=grup_menu(cfg))
    elif label == "⏲️ Jeda":
        await event.respond(f"⏲️ **PILIH JEDA**\nAktif: **{ub.fmt_jeda()}**", buttons=jeda_menu())
    elif label == "⏱️ Timer":
        pending[uid] = {"step": "timer"}
        await event.respond("⏱️ Kirim jam **ON OFF**. Contoh: `08:00 23:00` (atau ketik `off`).")
    elif label == "💬 Autoreply":
        await event.respond("💬 **AUTOREPLY**", buttons=autoreply_menu())
    elif label == "📊 Status":
        await event.respond(await ub.status_text(), buttons=main_keyboard(uid))
    elif label == "▶️ Mulai":
        # V2: cek akses lagi sebelum mulai auto-share (biar tidak jalan pas expired)
        if v2_extensions:
            has, _, _ = v2_extensions.compute_access(users, str(uid), whitelist)
            if not has:
                await tolak_akses(event, "expired")
                return
        if not cfg.get("pesan_list"):
            await event.respond("⚠️ Set pesan dulu (📝 Atur Pesan).", buttons=main_keyboard(uid))
            return
        cfg["running"] = True
        save()
        ub.start_share()
        await event.respond(f"🟢 **Auto share DIMULAI!**\nJeda: {ub.fmt_jeda()}", buttons=main_keyboard(uid))
    elif label == "⏹️ Berhenti":
        cfg["running"] = False
        save()
        await event.respond("🔴 **Auto share DIHENTIKAN.**", buttons=main_keyboard(uid))
    elif label == "👑 Panel Owner":
        if not is_owner(uid):
            await event.respond("⛔ Hanya untuk owner bot.")
            return
        total = len(users)
        aktif = sum(1 for u in users.values() if u.get("session"))
        running = sum(1 for u in users.values() if u.get("config", {}).get("running"))
        await event.respond(
            f"👑 **PANEL OWNER — {config.BRAND_NAME}**\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 Total user terdaftar: **{total}**\n"
            f"✅ Punya sesi: **{aktif}**\n"
            f"🟢 Sedang running: **{running}**\n\n"
            "Pilih aksi:",
            buttons=owner_panel_menu()
        )


@bot.on(events.NewMessage(incoming=True))
async def _input(event):
    try:
        await _input_impl(event)
    except Exception as e:
        traceback.print_exc()
        try:
            await event.respond(f"⚠️ ERROR: {e}"[:300])
        except Exception:
            pass


async def _input_impl(event):
    uid = event.sender_id
    text = (event.raw_text or "").strip()

    # V2: Skip akses check di /start. Cek hanya di aksi phone/otp/2fa (buat userbot).
    if text.startswith("/"):
        if text == "/cancel":
            pending.pop(uid, None)
            await event.respond("❌ Dibatalkan.", buttons=main_keyboard(uid))
        return

    # Tombol keyboard bawah = navigasi/aksi (prioritas, keluar dari step apa pun)
    if text in KEYBOARD_LABELS:
        pending.pop(uid, None)
        await handle_keyboard(event, uid, text)
        return

    if uid not in pending:
        return

    step = pending[uid]["step"]

    # Cek akses untuk step yang butuh (buat userbot alur)
    if step in ("phone", "otp", "2fa"):
        boleh, alasan = cek_akses(uid)
        if not boleh:
            pending.pop(uid, None)
            await tolak_akses(event, alasan)
            return

    # ---------- ALUR LOGIN ----------
    if step == "phone":
        if not text.startswith("+"):
            await event.respond("⚠️ Format salah. Contoh: `+628123456789`. Coba lagi:")
            return
        client = TelegramClient(StringSession(), config.API_ID, config.API_HASH)
        try:
            await client.connect()
            sent = await client.send_code_request(text)
        except Exception as e:
            await event.respond(f"❌ Gagal kirim kode: {e}\nCoba lagi / /cancel.")
            return
        pending[uid] = {"step": "otp", "client": client, "phone": text,
                        "hash": sent.phone_code_hash}
        await event.respond(
            "✅ Kode OTP dikirim ke Telegram akun tsb.\n"
            "Balas kodenya di sini. **Tips:** ketik pakai spasi biar tidak "
            "dianggap hangus, contoh: `1 2 3 4 5`."
        )

    elif step == "otp":
        code = "".join(ch for ch in text if ch.isdigit())
        p = pending[uid]
        client = p["client"]
        try:
            await client.sign_in(phone=p["phone"], code=code,
                                 phone_code_hash=p["hash"])
        except tg_errors.SessionPasswordNeededError:
            pending[uid]["step"] = "2fa"
            await event.respond("🔐 Akun ini pakai **verifikasi 2 langkah**.\n"
                                "Kirim **password** 2FA-nya:")
            try:
                await event.delete()
            except Exception:
                pass
            return
        except tg_errors.PhoneCodeInvalidError:
            await event.respond("❌ Kode salah. Coba kirim lagi (pakai spasi).")
            return
        except tg_errors.PhoneCodeExpiredError:
            await event.respond("❌ Kode kedaluwarsa. Ulangi /start → Buat Userbot.")
            pending.pop(uid, None)
            return
        except Exception as e:
            await event.respond(f"❌ Gagal login: {e}")
            return
        await finalize_login(event, uid)

    elif step == "2fa":
        p = pending[uid]
        client = p["client"]
        try:
            await client.sign_in(password=text)
        except Exception as e:
            await event.respond(f"❌ Password salah / gagal: {e}. Coba lagi:")
            return
        try:
            await event.delete()
        except Exception:
            pass
        await finalize_login(event, uid)

    # ---------- PENGATURAN ----------
    elif step == "set_text":
        if not _boleh_bagikan(uid) and getattr(event.message, "fwd_from", None):
            pending.pop(uid, None)
            await event.respond(TEXT_SPECIAL_BAGIKAN_BLOCK,
                                buttons=[[Button.inline("✍️ Set Teks", b"settext")],
                                         [Button.inline("⬅️ Kembali", b"menu")]])
            return
        item, tipe = build_promo_item(event.message)
        cfg = users[str(uid)]["config"]
        cfg["pesan_list"] = [item]
        cfg["pesan_index"] = 0
        save()
        pending.pop(uid, None)
        ket = "forward dari channel (custom emoji utuh)" if tipe == "channel" else "teks (format terjaga)"
        await event.respond(f"✅ Pesan promo diset — {ket}. Mengganti semua pesan.",
                            buttons=main_menu(uid))

    elif step == "add_text":
        if not _boleh_bagikan(uid) and getattr(event.message, "fwd_from", None):
            pending.pop(uid, None)
            await event.respond(TEXT_SPECIAL_BAGIKAN_BLOCK,
                                buttons=[[Button.inline("✍️ Set Teks", b"settext")],
                                         [Button.inline("⬅️ Kembali", b"menu")]])
            return
        item, tipe = build_promo_item(event.message)
        cfg = users[str(uid)]["config"]
        cfg.setdefault("pesan_list", []).append(item)
        save()
        pending.pop(uid, None)
        ket = "forward dari channel (custom emoji utuh)" if tipe == "channel" else "teks (format terjaga)"
        await event.respond(f"✅ Ditambahkan — {ket}. Total pesan: {len(cfg['pesan_list'])} (rotasi).",
                            buttons=main_menu(uid))

    elif step == "hapus_pesan":
        cfg = users[str(uid)]["config"]
        lst = cfg.get("pesan_list", [])
        if not text.isdigit() or not (1 <= int(text) <= len(lst)):
            await event.respond("⚠️ Nomor tidak valid.")
            return
        lst.pop(int(text) - 1)
        cfg["pesan_index"] = 0
        save()
        pending.pop(uid, None)
        await event.respond(f"🗑️ Dihapus. Sisa: {len(lst)} pesan.", buttons=main_menu(uid))

    elif step in ("jeda_semua", "jeda_grup"):
        if not text.isdigit() or int(text) < 1:
            await event.respond("⚠️ Kirim angka valid.")
            return
        n = int(text)
        cfg = users[str(uid)]["config"]
        if step == "jeda_semua":
            cfg["jeda_tipe"] = "semua"
            cfg["jeda_semua_menit"] = n
            warn = "" if n >= 20 else "\n⚠️ Di bawah 20 menit berisiko banned!"
            msg = f"✅ Jeda: Per SEMUA grup — {n} menit/putaran.{warn}"
        else:
            cfg["jeda_tipe"] = "grup"
            cfg["jeda_grup_detik"] = n
            warn = "" if n >= 15 else "\n⚠️ Di bawah 15 detik terlalu spam & berisiko banned!"
            msg = f"✅ Jeda: Per GRUP — {n} detik antar grup.{warn}"
        save()
        pending.pop(uid, None)
        await event.respond(msg, buttons=main_menu(uid))

    elif step == "timer":
        cfg = users[str(uid)]["config"]
        if text.lower() == "off":
            cfg["timer"] = None
            save()
            pending.pop(uid, None)
            await event.respond("⏱️ Timer dimatikan.", buttons=main_menu(uid))
            return
        parts = text.split()
        if len(parts) != 2 or not all(re.match(r"^\d{1,2}:\d{2}$", x) for x in parts):
            await event.respond("⚠️ Format: `08:00 23:00` atau `off`.")
            return
        cfg["timer"] = {"on": parts[0], "off": parts[1]}
        save()
        pending.pop(uid, None)
        await event.respond(f"⏱️ Timer diset: ON {parts[0]} / OFF {parts[1]}.",
                            buttons=main_menu(uid))

    elif step == "addreply":
        if "|" not in text:
            await event.respond("⚠️ Format: `pemicu | balasan`.")
            return
        trig, resp = text.split("|", 1)
        cfg = users[str(uid)]["config"]
        cfg.setdefault("replies", []).append({"trigger": trig.strip(), "response": resp.strip()})
        save()
        pending.pop(uid, None)
        await event.respond(f"✅ Autoreply ditambah. Total: {len(cfg['replies'])}.",
                            buttons=main_menu(uid))

    elif step == "skip":
        ub = get_ub(uid)
        cfg = users[str(uid)]["config"]
        kata = text.lower()
        grup_list = await ub.get_all_groups()
        ditambah = []
        for g in grup_list:
            if kata in (g.name or "").lower() and g.id not in cfg["blacklist"]:
                cfg["blacklist"].append(g.id)
                cfg.setdefault("blacklist_info", []).append({"id": g.id, "name": g.name})
                ditambah.append(g.name)
        save()
        pending.pop(uid, None)
        if ditambah:
            await event.respond("⛔ Di-skip:\n" + "\n".join(f"• {n}" for n in ditambah),
                                buttons=main_menu(uid))
        else:
            await event.respond("❌ Tidak ada grup cocok.", buttons=main_menu(uid))

    elif step == "carigrup":
        ub = get_ub(uid)
        kata = text.lower()
        await event.respond("🔍 Mencari...")
        grup_list = await ub.get_all_groups()
        cocok = [g.name for g in grup_list if kata in (g.name or "").lower()]
        pending.pop(uid, None)
        if cocok:
            await event.respond(f"🔍 Ditemukan {len(cocok)} grup:\n" +
                                "\n".join(f"• {n}" for n in cocok[:50]),
                                buttons=main_menu(uid))
        else:
            await event.respond("❌ Tidak ada grup cocok.", buttons=main_menu(uid))

    elif step == "bl_pick":
        order = pending[uid].get("grup_order", [])
        nums = [int(x) for x in re.findall(r"\d+", text)]
        cfg = users[str(uid)]["config"]
        dihapus = []
        for n in nums:
            if 1 <= n <= len(order):
                gid, name = order[n - 1]
                if gid not in cfg["blacklist"]:
                    cfg["blacklist"].append(gid)
                    cfg.setdefault("blacklist_info", []).append({"id": gid, "name": name})
                    dihapus.append(f"{n}. {name}")
        save()
        pending.pop(uid, None)
        if dihapus:
            await event.respond("🗑️ Grup dihapus dari share (blacklist):\n" +
                                "\n".join(f"• {n}" for n in dihapus), buttons=main_menu(uid))
        else:
            await event.respond("⚠️ Tidak ada nomor valid.", buttons=main_menu(uid))

    elif step == "target_pick":
        order = pending[uid].get("grup_order", [])
        nums = [int(x) for x in re.findall(r"\d+", text)]
        cfg = users[str(uid)]["config"]
        tl = cfg.setdefault("target_list", [])
        ditambah = []
        for n in nums:
            if 1 <= n <= len(order):
                gid, name = order[n - 1]
                if not any(t["id"] == gid for t in tl):
                    tl.append({"id": gid, "name": name})
                    ditambah.append(f"{n}. {name}")
        cfg["target_mode"] = "pilih"
        save()
        pending.pop(uid, None)
        if ditambah:
            await event.respond(f"🎯 Ditambahkan ke TARGET ({len(tl)} grup total):\n" +
                                "\n".join(f"• {n}" for n in ditambah), buttons=main_menu(uid))
        else:
            await event.respond("⚠️ Tidak ada nomor valid.", buttons=main_menu(uid))

    elif step == "add_link":
        ub = get_ub(uid)
        links = [l.strip() for l in text.splitlines() if l.strip()]
        await event.respond(f"⏳ Menambahkan {len(links)} grup (join)...")
        ok_list, gagal_list = [], []
        for lk in links:
            ok, nama, err = await ub.add_group_by_link(lk)
            if ok:
                ok_list.append(nama)
            else:
                gagal_list.append(f"{lk} ({err})")
        pending.pop(uid, None)
        cfg = users[str(uid)]["config"]
        pesan = f"🎯 Target mode: **Pilih** ({len(cfg.get('target_list', []))} grup)\n"
        if ok_list:
            pesan += "\n✅ Berhasil:\n" + "\n".join(f"• {n}" for n in ok_list)
        if gagal_list:
            pesan += "\n\n❌ Gagal:\n" + "\n".join(f"• {n}" for n in gagal_list)
        await event.respond(pesan, buttons=main_menu(uid))

    elif step == "hapus_target":
        cfg = users[str(uid)]["config"]
        tl = cfg.get("target_list", [])
        if not text.isdigit() or not (1 <= int(text) <= len(tl)):
            await event.respond("⚠️ Nomor tidak valid.")
            return
        dihapus = tl.pop(int(text) - 1)
        save()
        pending.pop(uid, None)
        await event.respond(f"🗑️ Target '{dihapus['name']}' dihapus. Sisa: {len(tl)} grup.",
                            buttons=main_menu(uid))

    elif step == "set_limit":
        if not text.isdigit():
            await event.respond("⚠️ Kirim angka (0 = tanpa batas).")
            return
        cfg = users[str(uid)]["config"]
        cfg["limit"] = int(text)
        save()
        pending.pop(uid, None)
        lim = int(text)
        msg = "🔢 Limit dimatikan (kirim ke semua target)." if lim == 0 else f"🔢 Limit diset: maksimal {lim} grup per putaran."
        await event.respond(msg, buttons=main_menu(uid))

    # ---------- OWNER PANEL STEPS ----------
    elif step == "owner_makepanel_id":
        if not is_owner(uid):
            pending.pop(uid, None); return
        target_uid = text.strip()
        if not target_uid.isdigit():
            await event.respond("⚠️ USER_ID harus angka. Contoh: `7605731610`\n/cancel untuk batal.")
            return
        pending.pop(uid, None)
        try:
            import v2_panel as _vp
            kb = [[Button.inline("📦 CREATE PANEL NODEJS", f"own_mpt:{target_uid}:nodejs".encode())],
                  [Button.inline("🐍 CREATE PANEL PYTHON", f"own_mpt:{target_uid}:python".encode())]]
            kb.append([Button.inline("⬅️ Batal", b"owner_panel")])
            await event.respond(
                f"🖥️ **BIKIN PANEL GRATIS untuk `{target_uid}`**\n\n"
                "Pilih tipe panel:",
                buttons=kb,
            )
        except Exception as e:
            await event.respond(f"❌ Error: {e}", buttons=main_keyboard(uid))

    elif step == "topup_custom":
        try:
            amount = int(text.strip().replace(".", "").replace(",", ""))
        except Exception:
            await event.respond("❌ Nominal harus angka. Contoh: `15000`")
            return
        if amount < 1000:
            await event.respond("❌ Minimal topup **Rp 1.000**. Kirim nominal lebih besar.")
            return
        if amount > 10000000:
            await event.respond("❌ Maksimal topup **Rp 10.000.000** per transaksi.")
            return
        pending.pop(uid, None)
        try:
            import v2_panel as _vp
            _kb = _vp.topup_channel_kb(amount)
        except Exception as _e:
            await event.respond(f"❌ Error: {_e}")
            return
        await event.respond(f"💰 **TOPUP Rp {amount:,}**\n\nPilih metode:", buttons=_kb)

    elif step == "owner_settier":
        if not is_owner(uid):
            pending.pop(uid, None)
            return
        parts = text.split(None, 2)
        if len(parts) < 3:
            await event.respond("⚠️ Format salah. Contoh:\n`7605731610 Spesial++ 13:41, 02 Agustus 2027`")
            return
        target_uid, tier, expired = parts[0], parts[1], parts[2]
        if target_uid not in users:
            await event.respond(f"❌ User `{target_uid}` tidak ditemukan.")
            return
        users[target_uid].setdefault("config", {})["tier"] = tier
        users[target_uid]["config"]["expired"] = expired
        save()
        pending.pop(uid, None)
        await event.respond(f"✅ User `{target_uid}` diupdate:\n🏷️ Tier: **{tier}**\n🔥 Expired: **{expired}**",
                            buttons=main_keyboard(uid))
        await _send_backup_code_if_new(bot, int(target_uid))

    elif step == "owner_deluser":
        if not is_owner(uid):
            pending.pop(uid, None)
            return
        target_uid = text.strip()
        if target_uid not in users:
            await event.respond(f"❌ User `{target_uid}` tidak ditemukan.")
            return
        # Matikan userbot-nya jika aktif
        ub_target = userbots.pop(int(target_uid), None)
        if ub_target:
            try:
                await ub_target.disconnect()
            except Exception:
                pass
        del users[target_uid]
        save()
        pending.pop(uid, None)
        await event.respond(f"🗑️ User `{target_uid}` berhasil dihapus.", buttons=main_keyboard(uid))

    elif step == "owner_addsaldo":
        if not is_owner(uid):
            pending.pop(uid, None)
            return
        pending.pop(uid, None)
        parts = text.strip().split()
        if len(parts) < 2 or not parts[0].isdigit():
            await event.respond("\u26A0\uFE0F Format salah. Contoh: `7605731610 50000`\n/cancel untuk batal.")
            return
        target_uid, amount_str = parts[0], parts[1]
        try:
            amount = int(amount_str.replace(".", "").replace(",", ""))
        except ValueError:
            await event.respond("❌ Nominal harus angka. Contoh: `7605731610 50000`")
            return
        if amount <= 0:
            await event.respond("❌ Nominal harus lebih dari 0.")
            return
        import v2_panel as _vp
        in_users = str(target_uid) in users
        saldo_rec = _vp.get_saldo(int(target_uid))
        pernah = in_users or bool(saldo_rec.get("balance")) or bool(saldo_rec.get("deposit_total"))
        if not pernah:
            await event.respond(
                f"\u274C User `{target_uid}` belum pernah akses bot.\n\n"
                "Minta user kirim /start dulu, atau cek ID-nya lagi (dari @userinfobot).",
                buttons=main_keyboard(uid),
            )
            return
        rec, _ = _vp.add_saldo(int(target_uid), amount)
        await event.respond(
            f"\u2705 **SALDO DITAMBAHKAN**\n\n"
            f"\U0001F464 User ID: `{target_uid}`\n"
            f"\U0001F4B0 Nominal: **+Rp {amount:,}**\n"
            f"\U0001F4B3 Saldo sekarang: **Rp {rec.get('balance', 0):,}**",
            buttons=main_keyboard(uid),
        )
        try:
            await bot.send_message(int(target_uid),
                f"\U0001F4B0 **SALDO MASUK!**\n\n"
                f"Saldo kamu ditambah **Rp {amount:,}** oleh Owner.\n"
                f"\U0001F4B3 Saldo sekarang: **Rp {rec.get('balance', 0):,}**\n\n"
                "Langsung bisa dipakai beli panel / premium.",
                buttons=main_keyboard(int(target_uid)))
        except Exception:
            pass
    elif step == "owner_broadcast":
        if not is_owner(uid):
            pending.pop(uid, None)
            return
        pending.pop(uid, None)
        berhasil, gagal = 0, 0
        for u_id in list(users.keys()):
            try:
                await bot.send_message(int(u_id), text)
                berhasil += 1
            except Exception:
                gagal += 1
            await asyncio.sleep(0.5)
        await event.respond(f"📢 Broadcast selesai!\n✅ Terkirim: {berhasil}\n❌ Gagal: {gagal}",
                            buttons=main_keyboard(uid))

    elif step == "quick_akseskan":
        if not is_owner(uid):
            pending.pop(uid, None)
            return
        pending.pop(uid, None)
        parts = text.strip().split()
        try:
            target_uid = int(parts[0])
        except (ValueError, IndexError):
            await event.respond("❌ Format salah. USER_ID harus angka. Contoh: `8394402690` atau `8394402690 30`",
                                buttons=main_keyboard(uid))
            return
        days_arg = parts[1] if len(parts) > 1 else "lifetime"
        tier_arg = " ".join(parts[2:]) if len(parts) > 2 else "Spesial++"
        from storage import get_user as _gu
        u_target = _gu(users, str(target_uid))
        cfg_t = u_target.setdefault("config", {})
        cfg_t.pop("reminder_h3_sent", None)
        cfg_t.pop("reminder_h1_sent", None)
        cfg_t.pop("backup_sent", None)
        if days_arg.lower() in ("lifetime", "seumur", "seumurhidup", "ltd", "permanen"):
            cfg_t["tier"] = "Lifetime"
            cfg_t["premium_ends_at"] = None
            cfg_t["expired"] = "♾️ Lifetime"
            save()
            await event.respond(
                f"✅ **AKSES LIFETIME DIBERIKAN**\n\n"
                f"👤 User ID: `{target_uid}`\n"
                f"🏷️ Tier: **Lifetime** (♾️ selamanya)",
                buttons=main_keyboard(uid),
            )
            try:
                await bot.send_message(target_uid,
                    f"🎉 **KAMU DAPAT AKSES LIFETIME dari Owner!**\n\n"
                    f"🏷️ Tier: **Lifetime** (♾️ selamanya)\n\n"
                    f"Ketuk **📚 Buat Userbot** untuk mulai!\n"
                    f"👑 Owner: {config.OWNER_USERNAME}",
                    buttons=main_keyboard(target_uid))
            except Exception:
                pass
            await _send_backup_code_if_new(bot, target_uid)
            return
        try:
            days = int(days_arg)
        except ValueError:
            await event.respond(f"❌ HARI harus angka atau `lifetime`. Kamu ketik: `{days_arg}`",
                                buttons=main_keyboard(uid))
            return
        from datetime import datetime as _dt, timedelta as _td
        new_end = _dt.now() + _td(days=days)
        cur = cfg_t.get("premium_ends_at")
        if cur:
            try:
                cur_dt = _dt.fromisoformat(cur)
                if cur_dt > _dt.now():
                    new_end = cur_dt + _td(days=days)
            except Exception:
                pass
        cfg_t["tier"] = tier_arg
        cfg_t["premium_ends_at"] = new_end.isoformat()
        cfg_t["expired"] = new_end.strftime("%H:%M, %d %B %Y")
        save()
        await event.respond(
            f"✅ **AKSES PREMIUM DIBERIKAN**\n\n"
            f"👤 User ID: `{target_uid}`\n"
            f"🏷️ Tier: **{tier_arg}**\n"
            f"⏰ Berakhir: **{new_end.strftime('%H:%M, %d %B %Y')}**\n"
            f"⏳ Durasi: {days} hari",
            buttons=main_keyboard(uid),
        )
        try:
            await bot.send_message(target_uid,
                f"🎉 **KAMU DAPAT AKSES PREMIUM dari Owner!**\n\n"
                f"🏷️ Tier: **{tier_arg}**\n"
                f"⏰ Berakhir: {new_end.strftime('%H:%M, %d %B %Y')}\n\n"
                f"Ketuk **📚 Buat Userbot** untuk mulai!\n"
                f"👑 Owner: {config.OWNER_USERNAME}",
                buttons=main_keyboard(target_uid))
        except Exception:
            pass
        await _send_backup_code_if_new(bot, target_uid)



# ------------------------------------------------------------------
#  FINALIZE LOGIN -> simpan sesi & jalankan userbot
# ------------------------------------------------------------------
async def finalize_login(event, uid):
    p = pending.pop(uid, None)
    client = p["client"]
    session_str = client.session.save()
    me = await client.get_me()
    await client.disconnect()

    u = storage.get_user(users, uid)
    u["session"] = session_str
    u["phone"] = p["phone"]
    save()

    ub = UserBot(uid, session_str, u["config"], config.API_ID, config.API_HASH,
                 notify=notify, on_save=save)
    ok = await ub.connect()
    if not ok:
        await event.respond("❌ Sesi tidak valid. Ulangi Buat Userbot.")
        return
    userbots[int(uid)] = ub

    await event.respond(
        f"🎉 **USERBOT AKTIF!** ({me.first_name})\n"
        "Gunakan tombol di bawah 👇 (tinggal tap, tanpa ketik).\n"
        "Atur pesan promo & grup, lalu tekan **▶️ Mulai**.\n\n"
        "⚠️ Untuk keamanan, hapus pesan berisi OTP/password di chat ini.",
        buttons=main_keyboard(uid),
    )


# ------------------------------------------------------------------
#  MAIN
# ------------------------------------------------------------------
async def main():
    if not config.BOT_TOKEN:
        print("⚠️  BOT_TOKEN kosong. Isi di /app/backend/.env lalu restart bot.")
        return
    if not config.API_HASH or not config.API_ID:
        print("⚠️  TELEGRAM_API_ID / TELEGRAM_API_HASH kosong.")
        return
    await bot.start(bot_token=config.BOT_TOKEN)
    try:
        import report_bot
        await report_bot.start()
    except Exception as _e:
        print(f"[WARN] report bot init failed: {_e}")
    print(f"[OK] Bot manajer aktif. Owner ID: {config.OWNER_ID}")

    # Register V2 extensions
    if v2_extensions:
        v2_extensions.register(bot, {
            "users": users,
            "save": save,
            "whitelist": whitelist,
            "main_keyboard": main_keyboard,
            "is_owner": is_owner,
            "notify": notify,
        })
        print("[OK] V2 extensions active: /trial /beli /redeem /kode /akses /gentoken /tokens /approve /help")

    # Register V2 scheduler + testimoni + backup restore
    try:
        import v2_scheduler
        v2_scheduler.register_testimoni_handlers(bot, users, save, main_keyboard, is_owner)
        v2_scheduler.register_restore_backup_handler(bot, users, save, main_keyboard)
        import v3_income_report
        v3_income_report.register_report_handlers(bot, is_owner)
        asyncio.create_task(v2_scheduler.scheduler_loop(bot, users, save, None))
        import v4_monitor
        asyncio.create_task(v4_monitor.monitor_loop(bot))
        v4_monitor.register_backup_handler(bot, is_owner)
        print("[OK] V2 scheduler active: reminder H-3, backup ZIP, /rate, /testimoni_list, /laporan, /v4monitor")
    except Exception as e:
        print(f"[WARN] scheduler init failed: {e}")

    # Register V2 referral
    try:
        import v2_referral
        me = await bot.get_me()
        v2_referral.register(bot, users, save, main_keyboard, is_owner, bot_username=me.username)
        print(f"[OK] V2 referral active: /ref /undang /saldo /ref_top (bot=@{me.username})")
    except Exception as e:
        print(f"[WARN] referral init failed: {e}")

    # Register V2 nokos (sewa nomor virtual + OTP auto)
    try:
        import v2_nokos
        v2_nokos.register(bot, {
            "users": users,
            "main_keyboard": main_keyboard,
            "is_owner": is_owner,
        })
    except Exception as e:
        print(f"[WARN] nokos init failed: {e}")

    # Register V2 panel (Beli Panel + Topup + Reseller — full otomatis via Paymentku)
    try:
        import v2_panel
        v2_panel.register(bot, {
            "users": users,
            "save": save,
            "whitelist": whitelist,
            "main_keyboard": main_keyboard,
            "is_owner": is_owner,
        })
        print("[OK] V2 panel active: 🛒 Beli Panel / 💰 Topup / 🤝 Reseller (Paymentku + Pterodactyl auto)")
    except Exception as e:
        print(f"[WARN] panel init failed: {e}")

    # Hidupkan kembali userbot yang sudah punya sesi
    for uid, u in list(users.items()):
        if u.get("session"):
            try:
                ub = UserBot(uid, u["session"], u["config"], config.API_ID,
                             config.API_HASH, notify=notify, on_save=save)
                ok = await ub.connect()
                if ok:
                    userbots[int(uid)] = ub
                    print(f"[OK] Userbot {uid} dihidupkan.")
                    # Auto-start share jika config.running=True
                    if u.get("config", {}).get("running"):
                        ub.start_share()
                        print(f"[OK] Auto-share DIMULAI untuk {uid}")
            except Exception as e:
                print(f"[WARN] Gagal hidupkan userbot {uid}: {e}")

    # Tangani SIGTERM/SIGINT dengan rapi supaya log restart tidak penuh error
    try:
        for _sig in (signal.SIGTERM, signal.SIGINT):
            try:
                asyncio.get_running_loop().add_signal_handler(
                    _sig, lambda: asyncio.create_task(_shutdown_graceful()))
            except Exception:
                pass
    except Exception:
        pass

    await bot.run_until_disconnected()


if __name__ == "__main__":
    if not config.BOT_TOKEN or not config.API_HASH:
        print("=" * 55)
        print(" ⚠️  BOT_TOKEN / API_ID / API_HASH belum diisi.")
        print(" Isi di /app/backend/.env lalu restart supervisor:")
        print("   sudo supervisorctl restart telegram_bot")
        print("=" * 55)
    else:
        bot.loop.run_until_complete(main())
