# botdeploy/ — KAKO STORE Bot siap deploy gratis 24/7

Isi folder ini = kode bot kamu + pelengkap deploy ke hosting gratis
(Hugging Face Spaces, tanpa kartu kredit).

| File | Fungsi |
|---|---|
| `manager_bot.py`, `userbot.py`, `v2_*`, `v3_*`, `v4_*`, dll. | Kode bot asli kamu (tidak diubah logikanya) |
| `config.py` | Versi baru: membaca kredensial dari Secrets (bukan hardcode) |
| `runner.py` | Menjalankan bot: auto-restart + keep-alive HTTP + restore data dari Secrets |
| `make_secret.py` | Membuat `CONFIG_JSON` & `DATA_B64` dari backup asli (dijalankan di Termux/VPS) |
| `Dockerfile`, `requirements.txt` | Untuk build di HF Spaces / Docker / VPS |
| `DEPLOY.md` | **Panduan lengkap — mulai dari sini** |

Keamanan: `.env`, `*.session`, dan data JSON tidak masuk git — semua
kredensial lewat Secrets hosting (lihat `.gitignore`).
