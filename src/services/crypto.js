import { db } from './db';

let memoryDEK = null;

async function generateDEK() {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

async function generateSilentKEK() {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["wrapKey", "unwrapKey"]
  );
}

async function derivePasswordKEK(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 600000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["wrapKey", "unwrapKey"]
  );
}

async function wrapDEK(dek, kek) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await window.crypto.subtle.wrapKey(
    "raw",
    dek,
    kek,
    {
      name: "AES-GCM",
      iv: iv
    }
  );

  const combined = new Uint8Array(iv.length + wrapped.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(wrapped), iv.length);
  return combined.buffer;
}

async function unwrapDEK(wrappedDekBuffer, kek) {
  const combined = new Uint8Array(wrappedDekBuffer);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  return window.crypto.subtle.unwrapKey(
    "raw",
    data,
    kek,
    {
      name: "AES-GCM",
      iv: iv
    },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

export async function encryptData(data) {
  if (!memoryDEK) throw new Error("Vault is locked");
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    memoryDEK,
    encoded
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  return combined.buffer;
}

export async function decryptData(encryptedBuffer) {
  if (!memoryDEK) throw new Error("Vault is locked");

  const combined = new Uint8Array(encryptedBuffer);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    memoryDEK,
    data
  );

  const decoded = new TextDecoder().decode(decrypted);
  return JSON.parse(decoded);
}

export async function setupVault(number, mode, password, userKeys) {
  // 1. Generate DEK
  const dek = await generateDEK();
  memoryDEK = dek;

  let kek;
  let wrappedDek;
  let salt = null;

  if (mode === 'silent') {
    kek = await generateSilentKEK();
    wrappedDek = await wrapDEK(dek, kek);
    
    await db.keys.put('silent-kek', kek);
    await db.keys.put('silent-wrapped-dek', wrappedDek);
  } else {
    salt = window.crypto.getRandomValues(new Uint8Array(32));
    kek = await derivePasswordKEK(password, salt);
    wrappedDek = await wrapDEK(dek, kek);
    
    await db.keys.put('password-wrapped-dek', wrappedDek);
    await db.meta.put('password-salt', salt);
  }

  await db.meta.put('mode', mode);
  await db.meta.put('phone_number', number);

  const encryptedUserKeys = await encryptData(userKeys);
  const base64Keys = btoa(String.fromCharCode(...new Uint8Array(encryptedUserKeys)));
  localStorage.setItem('encrypted_user_keys', base64Keys);
}

export async function unlockVault(password) {
  const mode = await db.meta.get('mode');
  if (!mode) throw new Error("Vault not found");

  let dek;

  if (mode === 'silent') {
    const kek = await db.keys.get('silent-kek');
    const wrappedDek = await db.keys.get('silent-wrapped-dek');
    if (!kek || !wrappedDek) throw new Error("Silent keys missing");
    dek = await unwrapDEK(wrappedDek, kek);
  } else {
    if (!password) throw new Error("Password required");
    const salt = await db.meta.get('password-salt');
    const wrappedDek = await db.keys.get('password-wrapped-dek');
    
    if (!salt || !wrappedDek) throw new Error("Password keys missing");
    
    const kek = await derivePasswordKEK(password, salt);
    try {
      dek = await unwrapDEK(wrappedDek, kek);
    } catch {
      throw new Error("Invalid password");
    }
  }

  memoryDEK = dek;
  return true;
}

export function lockVault() {
  memoryDEK = null;
}

export function isVaultUnlocked() {
  return !!memoryDEK;
}

export async function hasVault() {
  const mode = await db.meta.get('mode');
  return !!mode;
}

export async function getVaultMode() {
  return await db.meta.get('mode');
}

export async function getStoredNumber() {
  return await db.meta.get('phone_number');
}

export async function getStoredKeys() {
  if (!memoryDEK) return null;
  
  const base64Keys = localStorage.getItem('encrypted_user_keys');
  if (!base64Keys) return null;
  
  try {
    const buffer = Uint8Array.from(atob(base64Keys), c => c.charCodeAt(0)).buffer;
    return await decryptData(buffer);
  } catch (e) {
    console.error("Failed to decrypt keys", e);
    return null;
  }
}

export async function generateKeys() {
  const signingKeyPair = await window.crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );

  const encryptionKeyPair = await window.crypto.subtle.generateKey(
    { name: "X25519" },
    true,
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
  const key = await window.crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "Ed25519" },
    true,
    ["sign"]
  );

  const data = new TextEncoder().encode(challengeHex);

  const signature = await window.crypto.subtle.sign(
    "Ed25519",
    key,
    data
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function switchVaultMode(newMode, password) {
  if (!memoryDEK) throw new Error("Vault must be unlocked to switch mode");

  const oldMode = await db.meta.get('mode');
  if (oldMode === newMode) return;

  let kek;
  let wrappedDek;
  let salt = null;

  if (newMode === 'silent') {
    kek = await generateSilentKEK();
    wrappedDek = await wrapDEK(memoryDEK, kek);
    
    await db.keys.put('silent-kek', kek);
    await db.keys.put('silent-wrapped-dek', wrappedDek);
    
    await db.keys.remove('password-wrapped-dek');
    await db.meta.remove('password-salt');
  } else {
    if (!password) throw new Error("Password required for password mode");
    salt = window.crypto.getRandomValues(new Uint8Array(32));
    kek = await derivePasswordKEK(password, salt);
    wrappedDek = await wrapDEK(memoryDEK, kek);
    
    await db.keys.put('password-wrapped-dek', wrappedDek);
    await db.meta.put('password-salt', salt);
    
    await db.keys.remove('silent-kek');
    await db.keys.remove('silent-wrapped-dek');
  }

  await db.meta.put('mode', newMode);
}

export async function clearVault() {
  lockVault();
  await db.clear();
  localStorage.removeItem('encrypted_user_keys');
}

async function importX25519PublicKey(jwk) {
  return window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "X25519" },
    true,
    []
  );
}

