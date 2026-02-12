import { SimplePool, generateSecretKey, finalizeEvent } from 'nostr-tools';
import { useCallStore } from '../store/callStore';
import { decryptFromSender, encryptEnvelope, encryptForRecipient } from './crypto';
import { getKeys as fetchKeys } from './api';

const RELAYS = [
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.snort.social'
];
const pool = new SimplePool();

let subscription = null;

function base64UrlToHex(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  let hex = [];
  for (let i = 0; i < bin.length; i++) {
    hex.push(bin.charCodeAt(i).toString(16).padStart(2, '0'));
  }
  return hex.join('');
}

export async function initNostrService(myNumber, myKeys) {

  const myPubHex = base64UrlToHex(myKeys.encryption.public.x);

  useCallStore.getState().setRelayConnection(true);

  subscription = pool.subscribe(
    RELAYS,
    {
      kinds: [29999],
      '#p': [myPubHex],
      since: Math.floor(Date.now() / 1000)
    },
    {
      onevent: async (event) => {
        try {
          await handleIncomingMessage(event, myKeys, myNumber);
        } catch (e) {
          console.error("Error handling incoming Nostr message:", e);
        }
      }
    }
  );

  console.log("Nostr service initialized. Listening for messages to:", myPubHex, myNumber);
}

export function cleanupNostrService() {
  if (subscription) {
    subscription.close();
    subscription = null;
  }
  useCallStore.getState().setRelayConnection(false);
}

async function handleIncomingMessage(event, myKeys) {
  const content = JSON.parse(event.content);

  if (!content.ciphertext || !content.nonce || !content.ephemeralPublicKey) return;

  let outerJson;
  try {
    const outerPlaintext = await decryptFromSender(
      myKeys.encryption.private,
      content.ephemeralPublicKey,
      content.ciphertext,
      content.nonce
    );
    outerJson = JSON.parse(outerPlaintext);
  } catch (e) {
    console.warn("Failed to decrypt outer envelope", e);
    return;
  }

  const { senderNumber, secret } = outerJson;
  if (!senderNumber || !secret) return;

  let senderKeys;
  try {
    senderKeys = await fetchKeys(senderNumber);
  } catch (e) {
    console.warn("Failed to fetch sender keys", e);
    return;
  }

  if (!senderKeys) return;

  let innerJson;
  try {
    const innerPlaintext = await decryptFromSender(
      myKeys.encryption.private,
      senderKeys.encryptionKey,
      secret.ciphertext,
      secret.nonce
    );
    innerJson = JSON.parse(innerPlaintext);
  } catch (e) {
    console.warn("Failed to decrypt inner secret", e);
    return;
  }

  const { callRoom, callPassword } = innerJson;

  console.log(`Incoming call from ${senderNumber}`);
  useCallStore.getState().receiveIncomingCall(senderNumber, callRoom, callPassword);
}

export async function sendCallSignal(targetNumber, targetKeys, myNumber, myKeys, callRoom, callPassword) {
  const innerPayload = JSON.stringify({ callRoom, callPassword });

  const secret = await encryptForRecipient(
    myKeys.encryption.private,
    targetKeys.encryptionKey,
    innerPayload
  );

  const outerPayload = JSON.stringify({
    senderNumber: myNumber,
    secret: secret
  });

  const envelope = await encryptEnvelope(
    targetKeys.encryptionKey,
    outerPayload
  );

  const targetPubHex = base64UrlToHex(targetKeys.encryptionKey.x);

  const sk = generateSecretKey();


  const event = finalizeEvent({
    kind: 29999,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', targetPubHex]],
    content: JSON.stringify(envelope),
  }, sk);

  await Promise.any(pool.publish(RELAYS, event));
  console.log("Call signal published to Nostr", targetPubHex, targetNumber);
}