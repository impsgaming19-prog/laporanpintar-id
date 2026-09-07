"""Panel + Topup + Reseller — FULL OTOMATIS.

Flow beli panel:
  1. User tekan 🛒 Beli Panel → pilih TIPE (🐍 Python / 📦 Node.js)
  2. Pilih RAM (3GB–10GB / UNLI — menu pemanis) — harga flat Rp 15.000
     RAM ASLI server SELALU dikunci maksimal 5GB (PANEL_MAX_RAM_MB), berapa pun yang dipilih.
  3. Pilih channel bayar (Paymentku) atau bayar pakai saldo
  4. Background poller cek status → kalau paid:
     - Type=panel  → create user & server Pterodactyl (username/password RANDOM,
                     egg sesuai tipe) → kirim detail akun + notif owner
     - Type=topup  → tambah saldo user

Storage:
  panel_orders.json   {order_id: {type, user_id, ptype, ram, amount, status, ...}}
  saldo.json          {user_id: {balance, is_reseller, deposit_total}}
  user_panels.json    {user_id: [{server_id, url, username, password, ptype, ram, ...}]}
"""
import asyncio
import json
import secrets
import string
import logging
from pathlib import Path
from datetime import datetime, timedelta

from telethon import events, Button

import config
import ptero_service

log = logging.getLogger("v2panel")
STATE = Path(__file__).parent

PANEL_ORDERS_FILE = STATE / "panel_orders.json"
SALDO_FILE = STATE / "saldo.json"
USER_PANELS_FILE = STATE / "user_panels.json"

# Diskon reseller (persentase dari harga produk)
DISCOUNT_PERCENT = 20   # 20% flat — safe default, ubah di sini kalau mau naikin/turunin

# Masa aktif panel (hari) — default 30 hari, auto-suspend saat expired
PANEL_DURATION_DAYS = 30
PANEL_GRACE_DAYS = 3   # setelah expired + 3 hari nggak diperpanjang → auto-DELETE

# ---------- Harga & opsi panel ----------
PANEL_PRICE = 15000     # flat Rp 15.000 untuk SEMUA tipe & RAM

# ---------- BATASAN PEMBELIAN PANEL (LIMIT) ----------
# Setiap user DIBATASI supaya resource node tidak jebol & bot tetap stabil.
# Ubah angka di sini kalau mau naikin/turunin limit (satuan MB).
# NOTE: Menu RAM itu "pemanis" — pilihan banyak (3GB–10GB / UNLI),
# tapi server yang benar-benar dibuat SELALU dikunci maksimal PANEL_MAX_RAM_MB.
# Jadi user klik 10GB / UNLI pun, RAM asli di Pterodactyl tetap 5GB.
PANEL_MAX_RAM_MB = 5120             # Max RAM ASLI per panel = 5GB (berapa pun pilihan di menu)
MAX_PANELS_PER_USER = 3             # Max panel AKTIF per user
MAX_TOTAL_RAM_MB_PER_USER = 15360   # Max TOTAL RAM semua panel aktif per user = 15GB
# Catatan: OWNER_ID bebas dari semua limit (tidak terpotong kuota).

# Tipe panel → egg Pterodactyl (nest 5: "BOT HOSTING")
# Egg id bisa di-override via env: PTERO_PY_EGG_ID / PTERO_NODE_EGG_ID / PTERO_NEST_ID
PANEL_TYPES = {
    "python": {"label": "🐍 Python", "egg_key": "python"},
    "nodejs": {"label": "📦 Node.js", "egg_key": "nodejs"},
}

# Opsi RAM di MENU (pemanis) — bebas banyak pilihan supaya terlihat bagus.
# Nilai asli yang dipakai selalu dikunci ke PANEL_MAX_RAM_MB (lihat _effective_ram_mb).
PANEL_RAM_OPTIONS = [
    {"key": "ram3",  "label": "3GB",  "mb": 3072},
    {"key": "ram4",  "label": "4GB",  "mb": 4096},
    {"key": "ram5",  "label": "5GB",  "mb": 5120},
    {"key": "ram6",  "label": "6GB",  "mb": 6144},
    {"key": "ram7",  "label": "7GB",  "mb": 7168},
    {"key": "ram8",  "label": "8GB",  "mb": 8192},
    {"key": "ram9",  "label": "9GB",  "mb": 9216},
    {"key": "ram10", "label": "10GB", "mb": 10240},
    {"key": "unli",  "label": "UNLI", "mb": 0},
]

PANEL_DISK_MB = 20480   # disk flat 20GB per server

# Order yang sedang diproses (anti double-provisioning kalau callback & poller jalan bersamaan)
_PROVISIONING = set()
# Poller cuma boleh start SEKALI (anti duplikat kalau register() dipanggil ulang)
_POLLERS_STARTED = False


def _active_panels(panels):
    """Panel yang masih terpakai (bukan deleted)."""
    return [p for p in panels if p.get("status") not in ("deleted",)]


def user_panel_quota(uid):
    """Hitung pemakaian kuota user: jumlah panel aktif + total RAM terpakai."""
    panels = _active_panels(get_user_panels(uid))
    total_ram = 0
    for p in panels:
        rm = p.get("ram_mb")
        if rm is None:
            key = p.get("ram")
            r = _ram_by_key(key) if key else None
            rm = _effective_ram_mb(r) if r else 0
        try:
            total_ram += int(rm or 0)
        except Exception:
            pass
    return {
        "count": len(panels),
        "total_ram_mb": total_ram,
        "remaining_panels": max(0, MAX_PANELS_PER_USER - len(panels)),
        "remaining_ram_mb": max(0, MAX_TOTAL_RAM_MB_PER_USER - total_ram),
    }


