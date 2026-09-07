# 🚀 Deploy Bot KAKO STORE — Gratis 24/7 tanpa Kartu Kredit

Bot jalan di **Hugging Face Spaces** (gratis, tanpa kartu kredit). HP kamu bebas.

---

## Langkah 1 — Bikin 2 SECRET (sekali saja)

Jalankan di Termux/VPS, **di folder backup yang lengkap**
(yang berisi `config.py`, `.session`, `users.json`, dan sebelahnya ada `backend/.env`):

```bash
# salin make_secret.py dari repo ini ke folder backup, lalu:
python3 make_secret.py
```

Output: 2 nilai rahasia:

1. **CONFIG_JSON** — semua kredensial bot (bot token, api id/hash, session, dll.)
2. **DATA_B64** — data user + file `.session` kamu dibungkus jadi satu

⚠️ **Penting:**
- Kalau muncul `API_HASH` kosong / tidak ada di CONFIG_JSON: ambil manual dari
  https://my.telegram.org → API development tools → salin `api_hash`, lalu sisipkan
  manual ke dalam CONFIG_JSON: `"API_HASH":"isinya_disini",`
- Punya fitur panel Pterodactyl? Tambahkan juga ke CONFIG_JSON:
  `"PTERO_PANEL_URL":"http://103.253.244.26","PTERO_APP_API_KEY":"ptla_xxx"`
- **Fitur 📱 Nokos** (jual nomor OTP semua negara & semua aplikasi, 2 web jadi 1,
  multi-server)? Tambahkan ke CONFIG_JSON:
  `"KIRIMKODE_API_KEY":"kk_xxx"` → membuka 10 server (Bimasakti, Neptune, Earth, …)
  `"DITZ_API_KEY":"xxx"` → membuka Ditznesia Server 1
  `"DITZ_API_KEY_S2":"xxx"` … s/d `DITZ_API_KEY_S5` → clone server 2–5 (opsional)
  Opsional: `"NOKOS_MARKUP":"500"` (untung per nomor, default Rp 500),
  `"NOKOS_MARKUP_KK1":"700"` (markup per server),
  `"NOKOS_MIN_TOPUP":"5000"`, `"NOKOS_BRAND":"KAKO NOKOS"`.
  Harga jual = harga asli provider + markup; selisih reconcile otomatis.
  Tanpa api key, menu Nokos tampil "belum aktif" — bot tetap normal, tidak error.
- Jangan pernah membagikan kedua nilai ini ke siapa pun.

## Langkah 2 — Buat Space di Hugging Face

1. Daftar/masuk: https://huggingface.co (gratis, tanpa kartu kredit)
2. Buka https://huggingface.co/new-space
   - Nama: misal `kakostore-bot`
   - SDK: pilih **Docker** → Blank → Public → Create Space
3. Upload **semua file** dari folder `botdeploy/` repo ini:
   - Semua `.py` (manager_bot, userbot, config, runner, dst.)
   - `Dockerfile`, `requirements.txt`
   - **Jangan upload** `.env`, `*.session`, atau `*.json` data
4. Tunggu build pertama selesai (2–3 menit). Gagal build masih normal —
   Secrets belum diisi.

## Langkah 3 — Isi Secrets

Di Space: **Settings → Variables and secrets → New secret**, tambahkan:

| Nama | Nilai |
|---|---|
| `CONFIG_JSON` | hasil Langkah 1 (satu baris) |
| `DATA_B64` | hasil Langkah 1 (satu baris) |

Setelah simpan, Space otomatis restart & bot mulai jalan.

> ⚠️ **Matikan dulu bot yang masih jalan di Termux/VPS lama!**
> Session Telegram yang sama dipakai di 2 tempat bersamaan bisa bikin
> bot error/logut. Jalan di SATU tempat saja.

## Langkah 4 — Cek

1. Space → tab **Logs** (App logs): harus muncul `=== KAKO STORE bot start ===`
   tanpa error berulang.
2. Buka bot kamu di Telegram → kirim `/start` → harus respons normal, semua
   menu tampil (whitelist, user, saldo & session lama sudah ikut).
3. Fitur "Buat Userbot" juga jalan — sesi userbot baru tersimpan selama Space hidup.

## Langkah 5 — Anti-Tidur (keep-alive)

Space gratis bisa tidur kalau tidak ada trafik HTTP. Pasang gratis:

1. Daftar https://uptimerobot.com (gratis)
2. Add New Monitor → tipe **HTTP(s)** → interval 10 menit
3. URL: `https://NAMA-SPACE-USERNAME.hf.space`
   (lihat di tab App → kalau respons "kakostore bot is running" berarti benar)

Selesai — bot online 24/7. 🎉

---

## Catatan & keterbatasan versi gratis (jujur)

- **Data JSON** (user baru, saldo, token) tersimpan selama Space hidup.
  Kalau Space restart, data kembali seperti `DATA_B64` terakhir.
  Update data: jalankan ulang `make_secret.py` di backup terbaru → ganti
  secret `DATA_B64` → Space restart otomatis.
- **Fitur panel Pterodactyl** aktif kalau kamu isi `PTERO_PANEL_URL` +
  `PTERO_APP_API_KEY` di CONFIG_JSON (Langkah 1).
- **Fitur 📱 Nokos** aktif kalau ada `KIRIMKODE_API_KEY` atau `DITZ_API_KEY`.
  Cara pakai: menu **📱 Nokos** → **pilih server** (harga beda tiap server) →
  pilih negara (semua negara) → pilih layanan (WA/TG/IG/FB/Gojek/Grab/Shopee/TikTok
  dll, harga+stok asli tampil) → bayar **saldo nokos** (topup QRIS min Rp 5.000)
  atau **QRIS langsung** → nomor dikirim otomatis → OTP masuk otomatis ke chat.
  Batal/timeout tanpa OTP = **refund penuh otomatis**.
  Owner: cek semua server & saldo provider di 👑 Panel Owner → 📱 Nokos.
- Kalau di Logs muncul `ModuleNotFoundError: No module named 'xxx'`:
  tambahkan `xxx` ke `requirements.txt` → commit → Space rebuild otomatis.
- Untuk pemakaian jangka panjang / data permanen, VPS murah tetap opsi
  terbaik nanti — semua file di `botdeploy/` ini tinggal copy ke VPS.

## Troubleshooting cepat

| Masalah | Solusi |
|---|---|
| `CONFIG_JSON belum diset!` | Secret belum dibuat / salah nama (huruf besar semua) |
| `CONFIG_JSON bukan JSON valid` | Salin ulang, pastikan satu baris utuh |
| Bot tidak respons | Cek Logs; pastikan bot lama di Termux sudah MATI |
| `AuthKeyDuplicatedError` | Session dipakai di 2 tempat — matikan yang lama |
| Build gagal | Baca error di tab Logs (Build) — biasanya salah nama file |
