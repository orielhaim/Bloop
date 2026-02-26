import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';

const activate = new Hono();

const activateSchema = z.object({
  code: z.string(),
  signingKey: z
    .object({
      kty: z.literal('OKP'),
      crv: z.literal('Ed25519'),
      x: z.string(),
    })
    .passthrough(),
  encryptionKey: z
    .object({
      kty: z.literal('OKP'),
      crv: z.literal('X25519'),
      x: z.string(),
    })
    .passthrough(),
});

activate.post('/', zValidator('json', activateSchema), async (c) => {
  const { code, signingKey, encryptionKey } = c.req.valid('json');

  const errorResponse = { error: 'invalid_code' };

  const activation = db
    .query('SELECT * FROM activation_codes WHERE code = ?')
    .get(code) as { code: string; number: string; expires_at: number } | null;

  if (!activation) {
    return c.json(errorResponse, 400);
  }

  if (Date.now() > activation.expires_at) {
    db.run('DELETE FROM activation_codes WHERE code = ?', [code]);
    return c.json(errorResponse, 400);
  }

  const numberEntry = db
    .query('SELECT status FROM numbers WHERE number = ?')
    .get(activation.number) as { status: string } | null;

  if (!numberEntry || numberEntry.status !== 'waiting') {
    return c.json(errorResponse, 400);
  }

  try {
    const updateTransaction = db.transaction(() => {
      db.run(
        "UPDATE numbers SET signing_key = ?, encryption_key = ?, status = 'active' WHERE number = ?",
        [
          JSON.stringify(signingKey),
          JSON.stringify(encryptionKey),
          activation.number,
        ],
      );
      db.run('DELETE FROM activation_codes WHERE code = ?', [code]);
    });

    updateTransaction();

    return c.json({ number: activation.number });
  } catch (e) {
    console.error(e);
    return c.json(errorResponse, 500);
  }
});

export default activate;
