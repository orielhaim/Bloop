const encoder = new TextEncoder();

function checkLeadingZeroBits(hash, difficulty) {
  const fullBytes    = difficulty >>> 3;
  const remainBits   = difficulty & 7;

  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }

  if (remainBits > 0 && (hash[fullBytes] & (0xFF << (8 - remainBits))) !== 0) {
    return false;
  }

  return true;
}

export async function verify(data, nonce, difficulty) {
  const buffer = encoder.encode(data + nonce);
  const hash   = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return checkLeadingZeroBits(hash, difficulty);
}

export function mine(data, difficulty = 10, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }

    const worker = new Worker(
      new URL('./pow.worker.js', import.meta.url),
      { type: 'module' },
    );

    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = ({ data: msg }) => {
      cleanup();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.nonce);
    };

    worker.onerror = (err) => {
      cleanup();
      reject(err);
    };

    worker.postMessage({ data, difficulty });
  });
}
