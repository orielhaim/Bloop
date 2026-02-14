import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { generateKeyPairSync } from "crypto";
import { db } from "../db";

const keys = new Hono();

const paramSchema = z.object({
  number: z.string()
});

function generateDummyKeys() {
  const signingKeyPair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' }
  });

  const encryptionKeyPair = generateKeyPairSync('x25519', {
    publicKeyEncoding: { format: 'jwk' },
    privateKeyEncoding: { format: 'jwk' }
  });

  const signingKey = {
    kty: signingKeyPair.publicKey.kty,
    crv: signingKeyPair.publicKey.crv,
    x: signingKeyPair.publicKey.x,
    alg: "Ed25519",
    ext: true,
    key_ops: ["verify"]
  };

  const encryptionKey = {
    kty: encryptionKeyPair.publicKey.kty,
    crv: encryptionKeyPair.publicKey.crv,
    x: encryptionKeyPair.publicKey.x,
    ext: true,
    key_ops: []
  };

  return {
    signingKey,
    encryptionKey
  };
}

keys.get("/:number", zValidator("param", paramSchema), (c) => {
  const { number } = c.req.valid("param");

  const entry = db.query("SELECT * FROM numbers WHERE number = ?").get(number) as { number: string, signing_key: string, encryption_key: string, status: string } | null;

  if (!entry) {
    const { signingKey, encryptionKey } = generateDummyKeys();
    
    db.run("INSERT INTO numbers (number, signing_key, encryption_key, status) VALUES (?, ?, ?, ?)", [
      number,
      JSON.stringify(signingKey),
      JSON.stringify(encryptionKey),
      'dummy'
    ]);

    return c.json({
      number,
      signingKey,
      encryptionKey
    });
  }

  if (entry.status === 'active' || entry.status === 'dummy') {
    return c.json({
      number: entry.number,
      signingKey: JSON.parse(entry.signing_key),
      encryptionKey: JSON.parse(entry.encryption_key)
    });
  }

  if (entry.status === 'waiting') {
    if (entry.signing_key && entry.encryption_key) {
      return c.json({
        number: entry.number,
        signingKey: JSON.parse(entry.signing_key),
        encryptionKey: JSON.parse(entry.encryption_key)
      });
    }

    const { signingKey, encryptionKey } = generateDummyKeys();

    db.run("UPDATE numbers SET signing_key = ?, encryption_key = ? WHERE number = ?", [
      JSON.stringify(signingKey),
      JSON.stringify(encryptionKey),
      number
    ]);

    return c.json({
      number,
      signingKey,
      encryptionKey
    });
  }

  return c.json({ error: "unexpected_status" }, 500);
});

export default keys;
