import { db } from './db';
import { encryptData, decryptData } from './crypto';

const HISTORY_KEY = 'call_history';
const HISTORY_LIMIT = 200;

async function loadHistory() {
  const encrypted = await db.history.get(HISTORY_KEY);
  if (!encrypted) return [];
  try {
    const history = await decryptData(encrypted);
    return Array.isArray(history) ? history : [];
  } catch (e) {
    console.error("Failed to decrypt call history", e);
    return [];
  }
}

async function saveHistory(history) {
  const encrypted = await encryptData(history);
  await db.history.put(HISTORY_KEY, encrypted);
}

export async function getCallHistory() {
  return await loadHistory();
}

export async function addCallRecord(record) {
  const history = await loadHistory();
  const next = [record, ...history].slice(0, HISTORY_LIMIT);
  await saveHistory(next);
  return next;
}
