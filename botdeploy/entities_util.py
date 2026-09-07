"""Simpan & bangun ulang formatting (entities) pesan.

Tujuan: teks yang di-share TIDAK rusak formatnya (bold, italic, underline,
strike, spoiler, code, quote, link) walau akun bukan premium — tampil rapi
seperti premium. Custom/premium emoji dilewati (tidak bisa dikirim akun biasa),
teksnya tetap dipertahankan.
"""
from telethon.tl import types as T

# Peta nama class -> class entity
_ENTITY_CLASSES = [
    T.MessageEntityBold, T.MessageEntityItalic, T.MessageEntityUnderline,
    T.MessageEntityStrike, T.MessageEntitySpoiler, T.MessageEntityCode,
    T.MessageEntityPre, T.MessageEntityBlockquote, T.MessageEntityTextUrl,
    T.MessageEntityUrl, T.MessageEntityEmail, T.MessageEntityMention,
    T.MessageEntityMentionName, T.MessageEntityHashtag, T.MessageEntityCashtag,
    T.MessageEntityBotCommand, T.MessageEntityPhone, T.MessageEntityBankCard,
]
_NAME_MAP = {c.__name__: c for c in _ENTITY_CLASSES}


def serialize_entities(entities):
    """Entity Telethon -> list dict (bisa disimpan ke JSON)."""
    out = []
    for e in entities or []:
        d = {"_": type(e).__name__, "offset": e.offset, "length": e.length}
        for attr in ("url", "user_id", "document_id", "language"):
            val = getattr(e, attr, None)
            if val is not None:
                d[attr] = val
        out.append(d)
    return out


def build_entities(dicts):
    """list dict -> entity Telethon (untuk formatting_entities saat kirim)."""
    res = []
    for d in dicts or []:
        name = d.get("_")
        # Lewati premium/custom emoji (akun non-premium tidak bisa kirim)
        if name == "MessageEntityCustomEmoji":
            continue
        cls = _NAME_MAP.get(name)
        if not cls:
            continue
        kwargs = {"offset": d["offset"], "length": d["length"]}
        if name == "MessageEntityTextUrl":
            kwargs["url"] = d.get("url", "")
        elif name == "MessageEntityMentionName":
            kwargs["user_id"] = d.get("user_id")
        elif name == "MessageEntityPre":
            kwargs["language"] = d.get("language", "")
        try:
            res.append(cls(**kwargs))
        except Exception:
            pass
    return res
