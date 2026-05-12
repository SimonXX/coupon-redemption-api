import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

type AppliedMigrationRow = {
  name: string;
  checksum: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultMigrationsDir = path.resolve(__dirname, "../migrations");
const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : defaultMigrationsDir;

const pool = new Pool({
  connectionString: config.DATABASE_URL
});

try {
  await ensureMigrationTable();
  await runPendingMigrations();
} finally {
  await pool.end();
}

async function ensureMigrationTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function runPendingMigrations(): Promise<void> {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const appliedResult = await pool.query<AppliedMigrationRow>(
    "SELECT name, checksum FROM schema_migrations"
  );

  const applied = new Map(
    appliedResult.rows.map((row) => [row.name, row.checksum])
  );

  for (const file of migrationFiles) {
    const fullPath = path.join(migrationsDir, file);
    const sql = await readFile(fullPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const appliedChecksum = applied.get(file);

    if (appliedChecksum !== undefined) {
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied`);
      }

      console.log(`Skipping already applied migration ${file}`);
      continue;
    }

    await applyMigration(file, sql, checksum);
  }
}

async function applyMigration(name: string, sql: string, checksum: string): Promise<void> {
  const client = await pool.connect();

  try {
    console.log(`Applying migration ${name}`);
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
      [name, checksum]
    );
    await client.query("COMMIT");
    console.log(`Applied migration ${name}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
