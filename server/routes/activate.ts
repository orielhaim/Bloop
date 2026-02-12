import { Hono } from "hono";
import { db } from "../db";

const activate = new Hono();

activate.post("/", async (c) => {
  const body = await c.req.json();
  const { code, signingKey, encryptionKey } = body;

  const errorResponse = { error: "invalid_code" };

  // 1. Look up code
  const activation = db.query("SELECT * FROM activation_codes WHERE code = ?").get(code) as { code: string, number: string, expires_at: number } | null;

  if (!activation) {
    return c.json(errorResponse, 400); // Or 200 with error field as per spec? Spec says "Response (any failure): { error: 'invalid_code' }". Doesn't specify status code, but usually 400 or 200. I'll stick to returning JSON.
  }

  // 2. Check expiry
  if (Date.now() > activation.expires_at) {
    db.run("DELETE FROM activation_codes WHERE code = ?", [code]);
    return c.json(errorResponse, 400);
  }

  // 3. Check if number already in numbers table (shouldn't happen if we manage activation codes correctly, but good check)
  const existingNumber = db.query("SELECT number FROM numbers WHERE number = ?").get(activation.number);
  if (existingNumber) {
    return c.json(errorResponse, 400);
  }

  // 4. Validate signingKey
  if (!isValidKey(signingKey, "Ed25519")) {
    return c.json(errorResponse, 400);
  }

  // 5. Validate encryptionKey
  if (!isValidKey(encryptionKey, "X25519")) {
    return c.json(errorResponse, 400);
  }

  // 6. Insert into numbers
  try {
    db.run("INSERT INTO numbers (number, signing_key, encryption_key) VALUES (?, ?, ?)", [
      activation.number,
      JSON.stringify(signingKey),
      JSON.stringify(encryptionKey)
    ]);

    // 7. Delete from activation_codes
    db.run("DELETE FROM activation_codes WHERE code = ?", [code]);

    return c.json({ number: activation.number });
  } catch (e) {
    console.error(e);
    return c.json(errorResponse, 500);
  }
});

function isValidKey(key: any, crv: string): boolean {
  if (!key || typeof key !== 'object') return false;
  if (key.kty !== 'OKP') return false;
  if (key.crv !== crv) return false;
  if (typeof key.x !== 'string') return false;
  // Basic base64url check?
  return true;
}

export default activate;
