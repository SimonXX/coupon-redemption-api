# Coupon Redemption API

Backend Engineer assignment for a coupon redemption system.

This repository includes the database model, local Docker setup, and a TypeScript API for coupon listing, creation, and redemption.

## Prerequisites

- Docker
- Docker Compose v2

## Environment Setup

Create a local `.env` file from the committed example:

```bash
cp .env.example .env
```

The example values are suitable for local development. The real `.env` file is ignored by Git.

## Run API, PostgreSQL and Adminer

Start the local stack:

```bash
docker compose up -d --build
```

This starts:

- PostgreSQL on `localhost:5433`
- Adminer on `http://localhost:8081`
- API on `http://localhost:3000`

On startup, Docker Compose runs two one-shot services before the API starts:

- `migrate`: applies SQL migrations from `migrations/`
- `seed`: loads local development seed data from `db/002_seed_test_data.sql`

The migration runner stores applied migrations in `schema_migrations`, including a checksum, so changed already-applied migrations are detected.
Seed data is idempotent and intended for local development.

## Adminer Login

Open:

```text
http://localhost:8081
```

Use:

```text
System:   PostgreSQL
Server:   postgres
Username: coupon_user
Password: coupon_password
Database: coupon_redemption
```

Important: inside Docker Compose, the PostgreSQL hostname is `postgres`, not `localhost`.

## Verify The Database

Run:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select (select count(*) from campaigns) as campaigns, (select count(*) from coupons) as coupons, (select count(*) from users) as users, (select count(*) from redemptions) as redemptions;"'
```

Expected result after the seed script:

```text
 campaigns | coupons | users | redemptions
-----------+---------+-------+-------------
         4 |       7 |     3 |           0
```

Verify applied migrations:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select name, applied_at from schema_migrations order by applied_at;"'
```

## API Endpoints

### Health

```bash
curl http://localhost:3000/health
```

### List Coupons

```bash
curl "http://localhost:3000/coupons?page=1&pageSize=10"
```

The endpoint follows the assignment requirement and accepts `page` and `pageSize` as query parameters.
Those values are validated with Zod and passed to PostgreSQL through `pg` parameter binding.
They are never interpolated into SQL strings. The implementation also uses named `pg` prepared statements for the main queries.

Returned coupons satisfy:

- campaign status is `available`
- coupon status is `available`
- campaign is not expired
- coupon is not expired, unless `expiration_timestamp` is `NULL`
- future campaigns are included in the listing

### Create Campaign And Coupon

```bash
curl -X POST http://localhost:3000/coupons \
  -H "content-type: application/json" \
  -d '{
    "campaign": {
      "name": "Spring Wellness Campaign",
      "description": "Campaign description",
      "status": "available",
      "startTimestamp": "2026-05-01T00:00:00.000Z",
      "endTimestamp": "2026-12-31T23:59:59.000Z",
      "maxRedemptions": 100
    },
    "coupon": {
      "code": "SPRING20",
      "status": "available",
      "expirationTimestamp": "2026-12-31T23:59:59.000Z",
      "maxRedemptions": 5
    }
  }'
```

Campaigns are identified by unique `name`.
If a campaign with the same name already exists, the API reuses it and creates only the coupon.

### Redeem Coupon

Get a seed user id:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''alice@example.com'\'';"'
```

```bash
curl -X POST http://localhost:3000/coupons/SPRING10/redeem \
  -H "content-type: application/json" \
  -d '{"userId":"<seed-user-id>"}'
```

Authentication is intentionally out of scope for this assignment iteration.
The endpoint receives `userId` in the request body so the redemption rules can be exercised directly.

Redemption is executed inside a PostgreSQL transaction.
The API locks the target coupon and campaign rows with `SELECT ... FOR UPDATE`, validates availability and limits while locked, inserts the redemption record, and increments both counters in the same transaction.

## SQL Safety

All database access uses `pg` parameterized queries.
User-controlled input, including query parameters and path parameters, is validated before use and is passed as bind values (`$1`, `$2`, etc.).
The API does not build SQL by concatenating request values.

## Reset Local Database

To recreate the database from scratch and rerun migrations plus seed:

```bash
docker compose down -v
docker compose up -d --build
```

## Database Documentation

- Relational schema: `docs/RELATIONAL_SCHEMA.md`
- Part A database model PDF: `docs/Part_A_Domain_Modelling_and_Database_Design.pdf`
- SQL migrations: `migrations/`
- Test seed data: `db/002_seed_test_data.sql`
