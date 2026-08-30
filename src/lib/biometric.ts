// WebAuthn biometric authentication utility
// Uses the real Web Authentication API to trigger fingerprint/face prompt

const RP_NAME = "Laporan Keuanganku";
const RP_ID = window.location.hostname;
const STORAGE_KEY = "biometric_credential_id";

function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.PublicKeyCredential !== undefined &&
    typeof navigator.credentials !== "undefined" &&
    typeof navigator.credentials.create === "function" &&
    typeof navigator.credentials.get === "function"
  );
}

async function isBiometricAvailable(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available;
  } catch {
    return false;
  }
}

// Convert ArrayBuffer to base64 string
function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Convert base64 string to ArrayBuffer
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Register a new biometric credential (first time setup)
async function registerCredential(userId: string, username: string): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: RP_NAME, id: RP_ID },
        user: {
          id: new TextEncoder().encode(userId),
          name: username,
          displayName: username,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },   // ES256
          { alg: -257, type: "public-key" },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    });

    if (credential && "rawId" in credential) {
      localStorage.setItem(STORAGE_KEY, bufferToBase64((credential as PublicKeyCredential).rawId));
      return true;
    }
    return false;
  } catch (err) {
    console.error("Registration failed:", err);
    return false;
  }
}

// Authenticate with existing biometric credential
async function authenticate(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false;

  const storedId = localStorage.getItem(STORAGE_KEY);
  if (!storedId) return false;

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
        allowCredentials: [{
          id: base64ToBuffer(storedId),
          type: "public-key",
          transports: ["internal"],
        }],
      },
    });

    return assertion !== null;
  } catch (err) {
    console.error("Authentication failed:", err);
    return false;
  }
}

// Check if credential is registered
function hasCredential(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

// Remove credential
function removeCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export {
  isBiometricAvailable,
  registerCredential,
  authenticate,
  hasCredential,
  removeCredential,
};
