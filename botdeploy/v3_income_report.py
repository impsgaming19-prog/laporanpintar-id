# -*- coding: utf-8 -*-
"""Laporan Penghasilan Bulanan -> Owner.

Penghasilan CUSTOMER (dihitung sebagai pemasukan) dipisah dari:
  - Pemakaian INTERNAL (transaksi akun owner sendiri — config.OWNER_IDS)
  - AKSES GRATIS (token premium yang diberikan owner, bukan pemasukan)

Saluran: Telegram DM owner (utama) + Email via Resend (bonus).

Sumber data:
  - payments.json      -> order premium (status paid)
  - panel_orders.json  -> order panel & topup saldo (status paid)
  - tokens.json        -> token gratis yang diredeem
"""
import json
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import config  # memuat dotenv backend/.env -> RESEND_API_KEY, OWNER_EMAIL, OWNER_IDS

log = logging.getLogger("v3report")

BASE_DIR = Path(__file__).parent
PAYMENTS_FILE = BASE_DIR / "payments.json"
PANEL_ORDERS_FILE = BASE_DIR / "panel_orders.json"
TOKENS_FILE = BASE_DIR / "tokens.json"
STATE_FILE = BASE_DIR / "report_state.json"

BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
         "Juli", "Agustus", "September", "Oktober", "November", "Desember"]

TIER_LABEL = {
    "spesial": "Spesial",
    "spesial_plus": "Spesial++",
    "spesial++": "Spesial++",
    "lifetime": "Lifetime",
    "premium": "Premium",
}

# Estimasi harga 30 hari (buat nilai token gratis)
PRICE_30D = {"spesial": 20000, "spesial_plus": 35000, "spesial++": 35000, "lifetime": 35000}

CAT_ICON = {"premium": "💎", "panel": "🖥️", "topup": "💰"}


