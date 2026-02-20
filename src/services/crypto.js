import { db } from './db.js';

const ALGO_AES  = 'AES-GCM';
const ALGO_KDF  = 'PBKDF2';
const ALGO_SIGN = 'Ed25519';
const ALGO_DH   = 'X25519';

const AES_KEY_BITS   = 256;
const IV_BYTES       = 12;
const SALT_BYTES     = 32;
const KDF_ITERATIONS = 600_000;
const KDF_HASH       = 'SHA-256';

const LOCAL_KEY_SLOT = 'encrypted_user_keys';

const AES_GCM_PARAMS = Object.freeze({ name: ALGO_AES, length: AES_KEY_BITS });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBytes(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function toBase64(value) {
  return btoa(String.fromCharCode(...toBytes(value)));
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function toHex(buffer) {
  return Array.from(toBytes(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map((h) => parseInt(h, 16)));
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function freshIV() {
  return randomBytes(IV_BYTES);
}

function freshSalt() {
  return randomBytes(SALT_BYTES);
}

async function aesEncrypt(key, plainBytes) {
  const iv = freshIV();
  const ct = await crypto.subtle.encrypt({ name: ALGO_AES, iv }, key, plainBytes);
  const out = new Uint8Array(IV_BYTES + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), IV_BYTES);
  return out.buffer;
}

async function aesDecrypt(key, combined) {
  const buf = toBytes(combined);
  const iv   = buf.subarray(0, IV_BYTES);
  const data = buf.subarray(IV_BYTES);
  return crypto.subtle.decrypt({ name: ALGO_AES, iv }, key, data);
}

async function encryptJSON(key, value) {
  return aesEncrypt(key, encoder.encode(JSON.stringify(value)));
}

async function decryptJSON(key, buffer) {
  const plain = await aesDecrypt(key, buffer);
  return JSON.parse(decoder.decode(plain));
}

// ── Key generation helpers ──────────────────────────────────────

function generateAESKey(extractable, usages) {
  return crypto.subtle.generateKey(AES_GCM_PARAMS, extractable, usages);
}

function generateDEK() {
  return generateAESKey(true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}

function generateSilentKEK() {
  return generateAESKey(false, ['wrapKey', 'unwrapKey']);
}

// ── PBKDF2 key derivation ───────────────────────────────────────

async function importKeyMaterial(password) {
  return crypto.subtle.importKey('raw', encoder.encode(password), ALGO_KDF, false, ['deriveKey']);
}

function pbkdf2Params(salt) {
  return { name: ALGO_KDF, salt, iterations: KDF_ITERATIONS, hash: KDF_HASH };
}

async function deriveAESKey(password, salt, extractable, usages) {
  const material = await importKeyMaterial(password);
  return crypto.subtle.deriveKey(pbkdf2Params(salt), material, AES_GCM_PARAMS, extractable, usages);
}

function derivePasswordKEK(password, salt) {
  return deriveAESKey(password, salt, false, ['wrapKey', 'unwrapKey']);
}

function deriveFileKey(password, salt) {
  return deriveAESKey(password, salt, false, ['encrypt', 'decrypt']);
}

// ── DEK wrapping / unwrapping ───────────────────────────────────

async function wrapDEK(dek, kek) {
  const iv = freshIV();
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: ALGO_AES, iv });
  const out = new Uint8Array(IV_BYTES + wrapped.byteLength);
  out.set(iv);
  out.set(new Uint8Array(wrapped), IV_BYTES);
  return out.buffer;
}

async function unwrapDEK(wrappedBuffer, kek) {
  const buf = toBytes(wrappedBuffer);
  const iv   = buf.subarray(0, IV_BYTES);
  const data = buf.subarray(IV_BYTES);

  return crypto.subtle.unwrapKey(
    'raw', data, kek,
    { name: ALGO_AES, iv },
    AES_GCM_PARAMS,
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}

// ── Password-based payload encryption (for export files) ────────

async function encryptPayloadWithPassword(password, payload) {
  const salt = freshSalt();
  const iv   = freshIV();
  const key  = await deriveFileKey(password, salt);
  const ct   = await crypto.subtle.encrypt({ name: ALGO_AES, iv }, key, encoder.encode(JSON.stringify(payload)));

  return {
    salt:       toBase64(salt),
    iv:        toBase64(iv),
    ciphertext: toBase64(ct),
  };
}

async function decryptPayloadWithPassword(password, { salt, iv, ciphertext }) {
  const key = await deriveFileKey(password, fromBase64(salt), );
  const pt  = await crypto.subtle.decrypt(
    { name: ALGO_AES, iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(decoder.decode(pt));
}

// ── X25519 helpers ──────────────────────────────────────────────

function importX25519Key(jwk, isPrivate) {
  return crypto.subtle.importKey(
    'jwk', jwk, { name: ALGO_DH }, true,
    isPrivate ? ['deriveKey', 'deriveBits'] : [],
  );
}

async function deriveSharedKey(privateKey, publicKey) {
  return crypto.subtle.deriveKey(
    { name: ALGO_DH, public: publicKey },
    privateKey,
    AES_GCM_PARAMS,
    false,
    ['encrypt', 'decrypt'],
  );
}

async function dhEncrypt(privateKey, publicKey, plaintext) {
  const shared = await deriveSharedKey(privateKey, publicKey);
  const iv = freshIV();
  const ct = await crypto.subtle.encrypt({ name: ALGO_AES, iv }, shared, encoder.encode(plaintext));
  return { ciphertext: toHex(ct), nonce: toHex(iv) };
}

async function dhDecrypt(privateKey, publicKey, ciphertextHex, nonceHex) {
  const shared = await deriveSharedKey(privateKey, publicKey);
  const pt = await crypto.subtle.decrypt(
    { name: ALGO_AES, iv: fromHex(nonceHex) },
    shared,
    fromHex(ciphertextHex),
  );
  return decoder.decode(pt);
}

//  Vault state

let memoryDEK = null;

function requireUnlocked() {
  if (!memoryDEK) throw new Error('Vault is locked');
  return memoryDEK;
}

//  Public API — data encryption

export function encryptData(data) {
  return encryptJSON(requireUnlocked(), data);
}

export function decryptData(buffer) {
  return decryptJSON(requireUnlocked(), buffer);
}

//  Public API — vault lifecycle

export async function setupVault(number, mode, password, userKeys) {
  const dek = await generateDEK();
  memoryDEK = dek;

  await persistKEK(mode, password, dek);
  await db.meta.put('mode', mode);
  await db.meta.put('phone_number', number);
  await storeUserKeys(userKeys);
}

export async function unlockVault(password) {
  const mode = await db.meta.get('mode');
  if (!mode) throw new Error('Vault not found');

  if (mode === 'silent') {
    const [kek, wrapped] = await Promise.all([
      db.keys.get('silent-kek'),
      db.keys.get('silent-wrapped-dek'),
    ]);
    if (!kek || !wrapped) throw new Error('Silent keys missing');
    memoryDEK = await unwrapDEK(wrapped, kek);
  } else {
    if (!password) throw new Error('Password required');
    const [salt, wrapped] = await Promise.all([
      db.meta.get('password-salt'),
      db.keys.get('password-wrapped-dek'),
    ]);
    if (!salt || !wrapped) throw new Error('Password keys missing');

    const kek = await derivePasswordKEK(password, salt);
    try {
      memoryDEK = await unwrapDEK(wrapped, kek);
    } catch {
      throw new Error('Invalid password');
    }
  }

  return true;
}

export function lockVault() {
  memoryDEK = null;
}

export function isVaultUnlocked() {
  return memoryDEK !== null;
}

export async function hasVault() {
  return !!(await db.meta.get('mode'));
}

export function getVaultMode() {
  return db.meta.get('mode');
}

export function getStoredNumber() {
  return db.meta.get('phone_number');
}

export async function getStoredKeys() {
  if (!memoryDEK) return null;
  const b64 = localStorage.getItem(LOCAL_KEY_SLOT);
  if (!b64) return null;
  try {
    return await decryptData(fromBase64(b64).buffer);
  } catch (e) {
    console.error('Failed to decrypt keys', e);
    return null;
  }
}

//  Public API — key generation & signing

export async function generateKeys() {
  const [signing, encryption] = await Promise.all([
    crypto.subtle.generateKey({ name: ALGO_SIGN }, true, ['sign', 'verify']),
    crypto.subtle.generateKey({ name: ALGO_DH }, true, ['deriveKey', 'deriveBits']),
  ]);

  const [sigPub, sigPriv, encPub, encPriv] = await Promise.all([
    crypto.subtle.exportKey('jwk', signing.publicKey),
    crypto.subtle.exportKey('jwk', signing.privateKey),
    crypto.subtle.exportKey('jwk', encryption.publicKey),
    crypto.subtle.exportKey('jwk', encryption.privateKey),
  ]);

  return {
    signing:    { public: sigPub,  private: sigPriv  },
    encryption: { public: encPub,  private: encPriv  },
  };
}

export async function signChallenge(privateKeyJwk, challengeHex) {
  const key = await crypto.subtle.importKey('jwk', privateKeyJwk, { name: ALGO_SIGN }, true, ['sign']);
  const sig = await crypto.subtle.sign(ALGO_SIGN, key, encoder.encode(challengeHex));
  return toHex(sig);
}

//  Public API — mode switching

export async function switchVaultMode(newMode, password) {
  const dek = requireUnlocked();
  const oldMode = await db.meta.get('mode');
  if (oldMode === newMode) return;

  await persistKEK(newMode, password, dek);
  await cleanupOldKEK(oldMode);
  await db.meta.put('mode', newMode);
}

//  Public API — vault destruction

export async function clearVault() {
  lockVault();
  await db.clear();
  localStorage.removeItem(LOCAL_KEY_SLOT);
}

//  Public API — export / import

export async function createVaultExport(options = {}) {
  const { oneTimePassword, includeContacts, includeHistory } = options;

  const [mode, number] = await Promise.all([getVaultMode(), getStoredNumber()]);
  if (!mode || !number) throw new Error('Vault missing');

  const filename = `${number}.bloop`;
  const payload = {};

  if (mode === 'password') {
    requireUnlocked();
    await buildPasswordExportPayload(payload, includeContacts, includeHistory);
    return exportEnvelope(filename, number, mode, false, payload);
  }

  const keys = await getStoredKeys();
  if (!keys) throw new Error('Keys unavailable');
  payload.keys = keys;

  await attachOptionalData(payload, includeContacts, includeHistory, true);

  if (oneTimePassword) {
    const encrypted = await encryptPayloadWithPassword(oneTimePassword, payload);
    return exportEnvelope(filename, number, 'silent', true, encrypted);
  }

  return exportEnvelope(filename, number, 'silent', false, payload);
}

export async function importVaultExport(exportData, password) {
  if (!exportData || typeof exportData !== 'object') throw new Error('Invalid file');
  const { number, mode, encrypted, payload } = exportData;
  if (!number || !mode || !payload) throw new Error('Invalid file');

  const resolved = encrypted
    ? await decryptPayloadWithPassword(password, payload)
    : payload;

  if (mode === 'password') {
    return importPasswordVault(resolved, number, password);
  }

  return importSilentVault(resolved, number);
}

//  Public API — end-to-end encrypted messaging

export async function encryptForRecipient(senderPrivateJwk, recipientPublicJwk, plaintext) {
  const [priv, pub] = await Promise.all([
    importX25519Key(senderPrivateJwk, true),
    importX25519Key(recipientPublicJwk, false),
  ]);
  return dhEncrypt(priv, pub, plaintext);
}

export async function decryptFromSender(recipientPrivateJwk, senderPublicJwk, ciphertextHex, nonceHex) {
  const [priv, pub] = await Promise.all([
    importX25519Key(recipientPrivateJwk, true),
    importX25519Key(senderPublicJwk, false),
  ]);
  return dhDecrypt(priv, pub, ciphertextHex, nonceHex);
}

export async function encryptEnvelope(recipientPublicJwk, plaintext) {
  const ephemeral = await crypto.subtle.generateKey({ name: ALGO_DH }, true, ['deriveKey', 'deriveBits']);
  const recipientPublic = await importX25519Key(recipientPublicJwk, false);

  const { ciphertext, nonce } = await dhEncrypt(ephemeral.privateKey, recipientPublic, plaintext);
  const ephemeralPublicKey = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);

  return { ciphertext, nonce, ephemeralPublicKey };
}

//  Internal helpers

async function storeUserKeys(userKeys) {
  const encrypted = await encryptData(userKeys);
  localStorage.setItem(LOCAL_KEY_SLOT, toBase64(encrypted));
}

async function persistKEK(mode, password, dek) {
  if (mode === 'silent') {
    const kek = await generateSilentKEK();
    const wrapped = await wrapDEK(dek, kek);
    await Promise.all([
      db.keys.put('silent-kek', kek),
      db.keys.put('silent-wrapped-dek', wrapped),
    ]);
  } else {
    if (!password) throw new Error('Password required for password mode');
    const salt = freshSalt();
    const kek = await derivePasswordKEK(password, salt);
    const wrapped = await wrapDEK(dek, kek);
    await Promise.all([
      db.keys.put('password-wrapped-dek', wrapped),
      db.meta.put('password-salt', salt),
    ]);
  }
}

async function cleanupOldKEK(mode) {
  if (mode === 'silent') {
    await Promise.all([
      db.keys.remove('silent-kek'),
      db.keys.remove('silent-wrapped-dek'),
    ]);
  } else {
    await Promise.all([
      db.keys.remove('password-wrapped-dek'),
      db.meta.remove('password-salt'),
    ]);
  }
}

function exportEnvelope(filename, number, mode, encrypted, payload) {
  return { filename, data: { version: 2, number, mode, encrypted, payload } };
}

async function buildPasswordExportPayload(payload, includeContacts, includeHistory) {
  const encryptedUserKeys = localStorage.getItem(LOCAL_KEY_SLOT);
  const [wrappedDek, salt] = await Promise.all([
    db.keys.get('password-wrapped-dek'),
    db.meta.get('password-salt'),
  ]);

  if (!encryptedUserKeys || !wrappedDek || !salt) {
    throw new Error('Password vault data missing');
  }

  payload.encryptedUserKeys  = encryptedUserKeys;
  payload.passwordWrappedDek = toBase64(wrappedDek);
  payload.passwordSalt       = toBase64(salt);

  await attachOptionalData(payload, includeContacts, includeHistory, false);
}

async function attachOptionalData(payload, includeContacts, includeHistory, decrypt) {
  const tasks = [];

  if (includeContacts) {
    tasks.push(
      db.contacts.get('contacts').then(async (raw) => {
        if (!raw) return;
        if (decrypt) {
          try { payload.contacts = await decryptData(raw); }
          catch (e) { console.warn('Failed to decrypt contacts for export', e); }
        } else {
          payload.encryptedContacts = toBase64(raw);
        }
      }),
    );
  }

  if (includeHistory) {
    tasks.push(
      db.history.get('call_history').then(async (raw) => {
        if (!raw) return;
        if (decrypt) {
          try { payload.history = await decryptData(raw); }
          catch (e) { console.warn('Failed to decrypt history for export', e); }
        } else {
          payload.encryptedHistory = toBase64(raw);
        }
      }),
    );
  }

  await Promise.all(tasks);
}

async function importPasswordVault(resolved, number, password) {
  const { encryptedUserKeys, passwordWrappedDek, passwordSalt, encryptedContacts, encryptedHistory } = resolved;
  if (!encryptedUserKeys || !passwordWrappedDek || !passwordSalt) {
    throw new Error('Password data missing');
  }

  await Promise.all([
    db.meta.put('mode', 'password'),
    db.meta.put('phone_number', number),
    db.meta.put('password-salt', fromBase64(passwordSalt)),
    db.keys.put('password-wrapped-dek', fromBase64(passwordWrappedDek)),
    db.keys.remove('silent-kek'),
    db.keys.remove('silent-wrapped-dek'),
  ]);

  localStorage.setItem(LOCAL_KEY_SLOT, encryptedUserKeys);
  await unlockVault(password);

  await Promise.all([
    encryptedContacts && db.contacts.put('contacts', fromBase64(encryptedContacts).buffer),
    encryptedHistory  && db.history.put('call_history', fromBase64(encryptedHistory).buffer),
  ].filter(Boolean));

  return { mode: 'password', number };
}

async function importSilentVault(resolved, number) {
  if (!resolved?.keys) throw new Error('Keys missing');
  await setupVault(number, 'silent', '', resolved.keys);

  await Promise.all([
    resolved.contacts && encryptData(resolved.contacts).then((enc) => db.contacts.put('contacts', enc)),
    resolved.history  && encryptData(resolved.history).then((enc) => db.history.put('call_history', enc)),
  ].filter(Boolean));

  return { mode: 'silent', number };
}
