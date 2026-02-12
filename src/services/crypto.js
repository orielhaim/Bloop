export async function generateKeys() {
  // Ed25519 for signing
  const signingKeyPair = await window.crypto.subtle.generateKey(
    {
      name: "Ed25519",
    },
    true, // extractable
    ["sign", "verify"]
  );
  
  // X25519 for encryption
  const encryptionKeyPair = await window.crypto.subtle.generateKey(
    {
      name: "X25519",
    },
    true, // extractable
    ["deriveKey", "deriveBits"]
  );
  
  const signingPublic = await window.crypto.subtle.exportKey("jwk", signingKeyPair.publicKey);
  const signingPrivate = await window.crypto.subtle.exportKey("jwk", signingKeyPair.privateKey);
  
  const encryptionPublic = await window.crypto.subtle.exportKey("jwk", encryptionKeyPair.publicKey);
  const encryptionPrivate = await window.crypto.subtle.exportKey("jwk", encryptionKeyPair.privateKey);
  
  return {
    signing: { public: signingPublic, private: signingPrivate },
    encryption: { public: encryptionPublic, private: encryptionPrivate }
  };
}

export async function signChallenge(privateKeyJwk, challengeHex) {
  // Import private key
  const key = await window.crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "Ed25519" },
    true,
    ["sign"]
  );
  
  // Encode challenge string to bytes
  // As per our server implementation, we verify against the challenge string (UTF-8 bytes)
  const data = new TextEncoder().encode(challengeHex);
  
  const signature = await window.crypto.subtle.sign(
    "Ed25519",
    key,
    data
  );
  
  // Convert signature to hex
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to store keys
export function storeKeys(keys, number) {
  localStorage.setItem('phone_keys', JSON.stringify(keys));
  localStorage.setItem('phone_number', number);
}

export function getStoredKeys() {
  const keys = localStorage.getItem('phone_keys');
  return keys ? JSON.parse(keys) : null;
}

export function getStoredNumber() {
  return localStorage.getItem('phone_number');
}

export function clearKeys() {
  localStorage.removeItem('phone_keys');
  localStorage.removeItem('phone_number');
}
