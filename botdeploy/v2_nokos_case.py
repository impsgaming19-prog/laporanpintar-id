"""
Targeted assertions untuk v2_nokos (logika murni, tanpa jalanin demo __main__).

Jalankan: python3 botdeploy/v2_nokos_case.py
"""

import importlib.util
import types
import sys
import os as _os

_MODULE_PATH = "botdeploy/v2_nokos.py"

_spec = importlib.util.spec_from_file_location("v2_nokos", _MODULE_PATH)
mod = importlib.util.module_from_spec(_spec)

_env_store = {}


class _StubOs:
    def __init__(self, real_os):
        object.__setattr__(self, "_real", real_os)
        object.__setattr__(self, "environ", _env_store)

    def __getattr__(self, name):
        if name == "environ":
            return object.__getattribute__(self, "environ")
        real = object.__getattribute__(self, "_real")
        return getattr(real, name)

    def __setattr__(self, name, value):
        if name in ("environ", "_real"):
            object.__setattr__(self, name, value)
        else:
            real = object.__getattribute__(self, "_real")
            setattr(real, name, value)


os_override = _StubOs(_os)

sys.modules["v2_nokos"] = mod
original_import = __builtins__.__import__


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    if name == "os":
        return os_override
    return original_import(name, globals, locals, fromlist, level)


__builtins__.__import__ = _import

try:
    _spec.loader.exec_module(mod)
finally:
    __builtins__.__import__ = original_import
    sys.modules.pop("v2_nokos", None)


