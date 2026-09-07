"""Engine userbot: menjalankan auto-share untuk 1 akun user.

Setiap user punya 1 UserBot (TelegramClient dari StringSession).
Membaca konfigurasi dari dict `config` (referensi ke storage.users[uid]['config']).
"""
import asyncio
import random
import time
from datetime import datetime, timezone, timedelta
WIB = timezone(timedelta(hours=7))  # jam Indonesia

from telethon import TelegramClient, events, utils as tg_utils
from telethon.sessions import StringSession
from telethon.tl.types import Channel, Chat
from telethon import errors as tg_errors
from telethon.tl.functions.messages import ImportChatInviteRequest
from telethon.tl.functions.channels import JoinChannelRequest

from entities_util import build_entities

import config


def map_error(exc):
    """Alasan gagal berbahasa Indonesia dari error Telethon."""
    if isinstance(exc, tg_errors.FloodWaitError):
        return f"Akun limit di {{grup}} (flood wait {exc.seconds}s)"
    if isinstance(exc, tg_errors.SlowModeWaitError):
        return "Tutup typing di {grup} (slowmode aktif)"
    if isinstance(exc, tg_errors.UserBannedInChannelError):
        return "Grup terbanned {grup}"
    if isinstance(exc, tg_errors.ChatWriteForbiddenError):
        return "Dimute di {grup}"
    if isinstance(exc, tg_errors.ChannelPrivateError):
        return 'Tidak ditemukan "{grup}"'
    if isinstance(exc, tg_errors.ChatAdminRequiredError):
        return "Butuh admin di {grup}"
    if isinstance(exc, tg_errors.UserDeactivatedBanError):
        return "Akun limit di {grup} (akun dibatasi)"
    if isinstance(exc, tg_errors.ForbiddenError):
        return "Tidak diizinkan kirim di {grup}"
    return "Gagal kirim ke {grup}"