def check_panel_limit(uid, ram=None):
    """Cek apakah user masih boleh beli panel (dengan RAM tertentu).
    Owner bebas limit. Return: (ok, pesan_error_atau_None)."""
    if str(uid) in [str(o) for o in config.OWNER_IDS]:
        return True, None
    q = user_panel_quota(uid)
    if q["remaining_panels"] <= 0:
        return False, (
            "❌ **LIMIT PANEL TERCAPAI**\n\n"
            f"Kamu sudah punya **{q['count']} panel aktif** (maksimal {MAX_PANELS_PER_USER} panel/user).\n\n"
            f"Beli lagi setelah panel lama expired/dihapus, atau hubungi {config.OWNER_USERNAME} untuk minta upgrade limit.")
    eff_mb = _effective_ram_mb(ram) if ram else 0
    if eff_mb > 0 and eff_mb > q["remaining_ram_mb"]:
        return False, (
            "❌ **LIMIT RAM TERCAPAI**\n\n"
            f"RAM panel ini (**{ram['label']}**) melebihi sisa kuota kamu (**{q['remaining_ram_mb'] // 1024}GB**).\n"
            f"Total RAM semua panel kamu dibatasi **{MAX_TOTAL_RAM_MB_PER_USER // 1024}GB**.\n\n"
            f"Pilih RAM yang lebih kecil atau hubungi {config.OWNER_USERNAME}.")
    return True, None


def quota_line(uid):
    q = user_panel_quota(uid)
    return (f"📊 Kuota kamu: **{q['count']}/{MAX_PANELS_PER_USER} panel** · "
            f"**{q['total_ram_mb'] // 1024}GB/{MAX_TOTAL_RAM_MB_PER_USER // 1024}GB RAM** dipakai")


def _ram_by_key(key):
    for r in PANEL_RAM_OPTIONS:
        if r["key"] == key:
            return r
    return None


def _effective_ram_mb(ram):
    """RAM ASLI yang diberikan ke server.
    Pilihan menu boleh besar (10GB/UNLI), tapi server SELALU dikunci
    maksimal PANEL_MAX_RAM_MB (5GB). UNLI (mb=0) juga dikunci ke 5GB."""
    if not ram:
        return 0
    mb = int(ram.get("mb", 0) or 0)
    if mb <= 0 or mb > PANEL_MAX_RAM_MB:
        return PANEL_MAX_RAM_MB
    return mb


def _panel_label(p):
    """Label ringkas sebuah record panel (compat dengan record lama)."""
    if p.get("ptype_label") or p.get("ram_label"):
        return f"{p.get('ptype_label', '') or ''} · RAM {p.get('ram_label', '-') or '-'}".strip(" ·")
    return p.get("package_label", "Panel")


def _load(p, default):
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def _save(p, data):
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


TOPUP_NOMINALS = {
    "t_10":  10000,
    "t_25":  25000,
    "t_50":  50000,
    "t_100": 100000,
}

RESELLER_MIN_DEPOSIT = 100000  # Rp


# ---------- Saldo & Reseller helpers ----------
def get_saldo(uid):
    d = _load(SALDO_FILE, {})
    return d.get(str(uid), {"balance": 0, "is_reseller": False, "deposit_total": 0})


def add_saldo(uid, amount, order_id=None):
    d = _load(SALDO_FILE, {})
    rec = d.get(str(uid), {"balance": 0, "is_reseller": False, "deposit_total": 0})
    credited = True
    if order_id:
        done = set(rec.get("topup_orders") or [])
        if order_id in done:
            credited = False
        else:
            done.add(order_id)
            rec["topup_orders"] = sorted(done)
    if credited:
        rec["balance"] = int(rec.get("balance", 0)) + int(amount)
        rec["deposit_total"] = int(rec.get("deposit_total", 0)) + int(amount)
        if rec["deposit_total"] >= RESELLER_MIN_DEPOSIT:
            rec["is_reseller"] = True
    d[str(uid)] = rec
    _save(SALDO_FILE, d)
    return rec, credited


def charge_saldo(uid, amount):
    """Potong saldo user untuk order/beli (panel, premium, nokos, dst.).

    Return (ok, sisa_balnce).
    """
    d = _load(SALDO_FILE, {})
    rec = d.get(str(uid))
    if not rec:
        return False, 0
    bal = int(rec.get("balance", 0) or 0)
    if bal < amount:
        return False, bal
    rec["balance"] = bal - amount
    d[str(uid)] = rec
    _save(SALDO_FILE, d)
    return True, rec["balance"]


def deduct_saldo(uid, amount):
    ok, _ = charge_saldo(uid, amount)
    return ok


def add_user_panel(uid, panel_data):
    d = _load(USER_PANELS_FILE, {})
    lst = d.get(str(uid), [])
    lst.append(panel_data)
    d[str(uid)] = lst
    _save(USER_PANELS_FILE, d)


def get_user_panels(uid):
    d = _load(USER_PANELS_FILE, {})
    return d.get(str(uid), [])


def delete_user_panel(uid, server_id):
    """Tandai panel user sebagai deleted (server di Pterodactyl sudah dihapus)."""
    d = _load(USER_PANELS_FILE, {})
    for pp in d.get(str(uid), []):
        if str(pp.get("server_id")) == str(server_id):
            pp["status"] = "deleted"
            pp["deleted_at"] = datetime.now().isoformat()
            break
    _save(USER_PANELS_FILE, d)


def _gen_order_id():
    chars = string.ascii_uppercase + string.digits
    return "PNL-" + "".join(secrets.choice(chars) for _ in range(10))


def _gen_topup_id():
    chars = string.ascii_uppercase + string.digits
    return "TOP-" + "".join(secrets.choice(chars) for _ in range(10))


def _gen_panel_username():
    """Username panel acak (rendem, tidak sama antar pembeli)."""
    letters = "".join(secrets.choice(string.ascii_lowercase) for _ in range(4))
    digits = "".join(secrets.choice(string.digits) for _ in range(4))
    return f"panel{letters}{digits}"   # contoh: panelab12cd34


def _gen_panel_password():
    """Password panel acak 12 karakter (huruf besar/kecil + angka + simbol)."""
    core = "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(9))
    sym = secrets.choice("!@#$%&*")
    pw = "Panel" + core + sym
    return pw[:12]