def _load(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def _save(p, data):
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _fmt_rp(n):
    return "Rp " + format(int(n or 0), ",").replace(",", ".")


def _bulan_str(month):
    return BULAN[month] if 0 < month < 13 else str(month)


def _is_internal(uid):
    """Apakah user termasuk akun internal (owner sendiri)?"""
    try:
        uid_i = int(str(uid))
    except Exception:
        return False
    return uid_i in getattr(config, "OWNER_IDS", [7605731610])


def build_monthly_report(year, month):
    """Kumpulkan pemasukan bulan tsb, dipisah customer vs internal + token gratis."""
    payments = _load(PAYMENTS_FILE, {})
    orders = _load(PANEL_ORDERS_FILE, {})
    prefix = "%04d-%02d" % (year, month)
    rows = []
    total = 0
    by_cat = {"premium": 0, "panel": 0, "topup": 0}

    def _add(oid, uid, paid_at, cat, detail, amount):
        nonlocal total
        try:
            amount = int(amount or 0)
        except Exception:
            amount = 0
        if amount <= 0:
            return
        total += amount
        by_cat[cat] = by_cat.get(cat, 0) + amount
        rows.append({
            "date": (paid_at or "")[:10],
            "oid": oid,
            "uid": str(uid),
            "internal": _is_internal(uid),
            "cat": cat,
            "detail": detail,
            "amount": amount,
        })

    for oid, p in payments.items():
        if p.get("status") != "paid":
            continue
        paid_at = p.get("paid_at") or p.get("created_at") or ""
        if not paid_at.startswith(prefix):
            continue
        tier_raw = str(p.get("tier", "")).lower()
        tier = TIER_LABEL.get(tier_raw, str(p.get("tier", "Premium")) or "Premium")
        plan = str(p.get("plan", "") or "")
        detail = "Premium " + tier + ((" (" + plan + ")") if plan else "")
        _add(oid, p.get("user_id", "?"), paid_at, "premium", detail, p.get("amount"))

    for oid, o in orders.items():
        if o.get("status") != "paid":
            continue
        paid_at = o.get("paid_at") or o.get("created_at") or ""
        if not paid_at.startswith(prefix):
            continue
        typ = o.get("type", "panel")
        if typ == "topup":
            _add(oid, o.get("user_id", "?"), paid_at, "topup", "Topup Saldo", o.get("amount"))
        else:
            pkg = str(o.get("package", "") or "panel")
            _add(oid, o.get("user_id", "?"), paid_at, "panel", "Panel (" + pkg + ")", o.get("amount"))

    rows.sort(key=lambda r: r["date"])
    customer_rows = [r for r in rows if not r["internal"]]
    internal_rows = [r for r in rows if r["internal"]]
    total_customer = sum(r["amount"] for r in customer_rows)
    total_internal = sum(r["amount"] for r in internal_rows)

    # Token gratis yang diredeem bulan ini
    tokens = _load(TOKENS_FILE, {})
    free_tokens = []
    total_free = 0
    for tid, t in tokens.items():
        used_at = t.get("used_at") or ""
        if not used_at.startswith(prefix):
            continue
        try:
            days = int(t.get("days") or 30)
        except Exception:
            days = 30
        tier_raw = str(t.get("tier", "")).lower()
        price = PRICE_30D.get(tier_raw, 0)
        est = round(price * days / 30)
        total_free += est
        free_tokens.append({
            "tid": tid,
            "tier": TIER_LABEL.get(tier_raw, str(t.get("tier", "Premium")) or "Premium"),
            "days": days,
            "uid": str(t.get("used_by", "?")),
            "date": used_at[:10],
            "est": est,
        })

    def _cat_sum(cat_rows, cat):
        return sum(r["amount"] for r in cat_rows if r["cat"] == cat)

    return {
        "year": year,
        "month": month,
        "rows": rows,
        "customer_rows": customer_rows,
        "internal_rows": internal_rows,
        "total_customer": total_customer,
        "total_internal": total_internal,
        "free_tokens": free_tokens,
        "total_free": total_free,
        # breakdown khusus customer (biar konsisten sama total customer)
        "premium": _cat_sum(customer_rows, "premium"),
        "panel": _cat_sum(customer_rows, "panel"),
        "topup": _cat_sum(customer_rows, "topup"),
        "n_customers": len({r["uid"] for r in customer_rows}),
        "n_rows": len(rows),
    }


def _rows_block(rows, icon_map=None):
    icon_map = icon_map or CAT_ICON
    if not rows:
        return ["ℹ️ Tidak ada transaksi."]
    lines = []
    for i, r in enumerate(rows[:30], 1):
        icon = icon_map.get(r["cat"], "•")
        lines.append("%d. %s · %s %s · %s" % (i, r["date"][5:], icon, r["detail"], _fmt_rp(r["amount"])))
    if len(rows) > 30:
        lines.append("...dan %d transaksi lainnya" % (len(rows) - 30))
    return lines


def report_full_text(rp):
    """Teks lengkap untuk Telegram (ringkasan + rincian terpisah)."""
    lines = [
        "📊 **LAPORAN PENGHASILAN**",
        "📅 Periode: **%s %d**" % (_bulan_str(rp["month"]), rp["year"]),
        "",
        "💰 **TOTAL CUSTOMER: %s**" % _fmt_rp(rp["total_customer"]),
        "💎 Premium: %s" % _fmt_rp(rp["premium"]),
        "🖥️ Panel: %s" % _fmt_rp(rp["panel"]),
        "💰 Topup Saldo: %s" % _fmt_rp(rp["topup"]),
        "🧾 %d transaksi · %d pembeli (customer)" % (len(rp["customer_rows"]), rp["n_customers"]),
    ]
    lines.append("")
    lines.append("━━━━━ RINCIAN CUSTOMER ━━━━━")
    lines += _rows_block(rp["customer_rows"])
    lines.append("")
    lines.append("━━━━━ PEMAKAIAN INTERNAL (OWNER) ━━━━━")
    lines.append("💰 %s · %d transaksi akun sendiri (bukan pemasukan)" % (
        _fmt_rp(rp["total_internal"]), len(rp["internal_rows"])))
    lines += _rows_block(rp["internal_rows"])
    lines.append("")
    lines.append("━━━━━ AKSES GRATIS (TOKEN) ━━━━━")
    if rp["free_tokens"]:
        for t in rp["free_tokens"]:
            lines.append("• %s · %s %d hr · user %s · ± %s" % (
                t["date"], t["tier"], t["days"], t["uid"], _fmt_rp(t["est"])))
        lines.append("Nilai total akses gratis: ± %s" % _fmt_rp(rp["total_free"]))
    else:
        lines.append("ℹ️ Tidak ada token diredeem bulan ini.")
    return "\n".join(lines)


def report_summary_text(rp):
    lines = [
        "📊 **LAPORAN PENGHASILAN**",
        "📅 Periode: **%s %d**" % (_bulan_str(rp["month"]), rp["year"]),
        "",
        "💰 **TOTAL CUSTOMER: %s**" % _fmt_rp(rp["total_customer"]),
        "🧾 %d transaksi · %d pembeli" % (len(rp["customer_rows"]), rp["n_customers"]),
        "",
        "📦 Internal (owner): %s (%d trx)" % (_fmt_rp(rp["total_internal"]), len(rp["internal_rows"])),
        "🎁 Token gratis: ± %s" % _fmt_rp(rp["total_free"]),
    ]
    return "\n".join(lines)


def _card(label, value, color):
    return (
        "<td style='padding:14px 16px;background:#f8fafc;border-radius:12px;"
        "border:1px solid #e2e8f0;text-align:center'>"
        "<div style='font-size:12px;color:#64748b;margin-bottom:4px'>" + label + "</div>"
        "<div style='font-size:18px;font-weight:700;color:" + color + "'>" + value + "</div></td>"
    )


def _html_table(rows):
    if not rows:
        return (
            "<tr><td colspan='4' style='padding:18px;text-align:center;color:#94a3b8'>"
            "Tidak ada transaksi.</td></tr>"
        )
    out = ""
    for r in rows[:40]:
        icon = CAT_ICON.get(r["cat"], "•")
        out += (
            "<tr style='border-bottom:1px solid #f1f5f9'>"
            "<td style='padding:8px 10px;white-space:nowrap;color:#64748b'>" + r["date"] + "</td>"
            "<td style='padding:8px 10px'>" + icon + " " + r["detail"] + "</td>"
            "<td style='padding:8px 10px;color:#64748b;font-size:12px'>" + r["uid"] + "</td>"
            "<td style='padding:8px 10px;text-align:right;font-weight:600'>" + _fmt_rp(r["amount"]) + "</td></tr>"
        )
    if len(rows) > 40:
        out += (
            "<tr><td colspan='4' style='padding:10px;text-align:center;color:#94a3b8'>"
            "...dan %d transaksi lainnya</td></tr>" % (len(rows) - 40)
        )
    return out


def build_html(rp):
    bln = _bulan_str(rp["month"])
    free_html = ""
    if rp["free_tokens"]:
        for t in rp["free_tokens"][:20]:
            free_html += (
                "<tr style='border-bottom:1px solid #f1f5f9'>"
                "<td style='padding:8px 10px;white-space:nowrap;color:#64748b'>" + t["date"] + "</td>"
                "<td style='padding:8px 10px'>🎁 " + t["tier"] + " " + str(t["days"]) + " hari</td>"
                "<td style='padding:8px 10px;color:#64748b;font-size:12px'>" + t["uid"] + "</td>"
                "<td style='padding:8px 10px;text-align:right;font-weight:600;color:#f59e0b'>± " + _fmt_rp(t["est"]) + "</td></tr>"
            )
    else:
        free_html = (
            "<tr><td colspan='4' style='padding:18px;text-align:center;color:#94a3b8'>"
            "Tidak ada token diredeem bulan ini.</td></tr>"
        )
    return (
        "<!DOCTYPE html><html><body style='margin:0;padding:0;background:#eef2f7;"
        "font-family:Arial,Helvetica,sans-serif'>"
        "<div style='max-width:640px;margin:0 auto;padding:24px 16px'>"
        "<div style='background:linear-gradient(135deg,#1e293b,#334155);border-radius:16px;"
        "padding:26px 24px;color:#fff'>"
        "<div style='font-size:13px;opacity:.75'>KAKOSTORE · Laporan Bulanan</div>"
        "<div style='font-size:22px;font-weight:700;margin-top:6px'>📊 Laporan Penghasilan " + bln + " " + str(rp["year"]) + "</div>"
        "<div style='margin-top:18px;font-size:13px;opacity:.85'>" + str(len(rp["customer_rows"])) + " transaksi customer · " + str(rp["n_customers"]) + " pembeli</div>"
        "</div>"
        "<div style='background:#fff;border-radius:16px;padding:26px 24px;margin-top:16px;"
        "box-shadow:0 1px 3px rgba(0,0,0,.06)'>"
        "<div style='font-size:13px;color:#64748b'>TOTAL PENGHASILAN CUSTOMER</div>"
        "<div style='font-size:34px;font-weight:800;color:#0f172a;margin-top:4px'>" + _fmt_rp(rp["total_customer"]) + "</div>"
        "<table style='width:100%;border-collapse:separate;border-spacing:8px;margin-top:14px'><tr>"
        + _card("💎 Premium", _fmt_rp(rp["premium"]), "#0ea5e9")
        + _card("🖥️ Panel", _fmt_rp(rp["panel"]), "#8b5cf6")
        + _card("💰 Topup Saldo", _fmt_rp(rp["topup"]), "#10b981")
        + "</tr></table>"
        "<div style='margin-top:14px;padding:12px 14px;background:#fef3c7;border-radius:10px;"
        "font-size:12px;color:#92400e'>📦 Pemakaian internal (owner): " + _fmt_rp(rp["total_internal"]) + " · "
        "🎁 Token gratis diberikan: ± " + _fmt_rp(rp["total_free"]) + " <i>(bukan pemasukan)</i></div>"
        "</div>"
        "<div style='background:#fff;border-radius:16px;padding:20px 18px;margin-top:16px;"
        "box-shadow:0 1px 3px rgba(0,0,0,.06)'>"
        "<div style='font-size:15px;font-weight:700;color:#0f172a;margin-bottom:10px'>🧾 Rincian Transaksi Customer</div>"
        "<table style='width:100%;border-collapse:collapse;font-size:13px'>"
        "<tr style='color:#94a3b8;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e2e8f0'>"
        "<td style='padding:6px 10px'>Tanggal</td><td style='padding:6px 10px'>Item</td>"
        "<td style='padding:6px 10px'>User</td><td style='padding:6px 10px;text-align:right'>Nominal</td></tr>"
        + _html_table(rp["customer_rows"]) +
        "</table></div>"
        "<div style='background:#fff;border-radius:16px;padding:20px 18px;margin-top:16px;"
        "box-shadow:0 1px 3px rgba(0,0,0,.06)'>"
        "<div style='font-size:15px;font-weight:700;color:#0f172a;margin-bottom:10px'>🎁 Token Gratis Diberikan Owner</div>"
        "<table style='width:100%;border-collapse:collapse;font-size:13px'>"
        "<tr style='color:#94a3b8;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e2e8f0'>"
        "<td style='padding:6px 10px'>Tanggal</td><td style='padding:6px 10px'>Paket</td>"
        "<td style='padding:6px 10px'>User</td><td style='padding:6px 10px;text-align:right'>Estimasi</td></tr>"
        + free_html +
        "</table></div>"
        "<div style='text-align:center;color:#94a3b8;font-size:11px;margin-top:18px'>"
        "Dikirim otomatis oleh Kakostore Bot · " + datetime.now().strftime('%d %B %Y %H:%M') + "</div>"
        "</div></body></html>"
    )


def _owner_email():
    return (os.environ.get("OWNER_EMAIL", "") or getattr(config, "OWNER_EMAIL", "")).strip()


def send_report_email(rp, to_email=None, from_email=None):
    """Kirim laporan via Resend API (bonus, kalau email diset).

    Pakai curl (subprocess): python requests sering nge-hang di VPS ini,
    sedangkan curl stabil & cepat.
    """
    api_key = (os.environ.get("RESEND_API_KEY", "") or getattr(config, "RESEND_API_KEY", "")).strip()
    to_email = (to_email or _owner_email()).strip()
    from_email = (from_email or os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")).strip()
    if not api_key:
        return False, "RESEND_API_KEY belum diset"
    if not to_email:
        return False, "OWNER_EMAIL belum diset"
    subject = "📊 Laporan Penghasilan %s %d — Kakostore (Customer %s)" % (
        _bulan_str(rp["month"]), rp["year"], _fmt_rp(rp["total_customer"]))
    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": build_html(rp),
    }
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=".json", prefix="resend_")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        cmd = [
            "curl", "-s", "-X", "POST", "https://api.resend.com/emails",
            "-H", "Authorization: Bearer " + api_key,
            "-H", "Content-Type: application/json",
            "--data-binary", "@" + tmp,
            "--max-time", "60",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=70)
        out = proc.stdout.strip()
        try:
            resp = json.loads(out) if out else {}
        except Exception:
            resp = {}
        if resp.get("id"):
            return True, out[:200]
        return False, "Resend gagal: %s" % (out[:300] or proc.stderr[:300])
    except Exception as e:
        return False, str(e)
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except Exception:
                pass


