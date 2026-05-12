# Coupon Redemption API

Backend Engineer assignment for a coupon redemption system.

This repository currently includes the Part A database model and local Docker setup.

## Prerequisites

- Docker
- Docker Compose v2

## Environment Setup

Create a local `.env` file from the committed example:

```bash
cp .env.example .env
```

The example values are suitable for local development. The real `.env` file is ignored by Git.

## Run PostgreSQL and Adminer

Start the local infrastructure:

```bash
docker compose up -d
```

This starts:

- PostgreSQL on `localhost:5433`
- Adminer on `http://localhost:8081`

On first startup with an empty volume, PostgreSQL automatically runs:

- `db/001_schema.sql`
- `db/002_seed_test_data.sql`

These scripts create the schema, constraints, relationships, indexes, triggers, and local test data.

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

## Reset Local Database

To recreate the database from scratch and rerun the initialization scripts:

```bash
docker compose down -v
docker compose up -d
```

## Database Documentation

- Relational schema: `docs/RELATIONAL_SCHEMA.md`
- Part A database model PDF: `docs/Part_A_Domain_Modelling_and_Database_Design.pdf`
- SQL schema: `db/001_schema.sql`
- Test seed data: `db/002_seed_test_data.sql`