# ---------- Paymentku invoice creation (reuse v2_extensions helper) ----------
async def _create_invoice(order_id, uid, amount, channel_code, description):
    """Buat invoice Paymentku custom (bukan plan premium)."""
    import os as _os
    import requests as _req
    PAYMENTKU_API_KEY = _os.environ.get("PAYMENTKU_API_KEY", "").strip()
    PAYMENTKU_BASE = "https://paymenku.com/api/v1"
    if not PAYMENTKU_API_KEY:
        return None, "PAYMENTKU_API_KEY belum diset"
    body = {
        "channel_code": channel_code,
        "amount": amount,
        "reference_id": order_id,
        "customer_name": f"User {uid}"[:50],
        "customer_email": f"tg{uid}@userbot.local",
        "return_url": f"https://t.me/{(config.OWNER_USERNAME or '@Kakostore_Bot').lstrip('@')}",
        "description": description[:200],
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
            lambda: _req.post(f"{PAYMENTKU_BASE}/transaction/create",
                              json=body, headers=headers, timeout=20),
        )
    except Exception as e:
        return None, f"Network: {e}"
    if r.status_code != 200:
        try:
            err = r.json().get("message", r.text[:200])
        except Exception:
            err = r.text[:200]
        return None, f"HTTP {r.status_code}: {err}"
    return r.json().get("data", {}), None


async def _check_payment(order_id):
    import os as _os
    import requests as _req
    PAYMENTKU_API_KEY = _os.environ.get("PAYMENTKU_API_KEY", "").strip()
    PAYMENTKU_BASE = "https://paymenku.com/api/v1"
    try:
        r = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _req.get(f"{PAYMENTKU_BASE}/check-status/{order_id}",
                             headers={"Authorization": f"Bearer {PAYMENTKU_API_KEY}"},
                             timeout=15),
        )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        return r.json().get("data", {}).get("status")
    except Exception:
        return None


# ---------- Provisioning (dijalankan setelah paid) ----------
def _mark_delivered(oid):
    """Tandai order sudah selesai diproses (anti double-provisioning)."""
    if not oid:
        return
    try:
        orders = _load(PANEL_ORDERS_FILE, {})
        if oid in orders:
            orders[oid]["delivered"] = True
            _save(PANEL_ORDERS_FILE, orders)
    except Exception:
        pass


async def _fix_placeholder_passwords():
    """Migrasi: ganti password panel yang ke-set teks placeholder dengan password asli."""
    try:
        d = _load(USER_PANELS_FILE, {})
        by_email = {}
        for uid, panels in d.items():
            for pp in panels:
                pw = str(pp.get("password") or "")
                if pw.startswith("(pakai"):
                    by_email.setdefault(pp.get("email") or f"tg{uid}@kakostore.local", []).append(pp)
        if not by_email:
            return
        for email, panels in by_email.items():
            try:
                user_attr, _, err = await ptero_service.find_or_create_user(email, "User", "Kako",
                                                                             f"migr{abs(hash(email)) % 99999}", password=None)
                if err or not user_attr:
                    print(f"[MIGR] user lookup gagal: {err}")
                    continue
                new_pw = _gen_panel_password()
                _, rerr = await ptero_service.reset_user_password(
                    user_attr["id"], new_pw,
                    email=user_attr.get("email") or email,
                    username=user_attr.get("username") or "panel",
                    first_name=user_attr.get("first_name"),
                    last_name=user_attr.get("last_name"),
                )
                if rerr:
                    print(f"[MIGR] reset password gagal untuk {email}: {rerr}")
                    continue
                for pp in panels:
                    pp["password"] = new_pw
            except Exception:
                continue
        _save(USER_PANELS_FILE, d)
        print("[OK] Migrasi password panel selesai.")
    except Exception as e:
        print(f"[WARN] migrasi password panel gagal: {e}")


async def _reconcile_phantom_panels():
    """Tandai panel yang servernya sudah tidak ada di Pterodactyl (phantom) sebagai deleted."""
    try:
        d = _load(USER_PANELS_FILE, {})
        changed = False
        for uid, panels in d.items():
            for pp in panels:
                if pp.get("status") not in (None, "active"):
                    continue
                sid = pp.get("server_id")
                if not sid:
                    continue
                _, err = await ptero_service.get_server(sid)
                if err and "404" in str(err):
                    pp["status"] = "deleted"
                    pp["deleted_at"] = datetime.now().isoformat()
                    changed = True
                    print(f"[PANEL] Server {sid} milik {uid} tidak ditemukan di panel - ditandai deleted.")
        if changed:
            _save(USER_PANELS_FILE, d)
            print("[PANEL] Rekonsiliasi panel phantom selesai.")
    except Exception as e:
        print(f"[WARN] rekonsiliasi panel gagal: {e}")


async def _reconcile_phantom_loop():
    """Jalankan rekonsiliasi panel phantom tiap 10 menit supaya data bot
    selalu sinkron dengan kondisi server di Pterodactyl."""
    while True:
        try:
            await _reconcile_phantom_panels()
        except Exception:
            pass
        await asyncio.sleep(600)


async def _provision_panel(bot, order):
    """Auto-create user & server di Pterodactyl (username/password RANDOM)."""
    try:
        return await _provision_panel_inner(bot, order)
    except Exception as e:
        log.exception("provision panel error")
        return False, f"provisioning error: {e}"


