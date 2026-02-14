self.onmessage = async (e) => {
  const { data, difficulty } = e.data;
  try {
    const nonce = await mine(data, difficulty);
    self.postMessage({ nonce });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};

async function mine(data, difficulty) {
  let nonce = 0;
  while (true) {
    const isValid = await checkHash(data, nonce, difficulty);
    if (isValid) return nonce;
    nonce++;
  }
}

async function checkHash(data, nonce, difficulty) {
  const enc = new TextEncoder();
  const msgBuffer = enc.encode(data + nonce.toString());
  const hashBuffer = await self.crypto.subtle.digest('SHA-256', msgBuffer);
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
