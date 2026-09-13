/**
 * Layanan Bantuan (CS) — tombol "Bantuan" di website.
 *
 * Alur:
 * 1. Customer menekan tombol bantuan (tombol ngambang kanan bawah).
 * 2. Ada 2 pilihan yang bisa dinyalakan/dimatikan Owner di Panel Admin →
 *    tab "Bantuan CS":
 *      a. Chat di website — pesan disimpan & dijawab OTOMATIS dengan balasan
 *         siap pakai ala CS (bukan AI, tidak butuh kunci API). Balasan diambil
 *         dari daftar pertanyaan yang paling sering ditanyakan customer.
 *         Kalau customer memang minta admin / komplain berat, percakapan
 *         dialihkan ke admin/CS.
 *      b. WhatsApp — customer diarahkan ke nomor WhatsApp milik Owner.
 * 3. Owner/CS membalas dari Panel Admin → tab "Bantuan CS".
 *
 * Pengaturan disimpan di nokosSettings (bisa juga dibaca action lain):
 *   supportConfig: { autoReply, contactEnabled, waNumber }
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Cast ke any: generated api/internal memuat modul ini sendiri -> inferensi
// tipe melingkar. Objek referensi tetap valid saat runtime.
const I = internal as any;

const MAX_BODY = 1000;
const SETTINGS_KEY = "supportConfig";
/** Nomor WhatsApp bawaan (Owner bisa ganti kapan saja dari Panel Admin). */
const DEFAULT_WA = "12897540214";

type SupportConfig = {
  /** Balasan otomatis sederhana di chat website. */
  autoReply: boolean;
  /** Tampilkan pilihan WhatsApp untuk customer. */
  contactEnabled: boolean;
  /** Nomor WhatsApp (boleh pakai +, spasi, atau tanda hubung). */
  waNumber: string;
};

function normalizeConfig(raw: any): SupportConfig {
  return {
    autoReply: raw?.autoReply !== false,
    contactEnabled: raw?.contactEnabled !== false,
    waNumber: typeof raw?.waNumber === "string" ? raw.waNumber : DEFAULT_WA,
  };
}

function waLink(value: string): { url: string | null; number: string } {
  const digits = (value || "").replace(/[^0-9]/g, "");
  if (!digits) return { url: null, number: "" };
  return { url: `https://wa.me/${digits}`, number: `+${digits}` };
}

async function readConfig(ctx: any): Promise<SupportConfig> {
  const map = await ctx.runQuery(I.wallet.getSettings, {});
  return normalizeConfig(map?.[SETTINGS_KEY]);
}

/* =====================================================================
 * Balasan otomatis ala CS (tanpa AI) — cocok kata kunci + pilih yang paling tepat
 * ===================================================================== */

type CsEntry = {
  /** Nama topik (buat pengecekan/manusia). */
  tag: string;
  /** Kata kunci. Frasa (pakai spasi) bernilai lebih tinggi dari kata tunggal. */
  keys: string[];
  answer: string;
  /** Setelah menjawab, percakapan diteruskan ke admin (kasus uang/akun). */
  notifyAdmin?: boolean;
};