class UserBot:
    def __init__(self, uid, session_str, config, api_id, api_hash,
                 notify=None, on_save=None):
        self.uid = int(uid)
        self.config = config                 # dict referensi (auto tersimpan via on_save)
        self.api_id = api_id
        self.api_hash = api_hash
        self.notify = notify                 # async fn(uid, text) -> kirim via bot manajer
        self.on_save = on_save               # fn() -> simpan users.json
        self.client = TelegramClient(StringSession(session_str), api_id, api_hash)
        self.share_task = None
        self.current_action = "Idle"
        self.me = None

    # ---------------- lifecycle ----------------
    async def connect(self):
        await self.client.connect()
        if not await self.client.is_user_authorized():
            return False
        self.me = await self.client.get_me()
        self._register_autoreply()
        # lanjut auto share bila sebelumnya running
        if self.config.get("running") and self._punya_pesan():
            self.start_share()
        # jalankan pengecek timer
        self.client.loop.create_task(self._timer_loop())
        return True

    async def disconnect(self):
        self.config["running"] = False
        await self.client.disconnect()

    def _save(self):
        if self.on_save:
            try:
                self.on_save()
            except Exception:
                pass

    async def _notify(self, text):
        if self.notify:
            try:
                await self.notify(self.uid, text)
            except Exception:
                pass

    # ---------------- util ----------------
    async def get_all_groups(self):
        """Daftar semua grup, DEDUP by id (biar 1 grup gak kena 2x per putaran)."""
        grup = []
        seen = set()
        async for dialog in self.client.iter_dialogs():
            ent = dialog.entity
            if isinstance(ent, Chat) or (isinstance(ent, Channel) and getattr(ent, "megagroup", False)):
                if dialog.id not in seen:
                    seen.add(dialog.id)
                    grup.append(dialog)
        return grup

    async def get_target_groups(self):
        """Daftar grup tujuan akhir: mode semua/pilih, minus blacklist, batasi limit."""
        c = self.config
        grup = await self.get_all_groups()
        grup = [g for g in grup if g.id not in c.get("blacklist", [])]
        if c.get("target_mode") == "pilih":
            ids = {t["id"] for t in c.get("target_list", [])}
            grup = [g for g in grup if g.id in ids]
        lim = c.get("limit", 0) or 0
        if lim > 0:
            grup = grup[:lim]
        return grup

    async def add_group_by_link(self, link):
        """Join & tambahkan grup ke target_list via ID / link / username. -> (ok, nama, err)."""
        link = link.strip()
        try:
            # ID grup langsung (mis. -1001234567890 atau 1234567890)
            if link.lstrip("-").isdigit():
                entity = await self.client.get_entity(int(link))
            elif "t.me/+" in link or "joinchat" in link:
                # invite link privat
                if "+" in link:
                    invhash = link.split("+", 1)[1].strip("/")
                else:
                    invhash = link.rstrip("/").split("/")[-1]
                try:
                    updates = await self.client(ImportChatInviteRequest(invhash))
                    entity = updates.chats[0]
                except tg_errors.UserAlreadyParticipantError:
                    entity = await self.client.get_entity(link)
            else:
                username = (link.replace("https://", "").replace("http://", "")
                            .replace("t.me/", "").replace("@", "").strip("/"))
                entity = await self.client.get_entity(username)
                try:
                    await self.client(JoinChannelRequest(entity))
                except Exception:
                    pass
            gid = tg_utils.get_peer_id(entity)
            name = getattr(entity, "title", None) or getattr(entity, "username", "?")
            tl = self.config.setdefault("target_list", [])
            if not any(t["id"] == gid for t in tl):
                tl.append({"id": gid, "name": name})
            self.config["target_mode"] = "pilih"
            self._save()
            return True, name, None
        except Exception as e:
            return False, None, str(e)

    def _punya_pesan(self):
        return len(self.config.get("pesan_list", [])) > 0

    def _ambil_pesan_rotasi(self):
        lst = self.config.get("pesan_list", [])
        if not lst:
            return None
        idx = self.config.get("pesan_index", 0) % len(lst)
        self.config["pesan_index"] = (idx + 1) % len(lst)
        return lst[idx]

    async def _kirim_ke_grup(self, dialog_id, pesan):
        """Kirim 1 pesan ke 1 grup sesuai tipe (text / forward).

        Untuk teks: formatting (bold/italic/spoiler/link/quote) dipertahankan
        via formatting_entities agar tampil rapi seperti premium.

        V2: User TRIAL & SPESIAL otomatis dapat watermark "• Promote By @{BOT_NAME}"
        yang NEMPEL di pesan promo (satu pesan, bukan terpisah) → promosi gratis bot.
        Spesial++ / Lifetime / Owner → tanpa watermark.
        """
        # Watermark promo — WAJIB NEMPEL (satu pesan) untuk tier TRIAL & SPESIAL.
        # Spesial++ / Lifetime / Owner → TANPA watermark.
        tier = str(self.config.get("tier", "")).strip().lower()
        watermark = ""
        if tier in ("trial", "spesial"):
            if str(self.uid) != str(config.OWNER_ID):
                import os as _os
                bot_username = _os.environ.get("BOT_USERNAME", "Kakostore_Bot")
                watermark = (_os.environ.get("PROMO_WATERMARK_TEXT", "").strip()
                             or f"\n\n• Promote By @{bot_username}")

        if pesan.get("type") == "text":
            entities = build_entities(pesan.get("entities"))
            text_final = pesan["text"] + watermark
            await self.client.send_message(
                dialog_id,
                text_final,
                formatting_entities=entities or None,
                link_preview=pesan.get("link_preview", True),
            )
        else:  # forward (dari Saved Messages) — watermark ga bisa nempel di forward
            if watermark:
                # Fallback utk pesan forward lama: kirim forward + watermark terpisah
                await self.client.forward_messages(dialog_id, pesan["msg_id"], pesan["chat_id"])
                try:
                    await self.client.send_message(dialog_id, watermark.strip())
                except Exception:
                    pass
            else:
                await self.client.forward_messages(dialog_id, pesan["msg_id"], pesan["chat_id"])

    def fmt_jeda(self):
        c = self.config
        if c["jeda_tipe"] == "semua":
            return f"Per SEMUA grup — {c['jeda_semua_menit']} menit / putaran"
        if c["jeda_tipe"] == "aman":
            return "Jeda AMAN (RANDOM/rendem, mirip manusia — anti-deteksi bot)"
        return f"Per GRUP — {c['jeda_grup_detik']} detik antar grup"

    # ---------------- share loop ----------------
    def start_share(self):
        if self.share_task is None or self.share_task.done():
            self.share_task = self.client.loop.create_task(self._share_loop())

    async def _share_loop(self):
        c = self.config
        # Jeda awal acak per akun (mulai dari detik dia start, beda-beda tiap akun)
        # biar pas bot restart / pencet Mulai, akun-akun TIDAK share serentak/lockstep.
        if c.get("running"):
            self.current_action = "Menyiapkan..."
            await asyncio.sleep(random.uniform(5, 45))
        while c.get("running"):
            # Jika akun sedang kena limit (flood wait) — TUNGGU sampai selesai,
            # jangan coba kirim (biar hukuman Telegram tidak makin berat/naik).
            fu = c.get("flood_until") or 0
            if fu and time.time() < fu:
                sisa = int(fu - time.time())
                self.current_action = f"Menunggu masa limit {sisa}s"
                await asyncio.sleep(min(sisa, 60))
                continue
            if fu:
                c["flood_until"] = 0
                self._save()

            if not self._punya_pesan():
                await self._notify("⚠️ Auto share berhenti: belum ada pesan promo.")
                c["running"] = False
                self._save()
                break

            pesan = self._ambil_pesan_rotasi()
            self.current_action = "Broadcasting..."
            grup_list = await self.get_target_groups()

            if not grup_list:
                await self._notify("⚠️ Tidak ada grup ditemukan. Auto share berhenti.")
                c["running"] = False
                self._save()
                break

            terkirim = 0
            gagal_list = []
            flood_hit = 0  # detik flood wait besar (>=30s) → stop total
            for dialog in grup_list:
                if not c.get("running"):
                    break
                try:
                    await self._kirim_ke_grup(dialog.id, pesan)
                    terkirim += 1
                    print(f"[SHARE {self.uid}] {datetime.now(WIB).strftime(chr(37)+chr(72)+chr(58)+chr(37)+chr(77)+chr(58)+chr(37)+chr(83))} OK {dialog.id} {getattr(dialog, chr(110)+chr(97)+chr(109)+chr(101), chr(63))}")  # log kirim per grup (untuk monitoring ritme)
                except Exception as e:
                    if isinstance(e, tg_errors.FloodWaitError):
                        detik = int(getattr(e, "seconds", 0) or 0)
                        if detik >= 30:
                            # Limit besar — BERHENTI total, jangan ngehantem.
                            flood_hit = detik
                            break
                        # Flood kecil — tunggu masa flood + JEDA RENDEM dulu
                        # (jangan langsung lanjut, biar gak keliatan share setiap detik).
                        self.current_action = f"Flood kecil {detik}s"
                        await asyncio.sleep(detik)
                        if c.get("running"):
                            if c["jeda_tipe"] == "aman":
                                await asyncio.sleep(random.uniform(5, 10))
                            elif c["jeda_tipe"] == "grup":
                                await asyncio.sleep(c["jeda_grup_detik"])
                        continue
                    # Auto-blacklist grup yang memblokir akun (banned/dimute/tidak diizinkan) biar
                    # gak dicoba terus & laporan gak penuh notif "terbanned".
                    if isinstance(e, (tg_errors.UserBannedInChannelError,
                                      tg_errors.ChatWriteForbiddenError,
                                      tg_errors.ChatAdminRequiredError,
                                      tg_errors.ForbiddenError)):
                        try:
                            _bl = c.setdefault("blacklist", [])
                            _bi = c.setdefault("blacklist_info", [])
                            if dialog.id not in _bl:
                                _bl.append(dialog.id)
                                _bi.append({"id": dialog.id, "name": getattr(dialog, "name", "?")})
                                self._save()
                        except Exception:
                            pass
                    gagal_list.append(map_error(e).replace("{grup}", dialog.name or "?"))

                if c["jeda_tipe"] == "grup" and c.get("running"):
                    await asyncio.sleep(c["jeda_grup_detik"])
                elif c["jeda_tipe"] == "aman" and c.get("running"):
                    # Jeda AMAN (RENDEM per grup) — kayak manusia:
                    # tiap grup dijeda 5-10 detik (kadang 5, kadang 10), variatif gak kaku,
                    # plus kadang-kadang ISTIRAHAT 1-2 menit kayak orang lagi sibuk/ngelamun:
                    #  ~55% 5-10 dtk   — copy-paste ke grup berikutnya
                    #  ~20% 10-16 dtk  — scroll/baca sebentar
                    #  ~12% 18-30 dtk  — buka HP sebentar
                    #  ~5%  35-60 dtk  — ngelamun sebentar
                    #  ~8%  60-120 dtk — ISTIRAHAT 1-2 menit (kadang-kadang)
                    r = random.random()
                    if r < 0.55:
                        d = random.uniform(5, 10)
                    elif r < 0.75:
                        d = random.uniform(10, 16)
                    elif r < 0.87:
                        d = random.uniform(18, 30)
                    elif r < 0.92:
                        d = random.uniform(35, 60)
                    else:
                        d = random.uniform(60, 120)
                    self.current_action = f"Sleeping (aman) {int(d)}s"
                    await asyncio.sleep(d)
                elif c.get("slowly", True) and c.get("running"):
                    await asyncio.sleep(1)

            self._save()

            # ===== PENGAMAN FLOOD WAIT: akun kena limit → berhenti & tunggu =====
            if flood_hit:
                c["flood_until"] = time.time() + flood_hit
                self._save()
                menit = int(flood_hit // 60)
                jam = menit // 60
                sisa_m = menit % 60
                durasi = f"{jam} jam {sisa_m} menit" if jam else f"{menit} menit"
                await self._notify(
                    f"🚨 AKUN LIMIT (flood wait {flood_hit}s ≈ {durasi})!\n"
                    f"Auto share DIHENTIKAN sementara biar hukuman tidak makin berat.\n"
                    f"Lanjut otomatis setelah masa limit selesai. 🔄"
                )
                # Tunggu sampai masa limit selesai (cek berkala; user bisa stop manual).
                while c.get("running"):
                    sisa = int((c.get("flood_until") or 0) - time.time())
                    if sisa <= 0:
                        break
                    self.current_action = f"Masa limit: {sisa}s lagi"
                    await asyncio.sleep(min(sisa, 60))
                c["flood_until"] = 0
                self._save()
                if c.get("running"):
                    await self._notify("✅ Masa limit selesai — auto share LANJUT normal.")
                    # Jeda ekstra setelah pulih, biar aman & tidak langsung kena lagi.
                    await asyncio.sleep(random.uniform(120, 300))
                continue

            laporan = self._build_report(terkirim, gagal_list)
            try:
                import report_bot
                # Edit laporan sebelumnya -> cuma laporan TERAKHIR yang tampil.
                _sent = await report_bot.kirim_last(self.uid, laporan)
            except Exception:
                _sent = False
            if not _sent:
                await self._notify(laporan)

            if not c.get("running"):
                break

            if c["jeda_tipe"] == "semua":
                detik = c["jeda_semua_menit"] * 60
            elif c["jeda_tipe"] == "aman":
                # Antar putaran diacak: kadang istirahat lama, kadang sebentar,
                # kadang langsung lanjut — pola gak bisa ditebak:
                #  ~45% istirahat lama (5-12 menit) — kayak selesai & ninggalin HP
                #  ~45% istirahat sebentar (1-3 menit) — ngaso dulu terus lanjut
                #  ~10% langsung lanjut (15-45 dtk) — semangat, putaran baru aja
                r = random.random()
                if r < 0.45:
                    detik = random.uniform(300, 720)
                elif r < 0.90:
                    detik = random.uniform(60, 180)
                else:
                    detik = random.uniform(15, 45)
            else:
                detik = c["jeda_grup_detik"]
            self.current_action = f"Sleeping for {int(detik)}s"
            await asyncio.sleep(detik)

        self.current_action = "Idle"

    def _build_report(self, terkirim, gagal_list):
        total = terkirim + len(gagal_list)
        waktu = datetime.now(WIB).strftime("%H:%M:%S %d/%m/%Y")
        baris = [
            "📤 **LAPORAN TERKIRIM**",
            f"🕒 {waktu}",
            f"⏲️ Jeda: {self.fmt_jeda()}",
            f"🌐 Total grup: {total}",
            "━━━━━━━━━━━━━━━━━━━━",
            f"✅ Sukses: {terkirim} Grup",
            f"❌ Gagal: {len(gagal_list)} Grup",
        ]
        if gagal_list:
            baris.append("")
            baris.append("**Gagal Terkirim (keterangan):**")
            for a in gagal_list:
                baris.append(f"> {a}")
        baris.append("")
        baris.append(f"🤖 UserBot by {self.me.first_name if self.me else 'User'}")
        return "\n".join(baris)

    # ---------------- timer ----------------
    async def _timer_loop(self):
        c = self.config
        while self.client.is_connected():
            await asyncio.sleep(30)
            t = c.get("timer")
            if not t:
                continue
            sekarang = datetime.now(WIB).strftime("%H:%M")
            if sekarang == t["on"] and not c.get("running") and self._punya_pesan():
                c["running"] = True
                self._save()
                self.start_share()
                await self._notify(f"⏱️ Timer: Auto share DIMULAI ({sekarang}).")
                await asyncio.sleep(60)
            elif sekarang == t["off"] and c.get("running"):
                c["running"] = False
                self._save()
                await self._notify(f"⏱️ Timer: Auto share DIHENTIKAN ({sekarang}).")
                await asyncio.sleep(60)

    # ---------------- autoreply ----------------
    def _register_autoreply(self):
        @self.client.on(events.NewMessage(incoming=True))
        async def _listener(event):
            lst = self.config.get("replies", [])
            if not lst:
                return
            teks = (event.raw_text or "").lower()
            if not teks:
                return
            for r in lst:
                if r["trigger"].lower() in teks:
                    try:
                        await event.reply(r["response"])
                    except Exception:
                        pass
                    break

    # ---------------- status ----------------
    def _delay_ringkas(self):
        c = self.config
        mode = "Slowly" if c.get("slowly", True) else "Fast"
        if c["jeda_tipe"] == "aman":
            return f"Acak/Random (Aman) - {mode}"
        if c["jeda_tipe"] == "semua":
            return f"{c['jeda_semua_menit']} Menit/putaran - {mode}"
        return f"{c['jeda_grup_detik']} Detik - {mode}"

    async def status_text(self):
        c = self.config
        try:
            jml_grup = len(await self.get_all_groups())
        except Exception:
            jml_grup = 0
        try:
            jml_target = len(await self.get_target_groups())
        except Exception:
            jml_target = jml_grup
        jeda_agresif = (
            (c["jeda_tipe"] == "grup" and c["jeda_grup_detik"] < 15)
            or (c["jeda_tipe"] == "semua" and c["jeda_semua_menit"] < 20)
        )
        safemode = "Aktif" if (jml_target > 30 or jeda_agresif) else "Off"
        status = f"Running {c.get('tier', 'Free')}" if c.get("running") else "Stopped"
        timer = f"ON {c['timer']['on']} / OFF {c['timer']['off']}" if c.get("timer") else "Null"
        email = c.get("email") or "Null"
        target = "Semua grup (auto)" if c.get("target_mode") != "pilih" else f"Pilih ({len(c.get('target_list', []))} grup)"
        lim = c.get("limit", 0) or 0
        limit_txt = f"{lim} grup/putaran" if lim > 0 else "Tanpa batas"
        uid = self.me.id if self.me else self.uid
        return (
            f"🏷️ **UserID:** `{uid}`\n\n"
            f"🕒 **Delay:** {self._delay_ringkas()}\n"
            f"⏱️ **Timer:** {timer}\n"
            f"📝 **Autoreply:** {len(c.get('replies', []))}\n"
            f"🧭 **Channel:** {c.get('channel', 0)}\n"
            f"⚡ **Extra:** {c.get('extra', 0)}\n"
            f"🌐 **Grup:** {jml_grup}\n"
            f"🎯 **Target:** {target}\n"
            f"🔢 **Limit:** {limit_txt}\n"
            f"📨 **Akan dikirim ke:** {jml_target} grup\n"
            f"📚 **List:** {len(c.get('pesan_list', []))}\n\n"
            f"👑 **Mode:** {c.get('mode', 'Forward')}\n"
            f"⚠️ **Safemode:** {safemode}\n"
            f"🚀 **Status:** {status}\n"
            f"🔥 **Expired:** {c.get('expired', 'Null')}\n"
            f"🔔 **Notifikasi:** Aktif - {c.get('notification', 'Kirim ke Saya')}\n"
            f"✉️ **Email:** {email}\n"
            f"👤 **Admin:** {c.get('admin', 0)}\n"
            f"📦 **Tindakan Terkini:** {self.current_action}\n\n"
            f"_Ads: {c.get('ads', '')}_"
        )