async def _provision_panel_inner(bot, order):
    if not ptero_service.enabled():
        return False, "Panel URL/API key belum diset"
    uid = order["user_id"]
    ptype = order.get("ptype", "python")
    ram = _ram_by_key(order.get("ram", "ram3"))
    if ptype not in PANEL_TYPES:
        return False, "Tipe panel tidak valid"
    if not ram:
        return False, "RAM tidak valid"
    # Re-check limit saat provisioning (jaga-jaga walau sudah dicek saat order)
    ok_limit, limit_msg = check_panel_limit(uid, ram)
    if not ok_limit:
        return False, limit_msg
    try:
        tg_user = await bot.get_entity(int(uid))
        first = (tg_user.first_name or "User")[:30]
        last = (tg_user.last_name or "Kako")[:30]
    except Exception:
        first, last = "User", "Kako"
    # Username, email & password RANDOM UNIK per panel — tiap panel punya akun login sendiri
    username = _gen_panel_username()
    password = _gen_panel_password()
    email = f"pnl{secrets.token_hex(4)}@kakostore.local"
    user_attr, new_password, err = await ptero_service.find_or_create_user(
        email, first, last, username, password=password,
    )
    if err:
        return False, f"user: {err}"
    if new_password:
        password = new_password  # akun baru — password yang dipakai betulan

    # Egg sesuai tipe
    if ptype == "python":
        egg_id, nest_id = ptero_service.python_egg_id(), ptero_service.nest_id()
    else:
        egg_id, nest_id = ptero_service.node_egg_id(), ptero_service.nest_id()

    server_name = f"{ptype}-{secrets.token_hex(3)}"
    server_attr, err = await ptero_service.create_server(
        pterodactyl_user_id=user_attr["id"],
        name=server_name,
        memory_mb=_effective_ram_mb(ram),   # ASLI selalu dikunci ke 5GB, berapa pun pilihan menu
        disk_mb=PANEL_DISK_MB,
        cpu_percent=0,          # 0 = unlimited CPU
        nest_id=nest_id,
        egg_id=egg_id,
    )
    if err:
        return False, f"server: {err}"
    panel_url = ptero_service._panel_url()
    now = datetime.now()
    expires_at = now + timedelta(days=PANEL_DURATION_DAYS)
    panel_record = {
        "order_id": order["order_id"],
        "ptype": ptype,
        "ptype_label": PANEL_TYPES[ptype]["label"],
        "ram": ram["key"],
        "ram_label": ram["label"],
        "ram_mb": _effective_ram_mb(ram),   # RAM asli (max 5GB) — label tetap sesuai pilihan user
        "server_id": server_attr.get("id"),
        "server_identifier": server_attr.get("identifier"),
        "server_name": server_name,
        "panel_url": panel_url,
        "username": username,
        "email": email,
        "password": password,
        "created_at": now.isoformat(),
        "expires_at": expires_at.isoformat(),
        "duration_days": PANEL_DURATION_DAYS,
        "status": "active",   # active | suspended | deleted
    }
    add_user_panel(uid, panel_record)
    return True, panel_record


async def _handle_paid(bot, order):
    """Wrapper: anti-duplikat + jaminan _PROVISIONING selalu dibersihkan."""
    oid = order.get("order_id")
    if order.get("delivered"):
        return
    # Cek ulang delivered dari file (fresh) — anti race poller vs tombol Cek Status
    try:
        fresh = _load(PANEL_ORDERS_FILE, {}).get(oid, {}) if oid else {}
    except Exception:
        fresh = {}
    if fresh.get("delivered"):
        return
    if oid and oid in _PROVISIONING:
        return
    if oid:
        _PROVISIONING.add(oid)
    try:
        await _handle_paid_worker(bot, order)
    finally:
        if oid:
            _PROVISIONING.discard(oid)


async def _handle_paid_worker(bot, order):
    otype = order.get("type")
    uid = order["user_id"]
    if otype == "panel":
        ok, result = await _provision_panel(bot, order)
        if not ok:
            await bot.send_message(int(uid),
                f"⚠️ **PANEL ORDER PAID** tapi provisioning gagal!\n\n"
                f"Order: `{order['order_id']}`\n"
                f"Error: `{result}`\n\n"
                f"Owner sedang cek. Hubungi {config.OWNER_USERNAME} kalau lebih dari 15 menit.")
            # notify owner
            try:
                await bot.send_message(int(config.OWNER_ID),
                    f"⚠️ Provisioning FAILED\nOrder: `{order['order_id']}`\nUser: `{uid}`\nError: `{result}`")
            except Exception:
                pass
            return
        # Tandai SELESAI sebelum kirim detail (kalau pengiriman pesan gagal pun
        # tidak akan dibuat server duplikat saat retry).
        _mark_delivered(order.get("order_id"))
        rec = result
        ram_disp = "Unlimited" if rec.get("ram_label") == "UNLI" else rec.get("ram_label", "-")
        created_str = rec["created_at"][:16].replace("T", " ") + " WIB"
        expired_str = rec["expires_at"][:16].replace("T", " ") + " WIB"
        pw_line = rec["password"]
        await bot.send_message(int(uid),
            f"🎉 **PANEL BERHASIL DIAKTIFKAN!**\n\n"
            f"📋 **DETAIL AKUN**\n"
            f"├ ID Panel: `{rec['order_id']}`\n"
            f"├ Tipe: {rec['ptype_label']}\n"
            f"├ Username: `{rec['username']}`\n"
            f"├ Password: `{pw_line}`\n"
            f"└ Login: {rec['panel_url']}\n\n"
            f"🖥️ **SPESIFIKASI**\n"
            f"├ RAM: {ram_disp}\n"
            f"├ CPU: Unlimited\n"
            f"└ Disk: 20GB\n\n"
            f"⏰ **MASA AKTIF**\n"
            f"├ Dibuat: {created_str}\n"
            f"├ Durasi: {PANEL_DURATION_DAYS} Hari\n"
            f"└ Expired: {expired_str}\n\n"
            f"🛡️ **FULL GARANSI**\n"
            f"└ Berlaku selama masa aktif panel.\n\n"
            f"🛟 **BUTUH BANTUAN?**\n"
            f"Jika muncul error atau panel tidak jalan, hubungi {config.OWNER_USERNAME}.\n\n"
            f"⚠️ **SIMPAN PESAN INI!** Info login tidak dikirim ulang.\n"
            f"💡 Ganti password setelah login pertama.")
        # Notif owner — ada penjualan panel baru
        try:
            await bot.send_message(int(config.OWNER_ID),
                f"🛒 **PENJUALAN PANEL BARU**\n\n"
                f"├ Order: `{rec['order_id']}`\n"
                f"├ User ID: `{uid}`\n"
                f"├ Tipe: {rec['ptype_label']}\n"
                f"├ RAM: {ram_disp}\n"
                f"└ Harga: Rp {int(order.get('amount', 0) or 0):,}")
        except Exception:
            pass
        # Auto-issue Token Login backup untuk pembeli panel (kalau belum punya)
        try:
            import v2_extensions as _v2
            backup_code, is_new = _v2.get_or_create_backup_code(str(uid), source="panel")
            if is_new:
                await bot.send_message(int(uid),
                    f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                    f"`{backup_code}`\n\n"
                    "⚠️ **SIMPAN!** Untuk restore akses kalau ganti akun / logout.\n"
                    f"Cara pakai: `/restore {backup_code}` dari akun baru.\n"
                    "🔒 Rahasiakan!")
        except Exception:
            pass
    elif otype == "topup":
        amount = int(order["amount"])
        rec, credited = add_saldo(uid, amount, order_id=order.get("order_id"))
        if not credited:
            # Sudah pernah di-credit (race poller vs tombol Cek Status) — jangan dobel
            return
        # Tandai SELESAI setelah saldo masuk (anti double-topup saat retry)
        _mark_delivered(order.get("order_id"))
        # Auto-issue Token Login backup untuk topper (belum punya?)
        try:
            import v2_extensions as _v2
            backup_code, is_new = _v2.get_or_create_backup_code(str(uid), source="topup")
        except Exception:
            backup_code, is_new = None, False
        await bot.send_message(int(uid),
            f"✅ **TOPUP SUKSES!**\n\n"
            f"💰 Nominal: **Rp {amount:,}**\n"
            f"💳 Saldo sekarang: **Rp {rec['balance']:,}**\n"
            f"📊 Total deposit: Rp {rec['deposit_total']:,}\n"
            + (f"\n🤝 **STATUS RESELLER AKTIF!** (deposit ≥ Rp {RESELLER_MIN_DEPOSIT:,})" if rec["is_reseller"] else ""))
        if backup_code and is_new:
            try:
                await bot.send_message(int(uid),
                    f"🔑 **TOKEN LOGIN BACKUP KAMU**\n\n"
                    f"`{backup_code}`\n\n"
                    "⚠️ **SIMPAN!** Untuk restore akses kalau ganti akun / logout.\n"
                    f"Cara pakai: `/restore {backup_code}` dari akun baru.\n"
                    "🔒 Rahasiakan!")
            except Exception:
                pass


