import { Database } from "bun:sqlite";
import { join } from "node:path";

const db = new Database(join(__dirname, "data", "database.sqlite"));

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS activation_codes (
    code TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (number) REFERENCES numbers(number) ON DELETE CASCADE
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS numbers (
    number TEXT PRIMARY KEY,
    signing_key TEXT,
    encryption_key TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    created_at INTEGER NOT NULL DEFAULT CURRENT_TIMESTAMP
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
export function getNextNumber() {
  const result = db.query("SELECT MAX(CAST(number AS INTEGER)) as max_num FROM numbers").get();
  const lastNum = result?.max_num || 1000;
  
  return (lastNum + 1).toString();
}

export { db };