# Database Scripts

This directory contains local development seed data for the assignment.

The database itself is created by Docker through `POSTGRES_DB` in `.env`.
The schema is managed through SQL migrations in `migrations/`.

## Files

- `002_seed_test_data.sql`: inserts deterministic test data for local manual testing.

## Execution

Docker Compose runs the `seed` one-shot service after migrations complete.

To recreate the database from scratch and run migrations plus seed:

```bash
docker compose down -v
docker compose up -d --build
```

For manual re-application during local development, use:

```bash
npm run seed
```

From inside Adminer:

- System: PostgreSQL
- Server: `postgres`
- Username: value of `POSTGRES_USER`
- Password: value of `POSTGRES_PASSWORD`
- Database: value of `POSTGRES_DB`