# ---------- Background poller ----------
async def _panel_expiry_loop(bot):
    """Loop cek panel yang expired setiap 1 jam.
    - H-3 & H-1 → notify user
    - Expired → auto-suspend
    - Expired + grace 3 hari → auto-delete
    """
    notified_expiring = set()   # (uid, server_id, day_marker) sudah dinotif
    while True:
        try:
            all_panels = _load(USER_PANELS_FILE, {})
            changed = False
            for uid, panels in list(all_panels.items()):
                for p in panels:
                    if p.get("status") == "deleted":
                        continue
                    exp_str = p.get("expires_at", "")
                    if not exp_str:
                        continue
                    try:
                        exp = datetime.fromisoformat(exp_str)
                    except Exception:
                        continue
                    days_left = (exp - datetime.now()).total_seconds() / 86400
                    sid = p.get("server_id")

                    # H-3 & H-1 reminder
                    for d in (3, 1):
                        if 0 < days_left <= d and (uid, sid, d) not in notified_expiring:
                            notified_expiring.add((uid, sid, d))
                            try:
                                await bot.send_message(int(uid),
                                    f"⚠️ **PANEL AKAN EXPIRED**\n\n"
                                    f"📦 {_panel_label(p)}\n"
                                    f"🔗 {p['panel_url']}\n"
                                    f"⏰ Sisa: **~{d} hari**\n"
                                    f"📅 Expired: {exp_str[:16]}\n\n"
                                    f"💡 Perpanjang sebelum expired biar server nggak di-suspend.\n"
                                    f"Chat owner atau tekan **🛒 Shop → Perpanjang Panel**.")
                            except Exception:
                                pass

                    # Expired → suspend
                    if days_left <= 0 and p.get("status") == "active" and sid:
                        ok, err = await ptero_service.suspend_server(sid)
                        if ok:
                            p["status"] = "suspended"
                            p["suspended_at"] = datetime.now().isoformat()
                            changed = True
                            try:
                                await bot.send_message(int(uid),
                                    f"⛔ **PANEL SUSPENDED — EXPIRED**\n\n"
                                    f"📦 {_panel_label(p)}\n"
                                    f"🔗 {p['panel_url']}\n"
                                    f"⏰ Expired: {exp_str[:16]}\n\n"
                                    f"⚠️ Server & data masih ada tapi TIDAK BISA DIAKSES.\n"
                                    f"Perpanjang dalam **{PANEL_GRACE_DAYS} hari** biar data nggak dihapus permanen.\n\n"
                                    f"Chat owner untuk perpanjang.")
                            except Exception:
                                pass

                    # Grace expired → delete
                    if p.get("status") == "suspended" and sid:
                        try:
                            susp = datetime.fromisoformat(p.get("suspended_at", ""))
                            if (datetime.now() - susp).total_seconds() / 86400 >= PANEL_GRACE_DAYS:
                                ok, err = await ptero_service.delete_server(sid)
                                if ok:
                                    p["status"] = "deleted"
                                    p["deleted_at"] = datetime.now().isoformat()
                                    changed = True
                                    try:
                                        await bot.send_message(int(uid),
                                            f"🗑️ **PANEL DIHAPUS PERMANEN**\n\n"
                                            f"📦 {_panel_label(p)}\n"
                                            f"Panel `{p.get('server_name', '')}` sudah lewat grace period {PANEL_GRACE_DAYS} hari.\n"
                                            f"Semua data server hilang. Order baru via **🛒 Shop → Beli Panel**.")
                                    except Exception:
                                        pass
                        except Exception:
                            pass
            if changed:
                _save(USER_PANELS_FILE, all_panels)
        except Exception as e:
            log.exception(f"panel_expiry_loop: {e}")
        await asyncio.sleep(3600)  # cek tiap 1 jam