const CS_KNOWLEDGE: CsEntry[] = [
  {
    tag: "sapaan",
    keys: [
      "halo", "hallo", "hai", "hi", "hello", "pagi", "siang", "sore", "malam",
      "permisi", "assalamualaikum", "assalam", "salam", "min", "mimin", "kak",
      "bang", "gan", "bos", "bro", "om", "tante", "tes", "test",
    ],
    answer:
      "Halo Kak 👋 Selamat datang di CS KAKO NOKOS.\nAda yang bisa dibantu? Kamu bisa tanya soal cara beli nomor, isi saldo, minimal deposit, OTP, refund, kode promo, atau kendala order — tulis saja pertanyaannya di sini, aku bantu jelaskan 🙂",
  },
  {
    tag: "terima-kasih",
    keys: ["makasih", "terimakasih", "terima kasih", "thanks", "thank", "thx", "tks", "sip", "mantap", "keren", "top"],
    answer: "Sama-sama Kak 🙏 Kalau nanti ada yang kurang jelas atau ada kendala, tulis lagi di chat ini ya. Senang bisa bantu 😊",
  },
  {
    tag: "cara-beli",
    keys: [
      "cara beli", "cara beli nomor", "gimana beli", "bagaimana beli", "cara pesan",
      "cara order", "langkah beli", "panduan beli", "cara belinya", "cara topup nomor",
      "beli nomor", "pesan nomor", "order nomor", "mau beli", "cara beli nya", "beli gimana",
    ],
    answer:
      "Cara beli nomornya gampang Kak:\n1. Buka menu Beli Nomor\n2. Pilih server (v1 paling lengkap, v2–v4 cadangan)\n3. Pilih negara, lalu pilih layanan (mis. WhatsApp)\n4. Tekan Beli — saldo otomatis terpotong dan nomornya langsung muncul\n\nNomornya bisa langsung dipakai untuk verifikasi. Kalau ada langkah yang bingung, bilang saja langkah nomor berapa 🙂",
  },
  {
    tag: "cara-daftar",
    keys: [
      "cara daftar", "daftar akun", "buat akun", "bikin akun", "register",
      "registrasi", "sign up", "cara bikin akun", "daftar gagal", "tidak bisa daftar",
    ],
    answer:
      "Untuk daftar: tekan tombol Daftar di halaman depan, isi email dan password, lalu akunmu langsung aktif dan bisa login.\n\nKalau emailmu sudah pernah dipakai, coba login saja. Kalau daftar gagal terus, tulis email yang kamu pakai — nanti dibantu cek oleh admin.",
  },
  {
    tag: "isi-saldo",
    keys: [
      "isi saldo", "cara isi saldo", "top up", "topup", "top-up", "deposit",
      "tambah saldo", "minimal deposit", "minimum deposit", "minimal isi",
      "minimal top up", "batas deposit", "metode pembayaran", "bayar pakai apa",
      "qris", "transfer bank", "e wallet", "ewallet", "dana", "gopay", "ovo",
      "shopeepay", "cara bayar", "biaya admin", "biaya tambahan", "ada biaya admin",
      "kena biaya", "biaya deposit", "biaya isi saldo",
    ],
    answer:
      "Isi saldo bisa lewat 2 cara Kak:\n• QRIS otomatis — saldo masuk sendiri begitu pembayaran berhasil (paling cepat, tidak perlu kode unik)\n• Manual — QR / transfer bank / e-wallet, dikonfirmasi admin setelah kamu unggah bukti\n\nMinimal deposit Rp 10.000 dan tidak ada biaya tambahan. Nominal yang kamu bayar masuk 100% jadi saldo 🎉",
  },
  {
    tag: "saldo-belum-masuk",
    keys: [
      "saldo belum masuk", "saldo tidak masuk", "saldo gak masuk", "belum masuk saldo",
      "sudah bayar", "sudah transfer", "udah bayar", "udah transfer", "sudah ku bayar",
      "deposit pending", "menunggu konfirmasi", "belum dikonfirmasi", "belum di konfirmasi",
      "bukti transfer", "sudah upload", "dana sudah", "uang sudah masuk",
    ],
    answer:
      "Terima kasih infonya Kak 🙏 Kalau pembayaranmu lewat QRIS otomatis, saldo biasanya masuk sendiri dalam 1–3 menit — coba tutup lalu buka lagi halaman saldo.\n\nKalau lewat manual, admin perlu konfirmasi dulu (biasanya cepat). Aku sudah teruskan ke admin supaya dicek, sertakan nominal dan jam pembayaranmu di chat ini ya.",
    notifyAdmin: true,
  },
  {
    tag: "harga",
    keys: [
      "harga", "harga nomor", "berapa harga", "biaya", "tarif", "mahal", "murah",
      "kenapa beda harga", "beda harga", "harga beda", "harga tidak sama",
      "kode promo harga", "harga final", "ada biaya", "kenapa mahal",
    ],
    answer:
      "Harga yang tampil itu harga final Kak — tidak ada biaya tersembunyi, yang kamu bayar itulah harganya.\n\nHarga bisa berbeda antar server karena sumber stoknya berbeda, dan stok/harga selalu ikut server resmi. Kalau mau yang paling hemat, pilih server yang harganya paling rendah untuk layanan yang kamu cari ya 🙂",
  },
  {
    tag: "refund",
    keys: [
      "refund", "refund dana", "batal", "batalkan", "cara batal", "cancel",
      "pembatalan", "uang kembali", "uang balik", "pengembalian dana",
      "cancel order", "minta refund", "syarat refund", "aturan refund",
    ],
    answer:
      "Aturan batal/refund di toko kami:\n• Bisa dibatalkan minimal 2 menit setelah pembelian, dari menu Riwayat → pilih order → Batal (saldo langsung kembali)\n• Kalau kode OTP sudah masuk, order TIDAK bisa dibatalkan/direfund\n• Kalau pembelian gagal, saldo otomatis dikembalikan tanpa perlu diminta\n\nKalau ordernya sudah lebih dari 2 menit dan OTP belum masuk, tulis nomor ordernya ya — admin bantu proses.",
  },
  {
    tag: "otp-belum-masuk",
    keys: [
      "otp", "otp belum", "otp gak masuk", "otp tidak masuk", "belum masuk otp",
      "kode otp", "kode belum", "kode gak masuk", "kode tidak masuk", "belum dapat kode",
      "belum dapat otp", "otp lama", "kode lama", "sms belum", "sms tidak masuk",
      "kode verifikasi", "tidak menerima kode", "gak nerima kode", "kode tak kunjung",
      "otp nya", "otpnya", "kode nya", "kodenya",
    ],
    answer:
      "Untuk kode OTP, ini yang perlu kamu tahu Kak:\n1. Kode masuk otomatis ke menu Riwayat begitu dikirim layanan — kamu tidak perlu refresh\n2. Ada tombol \"Periksa OTP\" untuk cek manual\n3. Waktu datang kode berbeda tiap aplikasi: WhatsApp/Telegram biasanya cepat, aplikasi lain bisa 1–10 menit\n4. Pastikan nomor yang dimasukkan di aplikasi persis sama dengan nomor yang kamu beli\n\nKalau sudah lebih dari 15 menit belum masuk, tulis nomor ordernya di chat ini — aku teruskan ke admin untuk dicek/diproses refund sesuai aturan.",
  },
  {
    tag: "nomor-tidak-bisa",
    keys: [
      "nomor sudah dipakai", "nomor terpakai", "nomor tidak valid", "nomor gak valid",
      "nomor salah", "nomor tidak bisa", "nomor gak bisa", "tidak bisa dipakai",
      "gak bisa dipakai", "sudah terdaftar", "nomor tidak menerima", "gak bisa terima otp",
      "tidak bisa terima otp",      "otp salah", "kode salah", "nomor tidak aktif",
      "nomor sudah terdaftar", "nomor diblokir", "nomor jelek", "nomor spam",
      "sudah dipakai", "dipakai orang", "nomor dipakai", "dipakai orang lain",
    ],
    answer:
      "Maaf ya Kak 🙏 Kalau nomornya tidak bisa dipakai:\n• Kalau belum lewat 2 menit, langsung batalkan dari menu Riwayat → saldo kembali otomatis\n• Kalau sudah lewat 2 menit, tulis nomor ordernya di chat ini — aku teruskan ke admin agar dibantu proses pengembalian sesuai aturan\n\nSebelum beli, pastikan aplikasi tujuan memang menerima nomor virtual ya.",
    notifyAdmin: true,
  },
  {
    tag: "masa-aktif-nomor",
    keys: [
      "berapa lama", "masa aktif", "kedaluwarsa", "kadaluarsa", "expired",
      "batas waktu", "berlaku berapa lama", "nomor hilang", "nomor kadaluarsa",
      "nomor expired", "lama aktif",
    ],
    answer:
      "Nomor yang kamu beli bersifat sementara untuk verifikasi Kak — masa aktifnya mengikuti layanan (umumnya beberapa menit sampai beberapa jam sejak nomor terbit).\n\nSaran: setelah kode OTP masuk, segera pakai kodenya dan aktifkan verifikasi 2 langkah / email pemulihan di akunmu, supaya akun tetap aman walau nomornya sudah tidak aktif.",
  },
  {
    tag: "order-gagal",
    keys: [
      "order gagal", "gagal order", "gagal beli", "gagal terus", "saldo terpotong",
      "saldo kepotong", "saldo berkurang", "nomor tidak keluar", "nomor gak keluar",
      "tidak dapat nomor", "gak dapat nomor", "kenapa gagal", "error", "eror",
      "tidak bisa beli", "gak bisa beli", "stok habis", "stok kosong",
    ],
    answer:
      "Kalau pembelian gagal, saldo kamu otomatis dikembalikan ya Kak — cek di menu Riwayat/saldo, biasanya kembali seketika.\n\nCoba juga server lain (v2/v3/v4) karena stok tiap server berbeda. Kalau saldo benar-benar terpotong tapi nomor tidak keluar, tulis nomor ordernya di chat ini — aku teruskan ke admin untuk dicek.",
    notifyAdmin: true,
  },
  {
    tag: "saldo-kurang",
    keys: [
      "saldo kurang", "saldo tidak cukup", "saldo gak cukup", "kurang saldo", "saldo habis",
      "saldo minim", "saldo kecil", "kurang", "saldo saya kurang", "saldo saya tidak cukup",
      "saldo saya gak cukup", "saldo saya habis",
    ],
    answer:
      "Kalau muncul pesan saldo tidak cukup, berarti saldo kamu di bawah harga layanan yang dipilih Kak. Solusinya: tekan Isi Saldo (minimal Rp 10.000) lalu ulangi pembeliannya.\n\nKalau menurutmu saldomu seharusnya cukup, tulis di chat ini — aku bantu cek.",
  },
  {
    tag: "aplikasi-tersedia",
    keys: [
      "aplikasi apa", "aplikasi apa saja", "layanan apa", "layanan apa saja",
      "app apa", "tersedia apa", "ada apa saja", "whatsapp", "telegram", "tiktok",
      "instagram", "facebook", "google", "shopee", "tokopedia", "grab", "gojek",
      "line", "twitter", "netflix", "akun game", "aplikasi bank", "wa",
    ],
    answer:
      "Kami menyediakan nomor untuk verifikasi hampir semua aplikasi Kak: WhatsApp, Telegram, Google/Gmail, TikTok, Instagram, Facebook, X/Twitter, Shopee, Tokopedia, Grab, Gojek, Line, Netflix, layanan game, dan ratusan aplikasi lain.\n\nKalau aplikasi yang kamu cari tidak ketemu, tulis nama aplikasinya di chat ini — nanti dibantu cek ketersediaannya.",
  },
  {
    tag: "negara",
    keys: [
      "negara apa", "negara apa saja", "negara tersedia", "daftar negara",
      "stok negara", "indonesia", "malaysia", "filipina", "vietnam", "rusia",
      "ukraina", "amerika", "india", "china", "thailand", "kamboja",
    ],
    answer:
      "Negara yang tersedia 190+ Kak, termasuk Indonesia, Malaysia, Filipina, Vietnam, Thailand, India, Rusia, Ukraina, Amerika, dan banyak lagi.\n\nDi halaman Beli Nomor, pilih dulu negaranya lalu muncul daftar layanan + harga untuk negara tersebut. Kalau negara yang kamu cari tidak muncul, berarti stoknya sedang kosong di server itu — coba server lain ya.",
  },
  {
    tag: "server",
    keys: [
      "server", "beda server", "pilih server", "server apa", "v1", "v2", "v3", "v4",
      "server mana", "server bagus", "server murah", "kenapa ada 4 server",
    ],
    answer:
      "Di toko kami ada 4 server Kak:\n• Server v1 — pilihan paling lengkap (negara & layanan terbanyak), harga biasanya paling murah\n• Server v2–v4 — cadangan dengan sumber stok berbeda, berguna kalau stok di v1 kosong atau order sedang gagal\n\nCara pakai & OTP-nya sama di semua server, dan saldo bisa dipakai di server mana pun. Kalau v1 kosong, tinggal pindah server ya 🙂",
  },
  {
    tag: "promo",
    keys: ["promo", "voucher", "kode promo", "diskon", "potongan", "kupon", "kode diskon", "kode voucher"],
    answer:
      "Promo bisa dipakai lewat menu Kode Promo di halaman akun Kak: masukkan kodenya → tekan Pakai. Potongan langsung masuk ke saldo/pembelianmu.\n\nKalau kodenya ditolak, tulis kodenya di chat ini — aku bantu cek apakah masih berlaku.",
  },
  {
    tag: "ajak-teman",
    keys: [
      "ajak teman", "kode undangan", "referral", "referal", "undang teman",
      "bonus ajak", "kode referal", "kode ref", "bonus teman", "bagi kode",
    ],
    answer:
      "Program Ajak Teman: bagikan kode undanganmu ke teman. Kalau temanmu daftar dan isi saldo pertamanya minimal Rp 20.000, kamu langsung dapat bonus Rp 5.000 ke saldo — otomatis, tanpa klaim.\n\nBonus dihitung sekali per teman, dan yang diundang tetap dapat saldo penuh sesuai yang dia bayar. Kodenya ada di menu Ajak Teman ya Kak 🎁",
  },
  {
    tag: "akun-password",
    keys: [
      "lupa password", "ganti password", "reset password", "tidak bisa login",
      "gak bisa login", "tidak bisa masuk akun", "password salah", "akun terkunci",
      "ganti email", "email salah", "akun saya hilang", "tidak bisa masuk",
    ],
    answer:
      "Untuk kasus akun, demi keamanan reset password dilakukan oleh admin ya Kak (biar tidak ada yang bisa membajak akun orang lain).\n\nTulis di chat ini: email akunmu + kendalanya. Admin akan bantu reset dan password baru hanya dikirim ke chat akun ini.\n\nPenting: kami TIDAK pernah meminta password atau kode OTP kamu 🙏",
    notifyAdmin: true,
  },
  {
    tag: "keamanan",
    keys: [
      "aman", "aman gak", "apakah aman", "terpercaya", "bisa dipercaya",
      "data saya", "privasi", "nomor penting", "akun penting", "whatsapp utama",
      "nomor utama", "buat wa utama", "akun bank", "paypal", "akun bisnis",
      "kena blokir", "banned", "diblokir",
    ],
    answer:
      "Nomor kami berasal dari server resmi dan stoknya diambil langsung dari sana, jadi bisa dipakai verifikasi dengan normal Kak. Kami juga tidak menyimpan data akunmu untuk hal lain.\n\nCatatan penting: nomor ini bersifat sementara (untuk verifikasi), jadi sebaiknya JANGAN dipakai untuk akun penting/jangka panjang seperti WhatsApp utama atau akun bank. Setelah kode masuk, segera pasang verifikasi tambahan di aplikasi tujuan supaya akunmu aman.",
  },
  {
    tag: "cara-pakai-nomor",
    keys: [
      "cara pakai nomor", "cara pakai nomornya", "cara pakai", "cara gunain",
      "gimana pakai nomor", "cara masukan nomor", "cara input nomor", "pakai nomor",
      "cara verifikasi", "cara daftar wa", "cara masukkan nomor", "cara menggunakan nomor",
    ],
    answer:
      "Cara pakainya Kak:\n1. Buka aplikasi tujuan (mis. WhatsApp) → masukkan nomor yang sudah kamu beli (pakai format +kode negara, mis. +62…)\n2. Tekan lanjut / minta kode\n3. Kembali ke website → menu Riwayat → kode OTP akan muncul di order tersebut (bisa juga tekan \"Periksa OTP\")\n4. Masukkan kodenya di aplikasi\n\nKalau aplikasi bilang kodenya salah, tunggu sebentar lalu minta kode ulang — pastikan format nomornya benar.",
  },
  {
    tag: "cek-order",
    keys: [
      "cek order", "riwayat", "histori", "lihat nomor", "nomor saya",
      "order saya", "status order", "di mana nomor", "nomor yang saya beli",
      "lacak order", "cari order", "pesanan saya",
    ],
    answer:
      "Semua pembelianmu bisa dilihat di menu Riwayat Kak — di sana ada nomor order, nomor yang kamu beli, status order, dan kode OTP yang masuk.\n\nKalau ada order yang statusnya masih menunggu dan lebih dari 15 menit belum ada kode, tulis nomor ordernya di chat ini ya — aku teruskan ke admin.",
  },
  {
    tag: "jumlah-pembelian",
    keys: ["batas beli", "bisa berapa", "banyak nomor", "beli banyak", "bulk", "maksimal beli", "limit beli"],
    answer:
      "Tidak ada batas jumlah Kak — kamu bisa beli 1 nomor atau banyak sekaligus, tergantung stok yang tersedia. Kalau butuh jumlah besar untuk jangka panjang, tulis kebutuhannya di chat ini (jumlah & aplikasinya), nanti admin bantu carikan.",
  },
  {
    tag: "jam-operasional",
    keys: [
      "jam berapa", "buka jam", "online jam", "24 jam", "jam kerja", "cs online",
      "kapan balas", "admin online", "lama balas", "kapan dibalas", "adminnya dimana",
    ],
    answer:
      "Toko & pembelian otomatis bisa dipakai 24 jam Kak, dan chat website ini dijawab otomatis kapan saja.\n\nKalau butuh admin manusia, laporannya masuk ke admin dan dibalas secepatnya (biasanya pada jam kerja). Kamu tidak perlu khawatir, semua laporan tercatat di akunmu dan balasannya muncul di chat ini.",
  },
  {
    tag: "salah-nominal-deposit",
    keys: ["kurang bayar", "lebih bayar", "nominal beda", "salah transfer", "salah nominal", "transfer kelebihan", "bayar kelebihan"],
    answer:
      "Tenang Kak, tidak ada uangmu yang hilang. Kalau nominal transfer berbeda dari yang diminta, tulis nominal yang kamu kirim + jam bayarnya di chat ini.\n\nAku sudah teruskan ke admin supaya dicocokkan dan saldo disesuaikan sesuai jumlah yang benar-benar masuk.",
    notifyAdmin: true,
  },
  {
    tag: "reseller",
    keys: ["reseller", "jual lagi", "kerja sama", "kerjasama", "grosir", "agen", "mitra", "deposit besar", "usaha"],
    answer:
      "Terima kasih minatnya Kak 🙌 Untuk kerja sama/reseller atau pembelian jumlah besar, aku teruskan ke admin agar bisa dibahas langsung (harga khusus, cara order, dan hal teknisnya).\n\nTulis di chat ini: nama usahamu, perkiraan jumlah nomor per hari, dan aplikasi yang paling kamu butuhkan ya.",
    notifyAdmin: true,
  },
];

