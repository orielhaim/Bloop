const BATCH_SIZE = 2048;
const encoder = new TextEncoder();

function checkLeadingZeroBits(hash, difficulty) {
  const fullBytes = difficulty >>> 3;
  const remainBits = difficulty & 7;

  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }

  if (remainBits > 0 && (hash[fullBytes] & (0xff << (8 - remainBits))) !== 0) {
    return false;
  }

  return true;
}

async function mine(data, difficulty) {
  const prefix = encoder.encode(data);
  let base = 0;

  while (true) {
    const pending = new Array(BATCH_SIZE);

    for (let i = 0; i < BATCH_SIZE; i++) {
      const suffix = encoder.encode(String(base + i));
      const buf = new Uint8Array(prefix.length + suffix.length);
      buf.set(prefix);
      buf.set(suffix, prefix.length);
      pending[i] = crypto.subtle.digest('SHA-256', buf);
    }

    const hashes = await Promise.all(pending);

    for (let i = 0; i < BATCH_SIZE; i++) {
      if (checkLeadingZeroBits(new Uint8Array(hashes[i]), difficulty)) {
        return base + i;
      }
    }

    base += BATCH_SIZE;
  }
}

self.onmessage = async ({ data: msg }) => {
  try {
    const nonce = await mine(msg.data, msg.difficulty);
    self.postMessage({ nonce });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
