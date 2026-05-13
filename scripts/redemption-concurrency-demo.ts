import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";

const { Client } = pg;

type DemoUser = {
  id: string;
  email: string;
};

type RedemptionResult = {
  index: number;
  userId: string;
  status: number;
  elapsedMs: number;
  error?: string;
};

type CounterRow = {
  coupon_redemptions_count: number;
  campaign_redemptions_count: number;
  actual_redemptions: string;
};

const usersCount = parsePositiveInt(process.env.CONCURRENCY_USERS, 50);
const redemptionLimit = parsePositiveInt(process.env.CONCURRENCY_LIMIT, 1);
const apiBaseUrl = process.env.API_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? "3000"}`;
const databaseUrl = process.env.DATABASE_URL;
const runId = Date.now();
const couponCode = `CONCURRENCY-${runId}`;
const campaignName = `Concurrency Demo Campaign ${runId}`;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env before running the demo.");
}

async function main(): Promise<void> {
  const users = createDemoUsers(usersCount, runId);

  await assertApiIsReachable();
  await createUsers(users);
  await createCoupon();

  const startedAt = performance.now();
  const results = await Promise.all(
    users.map((user, index) => redeemCoupon(user, index + 1))
  );
  const elapsedMs = performance.now() - startedAt;
  const counters = await readCounters();

  printReport(results, counters, elapsedMs);
}

async function assertApiIsReachable(): Promise<void> {
  try {
    const response = await fetch(`${apiBaseUrl}/health`);

    if (!response.ok) {
      throw new Error(`Health check returned ${response.status}`);
    }
  } catch (error) {
    throw new Error(
      `API is not reachable at ${apiBaseUrl}. Start the stack with docker compose up -d --build.`,
      { cause: error }
    );
  }
}

async function createUsers(users: DemoUser[]): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(
      `
        INSERT INTO users (id, email, role)
        SELECT user_id::uuid, email, 'user'
        FROM unnest($1::text[], $2::text[]) AS input(user_id, email)
        ON CONFLICT (email) DO NOTHING
      `,
      [users.map((user) => user.id), users.map((user) => user.email)]
    );
  } finally {
    await client.end();
  }
}

async function createCoupon(): Promise<void> {
  const response = await fetch(`${apiBaseUrl}/coupons`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      campaign: {
        name: campaignName,
        description: "Concurrency visualization campaign",
        status: "available",
        startTimestamp: "2026-01-01T00:00:00.000Z",
        endTimestamp: "2026-12-31T23:59:59.000Z",
        maxRedemptions: redemptionLimit
      },
      coupon: {
        code: couponCode,
        status: "available",
        expirationTimestamp: "2026-12-31T23:59:59.000Z",
        maxRedemptions: redemptionLimit
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Coupon setup failed with ${response.status}: ${body}`);
  }
}

async function redeemCoupon(user: DemoUser, index: number): Promise<RedemptionResult> {
  const startedAt = performance.now();
  const response = await fetch(`${apiBaseUrl}/coupons/${couponCode}/redeem`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      userId: user.id
    })
  });

  const body = await response.json().catch(() => ({}));

  return {
    index,
    userId: user.id,
    status: response.status,
    elapsedMs: performance.now() - startedAt,
    error: typeof body.error === "string" ? body.error : undefined
  };
}

async function readCounters(): Promise<CounterRow> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<CounterRow>(
      `
        SELECT
          coupons.redemptions_count AS coupon_redemptions_count,
          campaigns.redemptions_count AS campaign_redemptions_count,
          count(redemptions.id) AS actual_redemptions
        FROM coupons
        INNER JOIN campaigns ON campaigns.id = coupons.campaign_id
        LEFT JOIN redemptions ON redemptions.coupon_id = coupons.id
        WHERE coupons.code = $1
        GROUP BY coupons.id, campaigns.id
      `,
      [couponCode]
    );

    if (!result.rows[0]) {
      throw new Error("Could not read demo coupon counters");
    }

    return result.rows[0];
  } finally {
    await client.end();
  }
}

