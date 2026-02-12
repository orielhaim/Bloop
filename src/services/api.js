const API_URL = "http://localhost:3000/api";

export async function issueNumber() {
  const res = await fetch(`${API_URL}/admin/issue-number`, {
    method: "POST",
  });
  return res.json();
}

export async function activateNumber(code, signingKey, encryptionKey) {
  const res = await fetch(`${API_URL}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      signingKey,
      encryptionKey
    })
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Activation failed");
  }
  
  return res.json();
}

export async function requestChallenge(number) {
  const res = await fetch(`${API_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number })
  });
  return res.json();
}

export async function verifyChallenge(challengeId, number, signature) {
  const res = await fetch(`${API_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challengeId,
      number,
      signature
    })
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Verification failed");
  }
  
  return res.json();
}

export async function getKeys(number) {
  const res = await fetch(`${API_URL}/keys/${number}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Not found");
  }
  return res.json();
}