/** Permintaan tegas ke manusia (frasa) — langsung dialihkan ke admin/CS. */
const HUMAN_PHRASES = [
  "mau bicara", "bicara dengan admin", "bicara sama admin", "mau ngobrol",
  "ngobrol dengan", "minta admin", "hubungi admin", "kontak admin", "chat admin",
  "sambungkan", "panggil admin", "admin nya", "adminnya", "customer service",
  "orang asli", "manusia asli", "lapor", "laporan", "komplain", "keluhan",
  "kecewa", "penipuan", "penipu", "ditipu", "tipu", "dibohongi", "uang saya",
  "saldo hilang", "saldo saya hilang", "tidak dibalas", "gak dibalas", "parah",
  "lama sekali",
];

/** Kata panggilan admin — hanya mengalihkan kalau pesannya pendek/generik. */
const HUMAN_WORDS = ["admin", "cs", "manusia", "orangnya"];

const FALLBACK_ANSWER =
  "Terima kasih pesannya Kak 🙏 Supaya aku bisa bantu dengan tepat, boleh dijelaskan lebih spesifik?\n\nContoh yang sering ditanyakan:\n• Cara beli nomor & cara pakai\n• Isi saldo (minimal Rp 10.000, QRIS otomatis)\n• Kode OTP belum masuk\n• Aturan batal/refund\n• Kenapa harga berbeda tiap server\n\nTulis nomor order juga kalau kendalanya soal transaksi tertentu ya. Kalau memang butuh admin manusia, tulis \"admin\".";

