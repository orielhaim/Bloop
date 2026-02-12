import { Hono } from "hono";
import { db, getNextNumber } from "../db";

const admin = new Hono();

admin.post("/issue-number", async (c) => {
  const number = getNextNumber();
  
  // Generate 32 random bytes
  const activationCodeBytes = new Uint8Array(32);
  crypto.getRandomValues(activationCodeBytes);
  const activationCode = Buffer.from(activationCodeBytes).toString('hex');
  
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  
  db.run("INSERT INTO activation_codes (code, number, expires_at) VALUES (?, ?, ?)", [activationCode, number, expiresAt]);
  
  return c.json({
    number,
    activationCode
  });
});

export default admin;
