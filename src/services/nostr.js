import { SimplePool, generateSecretKey, finalizeEvent } from 'nostr-tools';
import { useCallStore } from '../store/callStore';
import { decryptFromSender, encryptEnvelope, encryptForRecipient } from './crypto';
import { getKeys as fetchKeys } from './api';
import { mine, verify } from './pow';
import { getSettings } from './settings';

const EVENT_KIND = 29999;
const DEFAULT_POW_DIFFICULTY = 10;

function base64UrlToHex(b64url) {
  const raw = atob(b64url.replace(/-/g, '+').replace(/_/g, '/'));
  const hex = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) hex[i] = raw.charCodeAt(i).toString(16).padStart(2, '0');
  return hex.join('');
}

let pool = null;

function getPool() {
  if (!pool) {
    pool = new SimplePool({ enablePing: true, enableReconnect: true });
  }
  return pool;
}

function buildEvent(targetPubHex, content) {
  return finalizeEvent(
    {
      kind: EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', targetPubHex]],
      content: JSON.stringify(content),
    },
    generateSecretKey(),
  );
}

function parseEventContent(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function verifyPoW(message) {
  const { encryptedData, nonce, difficulty } = message;
  if (!encryptedData || nonce === undefined || difficulty === undefined) return null;
  const valid = await verify(encryptedData, nonce, difficulty);
  return valid ? encryptedData : null;
}

function parseEnvelope(dataString) {
  const content = parseEventContent(dataString);
  if (!content?.ciphertext || !content?.nonce || !content?.ephemeralPublicKey) return null;
  return content;
}

async function decryptOuter(envelope, myKeys) {
  const plaintext = await decryptFromSender(
    myKeys.encryption.private,
    envelope.ephemeralPublicKey,
    envelope.ciphertext,
    envelope.nonce,
  );
  const parsed = JSON.parse(plaintext);
  if (!parsed?.senderNumber || !parsed?.secret) return null;
  return parsed;
}

async function decryptInner(secret, senderEncryptionKey, myKeys) {
  const plaintext = await decryptFromSender(
    myKeys.encryption.private,
    senderEncryptionKey,
    secret.ciphertext,
    secret.nonce,
  );
  const parsed = JSON.parse(plaintext);
  if (!parsed?.callRoom || !parsed?.callPassword) return null;
  return parsed;
}

async function handleIncomingEvent(event, myKeys) {
  const message = parseEventContent(event.content);
  if (!message) return;

  const verifiedData = await verifyPoW(message);
  if (!verifiedData) return;

  const envelope = parseEnvelope(verifiedData);
  if (!envelope) return;

  const outer = await decryptOuter(envelope, myKeys);
  if (!outer) return;

  const senderKeys = await fetchKeys(outer.senderNumber);
  if (!senderKeys) return;

  const inner = await decryptInner(outer.secret, senderKeys.encryptionKey, myKeys);
  if (!inner) return;

  console.log(`Incoming call from ${outer.senderNumber}`);
  useCallStore.getState().receiveIncomingCall(outer.senderNumber, inner.callRoom, inner.callPassword);
}

let activeSubscription = null;

export async function initNostrService(myNumber, myKeys) {
  cleanupNostrService();

  const myPubHex = base64UrlToHex((myKeys.encryption.public?.x));
  const settings = await getSettings();

  activeSubscription = getPool().subscribe(
    settings.nostrRelays,
    {
      kinds: [EVENT_KIND],
      '#p': [myPubHex],
      since: Math.floor(Date.now() / 1000),
    },
    {
      onevent: async (event) => {
        try {
          await handleIncomingEvent(event, myKeys);
        } catch (e) {
          console.error('Error handling incoming Nostr message:', e);
        }
      },
    },
  );

  useCallStore.getState().setRelayConnection(true);
  console.log('Nostr service initialized. Listening for messages to:', myPubHex, myNumber);
}

export function cleanupNostrService() {
  if (activeSubscription) {
    activeSubscription.close();
    activeSubscription = null;
  }
  useCallStore.getState().setRelayConnection(false);
}

async function buildEncryptedPayload(targetKeys, myKeys, myNumber, callRoom, callPassword) {
  const secret = await encryptForRecipient(
    myKeys.encryption.private,
    targetKeys.encryptionKey,
    JSON.stringify({ callRoom, callPassword }),
  );

  return encryptEnvelope(
    targetKeys.encryptionKey,
    JSON.stringify({ senderNumber: myNumber, secret }),
  );
}

export async function sendCallSignal(targetNumber, targetKeys, myNumber, myKeys, callRoom, callPassword) {
  const envelope = await buildEncryptedPayload(targetKeys, myKeys, myNumber, callRoom, callPassword);

  const envelopeString = JSON.stringify(envelope);
  const nonce = await mine(envelopeString, DEFAULT_POW_DIFFICULTY);

  const targetPubHex = base64UrlToHex(targetKeys.encryptionKey?.x);
  const event = buildEvent(targetPubHex, {
    encryptedData: envelopeString,
    nonce,
    difficulty: DEFAULT_POW_DIFFICULTY,
  });

  const settings = await getSettings();
  await Promise.any(getPool().publish(settings.nostrRelays, event));
  console.log('Call signal published to Nostr', targetPubHex, targetNumber);
}

export function destroyNostrService() {
  cleanupNostrService();
  if (pool) {
    pool.close([]);
    pool = null;
  }
}
