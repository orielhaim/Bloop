import { encryptData, decryptData } from './crypto';

const SETTINGS_KEY = 'encrypted_settings';

export const DEFAULT_RELAYS = [
  'wss://nos.lol',
  'wss://nostr.mom',
  'wss://relay.snort.social'
];

export const DEFAULT_SETTINGS = {
  nostrRelays: DEFAULT_RELAYS,
  turnServer: {
    enabled: false,
    urls: '',
    username: '',
    credential: ''
  }
};

export async function getSettings() {
  const encrypted = localStorage.getItem(SETTINGS_KEY);
  if (!encrypted) return DEFAULT_SETTINGS;

  try {
    const buffer = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0)).buffer;
    const settings = await decryptData(buffer);
    return { ...DEFAULT_SETTINGS, ...settings }; // Merge with defaults
  } catch (e) {
    console.warn("Failed to decrypt settings (vault might be locked or data corrupted), returning defaults", e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings) {
  const buffer = await encryptData(settings);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  localStorage.setItem(SETTINGS_KEY, base64);
}
