import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";

const keys = new Hono();

const paramSchema = z.object({
  number: z.string()
});

keys.get("/:number", zValidator("param", paramSchema), (c) => {
  const { number } = c.req.valid("param");

  const entry = db.query("SELECT * FROM numbers WHERE number = ?").get(number) as { number: string, signing_key: string, encryption_key: string, status: string } | null;

  if (!entry || entry.status !== 'active') {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({
    number: entry.number,
    signingKey: JSON.parse(entry.signing_key),
    encryptionKey: JSON.parse(entry.encryption_key)
  });
});

export default keys;
