import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSeedFile = path.resolve(__dirname, "../db/002_seed_test_data.sql");
const seedFile = process.env.SEED_FILE
  ? path.resolve(process.env.SEED_FILE)
  : defaultSeedFile;

const pool = new Pool({
  connectionString: config.DATABASE_URL
});

try {
  const sql = await readFile(seedFile, "utf8");
  await pool.query(sql);
  console.log(`Applied seed file ${path.basename(seedFile)}`);
} finally {
  await pool.end();
}
