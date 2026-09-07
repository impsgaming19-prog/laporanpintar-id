# Backend Toko KAKO NOKOS — Sambungan Provider OTP

File: `src/server/kirimkode.ts`
_endpoint_: `POST /api/kirimkode/order`

## Aturan server yang sudah disepakati

- Harga yang ditampilkan di website sudah final.
- Harga final = harga provider + 30% bagian penjual.
- Pembeli hanya melihat satu harga akhir. Refund pakai harga yang sama.

## Pemetaan server ke provider

- **JasaOTP v1** → Kirimkode
- **JasaOTP v2** → Ditznesia
- **JasaOTP v3** → Ditznesia API v2
- Jika nanti ada **JasaOTP v4**, ikuti pola yang sama: pilih provider yang sesuai, lalu hitung harga final +30%.

## Cara kerja fitur beli

1. Pembeli pilih server, negara, dan layanan.
2. Website tampilkan harga final.
3. Tombol beli kirim permintaan ke backend.
4. Backend pilih provider sesuai server yang dipilih.
5. Backend panggil API provider yang bersangkutan.
6. Jika berhasil, simpan nomor/order dan kirim ke pembeli lewat Telegram.

## Environment yang dibutuhkan

- `PAYMENTKU_API_URL`: default `https://paymenku.com/api/v1`.
- `NOKOS_KIRIMKODE_API_KEY` untuk Kirimkode.
- `NOKOS_KIRIMKODE_API_URL`: default `https://kirimkode.com/api/order`.
- `NOKOS_DITZNESIA_API_KEY` atau nama env lain yang disepakati untuk Ditznesia.
- `NOKOS_DITZNESIA_API2_KEY` jika API v2 punya kunci sendiri.
- `NOKOS_PAYMENTKU_API_KEY` untuk Paymentku.

Jangan simpan kunci di dalam file kode. Simpan di bagian Environment/Keys pada pengaturan projek.

## Paymentku

- Backend helper: `src/server/paymentku.ts`
- API URL: `https://paymenku.com/api/v1`
- Metode deposit di toko ini: QR only.
- Pastikan domain ini benar. Jika maksudmu `paymentku.com`, perbaiki base URL-nya di kode sebelum dipakai produksi.
- Endpoint dan parameter di helper masih placeholder sampai kamu beri detail endpoint/parameter resmi Paymentku.

## Catatan penting

- Backend ini bukan untuk dikirim ke browser. Semua panggilan ke provider harus dari server.
- Jika provider gagal atau timeout, jangan potong saldo atau tanda-tangani order.Append log error dan beri status yang jujur ke pembeli.
- Nomor yang keluar harus sesuai dengan server yang dipilih pembeli.