# ---------- Background poller (payment) ----------
def _set_order_status(oid, status, paid_at=None):
    """Update status order di file tanpa ngerombak field lain (anti clobber)."""
    try:
        orders = _load(PANEL_ORDERS_FILE, {})
        if oid not in orders:
            return
        orders[oid]["status"] = status
        if paid_at:
            orders[oid]["paid_at"] = paid_at
        _save(PANEL_ORDERS_FILE, orders)
    except Exception:
        pass


async def _poller_loop(bot):
    while True:
        try:
            orders = _load(PANEL_ORDERS_FILE, {})
            for oid, o in list(orders.items()):
                if o.get("status") != "pending":
                    continue
                # Skip if too old (>2 hours)
                try:
                    created = datetime.fromisoformat(o.get("created_at", ""))
                    if (datetime.now() - created).total_seconds() > 7200:
                        _set_order_status(oid, "expired")
                        continue
                except Exception:
                    pass
                status = await _check_payment(oid)
                if status == "paid":
                    _set_order_status(oid, "paid", paid_at=datetime.now().isoformat())
                    try:
                        await _handle_paid(bot, o)
                    except Exception as e:
                        log.exception(f"handle_paid: {e}")
                elif status in ("expired", "failed", "canceled"):
                    _set_order_status(oid, status)
        except Exception as e:
            log.exception(f"poller: {e}")
        await asyncio.sleep(20)


