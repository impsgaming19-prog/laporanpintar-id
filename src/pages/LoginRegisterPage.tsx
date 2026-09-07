import { useState } from "react";
import { authRegister, authOtpSend, authOtpVerify, authLogin, authGoogleLogin, type ApiResponse, type AuthUser } from "@/lib/auth";

type Mode = "login" | "register" | "otp";

export default function LoginRegisterPage() {
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const handleRegister = async () => {
    setMessage(null);
    if (!email || !password || !fullName) {
      setMessage("Email, password, dan nama wajib diisi.");
      return;
    }
    setLoading(true);
    const res = await authRegister({ email, password, fullName });
    setLoading(false);
    if (!res.ok) {
      setMessage(res.message || res.error || "Daftar gagal.");
      return;
    }
    setMessage(res.message || "Kode OTP dikirim. Cek email lalu verifikasi.");
    setMode("otp");
  };

  const handleOtpSend = async () => {
    setMessage(null);
    if (!email) {
      setMessage("Masukkan email dulu.");
      return;
    }
    setLoading(true);
    const res = await authOtpSend({ email });
    setLoading(false);
    setMessage(res.message || res.error || "Gagal kirim kode.");
  };

  const handleOtpVerify = async () => {
    setMessage(null);
    if (!otpCode) {
      setMessage("Masukkan kode OTP.");
      return;
    }
    setLoading(true);
    const res = await authOtpVerify({ email, code: otpCode, fullName: fullName });
    setLoading(false);
    if (!res.ok) {
      setMessage(res.message || res.error || "Verifikasi gagal.");
      return;
    }
    setUser(res.user || null);
    setMode("login");
    setMessage("Verifikasi berhasil. Silakan login.");
  };

  const handleLogin = async () => {
    setMessage(null);
    if (!email || !password) {
      setMessage("Email dan password wajib diisi.");
      return;
    }
    setLoading(true);
    const res = await authLogin({ email, password });
    setLoading(false);
    if (!res.ok) {
      setMessage(res.message || res.error || "Login gagal.");
      return;
    }
    setUser(res.user || null);
    setMessage("Berhasil masuk.");
  };

  const handleGoogleLogin = async () => {
    setMessage(null);
    setLoading(true);
    const res = await authGoogleLogin({ email });
    setLoading(false);
    if (!res.ok) {
      setMessage(res.message || res.error || "Login Google gagal.");
      return;
    }
    setUser(res.user || null);
    setMessage("Berhasil masuk pakai Google.");
  };

  if (user) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white selection:bg-red-500/30">
        <div className="flex flex-col items-center justify-center min-h-[70vh] px-5">
          <div className="w-14 h-14 rounded-xl bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/30 mb-5">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
            </svg>
          </div>
          <p className="text-2xl font-extrabold tracking-tight" style={{ color: "#ffffff" }}>KAKO NOKOS</p>
          <p className="text-zinc-400 text-sm mt-1 mb-6">Toko Nomor Online</p>

          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/60 p-6 text-center">
            <p className="text-white text-sm font-semibold mb-1">Selamat, {user.fullName || user.email}</p>
            <p className="text-zinc-400 text-sm mb-4">Anda sudah masuk.</p>
            <button
              onClick={() => {
                setUser(null);
                setMode("login");
                setMessage(null);
              }}
              className="w-full rounded-xl bg-white text-black text-sm font-bold py-3 hover:brightness-95 active:scale-[0.99] mb-3"
            >
              Keluar
            </button>
            <button className="w-full rounded-xl border border-white/10 text-zinc-300 text-sm py-3 hover:bg-white/5 active:scale-[0.99]">
              Lanjut ke toko
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-red-500/30">
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-5">
        <div className="w-14 h-14 rounded-xl bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/30 mb-5">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
          </svg>
        </div>
        <p className="text-2xl font-extrabold tracking-tight" style={{ color: "#ffffff" }}>KAKO NOKOS</p>
        <p className="text-zinc-400 text-sm mt-1 mb-6">Toko Nomor Online</p>

        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900/60 p-6">
          {message && (
            <div className="mb-4 rounded-xl bg-red-600/10 border border-red-600/20 px-4 py-3 text-sm text-red-300">
              {message}
            </div>
          )}

          <div className="flex flex-col gap-2 mb-4">
            <button
              onClick={() => setMode("login")}
              className={`w-full rounded-xl text-sm font-semibold py-2 transition-all ${
                mode === "login"
                  ? "bg-white text-black"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setMode("register")}
              className={`w-full rounded-xl text-sm font-semibold py-2 transition-all ${
                mode === "register"
                  ? "bg-white text-black"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Daftar
            </button>
          </div>

          {mode === "otp" && (
            <OTPForm
              email={email}
              otpCode={otpCode}
              setOtpCode={setOtpCode}
              loading={loading}
              onVerify={handleOtpVerify}
              onResend={handleOtpSend}
            />
          )}

          {mode === "login" && (
            <LoginForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              loading={loading}
              onLogin={handleLogin}
              onSwitchToRegister={() => setMode("register")}
              onGoogleLogin={handleGoogleLogin}
            />
          )}

          {mode === "register" && (
            <RegisterForm
              email={email}
              setEmail={setEmail}
              password={password}
              setPassword={setPassword}
              fullName={fullName}
              setFullName={setFullName}
              loading={loading}
              onRegister={handleRegister}
              onSwitchToLogin={() => setMode("login")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LoginForm({
  email,
  setEmail,
  password,
  setPassword,
  loading,
  onLogin,
  onSwitchToRegister,
  onGoogleLogin,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  loading: boolean;
  onLogin: () => void;
  onSwitchToRegister: () => void;
  onGoogleLogin: () => void;
}) {
  return (
    <>
      <p className="text-white text-sm font-semibold mb-3">Login pakai email</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-3"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-4"
      />
      <button
        onClick={onLogin}
        disabled={loading}
        className="w-full rounded-xl bg-white text-black text-sm font-bold py-3 hover:brightness-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Menghubungkan..." : "Login"}
      </button>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-zinc-500 text-xs">
            <span>atau</span>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={onGoogleLogin}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900/60 text-white text-sm font-semibold py-3 hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            <GoogleLogo />
            {loading ? "Menghubungkan..." : "Login dengan Google"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-zinc-400 text-sm">
        Belum punya akun?{" "}
        <button onClick={onSwitchToRegister} className="text-red-400 hover:underline">
          Daftar di sini
        </button>
      </p>
    </>
  );
}

function RegisterForm({
  email,
  setEmail,
  password,
  setPassword,
  fullName,
  setFullName,
  loading,
  onRegister,
  onSwitchToLogin,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  fullName: string;
  setFullName: (v: string) => void;
  loading: boolean;
  onRegister: () => void;
  onSwitchToLogin: () => void;
}) {
  return (
    <>
      <p className="text-white text-sm font-semibold mb-3">Daftar pakai email</p>
      <input
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder="Nama lengkap"
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-3"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-3"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-4"
      />
      <button
        onClick={onRegister}
        disabled={loading}
        className="w-full rounded-xl bg-white text-black text-sm font-bold py-3 hover:brightness-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Mengirim kode..." : "Daftar"}
      </button>

      <p className="mt-4 text-center text-zinc-400 text-sm">
        Sudah punya akun?{" "}
        <button onClick={onSwitchToLogin} className="text-red-400 hover:underline">
          Login di sini
        </button>
      </p>
    </>
  );
}

function OTPForm({
  email,
  otpCode,
  setOtpCode,
  loading,
  onVerify,
  onResend,
}: {
  email: string;
  otpCode: string;
  setOtpCode: (v: string) => void;
  loading: boolean;
  onVerify: () => void;
  onResend: () => void;
}) {
  return (
    <>
      <p className="text-white text-sm font-semibold mb-1">Verifikasi email</p>
      <p className="text-zinc-400 text-sm mb-4">Kode OTP dikirim ke {email}</p>

      <input
        type="text"
        value={otpCode}
        onChange={(e) => setOtpCode(e.target.value)}
        placeholder="Kode OTP 6 angka"
        maxLength={6}
        className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder-zinc-500 focus:border-red-600 focus:outline-none mb-4 text-center tracking-widest"
      />
      <button
        onClick={onVerify}
        disabled={loading}
        className="w-full rounded-xl bg-white text-black text-sm font-bold py-3 hover:brightness-95 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed mb-2"
      >
        {loading ? "Memverifikasi..." : "Verifikasi"}
      </button>
      <button
        onClick={onResend}
        disabled={loading}
        className="w-full rounded-xl border border-zinc-700 text-zinc-300 text-sm py-2 hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Kirim ulang kode OTP
      </button>
    </>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 6.04C22.56 4.76 21.89 3.88 20.8 3.28c-.81-.45-1.64-.7-2.49-.76-.83-.06-1.67.14-2.35.53-.68.38-1.5.58-2.33.58-1.31 0-2.47-.54-3.09-1.46-.61-.91-1.24-2.04-1.96-3.24-.63-1.04-1.25-2.09-1.72-3.09-.4-.9-.6-1.79-.6-2.68 0-1.04.22-2 .66-2.87.45-.88.97-1.66 1.64-2.26.66-.6.94-1.05.94-1.72 0-.53-.24-1.02-.7-1.52-.42-.46-.94-.73-1.54-.79-.63-.06-1.31.17-1.87.61-.56.45-1.16.87-1.78 1.2-.63.33-1.25.51-1.84.51-1.07 0-2.05-.42-2.74-1.12-.62-.66-1.16-1.44-1.54-2.3-.38-.86-.57-1.78-.57-2.76 0-1.16.27-2.25.79-3.19.51-.94 1.12-1.76 1.82-2.37.7-.6 1.06-1.29 1.06-2.1 0-.88-.53-1.63-1.45-2.02-.93-.4-1.9-.6-2.85-.6-2.01 0-3.65.85-4.62 2.14-.97 1.3-1.45 2.94-1.29 4.7.48 5.5 4.93 8.96 10.44 9.25 1.5.08 3 .13 4.48.13 1.97 0 3.94-.23 5.77-.73 1.8-.5 3.42-1.28 4.77-2.29 1.36-1.02 2.39-2.24 2.93-3.63.47-1.19.7-2.54.6-3.91-.1-1.39-.66-2.66-1.54-3.61-.93-1.02-2.1-1.76-3.37-2.04-1.13-.25-2.32-.24-3.44-.01-1.54.32-2.74 1.18-3.25 2.37-.19.45-.24 1.04-.07 1.73.17.7.56 1.31 1.11 1.7 1.33.96 3.44 1.06 4.72 1.12 1.52.06 3.07 0 4.52-.63 1.43-.62 2.49-1.55 2.93-2.74.44-1.19.56-2.56.35-3.97-.2-1.38-.76-2.64-1.58-3.54-.91-.98-2.1-.97-3.04-.64-1.16.4-2.13 1.25-2.5 2.31-.11.31-.14.68-.08 1.06.06.39.15.78.25 1.16.13.53.25 1.03.36 1.48.11.45.19.91.25 1.36.07.48.11.98.11 1.48 0 .92-.41 1.75-1.06 2.27-.66.52-1.5 1.04-2.4 1.24-.07 1.14-.64 2.18-1.55 2.94-1.01.88-2.29 1.39-3.57 1.4-1.04.01-2.02-.22-2.85-.64-.82-.43-1.57-.91-2.22-1.4-1.3-.99-2.24-2.24-2.73-3.66-.5-1.44-.77-2.99-.77-4.58 0-1.09.18-2.13.56-3.07.38-.94.88-1.79 1.5-2.43.63-.64 1.36-1.11 2.16-1.36 1.18-.36 2.47-.37 3.73.04 1.04.34 1.94.86 2.62 1.51.67.64 1.14 1.41 1.4 2.27.23.78.3 1.65.22 2.49-.08.84-.37 1.64-.84 2.27-.5.65-1.19 1.19-1.98 1.47-.78.29-1.57.48-2.32.54-.99.07-1.96-.15-2.7-.58-.72-.43-1.35-.96-1.86-1.5-1.02-1.01-1.65-2.3-1.76-3.63-.09-1.06.03-2.11.32-3.05.27-.9.68-1.71 1.19-2.34.56-.66 1.22-1.18 1.96-1.51.88-.41 1.8-.67 2.73-.75.83-.07 1.66.07 2.42.41.77.34 1.44.81 1.95 1.38.5.57.8 1.25.9 2 .1 1.09-.22 2.09-.84 2.81-.62.72-1.42 1.27-2.31 1.51z"/>
      <path
        fill="#34A853"
        d="M5.78 14.28c-.13.51-.21 1.05-.21 1.6 0 .37.05.72.14 1.06.09.33.21.64.35.93.15.3.33.57.54.79.22.22.47.4.74.52.28.12.57.19.88.19 1.27 0 2.37-.71 3.16-1.46.76-.72 1.22-1.6 1.49-2.6.28-1 .28-1.97.03-2.92-.25-.95-.69-1.75-1.33-2.36-.64-.6-1.4-.97-2.23-1.06-.84-.09-1.65.06-2.36.44-.71.38-1.26.88-1.62 1.5-.36.62-.47 1.27-.31 1.92.13.53.4.97.78 1.3 1.02.9 2.38 1.02 3.48.28.83-.6 1.52-1.32 1.98-2.15.46-.84.72-1.75.72-2.73 0-1.43-.5-2.76-1.43-3.83-.86-1.01-1.84-1.7-2.86-1.82-.92-.09-1.8.05-2.54.4.76.43 1.42.98 1.95 1.62 1.14 1.37 1.7 3.01 1.41 4.67-.08.41-.21.84-.39 1.27-.17.42-.42.8-.76 1.1-.34.3-.76.47-1.2.42-.24-.03-.46-.07-.67-.12-.43-.09-.86-.23-1.26-.44-.43-.23-.8-.55-1.06-.92-.43-.6-.61-1.32-.45-1.95.1-.44.32-.82.64-1.11.46-.41 1.01-.63 1.6-.55z"/>
      <path
        fill="#FBBC05"
        d="M12.5 14.9c.16.6.36 1.18.62 1.72.27.55.6.99.99 1.34.36.33.77.56 1.24.65.48.09.97.04 1.44-.16.47-.2.87-.54 1.16-.98.28-.43.44-.92.49-1.45.04-.43.01-.86-.1-1.26-.11-.42-.3-.77-.57-1.03-.64-.54-1.4-.86-2.2-.64-.8.22-1.47.68-1.88 1.28-.4.6-1.04 1.03-1.76 1.07-.43.02-.87-.01-1.3-.06-.43-.06-.84-.16-1.21-.33-.47-.2-.86-.49-1.15-.84-.24-.33-.38-.72-.38-1.14 0-.49.17-.97.5-1.35.32-.38.74-.68 1.22-.82.49-.14 1.01-.15 1.52-.07z"/>
      <path
        fill="#EA4335"
        d="M16.54 14.4c-.2-1.05.03-2.12.68-3 .62-.87 1.48-1.49 2.45-1.62 1.12-.16 2.27.12 3.1 1.07.83.95 1.12 2.14 1.02 3.37-.09 1.05-.56 2.02-1.29 2.8-.73.78-1.65 1.31-2.65 1.38-.36.02-.74-.07-1.12-.24-.41-.16-.78-.41-1.11-.74-.38-.38-.6-.87-.67-1.38-.07-.5.11-.98.49-1.34.38-.36.83-.59 1.29-.66.45-.06.9.05 1.28.31.39.26.7.63.89 1.06.16.36.23.76.21 1.18-.03.56-.28 1.07-.73 1.42-.44.35-1 .54-1.55.52-.55-.03-1.08-.14-1.54-.37-.5-.25-1.04-.61-1.4-.89-.4-.33-.72-.73-.91-1.17-.17-.38-.24-.8-.21-1.23.03-.45.17-.87.42-1.23.24-.35.55-.62.9-.74.36-.12.75-.15 1.13-.07z"/>
    </svg>
  );
}
