import { Database } from "bun:sqlite";

const db = new Database("phone.sqlite");

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS activation_codes (
    code TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    number TEXT PRIMARY KEY,
    signing_key TEXT NOT NULL,
    encryption_key TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

// Helper to get last number
export function getNextNumber(): string {
  const result = db.query("SELECT MAX(CAST(number AS INTEGER)) as max_num FROM numbers").get() as { max_num: number | null };
  const lastNum = result?.max_num || 1000;
  
  // Also check activation codes to avoid collision if a number is issued but not activated yet?
  // The spec says "Generate next sequential number". 
  // We should probably track issued numbers somewhere or just check both tables?
  // For simplicity, let's assume we just increment from the max in numbers table.
  // BUT, if we issue 1001, it's in activation_codes, not numbers.
  // So we need to check activation_codes too.
  
  const result2 = db.query("SELECT MAX(CAST(number AS INTEGER)) as max_num FROM activation_codes").get() as { max_num: number | null };
  const lastNum2 = result2?.max_num || 1000;
  
  return (Math.max(lastNum, lastNum2) + 1).toString();
}

export { db };