# ---------- Register callbacks ----------
def register(bot, ctx):
    users = ctx["users"]
    main_keyboard = ctx["main_keyboard"]
    is_owner = ctx["is_owner"]

    # ==== BELI PANEL ====
    @bot.on(events.CallbackQuery(pattern=rb"^ptype:(.+)$"))
    async def _ptype_cb(event):
        t = event.pattern_match.group(1).decode()
        if t not in PANEL_TYPES:
            await event.answer("Tipe tidak valid", alert=True); return
        try:
            qline = quota_line(event.sender_id)
        except Exception:
            qline = ""
        await event.edit(
            f"{PANEL_TYPES[t]['label']} **CREATE PANEL — Rp {PANEL_PRICE:,}**\n\n"
            f"{qline}\n"
            f"⚖️ Max **{MAX_PANELS_PER_USER} panel** per user\n\n"
            "Pilih spesifikasi RAM:",
            buttons=ram_menu(t))

    @bot.on(events.CallbackQuery(pattern=rb"^pram:([^:]+):(.+)$"))
    async def _pram_cb(event):
        t = event.pattern_match.group(1).decode()
        ram_key = event.pattern_match.group(2).decode()
        if t not in PANEL_TYPES:
            await event.answer("Tipe tidak valid", alert=True); return
        ram = _ram_by_key(ram_key)
        if not ram:
            await event.answer("RAM tidak valid", alert=True); return
        ok, err = check_panel_limit(event.sender_id, ram)
        if not ok:
            await event.edit(err,
                             buttons=[[Button.inline("⬅️ Kembali", b"panel_beli")]])
            return
        kb = [
            [Button.inline("🟢 Bayar QRIS", f"panelch:{t}:{ram_key}:qris".encode())],
            [Button.inline("💰 Bayar pakai Saldo", f"panelsaldo:{t}:{ram_key}".encode())],
            [Button.inline("⬅️ Batal", b"menu")],
        ]
        await event.edit(
            f"🛒 **{PANEL_TYPES[t]['label']} — RAM {ram['label']}**\n"
            f"Total: **Rp {PANEL_PRICE:,}**\n\n"
            "Pilih metode pembayaran:",
            buttons=kb)

    @bot.on(events.CallbackQuery(pattern=rb"^panelsaldo:([^:]+):(.+)$"))
    async def _panel_saldo_cb(event):
        uid = str(event.sender_id)
        t = event.pattern_match.group(1).decode()
        ram_key = event.pattern_match.group(2).decode()
        if t not in PANEL_TYPES:
            await event.answer("Tipe tidak valid", alert=True); return
        ram = _ram_by_key(ram_key)
        if not ram:
            await event.answer("RAM tidak valid", alert=True); return
        ok, err = check_panel_limit(event.sender_id, ram)
        if not ok:
            await event.edit(err,
                             buttons=[[Button.inline("⬅️ Kembali", b"panel_beli")]])
            return
        amount = PANEL_PRICE
        rec = get_saldo(event.sender_id)
        bal = int(rec.get("balance", 0)) if isinstance(rec, dict) else int(rec or 0)
        if bal < amount:
            await event.edit(
                f"❌ Saldo tidak cukup.\n💰 Saldo: Rp {bal:,}\n🛒 Harga: Rp {amount:,}\n➖ Kurang: Rp {amount-bal:,}\n\nSilakan Topup Saldo dulu.",
                buttons=[[Button.inline("⬅️ Menu", b"menu")]])
            return
        deduct_saldo(event.sender_id, amount)
        order_id = _gen_order_id()
        order = {"order_id": order_id, "type": "panel", "user_id": uid,
                 "ptype": t, "ram": ram_key, "amount": amount, "channel": "saldo",
                 "status": "paid", "paid_at": datetime.now().isoformat(),
                 "created_at": datetime.now().isoformat()}
        orders = _load(PANEL_ORDERS_FILE, {})
        orders[order_id] = order
        _save(PANEL_ORDERS_FILE, orders)
        _label = f"{PANEL_TYPES[t]['label']} · RAM {ram['label']}"
        await event.edit(f"✅ Bayar pakai saldo sukses!\n🛒 {_label}\n💰 Saldo dipotong: Rp {amount:,}\n\n⏳ Panel sedang dibuat... (<1 menit)", buttons=None)
        try:
            await _handle_paid(bot, order)
        except Exception as _e:
            await event.respond(f"⚠️ Panel gagal dibuat otomatis: {_e}\nHubungi admin (saldo sudah terpotong).")

    @bot.on(events.CallbackQuery(pattern=rb"^panelch:([^:]+):([^:]+):(.+)$"))
    async def _panelch_cb(event):
        uid = str(event.sender_id)
        t = event.pattern_match.group(1).decode()
        ram_key = event.pattern_match.group(2).decode()
        channel = event.pattern_match.group(3).decode()
        if t not in PANEL_TYPES:
            await event.answer("Tipe tidak valid", alert=True); return
        ram = _ram_by_key(ram_key)
        if not ram:
            await event.answer("RAM tidak valid", alert=True); return
        ok, err = check_panel_limit(event.sender_id, ram)
        if not ok:
            await event.edit(err,
                             buttons=[[Button.inline("⬅️ Kembali", b"panel_beli")]])
            return
        await event.edit("⏳ Membuat invoice Paymentku...", buttons=None)
        order_id = _gen_order_id()
        amount = PANEL_PRICE
        data, err = await _create_invoice(order_id, uid, amount, channel,
                                           f"Panel {PANEL_TYPES[t]['label']} {ram['label']}")
        if err:
            await event.edit(f"❌ Gagal buat invoice\n`{err}`",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])
            return
        orders = _load(PANEL_ORDERS_FILE, {})
        orders[order_id] = {
            "order_id": order_id, "type": "panel", "user_id": uid,
            "ptype": t, "ram": ram_key, "amount": amount, "channel": channel,
            "status": "pending", "pay_url": data.get("pay_url"),
            "payment_info": data.get("payment_info", {}),
            "created_at": datetime.now().isoformat(),
        }
        _save(PANEL_ORDERS_FILE, orders)
        pinfo = data.get("payment_info", {})
        lines = [f"🧾 **INVOICE PANEL** ({channel.upper()})", "",
                 f"🆔 Order: `{order_id}`",
                 f"📦 Tipe: **{PANEL_TYPES[t]['label']} — RAM {ram['label']}**",
                 f"💰 Total: **Rp {int(float(data.get('amount', amount))):,}**", ""]
        if pinfo.get("va_number"):
            lines += [f"🏦 Bank: **{pinfo.get('bank', channel.upper())}**",
                      f"🔢 VA: `{pinfo['va_number']}`",
                      f"⏰ Expire: {pinfo.get('expiration_date', '-')}"]
        elif pinfo.get("qr_url"):
            lines += [f"🔗 QR: {pinfo['qr_url']}",
                      f"⏰ Expire: {pinfo.get('expiration_date', '-')}"]
        elif pinfo.get("checkout_url"):
            lines += [f"🔗 Bayar: {pinfo['checkout_url']}",
                      f"⏰ Expire: {pinfo.get('expiration_date', '-')}"]
        lines += ["",
                  f"🌐 Link bayar: {data.get('pay_url', '-')}", "",
                  "✅ Setelah bayar, panel **auto-dibuat** dalam <1 menit.",
                  "🔑 Login (URL/username/password) dikirim ke chat ini."]
        kb = [[Button.url("💳 Bayar Sekarang", data.get("pay_url", "https://paymenku.com"))],
              [Button.inline("🔄 Cek Status", f"pnlchk:{order_id}".encode())],
              [Button.inline("⬅️ Menu", b"menu")]]
        await event.edit("\n".join(lines), buttons=kb)

    @bot.on(events.CallbackQuery(pattern=rb"^pnlchk:(.+)$"))
    async def _pnl_check_cb(event):
        oid = event.pattern_match.group(1).decode()
        orders = _load(PANEL_ORDERS_FILE, {})
        o = orders.get(oid)
        if not o:
            await event.answer("Order tidak ditemukan", alert=True); return
        if o["status"] == "paid" or o.get("delivered"):
            _done_msg = "saldo sudah masuk" if o.get("type") == "topup" else "detail panel sudah dikirim"
            await event.answer(f"✅ PAID — {_done_msg}. Cek chat.", alert=True); return
        try:
            status = await _check_payment(oid)
        except Exception:
            status = None
        if status == "paid" and o["status"] != "paid":
            o["status"] = "paid"; o["paid_at"] = datetime.now().isoformat()
            _save(PANEL_ORDERS_FILE, orders)
            try:
                await _handle_paid(bot, o)
                if o.get("type") == "topup":
                    await event.answer("✅ PAID — saldo masuk!", alert=True)
                else:
                    await event.answer("✅ PAID — panel sedang dibuat...", alert=True)
            except Exception as e:
                await event.answer(f"⚠️ Order paid tapi ada kendala: {e} — hubungi admin", alert=True)
        else:
            await event.answer(f"Status: {status or 'pending'}", alert=True)

    # ==== TOPUP ====
    @bot.on(events.CallbackQuery(pattern=rb"^topup_n:(.+)$"))
    async def _topup_nominal_cb(event):
        nom_key = event.pattern_match.group(1).decode()
        amount = TOPUP_NOMINALS.get(nom_key)
        if not amount:
            await event.answer("Nominal invalid", alert=True); return
        await event.edit(f"💰 **TOPUP Rp {amount:,}**\n\nPilih metode:", buttons=topup_channel_kb(amount))

    # Pencatatan saldo pakai saldo_bot (bukan saldo_kost) biar satu pintu:
    # topup → beli panel / premium / nokos sama-sama.
    @bot.on(events.CallbackQuery(pattern=rb"^topupch:(\d+):(.+)$"))
    async def _topup_ch_cb(event):
        uid = str(event.sender_id)
        channel = event.pattern_match.group(2).decode()
        try:
            amount = int(event.pattern_match.group(1).decode())
        except Exception:
            await event.answer("Invalid", alert=True); return
        if amount < 1000:
            await event.answer("Minimal topup Rp 1.000", alert=True); return
        await event.edit("⏳ Membuat invoice...", buttons=None)
        order_id = _gen_topup_id()
        data, err = await _create_invoice(order_id, uid, amount, channel,
                                           f"Topup Saldo Rp {amount:,}")
        if err:
            await event.edit(f"❌ Gagal: {err}",
                             buttons=[[Button.inline("⬅️ Kembali", b"menu")]])
            return
        orders = _load(PANEL_ORDERS_FILE, {})
        orders[order_id] = {
            "order_id": order_id, "type": "topup", "user_id": uid,
            "amount": amount, "channel": channel, "status": "pending",
            "pay_url": data.get("pay_url"),
            "payment_info": data.get("payment_info", {}),
            "created_at": datetime.now().isoformat(),
        }
        _save(PANEL_ORDERS_FILE, orders)
        pinfo = data.get("payment_info", {})
        lines = ["🧾 **INVOICE TOPUP SALDO**", "",
                 f"🆔 Order: `{order_id}`",
                 f"💰 Nominal: **Rp {amount:,}**", "",
                 "Gunakan saldo ini bukti beli: 💎 Premium, 🖥️ Panel, 📱 Nokos, dan produk lainnya.", ""]
        if pinfo.get("va_number"):
            lines += [f"🔢 VA: `{pinfo['va_number']}`",
                      f"⏰ Expire: {pinfo.get('expiration_date', '-')}"]
        elif pinfo.get("qr_url"):
            lines += [f"🔗 QR: {pinfo['qr_url']}"]
        elif pinfo.get("checkout_url"):
            lines += [f"🔗 Bayar: {pinfo['checkout_url']}"]
        lines += ["", f"🌐 Link: {data.get('pay_url', '-')}",
                  "", "✅ Saldo masuk **otomatis** setelah bayar."]
        kb = [[Button.url("💳 Bayar", data.get("pay_url", "https://paymenku.com"))],
              [Button.inline("🔄 Cek Status", f"pnlchk:{order_id}".encode())],
              [Button.inline("⬅️ Kembali", b"menu")]]
        await event.edit("\n".join(lines), buttons=kb)

    # ==== /panel & /saldo command ====
    @bot.on(events.NewMessage(pattern=r"^/panel$"))
    async def _panel_cmd(event):
        panels = get_user_panels(event.sender_id)
        if not panels:
            await event.respond(
                "🖥️ **PANEL SAYA**\n\nKamu belum punya panel aktif.\n\n"
                "🛒 Beli panel dulu — tekan **🛒 Beli Panel** di menu."); return
        lines = [f"🖥️ **PANEL SAYA** ({len(panels)} aktif)\n"]
        for i, p in enumerate(panels, 1):
            lines.append(
                f"**{i}. {_panel_label(p)}**\n"
                f"🔗 {p['panel_url']}\n"
                f"👤 `{p['username']}` · 🔑 `{p['password']}`\n"
                f"📅 Dibuat: {p['created_at'][:10]}\n"
                f"⏰ Expired: {p.get('expires_at', '')[:10]}\n")
        await event.respond("\n".join(lines))

    @bot.on(events.NewMessage(pattern=r"^/saldo$"))
    async def _saldo_cmd(event):
        rec = get_saldo(event.sender_id)
        status = "🤝 **RESELLER**" if rec["is_reseller"] else "👤 Regular"
        await event.respond(
            f"💰 **SALDO KAMU**\n\n"
            f"Balance: **Rp {rec['balance']:,}**\n"
            f"Total deposit: Rp {rec['deposit_total']:,}\n"
            f"Status: {status}\n"
            + (f"\n🎁 Diskon {DISCOUNT_PERCENT}% aktif untuk semua pembelian pakai saldo!" if rec["is_reseller"] else
               f"\n💡 Topup ≥ Rp {RESELLER_MIN_DEPOSIT:,} untuk jadi reseller."))

    # ==== Start pollers (hanya sekali — anti duplikat kalau register() dipanggil ulang) ====
    global _POLLERS_STARTED
    if not _POLLERS_STARTED:
        _POLLERS_STARTED = True
        try:
            _loop = asyncio.get_event_loop()
        except Exception:
            _loop = asyncio.new_event_loop()
        _loop.create_task(_poller_loop(bot))
        _loop.create_task(_panel_expiry_loop(bot))
        _loop.create_task(_fix_placeholder_passwords())
        _loop.create_task(_reconcile_phantom_panels())
        _loop.create_task(_reconcile_phantom_loop())


