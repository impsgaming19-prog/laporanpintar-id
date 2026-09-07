"""
Nokos — jual nomor OTP + kode OTP auto-masuk.

Alur:
1. User pilih negara → layanan → bayar (saldo / QRIS)
2. Nomor dikirim ke chat
3. Kode OTP masuk otomatis
4. Bisa Cancel + Refund (saldo) dalam waktu terbatas
5. Setelah nomor terkirim / OTP masuk, cancel dibatasi

Harga:
- Harga jual = harga asli provider + 30% untung
- Contoh:
  - harga asli 10.000 -> jual 13.000
  - harga asli 50.000 -> jual 65.000
- Refund saat cancel pakai nominal yang dibeli (bukan harga asli provider)

Env yang dipakai:
- NOKOS_API_KEY        (aktifkan nokos)
- NOKOS_MARKUP_PCT     (persen untung, default 30)
- NOKOS_CANCEL_WINDOW_SECONDS (detik setelah nomor dikirim antesarkan cancel, default 180)
- NOKOS_OTP_VALID_SECONDS      (validitas kode OTP, default 300)

Catatan integrasi:
- Bot utama membaca NOKOS_API_KEY lewat config.py (CONFIG_JSON / Secrets).
- v2_nokos sendiri tetap membaca langsung dari os.environ.
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple, Callable

log = logging.getLogger("v2nokos")

__all__ = [
    "register",
    "create_order",
    "get_order",
    "update_order",
    "delete_order",
    "list_orders",
    "can_cancel_now",
    "cancel_order",
    "send_number",
    "mark_otp_delivered",
    "set_number_sent",
    "set_otp_code",
    "resend_number",
    "cancel_and_refund_order",
    "list_negara",
    "get_service_info",
    "get_services_by_country",
    "get_services_for_country",
    "summary_text",
    "nokos_menu",
    "enabled",
    "api_key",
    "compute_sell_price",
]


# ------------------------------------------------------------------
# Order data class
# ------------------------------------------------------------------
@dataclass
class Order:
    order_id: str
    user_id: int
    session_id: Optional[str] = None
    country_id: Optional[int] = None
    service_id: Optional[int] = None
    phone_number: Optional[str] = None
    status: str = "pending"
    amount: int = 0
    provider_price: int = 0
    markup_pct: int = 30
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    expires_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    otp_sent_at: Optional[str] = None
    otp_code: Optional[str] = None
    otp_expires_at: Optional[str] = None
    otp_received_at: Optional[str] = None
    otp_verified_at: Optional[str] = None
    error_message: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


# ------------------------------------------------------------------
# Storage
# ------------------------------------------------------------------
ORDERS: Dict[str, Dict[str, Any]] = {}

# Callback lists (diisi oleh register())
_on_number_sent_callbacks: List[Callable[[str, str], Any]] = []
_on_otp_received_callbacks: List[Callable[[str, str, Optional[str]], Any]] = []
_on_cancel_callbacks: List[Callable[[str, int], Any]] = []


# ------------------------------------------------------------------
# Small helpers
# ------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _now_ts() -> float:
    return time.time()


def _from_iso_to_ts(iso: str) -> float:
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


def _intish(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "")
    if raw and isinstance(raw, str) and raw.strip():
        try:
            return int(raw.strip())
        except Exception:
            return default
    return default


def _env_str(name: str, default: str = "") -> str:
    return (os.environ.get(name, default) or "").strip()


# ------------------------------------------------------------------
# Konfigurasi harga & batas cancel
# ------------------------------------------------------------------
NUM_MARKUP_PCT: int = _env_int("NOKOS_MARKUP_PCT", 30)
NUM_CANCEL_WINDOW_SECONDS: int = _env_int("NOKOS_CANCEL_WINDOW_SECONDS", 180)
NUM_OTP_VALID_SECONDS: int = _env_int("NOKOS_OTP_VALID_SECONDS", 300)


def _reload_config():
    """(opsional) baca ulang env constants kalau memang diperlukan.

    Default behavior tidak pakai dynamic refresh, tapi ini tersedia
    supaya pengujian/polling bisa pakai nilai terbaru tanpa restart proses.
    """
    global NUM_MARKUP_PCT, NUM_CANCEL_WINDOW_SECONDS, NUM_OTP_VALID_SECONDS
    NUM_MARKUP_PCT = _env_int("NOKOS_MARKUP_PCT", 30)
    NUM_CANCEL_WINDOW_SECONDS = _env_int("NOKOS_CANCEL_WINDOW_SECONDS", 180)
    NUM_OTP_VALID_SECONDS = _env_int("NOKOS_OTP_VALID_SECONDS", 300)


def compute_sell_price(provider_price: Any) -> int:
    """Harga jual = harga asli provider + 30% untung.

    Contoh:
      - harga asli 10.000  -> jual 13.000
      - harga asli 50.000  -> jual 65.000
      - harga asli 17.800  -> jual 23.140
    """
    try:
        base = int(provider_price or 0)
    except Exception:
        base = 0
    pct = (NUM_MARKUP_PCT / 100.0) if NUM_MARKUP_PCT else 0.0
    sell_price = int(base * (1 + pct))
    return max(0, sell_price)


def api_key() -> str:
    return _env_str("NOKOS_API_KEY")


def enabled() -> bool:
    return bool(api_key())


# ------------------------------------------------------------------
# CRUD order
# ------------------------------------------------------------------
def create_order(
    order_id: str,
    user_id: int,
    provider_price: Any = 0,
    **kwargs: Any,
) -> Dict[str, Any]:
    sell = compute_sell_price(provider_price)
    rec = {
        "order_id": order_id,
        "user_id": user_id,
        "session_id": kwargs.get("session_id"),
        "country_id": kwargs.get("country_id"),
        "service_id": kwargs.get("service_id"),
        "phone_number": None,
        "status": "pending",
        "amount": sell,
        "provider_price": provider_price,
        "markup_pct": NUM_MARKUP_PCT,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "expires_at": kwargs.get("expires_at"),
        "cancelled_at": None,
        "otp_sent_at": None,
        "otp_code": None,
        "otp_expires_at": None,
        "otp_received_at": None,
        "otp_verified_at": None,
        "error_message": None,
        "metadata": dict(kwargs.get("metadata") or {}),
    }
    ORDERS[order_id] = rec
    return dict(rec)


def get_order(order_id: str) -> Optional[Dict[str, Any]]:
    if not order_id:
        return None
    rec = ORDERS.get(order_id)
    return dict(rec) if rec else None


def update_order(order_id: str, **kwargs: Any) -> Optional[Dict[str, Any]]:
    rec = ORDERS.get(order_id)
    if not rec:
        return None
    for k, v in kwargs.items():
        if k in rec:
            rec[k] = v
    rec["updated_at"] = _now_iso()
    return dict(rec)


def delete_order(order_id: str) -> bool:
    ORDERS.pop(order_id, None)
    return True


def list_orders(needle: Optional[str] = None) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for rec in ORDERS.values():
        if needle:
            hay = f"{rec.get('order_id')} {rec.get('phone_number')} {rec.get('user_id')}"
            if needle not in hay:
                continue
        out.append(dict(rec))
    return out


def set_number_sent(order_id: str, phone_number: str) -> Optional[Dict[str, Any]]:
    updated = update_order(order_id, phone_number=phone_number, otp_sent_at=_now_iso())
    if updated:
        for fn in _on_number_sent_callbacks:
            try:
                fn(order_id, phone_number)
            except Exception as e:
                log.warning("on_number_sent callback error: %s", e)
    return updated


def mark_otp_delivered(
    order_id: str,
    otp_code: str,
    otp_expires_at: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    updated = update_order(
        order_id,
        otp_code=otp_code,
        otp_received_at=_now_iso(),
        otp_expires_at=otp_expires_at,
    )
    if updated:
        for fn in _on_otp_received_callbacks:
            try:
                fn(order_id, otp_code, otp_expires_at)
            except Exception as e:
                log.warning("on_otp_received callback error: %s", e)
    return updated


def set_otp_code(order_id: str, otp_code: str, expires_at: Optional[str] = None):
    return update_order(
        order_id,
        otp_code=otp_code,
        otp_expires_at=expires_at,
    )


def resend_number(order_id: str, new_phone_number: str) -> Optional[Dict[str, Any]]:
    rec = ORDERS.get(order_id)
    if not rec:
        return None
    if rec.get("status") in ("cancelled", "done", "expired"):
        return None
    updated = update_order(order_id, phone_number=new_phone_number, otp_sent_at=_now_iso())
    if updated:
        for fn in _on_number_sent_callbacks:
            try:
                fn(order_id, new_phone_number)
            except Exception as e:
                log.warning("on_number_sent callback error: %s", e)
    return updated


# ------------------------------------------------------------------
# Cancel & refund
# ------------------------------------------------------------------
def can_cancel_now(order: Dict[str, Any]) -> Tuple[bool, str]:
    if not order.get("order_id"):
        return False, "Order tidak ditemukan"

    status = order.get("status") or "pending"
    if status in ("cancelled",):
        return False, "Order sudah dibatalkan"
    if status in ("done",):
        return False, "Nomor sudah keluar / OTP sudah masuk, tidak bisa cancel"
    if status in ("expired",):
        return False, "Waktu order habis, tidak bisa cancel"

    if order.get("otp_received_at"):
        return False, "Kode OTP sudah masuk, tidak bisa cancel"

    if not order.get("phone_number"):
        return True, "Nomor belum dikirim, bisa cancel"

    now = _now_ts()
    try:
        sent_ts = _from_iso_to_ts(order.get("otp_sent_at")) or _from_iso_to_ts(order.get("created_at"))
    except Exception:
        sent_ts = now

    elapsed = now - sent_ts
    if elapsed >= NUM_CANCEL_WINDOW_SECONDS:
        return False, f"Waktu cancel sudah habis ({int(elapsed)} detik >= {NUM_CANCEL_WINDOW_SECONDS} detik)"

    remaining = NUM_CANCEL_WINDOW_SECONDS - int(elapsed)
    return True, f"Masih bisa cancel, sisa waktu {remaining} detik"


def cancel_order(order_id: str) -> Tuple[bool, str, Optional[int]]:
    """Batalkan order + refund nominal yang dibeli (bukan harga asli provider).

    Return (ok, pesan, jumlah_refund).
    """
    rec = ORDERS.get(order_id)
    if not rec:
        return False, "Order tidak ditemukan", None

    ok, msg = can_cancel_now(rec)
    if not ok:
        return False, msg, None

    refunded_amount = int(rec.get("amount") or 0)
    update_order(
        order_id,
        status="cancelled",
        cancelled_at=_now_iso(),
    )
    for fn in _on_cancel_callbacks:
        try:
            fn(order_id, refunded_amount)
        except Exception as e:
            log.warning("on_cancel callback error: %s", e)
    return True, "Order berhasil dibatalkan. Saldo kamu dikembalikan.", refunded_amount


def cancel_and_refund_order(order_id: str) -> Tuple[bool, str, Optional[int]]:
    return cancel_order(order_id)


# ------------------------------------------------------------------
# OTP helpers
# ------------------------------------------------------------------
def generate_otp(order_id: str, otp_code: str, expires_in: Optional[int] = None) -> Optional[Dict[str, Any]]:
    if expires_in is None:
        expires_in = NUM_OTP_VALID_SECONDS
    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()
    return update_order(
        order_id,
        otp_code=otp_code,
        otp_expires_at=expires_at,
    )


def verify_otp(order_id: str) -> Optional[Dict[str, Any]]:
    rec = ORDERS.get(order_id)
    if not rec:
        return None
    if rec.get("status") in ("cancelled", "done", "expired"):
        return None
    if rec.get("otp_received_at"):
        return update_order(order_id, otp_verified_at=_now_iso())
    return None


# ------------------------------------------------------------------
# Country / service stub (placeholder, bisa diganti pakai endpoint provider)
# ------------------------------------------------------------------
DEFAULT_COUNTRIES: List[Tuple[str, str]] = [
    ("ID", "Indonesia"),
    ("MY", "Malaysia"),
    ("PH", "Filipina"),
    ("TH", "Thailand"),
    ("VN", "Vietnam"),
    ("SG", "Singapura"),
    ("US", "Amerika Serikat"),
    ("GB", "Inggris"),
    ("AE", "Uni Emirat Arab"),
]


def list_negara() -> List[Tuple[str, str]]:
    """Return [(code, name), ...]."""
    return list(DEFAULT_COUNTRIES)


def get_services_by_country(country_code: str) -> List[Dict[str, Any]]:
    """Return list layanan untuk satu negara (placeholder)."""
    return [
        {
            "service_id": f"{country_code}_wa",
            "name": f"Nomor WA {country_code}",
            "provider_price": _dummy_provider_price(country_code),
        },
        {
            "service_id": f"{country_code}_ig",
            "name": f"Nomor IG {country_code}",
            "provider_price": _dummy_provider_price(country_code),
        },
    ]


def get_services_for_country(country_code: str) -> List[Dict[str, Any]]:
    return get_services_by_country(country_code)


def get_service_info(service_id: str) -> Optional[Dict[str, Any]]:
    return None


def _dummy_provider_price(country_code: str) -> int:
    """Harga asli provider dummy, agar harga jual +30% bisa dilihat di menu."""
    base = {
        "ID": 10000,
        "MY": 12000,
        "PH": 17800,
        "TH": 25000,
        "VN": 20000,
        "SG": 30000,
        "US": 50000,
        "GB": 45000,
        "AE": 90000,
    }
    return base.get(country_code, 10000)


# ------------------------------------------------------------------
# Bot registration
# ------------------------------------------------------------------
def register(
    bot: Any,
    ctx: Dict[str, Any],
) -> None:
    """Daftarkan handler nokos ke bot.

    ctx bisa berisi:
      - users
      - main_keyboard
      - is_owner
      - notify
    """
    try:
        from telethon import events
    except Exception as e:
        log.warning("Nokos gagal import telethon: %s", e)
        return

    async def _nokos_menu_handler(event):
        uid = event.sender_id
        try:
            txt = summary_text()
            await event.respond(txt, buttons=nokos_menu())
        except Exception as e:
            await event.respond(f"❌ Nokos error: {e}", buttons=ctx.get("main_keyboard")(uid))

    bot.add_event_handler(_nokos_menu_handler, events.NewMessage(pattern=r"^/nokos$"))
    log.info("[OK] nokos handler registered")


# ------------------------------------------------------------------
# Menu teks untuk bot Telegram
# ------------------------------------------------------------------
def summary_text() -> str:
    return (
        "📱 **NOKOS — JUAL NOMOR OTP**\n\n"
        "Pilih negara → layanan → bayar (saldo / QRIS)\n"
        "Nomor dikirim ke chat, kode OTP masuk otomatis.\n\n"
        "Fitur:\n"
        "• Pilih server\n"
        "• Pilih negara\n"
        "• Pilih layanan\n"
        "• Bayar QRIS / saldo Nokos\n"
        "• Nomor dikirim otomatis\n"
        "• Kode OTP masuk otomatis\n"
        "• Resend nomor\n"
        "• Cancel + refund (saldo)\n"
    )


def nokos_menu() -> List[List[Dict[str, Any]]]:
    return [
        [dict(text="📱 Pilih Server", callback="nk_server")],
        [dict(text="🌐 Pilih Negara", callback="nk_country")],
        [dict(text="📱 Pilih Layanan", callback="nk_service")],
        [dict(text="💳 Bayar dengan Saldo Nokos", callback="nk_pay_balance")],
        [dict(text="💳 Bayar dengan QRIS", callback="nk_pay_qris")],
        [dict(text="✅ Nomor Saya", callback="nk_mynumber")],
        [dict(text="🔁 Resend Nomor", callback="nk_resend")],
        [dict(text="🚫 Cancel + Refund", callback="nk_cancel")],
        [dict(text="⬅️ Kembali", callback="menu")],
    ]


# ------------------------------------------------------------------
# Demo / smoke test (bukan bagian dari bot production)
# ------------------------------------------------------------------
if __name__ == "__main__":
    print(":: Demo harga +30% ::")
    for base in (10000, 17800, 50000):
        print(f"  harga asli {base:,} -> jual {compute_sell_price(base):,}")

    print("\n:: Demo cancel + refund (saldo) ::")
    o1 = create_order("demo-1", 7605731610, provider_price=10000)
    print(f"  order demo-1 dibuat, amount={o1['amount']:,}")
    ok, msg, ref = cancel_order("demo-1")
    print(f"  cancel -> ok={ok}, refund={ref:,}")

    o2 = create_order("demo-2", 7605731610, provider_price=50000)
    set_number_sent("demo-2", "6281122334455")
    print(f"  order demo-2 nomor sudah dikirim")
    ok, msg, ref = cancel_order("demo-2")
    print(f"  cancel -> ok={ok}, refund={ref:,} (masih bisa karena belum OTP)")

    o3 = create_order("demo-3", 7605731610, provider_price=20000)
    set_number_sent("demo-3", "628777111222")
    mark_otp_delivered("demo-3", "123456")
    ok, msg, ref = cancel_order("demo-3")
    print(f"  cancel setelah OTP -> ok={ok}, refund={ref}")

    print("\n:: Demo menampilkan menu ::")
    print(summary_text())
    print("MENU:")
    for row in nokos_menu():
        print("  | ".join(x.get("text", "") for x in row))
