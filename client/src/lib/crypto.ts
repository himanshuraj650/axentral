/**
 * Web Crypto API Wrappers for E2EE
 * Uses ECDH (P-256) for key agreement and AES-GCM for encryption.
 */

// ArrayBuffer <-> Base64 helpers
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

// 1. Generate ECDH Key Pair
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable
    ["deriveKey"]
  );
}

// 2. Export Public Key (to send over WS)
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return bufferToBase64(exported);
}

// 3. Import Peer's Public Key
export async function importPublicKey(base64Key: string): Promise<CryptoKey> {
  const buffer = base64ToBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    "raw",
    buffer,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

// 4. Derive Shared AES-GCM Secret
export async function deriveSecret(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<CryptoKey> {
  return await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false, // Don't allow exporting the shared secret
    ["encrypt", "decrypt"]
  );
}

// 5. Encrypt Message
export async function encryptMessage(
  text: string,
  secretKey: CryptoKey
): Promise<{ encryptedPayload: string; iv: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    secretKey,
    data
  );

  return {
    encryptedPayload: bufferToBase64(encrypted),
    iv: bufferToBase64(iv),
  };
}

// 6. Decrypt Message
export async function decryptMessage(
  encryptedPayload: string,
  ivBase64: string,
  secretKey: CryptoKey
): Promise<string> {
  const encryptedData = base64ToBuffer(encryptedPayload);
  const iv = base64ToBuffer(ivBase64);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    secretKey,
    encryptedData
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}
