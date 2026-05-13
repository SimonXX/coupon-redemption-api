import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

const schemaSqlPath = path.join(projectRoot, "migrations/001_create_schema.sql");
const seedSqlPath = path.join(projectRoot, "db/002_seed_test_data.sql");

export async function resetDatabase(databaseUrl: string): Promise<void> {
  const [schemaSql, seedSql] = await Promise.all([
    readFile(schemaSqlPath, "utf8"),
    readFile(seedSqlPath, "utf8")
  ]);

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query(schemaSql);
    await client.query(seedSql);
  } finally {
    await client.end();
  }
}

export async function queryDatabase<Row extends pg.QueryResultRow>(
  databaseUrl: string,
  text: string,
  values: unknown[] = []
): Promise<Row[]> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<Row>(text, values);
    return result.rows;
  } finally {
    await client.end();
  }
}
