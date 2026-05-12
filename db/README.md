# Database Scripts

This directory contains explicit PostgreSQL scripts for the assignment.

The database itself is created by Docker through `POSTGRES_DB` in `.env`.
The SQL scripts here create the schema and optional test data inside that database.

## Files

- `001_schema.sql`: creates extensions, tables, relationships, constraints, indexes, and update timestamp triggers.
- `002_seed_test_data.sql`: inserts deterministic test data for local manual testing.

## Planned Execution

These scripts are mounted by `docker-compose.yml` into `/docker-entrypoint-initdb.d`.
PostgreSQL runs them automatically when the database volume is created for the first time.

To recreate the database from scratch:

```bash
docker compose down -v
docker compose up -d
```

For manual re-application during local development, use:

```bash
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/001_schema.sql
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/002_seed_test_data.sql
```

From inside Adminer:

- System: PostgreSQL
- Server: `postgres`
- Username: value of `POSTGRES_USER`
- Password: value of `POSTGRES_PASSWORD`
- Database: value of `POSTGRES_DB`
