# Migrations

Database schema changes are managed through versioned SQL migrations.

The migration runner is implemented in `src/migrate.ts` and tracks applied files in the database table `schema_migrations`.

Each applied migration stores:

- migration file name
- SHA-256 checksum
- application timestamp

If an already-applied migration file is edited later, the checksum mismatch makes the runner fail instead of silently accepting drift.

## Local Commands

Run pending migrations against the database configured by `DATABASE_URL`:

```bash
npm run migrate
```

Run local seed data:

```bash
npm run seed
```

## Docker Compose

`docker compose up -d --build` runs:

1. `postgres`
2. `migrate`
3. `seed`
4. `api`
5. `adminer`

`migrate` and `seed` are one-shot services and should exit with status `0`.
