export function mine(data, difficulty = 10) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pow.worker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (e) => {
      const { nonce, error } = e.data;
      worker.terminate();
      if (error) {
        reject(new Error(error));
      } else {
        resolve(nonce);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    worker.postMessage({ data, difficulty });
  });
}

export async function verify(data, nonce, difficulty) {
  const enc = new TextEncoder();
  const msgBuffer = enc.encode(data + nonce.toString());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = new Uint8Array(hashBuffer);

  const fullBytes = Math.floor(difficulty / 8);
  const remainingBits = difficulty % 8;

  for (let i = 0; i < fullBytes; i++) {
    if (hashArray[i] !== 0) return false;
  }

  if (remainingBits > 0) {
    const mask = 0xFF << (8 - remainingBits);
    if ((hashArray[fullBytes] & mask) !== 0) return false;
  }

  return true;
}