const HUMAN_MESSAGE =
  "Baik Kak, aku sambungkan ke admin/CS kami ya 🙏\nTulis detail kendalanya di chat ini (sertakan nomor order kalau ada) — balasannya muncul di halaman ini juga, jadi kamu tidak perlu pindah ke mana-mana.";

const WAITING_MESSAGE =
  "Pesanmu sudah masuk ke admin/CS kami 🙏\nBalasannya muncul di halaman ini juga, jadi tetap pantau chat ini ya. Sementara menunggu, kamu bisa tanya hal lain ke CS otomatis di sini.";

/* ---------- pencocokan kata kunci ---------- */

/** Rapikan teks: huruf kecil, tanda baca jadi spasi, sisakan huruf & angka. */
function normalize(text: string): string {
  return (
    " " +
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

/** Cocokkan satu kata dengan kata kunci (toleran variasi akhiran: otp / otpnya). */
function wordMatch(token: string, key: string): boolean {
  if (token === key) return true;
  if (key.length >= 4 && token.length >= 4 && token.startsWith(key)) return true;
  return false;
}

/** Frasa cocok kalau muncul utuh (awalannya boleh bersambung: "cara pakai nomornya"). */
function matchesPhrase(text: string, phrase: string): boolean {
  return text.includes(" " + phrase + " ") || text.includes(" " + phrase);
}

function scoreKeys(text: string, tokens: string[], keys: string[]): number {
  let score = 0;
  for (const rawKey of keys) {
    const key = rawKey.toLowerCase();
    if (key.includes(" ")) {
      // Frasa lebih spesifik -> nilainya lebih tinggi, makin panjang makin kuat.
      if (matchesPhrase(text, key)) score += 2 + key.split(" ").length;
      continue;
    }
    if (tokens.some((t) => wordMatch(t, key))) score += 1;
  }
  return score;
}

type CsReply = { answer: string; tag: string; escalate: boolean };

/** Pilih balasan CS yang paling cocok untuk pesan customer. */
function csReply(rawText: string): CsReply {
  const text = normalize(rawText);
  const tokens = text.trim().split(" ").filter(Boolean);

  if (!tokens.length) return { answer: FALLBACK_ANSWER, tag: "kosong", escalate: false };

  let best: CsEntry | null = null;
  let bestScore = 0;
  for (const entry of CS_KNOWLEDGE) {
    const score = scoreKeys(text, tokens, entry.keys);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  // Minta admin manusia: frasa tegas ("mau bicara", "komplain", …) selalu
  // dialihkan; kata "admin/cs" saja hanya kalau pesannya pendek/generik —
  // supaya pertanyaan seperti "ada biaya admin gak?" tetap dijawab CS.
  const strongHuman = HUMAN_PHRASES.some((p) => matchesPhrase(text, p));
  const bareHuman = tokens.some((t) => HUMAN_WORDS.some((k) => wordMatch(t, k)));
  if (strongHuman || (bareHuman && bestScore <= 2)) {
    return { answer: HUMAN_MESSAGE, tag: "minta-admin", escalate: true };
  }

  if (!best || !best.answer) return { answer: FALLBACK_ANSWER, tag: "belum-jelas", escalate: false };

  return {
    answer: best.answer,
    tag: best.tag,
    escalate: !!best.notifyAdmin,
  };
}

/* =====================================================================
 * Bagian customer
 * ===================================================================== */

/** Pengaturan bantuan untuk halaman customer (publik). */
export const publicConfig = action({
  args: {},
  handler: async (ctx) => {
    const cfg = await readConfig(ctx);
    const wa = waLink(cfg.waNumber);
    return {
      ok: true,
      autoReply: cfg.autoReply,
      contactEnabled: cfg.contactEnabled,
      // Kontak ditutup -> jangan kirim tautannya ke browser sama sekali.
      waUrl: cfg.contactEnabled ? wa.url : null,
    };
  },
});

/** Kirim pesan ke CS. Dijawab balasan otomatis ala CS, atau dialihkan ke admin. */
export const sendMessage = action({
  args: { userId: v.id("appUsers"), body: v.string() },
  handler: async (ctx, args) => {
    const body = (args.body || "").trim().slice(0, MAX_BODY);
    if (!body) return { ok: false, error: "Pesan masih kosong." };

    const me = await ctx.runQuery(I.wallet.actorInfo, { userId: args.userId });
    if (!me) return { ok: false, error: "Akun tidak ditemukan. Coba login ulang." };

    let thread = await ctx.runQuery(I.supportDb.threadOfUser, { userId: args.userId });
    if (!thread) {
      const threadId = await ctx.runMutation(I.supportDb.createThread, {
        userId: args.userId,
        userEmail: me.username,
        userName: me.fullName || me.username,
      });
      thread = { _id: threadId, mode: "ai" };
    }
    const threadId = thread._id;

    await ctx.runMutation(I.supportDb.addMessage, {
      threadId,
      role: "user",
      body,
      authorName: me.fullName || me.username,
      countForStaff: true,
    });

    // Sudah ditangani admin -> tidak dijawab otomatis lagi, cukup tunggu admin.
    if (thread.mode === "human") {
      return { ok: true, mode: "human" };
    }

    const reply = csReply(body);

    // Minta admin / komplain berat -> alihkan ke admin.
    if (reply.escalate && reply.tag === "minta-admin") {
      await ctx.runMutation(I.supportDb.addMessage, {
        threadId,
        role: "assistant",
        body: HUMAN_MESSAGE,
        countForUser: true,
        mode: "human",
      });
      return { ok: true, mode: "human" };
    }

    // Balasan otomatis dimatikan Owner -> jangan biarkan customer menunggu tanpa kabar.
    const cfg = await readConfig(ctx);
    if (!cfg.autoReply) {
      await ctx.runMutation(I.supportDb.addMessage, {
        threadId,
        role: "assistant",
        body: WAITING_MESSAGE,
        countForUser: true,
        mode: "human",
      });
      return { ok: true, mode: "human" };
    }

    // CS otomatis menjawab dulu. Kasus soal uang/akun (reply.escalate) tetap
    // dilaporkan ke admin lewat penanda "belum dibaca" di panel, TAPI balasan
    // otomatis tetap hidup supaya customer tidak ditinggal tanpa jawaban.
    await ctx.runMutation(I.supportDb.addMessage, {
      threadId,
      role: "assistant",
      body: reply.answer,
      countForUser: true,
    });
    return { ok: true, mode: "ai", tag: reply.tag };
  },
});

/** Ambil percakapan milik customer sendiri (sekaligus tandai sudah dibaca). */
export const myThread = action({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const thread = await ctx.runQuery(I.supportDb.threadOfUser, { userId: args.userId });
    if (!thread) return { ok: true, mode: "ai", messages: [] as any[] };
    const messages = await ctx.runQuery(I.supportDb.messagesOf, { threadId: thread._id, limit: 80 });
    await ctx.runMutation(I.supportDb.markThreadRead, { threadId: thread._id, forStaff: false });
    return { ok: true, mode: thread.mode, messages };
  },
});

/* =====================================================================
 * Bagian admin/CS
 * ===================================================================== */

async function requireStaff(ctx: any, actorId: string) {
  const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: actorId });
  if (!actor || (actor.role !== "owner" && actor.role !== "cs")) return null;
  return actor;
}