function printReport(
  results: RedemptionResult[],
  counters: CounterRow,
  totalElapsedMs: number
): void {
  const successes = results.filter((result) => result.status === 201);
  const conflicts = results.filter((result) => result.status === 409);
  const others = results.filter(
    (result) => result.status !== 201 && result.status !== 409
  );
  const latencies = results.map((result) => result.elapsedMs);
  const errorCounts = countByError(results);

  console.log("");
  console.log("Coupon Redemption Concurrency Demo");
  console.log("==================================");
  console.log(`API:                 ${apiBaseUrl}`);
  console.log(`Coupon code:         ${couponCode}`);
  console.log(`Campaign:            ${campaignName}`);
  console.log(`Parallel users:      ${usersCount}`);
  console.log(`Available slots:     ${redemptionLimit}`);
  console.log(`Total elapsed:       ${formatMs(totalElapsedMs)}`);
  console.log("");

  console.log("Outcome");
  console.log("-------");
  console.log(`201 Created          ${bar(successes.length, usersCount)} ${successes.length}`);
  console.log(`409 Conflict         ${bar(conflicts.length, usersCount)} ${conflicts.length}`);
  console.log(`Other statuses       ${bar(others.length, usersCount)} ${others.length}`);
  console.log("");

  console.log("Request Grid");
  console.log("------------");
  console.log(formatGrid(results));
  console.log("");

  console.log("Conflict Reasons");
  console.log("----------------");
  const errorEntries = Object.entries(errorCounts);

  if (errorEntries.length === 0) {
    console.log("none");
  } else {
    for (const [error, count] of errorEntries) {
      console.log(`${error.padEnd(40)} ${count}`);
    }
  }
  console.log("");

  console.log("Latency");
  console.log("-------");
  console.log(`min=${formatMs(Math.min(...latencies))}`);
  console.log(`avg=${formatMs(average(latencies))}`);
  console.log(`max=${formatMs(Math.max(...latencies))}`);
  console.log("");

  console.log("Database Verification");
  console.log("---------------------");
  console.log(`coupons.redemptions_count:   ${counters.coupon_redemptions_count}`);
  console.log(`campaigns.redemptions_count: ${counters.campaign_redemptions_count}`);
  console.log(`redemptions rows:            ${counters.actual_redemptions}`);
  console.log("");

  if (
    successes.length === redemptionLimit &&
    Number(counters.actual_redemptions) === redemptionLimit &&
    counters.coupon_redemptions_count === redemptionLimit &&
    counters.campaign_redemptions_count === redemptionLimit
  ) {
    console.log("Result: concurrency limit respected.");
    return;
  }

  console.log("Result: unexpected counters, inspect the output above.");
}

function createDemoUsers(count: number, id: number): DemoUser[] {
  return Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    email: `concurrency-demo-${id}-${index + 1}@example.com`
  }));
}

function countByError(results: RedemptionResult[]): Record<string, number> {
  return results
    .filter((result) => result.status !== 201)
    .reduce<Record<string, number>>((counts, result) => {
      const key = result.error ?? `HTTP_${result.status}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
}

function formatGrid(results: RedemptionResult[]): string {
  return results
    .sort((left, right) => left.index - right.index)
    .map((result) => {
      const marker = result.status === 201 ? "OK " : result.status === 409 ? "409" : String(result.status);
      return `${String(result.index).padStart(2, "0")}:${marker}`;
    })
    .reduce<string[]>((lines, cell, index) => {
      const lineIndex = Math.floor(index / 10);
      lines[lineIndex] = [lines[lineIndex], cell].filter(Boolean).join("  ");
      return lines;
    }, [])
    .join("\n");
}

function bar(value: number, total: number): string {
  const width = 40;
  const filled = total === 0 ? 0 : Math.round((value / total) * width);
  return `[${"#".repeat(filled)}${".".repeat(width - filled)}]`;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }

  return parsed;
}

await main();
