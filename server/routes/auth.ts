import { Hono } from "hono";
import { db } from "../db";

const auth = new Hono();

auth.post("/challenge", async (c) => {
  const body = await c.req.json();
  // We don't really use body.number for generating challenge, but it's in the request spec.
  // "Always return a challenge even if the number doesn't exist"

  const challengeId = crypto.randomUUID();
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = Buffer.from(challengeBytes).toString('hex');
  
  const expiresAt = Date.now() + 60 * 1000; // 60 seconds
  
  db.run("INSERT INTO challenges (id, challenge, expires_at) VALUES (?, ?, ?)", [challengeId, challenge, expiresAt]);
  
  return c.json({
    challengeId,
    challenge
  });
});

auth.post("/verify", async (c) => {
  const body = await c.req.json();
  const { challengeId, number, signature } = body;
  
  const errorResponse = { error: "invalid" };
  
  // 1. Look up challenge
  const challengeEntry = db.query("SELECT * FROM challenges WHERE id = ?").get(challengeId) as { id: string, challenge: string, expires_at: number } | null;
  
  if (!challengeEntry) {
    return c.json(errorResponse, 400);
  }
  
  // Delete challenge (one-time use)
  db.run("DELETE FROM challenges WHERE id = ?", [challengeId]);
  
  // Check expiry
  if (Date.now() > challengeEntry.expires_at) {
    return c.json(errorResponse, 400);
  }
  
  // 2. Look up number
  const numberEntry = db.query("SELECT * FROM numbers WHERE number = ?").get(number) as { number: string, signing_key: string } | null;
  
  if (!numberEntry) {
    return c.json(errorResponse, 400);
  }
  
  // 3. Import public key and verify
  try {
    const jwk = JSON.parse(numberEntry.signing_key);
    
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "Ed25519" },
      true,
      ["verify"]
    );
    
    const signatureBytes = Uint8Array.from(Buffer.from(signature, 'hex'));
    const dataBytes = new TextEncoder().encode(challengeEntry.challenge);
    
    const isValid = await crypto.subtle.verify(
      "Ed25519",
      key,
      signatureBytes,
      dataBytes
    );
    
    if (isValid) {
      return c.json({ verified: true, number });
    } else {
      return c.json(errorResponse, 400);
    }
  } catch (e) {
    console.error("Verification error:", e);
    return c.json(errorResponse, 400);
  }
});

export default auth;