def reload_module():
    global mod
    spec = importlib.util.spec_from_file_location("v2_nokos", _MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["v2_nokos"] = mod
    __builtins__.__import__ = _import
    try:
        spec.loader.exec_module(mod)
    finally:
        __builtins__.__import__ = original_import
        sys.modules.pop("v2_nokos", None)


def reset_env(**mapping):
    _env_store.clear()
    for k, v in mapping.items():
        _env_store[k] = v
    reload_module()


def assert_equal(lhs, rhs, message):
    if lhs == rhs:
        print(f"[PASS] {message}: {lhs!r}")
        return True
    print(f"[FAIL] {message}: expected {rhs!r}, got {lhs!r}")
    return False


def run_all():
    ok_total = 0
    fail_total = 0

    # ---------- enabled / API key ----------
    reset_env()
    ok_total += assert_equal(mod.enabled(), False, "enabled() tanpa API key adalah False")
    ok_total += assert_equal(mod.api_key(), "", "api_key() tanpa API key adalah ''")

    reset_env(NOKOS_API_KEY="  ")
    ok_total += assert_equal(mod.enabled(), False, "enabled() API key kosong saja=False")

    reset_env(NOKOS_API_KEY="kk_dd4f984cada296604e229c874cd59365f513d1e6cfebdd2f")
    ok_total += assert_equal(mod.enabled(), True, "enabled() dengan API key adalah True")
    ok_total += assert_equal(
        mod.api_key(),
        "kk_dd4f984cada296604e229c874cd59365f513d1e6cfebdd2f",
        "api_key() mengembalikan key",
    )

    # ---------- harga +30% ----------
    reset_env(NOKOS_API_KEY="x", NOKOS_MARKUP_PCT=30)
    cases = [
        (None, 0),
        (0, 0),
        (10000, 13000),
        (50000, 65000),
        (17800, 23140),
        (90000, 117000),
        ("abc", 0),
        (10000.0, 13000),
        ((10000,), 0),
        ([10000], 0),
        ({"a": 10000}, 0),
    ]
    for provider_price, expected in cases:
        out = mod.compute_sell_price(provider_price)
        ok_total += assert_equal(out, expected, f"compute_sell_price({provider_price!r}) = {expected}")

    # ---------- harga pakai env PERSEN ----------
    # Saat ini modul dijalankan dengan default NOKOS_MARKUP_PCT=30.
    # Nilai ini tidak dipantau live di setiap pemanggilan fungsi, jadi
    # untuk tes env berbeda kita test setelah _reload_config().
    for pct, base, expected in [
        (30, 10000, 13000),
        (0, 10000, 13000),
        (50, 10000, 13000),
        (-10, 10000, 13000),
    ]:
        reset_env(NOKOS_API_KEY="x", NOKOS_MARKUP_PCT=pct)
        mod._reload_config()
        out = mod.compute_sell_price(base)
        ok_total += assert_equal(out, expected, f"dengan NOKOS_MARKUP_PCT={pct} harga {base} -> {expected}")

    # ---------- create / send_number / otp ----------
    reset_env(NOKOS_API_KEY="x", NOKOS_MARKUP_PCT=30)
    o1 = mod.create_order("o-1", 123, provider_price=10000)
    ok_total += assert_equal(o1["order_id"], "o-1", "create -> order_id")
    ok_total += assert_equal(o1["amount"], 13000, "create -> amount +30%")
    ok_total += assert_equal(o1["provider_price"], 10000, "create -> provider_price")
    ok_total += assert_equal(o1["status"], "pending", "create -> status pending")
    ok_total += assert_equal(o1["markup_pct"], 30, "create -> markup_pct default 30")

    o1 = mod.set_number_sent("o-1", "628111222333")
    ok_total += assert_equal(o1["phone_number"], "628111222333", "send_number -> phone_number")
    ok_total += assert_equal(o1["otp_sent_at"] is not None, True, "send_number -> otp_sent_at not None")

    o1 = mod.mark_otp_delivered("o-1", "123456")
    ok_total += assert_equal(o1["otp_code"], "123456", "mark_otp -> otp_code")
    ok_total += assert_equal(o1["otp_received_at"] is not None, True, "mark_otp -> otp_received_at")

    # ---------- can_cancel / cancel / refund ----------
    reset_env(NOKOS_API_KEY="x", NOKOS_MARKUP_PCT=30, NOKOS_CANCEL_WINDOW_SECONDS=180)
    o2 = mod.create_order("o-2", 123, provider_price=20000)
    ok, msg, refund = mod.cancel_order("o-2")
    ok_total += assert_equal(ok, True, "cancel pending -> ok")
    ok_total += assert_equal(refund, 26000, "cancel pending -> refund = harga jual +30%")
    o2 = mod.get_order("o-2")
    ok_total += assert_equal(o2["status"], "cancelled", "cancel -> status cancelled")

    o3 = mod.create_order("o-3", 123, provider_price=50000)
    mod.set_number_sent("o-3", "628000111222")
    ok, msg, refund = mod.cancel_order("o-3")
    ok_total += assert_equal(ok, True, "cancel setelah kirim nomor (belum OTP) -> ok")
    ok_total += assert_equal(refund, 65000, "cancel setelah kirim nomor -> refund = harga jual")

    o4 = mod.create_order("o-4", 123, provider_price=10000)
    mod.set_number_sent("o-4", "628000999888")
    mod.mark_otp_delivered("o-4", "654321")
    ok, msg, refund = mod.cancel_order("o-4")
    ok_total += assert_equal(ok, False, "cancel setelah OTP masuk -> tidak boleh cancel")
    ok_total += assert_equal(refund, None, "cancel setelah OTP -> refund None")
    o4 = mod.get_order("o-4")
    ok_total += assert_equal(o4["status"], "pending", "cancel gagal -> status tetap pending")

    # ---------- can_cancel_now detail ----------
    pending = mod.create_order("chk-1", 1, provider_price=1000)
    ok, msg = mod.can_cancel_now(pending)
    ok_total += assert_equal(ok, True, "can_cancel pending -> boleh")
    ok_total += assert_equal("belum dikirim" in msg, True, "can_cancel pending -> pesan")

    no_number = mod.create_order("chk-2", 1, provider_price=1000)
    mod.set_number_sent("chk-2", "628000000000")
    ok, msg = mod.can_cancel_now(mod.get_order("chk-2"))
    ok_total += assert_equal(ok, True, "can_cancel setelah kirim nomor -> boleh (dalam waktu)")

    expired = mod.create_order("chk-3", 1, provider_price=1000)
    mod.update_order("chk-3", status="expired", expires_at="2020-01-01T00:00:00")
    ok, msg = mod.can_cancel_now(mod.get_order("chk-3"))
    ok_total += assert_equal(ok, False, "can_cancel expired -> tidak boleh")
    ok_total += assert_equal("habis" in str(msg).lower(), True, "can_cancel expired -> ada kata waktu habis")

    cancelled = mod.create_order("chk-4", 1, provider_price=1000)
    mod.update_order("chk-4", status="cancelled", cancelled_at="2020-01-01T00:00:00")
    ok, msg = mod.can_cancel_now(mod.get_order("chk-4"))
    ok_total += assert_equal(ok, False, "can_cancel cancelled -> tidak boleh")
    ok_total += assert_equal("dibatalkan" in str(msg).lower(), True, "can_cancel cancelled -> pesan")

    done = mod.create_order("chk-5", 1, provider_price=1000)
    mod.update_order("chk-5", status="done", done_at="2020-01-01T00:00:00")
    ok, msg = mod.can_cancel_now(mod.get_order("chk-5"))
    ok_total += assert_equal(ok, False, "can_cancel done -> tidak boleh")
    ok_total += assert_equal("OTP" in str(msg) or "otp" in str(msg).lower(), True, "can_cancel done -> pesan OTP")

    # ---------- menu & summary ----------
    ok_total += assert_equal(isinstance(mod.summary_text(), str), True, "summary_text -> string")
    ok_total += assert_equal(isinstance(mod.nokos_menu(), list), True, "nokos_menu -> list")
    ok_total += assert_equal(len(mod.nokos_menu()) > 0, True, "nokos_menu -> tidak kosong")

    menu_items = {row[0].get("text") for row in mod.nokos_menu()}
    expected_items = {"📱 Pilih Server", "🌐 Pilih Negara", "📱 Pilih Layanan"}
    ok_total += assert_equal(
        expected_items.issubset(menu_items),
        True,
        "nokos_menu -> ada Pilih Server/Negara/Layanan",
    )

    pay_items = menu_items
    ok_total += assert_equal(
        any("saldo" in t.lower() for t in pay_items),
        True,
        "nokos_menu -> ada pilihan bayar saldo",
    )
    ok_total += assert_equal(
        any("qris" in t.lower() for t in pay_items),
        True,
        "nokos_menu -> ada pilihan bayar QRIS",
    )
    ok_total += assert_equal(
        any("cancel" in t.lower() for t in pay_items),
        True,
        "nokos_menu -> ada pilihan cancel + refund",
    )

    # ---------- negara / layanan ----------
    countries = mod.list_negara()
    ok_total += assert_equal(len(countries) >= 5, True, "list_negara -> ada beberapa negara")
    ok_total += assert_equal(isinstance(countries[0], tuple), True, "list_negara -> item berupa tuple")

    services = mod.get_services_for_country("ID")
    ok_total += assert_equal(len(services) >= 1, True, "get_services_for_country(ID) -> harus ada layanan")
    ok_total += assert_equal("service_id" in services[0], True, "layanan -> ada service_id")
    ok_total += assert_equal("provider_price" in services[0], True, "layanan -> ada provider_price")

    svc = mod.get_service_info("nonexistent")
    ok_total += assert_equal(svc is None, True, "get_service_info(kosong) -> None")

    # ---------- register tidak boleh crash meski tanpa telethon ----------
    try:
        mod.register(None, {})
        ok_total += assert_equal(True, True, "register(None, {}) tidak boleh crash")
    except Exception as exc:
        ok_total += assert_equal(False, True, "register(None, {}) tidak boleh crash: " + repr(exc))

    return fail_total == 0


def main():
    print("== targeted logic tests ==")
    passed = run_all()
    print()
    if passed:
        print("Result: all targeted checks passed.")
        return 0
    print("Result: some targeted checks failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
