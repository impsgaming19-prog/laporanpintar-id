export interface AuthRegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthOtpSendRequest {
  email: string;
}

export interface AuthOtpVerifyRequest {
  email: string;
  code: string;
  fullName?: string;
}

export interface AuthGoogleLoginRequest {
  email: string;
  fullName?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  verified: boolean;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  message?: string;
  error?: string;
  user?: AuthUser;
}

export async function authRegister(body: AuthRegisterRequest): Promise<ApiResponse> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || res.statusText, message: text || res.statusText };
  }
  return (await res.json()) as ApiResponse;
}

export async function authOtpSend(body: AuthOtpSendRequest): Promise<ApiResponse> {
  const res = await fetch("/api/auth/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || res.statusText, message: text || res.statusText };
  }
  return (await res.json()) as ApiResponse;
}

export async function authOtpVerify(body: AuthOtpVerifyRequest): Promise<ApiResponse> {
  const res = await fetch("/api/auth/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || res.statusText, message: text || res.statusText };
  }
  return (await res.json()) as ApiResponse;
}

export async function authLogin(body: AuthLoginRequest): Promise<ApiResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || res.statusText, message: text || res.statusText };
  }
  return (await res.json()) as ApiResponse;
}

export async function authGoogleLogin(body: AuthGoogleLoginRequest): Promise<ApiResponse> {
  const res = await fetch("/api/auth/google/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || res.statusText, message: text || res.statusText };
  }
  return (await res.json()) as ApiResponse;
}
