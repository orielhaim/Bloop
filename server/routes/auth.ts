import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db';

const auth = new Hono();

const challengeSchema = z
  .object({
    number: z.string().optional(),
  })
  .passthrough();

auth.post('/challenge', zValidator('json', challengeSchema), async (c) => {
  const challengeId = crypto.randomUUID();
  const challengeBytes = new Uint8Array(32);
  crypto.getRandomValues(challengeBytes);
  const challenge = Buffer.from(challengeBytes).toString('hex');

  const expiresAt = Date.now() + 60 * 1000; // 60 seconds

  db.run(
    'INSERT INTO challenges (id, challenge, expires_at) VALUES (?, ?, ?)',
    [challengeId, challenge, expiresAt],
  );

  return c.json({
    challengeId,
    challenge,
  });
});

const verifySchema = z.object({
  challengeId: z.string(),
  number: z.string(),
  signature: z.string(),
});

auth.post('/verify', zValidator('json', verifySchema), async (c) => {
  const { challengeId, number, signature } = c.req.valid('json');

  const errorResponse = { error: 'invalid' };

  const challengeEntry = db
    .query('SELECT * FROM challenges WHERE id = ?')
    .get(challengeId) as {
    id: string;
    challenge: string;
    expires_at: number;
  } | null;

  if (!challengeEntry) {
    return c.json(errorResponse, 400);
  }

  db.run('DELETE FROM challenges WHERE id = ?', [challengeId]);

  if (Date.now() > challengeEntry.expires_at) {
    return c.json(errorResponse, 400);
  }

  const numberEntry = db
    .query('SELECT * FROM numbers WHERE number = ?')
    .get(number) as {
    number: string;
    signing_key: string;
    status: string;
  } | null;

  if (!numberEntry || numberEntry.status !== 'active') {
    return c.json(errorResponse, 400);
  }

  try {
    const jwk = JSON.parse(numberEntry.signing_key);

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'Ed25519' },
      true,
      ['verify'],
    );

    const signatureBytes = Uint8Array.from(Buffer.from(signature, 'hex'));
    const dataBytes = new TextEncoder().encode(challengeEntry.challenge);

    const isValid = await crypto.subtle.verify(
      'Ed25519',
      key,
      signatureBytes,
      dataBytes,
    );

    if (isValid) {
      return c.json({ verified: true, number });
    } else {
      return c.json(errorResponse, 400);
    }
  } catch (e) {
    console.error('Verification error:', e);
    return c.json(errorResponse, 400);
  }
});

export default auth;
