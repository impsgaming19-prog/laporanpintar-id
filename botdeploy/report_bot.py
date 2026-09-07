import config
from telethon import TelegramClient, events

_client = None
_username = None
_last_msg = {}  # uid -> pesan laporan terakhir (biar di-edit, gak numpuk)

async def start():
    global _client, _username
    token = (getattr(config, "REPORT_BOT_TOKEN", "") or "").strip()
    if not token:
        print("[WARN] REPORT_BOT_TOKEN kosong -> Bot Laporan TIDAK dijalankan.")
        return False
    _client = TelegramClient("report_bot_session", config.API_ID, config.API_HASH)
    await _client.start(bot_token=token)
    me = await _client.get_me()
    _username = me.username
    @_client.on(events.NewMessage(pattern=r"^/start"))
    async def _welcome(event):
        await event.respond("👋 Ini **Bot Laporan**.\nAnda akan menerima ringkasan laporan broadcast (sukses/gagal) di sini.", parse_mode="md")
    print(f"[OK] Bot Laporan aktif: @{_username}")
    return True

def aktif():
    return _client is not None

async def kirim(uid, text, parse_mode="md"):
    """Kirim pesan baru (dipakai untuk notif non-laporan)."""
    if _client is None:
        return False
    try:
        await _client.send_message(int(uid), text, parse_mode=parse_mode, link_preview=False)
        return True
    except Exception as e:
        print(f"[WARN] Bot Laporan gagal kirim ke {uid}: {e}")
        return False


async def kirim_last(uid, text, parse_mode="md"):
    """Laporan terakhir: EDIT pesan laporan sebelumnya, jadi cuma ada laporan
    paling baru (gak numpuk pesan tiap putaran). Kalau pesan lama gak bisa
    diedit (dihapus/dll), kirim pesan baru & simpan sebagai acuan edit berikutnya."""
    if _client is None:
        return False
    uid = int(uid)
    lama = _last_msg.get(uid)
    if lama is not None:
        try:
            await lama.edit(text, parse_mode=parse_mode, link_preview=False)
            return True
        except Exception as e:
            print(f"[WARN] Edit laporan lama gagal (kirim baru): {e}")
            _last_msg.pop(uid, None)
    try:
        msg = await _client.send_message(uid, text, parse_mode=parse_mode, link_preview=False)
        _last_msg[uid] = msg
        return True
    except Exception as e:
        print(f"[WARN] Bot Laporan gagal kirim ke {uid}: {e}")
        return False
