import type { FastifyInstance } from "fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { queryDatabase, resetDatabase } from "./support/database.js";

const aliceUserId = "11111111-1111-4111-8111-111111111111";

let container: StartedPostgreSqlContainer;
let databaseUrl: string;
let app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("coupon_redemption_test")
    .withUsername("coupon_test_user")
    .withPassword("coupon_test_password")
    .start();

  databaseUrl = container.getConnectionUri();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = databaseUrl;
  process.env.CORS_ORIGIN = "http://localhost:8082";

  const { buildApp } = await import("../../src/app.js");
  app = buildApp();
});

beforeEach(async () => {
  await resetDatabase(databaseUrl);
});

afterAll(async () => {
  if (app) {
    await app.close();
  }

  if (container) {
    await container.stop();
  }
});

describe("Coupon API integration", () => {
  test("lists available coupons with stable ordering and null expiration support", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/coupons?page=1&pageSize=10"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 4
    });

    const body = response.json() as {
      items: Array<{ code: string; expirationTimestamp: string | null }>;
    };

    expect(body.items.map((coupon) => coupon.code)).toEqual([
      "NO-EXPIRY",
      "ONE-SLOT",
      "SPRING10",
      "FUTURE10"
    ]);
    expect(body.items[0]).toMatchObject({
      code: "NO-EXPIRY",
      expirationTimestamp: null
    });
  });

  test("reuses an existing campaign name when creating a new coupon", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/coupons",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        campaign: {
          name: "Spring Wellness Campaign",
          description: "Request payload should not duplicate the existing campaign",
          status: "available",
          startTimestamp: "2026-05-01T00:00:00.000Z",
          endTimestamp: "2026-12-31T23:59:59.000Z",
          maxRedemptions: 999
        },
        coupon: {
          code: "SPRING-EXTRA",
          status: "available",
          expirationTimestamp: "2026-12-31T23:59:59.000Z",
          maxRedemptions: 2
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      campaign: {
        name: "Spring Wellness Campaign"
      },
      coupon: {
        code: "SPRING-EXTRA"
      }
    });

    const campaignRows = await queryDatabase<{ total: string }>(
      databaseUrl,
      "SELECT count(*) AS total FROM campaigns WHERE name = $1",
      ["Spring Wellness Campaign"]
    );
    const couponRows = await queryDatabase<{ total: string }>(
      databaseUrl,
      "SELECT count(*) AS total FROM coupons WHERE code = $1",
      ["SPRING-EXTRA"]
    );

    expect(Number(campaignRows[0].total)).toBe(1);
    expect(Number(couponRows[0].total)).toBe(1);
  });

  test("returns a client error for malformed JSON payloads", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/coupons",
      headers: {
        "content-type": "application/json"
      },
      payload: '{"campaign":{"name":"Winter Wellness Campaign","status":"not-available,'
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "FST_ERR_CTP_INVALID_JSON_BODY"
    });
  });

  test("prevents the same user from redeeming the same coupon twice", async () => {
    const firstResponse = await redeem("SPRING10", aliceUserId);
    const duplicateResponse = await redeem("SPRING10", aliceUserId);

    expect(firstResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toMatchObject({
      error: "COUPON_ALREADY_REDEEMED"
    });

    const rows = await queryDatabase<{ total: string }>(
      databaseUrl,
      `
        SELECT count(*) AS total
        FROM redemptions
        INNER JOIN users ON users.id = redemptions.user_id
        INNER JOIN coupons ON coupons.id = redemptions.coupon_id
        WHERE users.id = $1 AND coupons.code = $2
      `,
      [aliceUserId, "SPRING10"]
    );

    expect(Number(rows[0].total)).toBe(1);
  });

  test("does not exceed the coupon limit under concurrent redemption requests", async () => {
    const users = Array.from({ length: 10 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, "9")}-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
      email: `parallel-user-${index + 1}@example.com`
    }));

    await queryDatabase(
      databaseUrl,
      `
        INSERT INTO users (id, email, role)
        SELECT user_id::uuid, email, 'user'
        FROM unnest($1::text[], $2::text[]) AS input(user_id, email)
      `,
      [users.map((user) => user.id), users.map((user) => user.email)]
    );

    const responses = await Promise.all(
      users.map((user) => redeem("ONE-SLOT", user.id))
    );

    const successResponses = responses.filter((response) => response.statusCode === 201);
    const conflictResponses = responses.filter((response) => response.statusCode === 409);

    expect(successResponses).toHaveLength(1);
    expect(conflictResponses).toHaveLength(9);
    expect(
      conflictResponses.every(
        (response) => response.json().error === "COUPON_REDEMPTION_LIMIT_REACHED"
      )
    ).toBe(true);

    const counters = await queryDatabase<{
      redemptions_count: number;
      actual_redemptions: string;
    }>(
      databaseUrl,
      `
        SELECT
          coupons.redemptions_count,
          count(redemptions.id) AS actual_redemptions
        FROM coupons
        LEFT JOIN redemptions ON redemptions.coupon_id = coupons.id
        WHERE coupons.code = $1
        GROUP BY coupons.id
      `,
      ["ONE-SLOT"]
    );

    expect(counters[0]).toEqual({
      redemptions_count: 1,
      actual_redemptions: "1"
    });
  });
});

async function redeem(code: string, userId: string) {
  return app.inject({
    method: "POST",
    url: `/coupons/${code}/redeem`,
    headers: {
      "content-type": "application/json"
    },
    payload: {
      userId
    }
  });
}