async def maybe_send_monthly_report(bot):
    """Dipanggil tiap jam dari scheduler: kalau tanggal >= 2 dan laporan bulan
    lalu belum terkirim, kirim otomatis (sekali per bulan)."""
    now = datetime.now()
    if now.day < 2:
        return
    prev = now.replace(day=1) - timedelta(days=1)
    key = "%04d-%02d" % (prev.year, prev.month)
    st = _load(STATE_FILE, {})
    if st.get("last_report_month") == key:
        return
    rp = build_monthly_report(prev.year, prev.month)
    tg_ok = False
    try:
        await bot.send_message(config.OWNER_ID, report_full_text(rp))
        tg_ok = True
    except Exception as e:
        log.warning("Gagal kirim laporan Telegram: %s", e)
    mail_ok, mail_detail = send_report_email(rp)
    if mail_ok:
        try:
            await bot.send_message(config.OWNER_ID, "📧 Bonus: laporan juga dikirim ke email ✅")
        except Exception:
            pass
    elif not tg_ok:
        try:
            await bot.send_message(config.OWNER_ID, "⚠️ Laporan %s gagal dikirim: %s" % (key, mail_detail))
        except Exception:
            pass
    if tg_ok or mail_ok:
        st["last_report_month"] = key
        _save(STATE_FILE, st)
        log.info("Laporan %s terkirim (tg=%s, email=%s)", key, tg_ok, mail_ok)