/** Daftar semua percakapan (Owner & CS). */
export const staffThreads = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS.", threads: [] as any[] };
    const threads = await ctx.runQuery(I.supportDb.allThreads, {});
    const unread = (threads as any[]).reduce((n, t) => n + (t.unreadForStaff || 0), 0);
    return { ok: true, threads, unread };
  },
});

/** Isi satu percakapan + tandai sudah dibaca oleh staff. */
export const staffMessages = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS.", messages: [] as any[] };
    const messages = await ctx.runQuery(I.supportDb.messagesOf, { threadId: args.threadId, limit: 120 });
    await ctx.runMutation(I.supportDb.markThreadRead, { threadId: args.threadId, forStaff: true });
    return { ok: true, messages };
  },
});

/** Balas percakapan sebagai admin/CS. */
export const staffReply = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const body = (args.body || "").trim().slice(0, MAX_BODY);
    if (!body) return { ok: false, error: "Pesan masih kosong." };
    await ctx.runMutation(I.supportDb.addMessage, {
      threadId: args.threadId,
      role: "staff",
      body,
      authorName: actor.fullName || actor.username,
      countForUser: true,
      // Setelah admin turun tangan, balasan otomatis berhenti.
      mode: "human",
    });
    return { ok: true };
  },
});

/** Ubah status percakapan: balasan otomatis lagi, alihkan ke admin, atau tutup. */
export const staffSetMode = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads"), mode: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const mode = ["ai", "human", "closed"].includes(args.mode) ? args.mode : "human";
    await ctx.runMutation(I.supportDb.setThreadMode, { threadId: args.threadId, mode });
    return { ok: true, mode };
  },
});

/** Pengaturan bantuan (Owner) — dipakai tab "Bantuan CS" di Panel Admin. */
export const staffGetConfig = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const cfg = await readConfig(ctx);
    return { ok: true, config: cfg };
  },
});

/** Simpan pengaturan bantuan: balasan otomatis & nomor WhatsApp manual. */
export const staffSetConfig = action({
  args: {
    actorId: v.id("appUsers"),
    autoReply: v.boolean(),
    contactEnabled: v.boolean(),
    waNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const cfg: SupportConfig = {
      autoReply: !!args.autoReply,
      contactEnabled: !!args.contactEnabled,
      waNumber: (args.waNumber || "").trim().slice(0, 40),
    };
    await ctx.runMutation(I.wallet.setSettings, { key: SETTINGS_KEY, value: cfg });
    return { ok: true, config: cfg };
  },
});
