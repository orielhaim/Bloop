import { Hono } from "hono";
import { db } from "../db";

const keys = new Hono();

keys.get("/:number", (c) => {
  const number = c.req.param("number");
  
  const entry = db.query("SELECT * FROM numbers WHERE number = ?").get(number) as { number: string, signing_key: string, encryption_key: string } | null;
  
  if (!entry) {
    return c.json({ error: "not_found" }, 404);
  }
  
  return c.json({
    number: entry.number,
    signingKey: JSON.parse(entry.signing_key),
    encryptionKey: JSON.parse(entry.encryption_key)
  });
});

export default keys;