def register_report_handlers(bot, is_owner):
    """Register /laporan (owner only) untuk kirim manual / test."""
    from telethon import events

    @bot.on(events.NewMessage(pattern=r"^/laporan(?:\s+(\d{4}-\d{2}))?$"))
    async def _laporan(event):
        if not is_owner(event.sender_id):
            return
        arg = event.pattern_match.group(1)
        if arg:
            try:
                y, m = (int(x) for x in arg.split("-"))
                rp = build_monthly_report(y, m)
            except Exception:
                await event.respond("Format: `/laporan` (bulan berjalan) atau `/laporan 2026-08`")
                return
        else:
            # tanpa argumen -> bulan berjalan (biar langsung keliatan data terbaru)
            now = datetime.now()
            rp = build_monthly_report(now.year, now.month)
        text = report_full_text(rp)
        if rp["n_rows"] == 0:
            text += (
                "\n\nℹ️ Belum ada transaksi bulan ini. "
                "Coba `/laporan 2026-07` untuk bulan lain."
            )
        await event.respond(text)
        if _owner_email():
            ok, detail = send_report_email(rp)
            if ok:
                await event.respond("📧 Bonus: laporan juga dikirim ke email ✅")
            else:
                await event.respond("⚠️ Email gagal: " + detail)


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and "--send" not in sys.argv:
        yy, mm = (int(x) for x in sys.argv[1].split("-"))
        rep = build_monthly_report(yy, mm)
    else:
        now = datetime.now()
        rep = build_monthly_report(now.year, now.month)
    print(report_full_text(rep))
    if "--send" in sys.argv:
        okk, det = send_report_email(rep)
        print("EMAIL:", "OK" if okk else "FAIL", det)