# ---------- Menu builders (dipanggil dari manager_bot) ----------
def panel_beli_menu():
    """Menu awal beli panel: pilih tipe (Python / Node.js)."""
    return [
        [Button.inline("📦 CREATE PANEL NODEJS", b"ptype:nodejs")],
        [Button.inline("🐍 CREATE PANEL PYTHON", b"ptype:python")],
        [Button.inline("📋 PANEL SAYA", b"panel_saya")],
        [Button.inline("🔙 KEMBALI", b"menu")],
    ]


def ram_menu(t):
    """Menu pilih RAM untuk tipe panel tertentu."""
    icon = "🐍" if t == "python" else "📦"
    kb = [[Button.inline(f"{icon} {r['label']}", f"pram:{t}:{r['key']}".encode())]
          for r in PANEL_RAM_OPTIONS]
    kb.append([Button.inline("🔙 KEMBALI", b"panel_beli")])
    return kb


def topup_menu():
    kb = [[Button.inline(f"💰 Rp {a:,}", f"topup_n:{k}".encode())]
          for k, a in TOPUP_NOMINALS.items()]
    kb.append([Button.inline("✍️ Nominal Lain (bebas, min Rp 1.000)", b"topup_custom")])
    kb.append([Button.inline("⬅️ Kembali", b"menu")])
    return kb


def topup_channel_kb(amount):
    """Pembayaran QRIS aja — biar simpel & gak bingung."""
    return [
        [Button.inline("🟢 Bayar QRIS", f"topupch:{amount}:qris".encode())],
        [Button.inline("⬅️ Batal", b"menu")],
    ]