async function importX25519PrivateKey(jwk) {
  return window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "X25519" },
    true,
    ["deriveKey", "deriveBits"]
  );
}

async function deriveSharedKey(privateKey, publicKey) {
  return window.crypto.subtle.deriveKey(
    {
      name: "X25519",
      public: publicKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptForRecipient(senderPrivateJwk, recipientPublicJwk, plaintext) {
  const senderPrivate = await importX25519PrivateKey(senderPrivateJwk);
  const recipientPublic = await importX25519PublicKey(recipientPublicJwk);
  
  const sharedKey = await deriveSharedKey(senderPrivate, recipientPublic);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    encoded
  );

  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join(''),
    nonce: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('')
  };
}

export async function decryptFromSender(recipientPrivateJwk, senderPublicJwk, ciphertextHex, nonceHex) {
  const recipientPrivate = await importX25519PrivateKey(recipientPrivateJwk);
  const senderPublic = await importX25519PublicKey(senderPublicJwk);
  
  const sharedKey = await deriveSharedKey(recipientPrivate, senderPublic);
  
  const iv = new Uint8Array(nonceHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const data = new Uint8Array(ciphertextHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    data
  );
  
  return new TextDecoder().decode(decrypted);
}

export async function encryptEnvelope(recipientPublicJwk, plaintext) {
  const ephemeralKeyPair = await window.crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveKey", "deriveBits"]
  );
  
  const recipientPublic = await importX25519PublicKey(recipientPublicJwk);
  const sharedKey = await deriveSharedKey(ephemeralKeyPair.privateKey, recipientPublic);
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    encoded
  );
  
  const ephemeralPublicJwk = await window.crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey);

  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join(''),
    nonce: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
    ephemeralPublicKey: ephemeralPublicJwk
  };
}

