import pg from "pg";
import { AppError } from "../../errors.js";
import { DbClient, pool, withTransaction } from "../../db.js";
import { CreateCouponBody, ListCouponsQuery, RedeemCouponBody } from "./coupon.schemas.js";

type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  status: "available" | "not-available";
  start_timestamp: Date;
  end_timestamp: Date;
  max_redemptions: number | null;
  redemptions_count: number;
  created_at: Date;
  updated_at: Date;
};

type CouponRow = {
  id: string;
  code: string;
  status: "available" | "not-available";
  expiration_timestamp: Date | null;
  max_redemptions: number | null;
  redemptions_count: number;
  campaign_id: string;
  created_at: Date;
  updated_at: Date;
};

type CouponWithCampaignRow = {
  coupon_id: string;
  coupon_code: string;
  coupon_status: "available" | "not-available";
  coupon_expiration_timestamp: Date | null;
  coupon_max_redemptions: number | null;
  coupon_redemptions_count: number;
  coupon_created_at: Date;
  coupon_updated_at: Date;
  campaign_id: string;
  campaign_name: string;
  campaign_description: string | null;
  campaign_status: "available" | "not-available";
  campaign_start_timestamp: Date;
  campaign_end_timestamp: Date;
  campaign_max_redemptions: number | null;
  campaign_redemptions_count: number;
  campaign_created_at: Date;
  campaign_updated_at: Date;
};

type CountRow = {
  total: string;
};

type UserRow = {
  id: string;
};

type RedemptionRow = {
  id: string;
  user_id: string;
  coupon_id: string;
  redeemed_at: Date;
};

export async function listCoupons(query: ListCouponsQuery) {
  const now = new Date();
  const offset = (query.page - 1) * query.pageSize;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<CouponWithCampaignRow>({
      name: "list_available_coupons",
      text: `
        SELECT
          coupons.id AS coupon_id,
          coupons.code AS coupon_code,
          coupons.status AS coupon_status,
          coupons.expiration_timestamp AS coupon_expiration_timestamp,
          coupons.max_redemptions AS coupon_max_redemptions,
          coupons.redemptions_count AS coupon_redemptions_count,
          coupons.created_at AS coupon_created_at,
          coupons.updated_at AS coupon_updated_at,
          campaigns.id AS campaign_id,
          campaigns.name AS campaign_name,
          campaigns.description AS campaign_description,
          campaigns.status AS campaign_status,
          campaigns.start_timestamp AS campaign_start_timestamp,
          campaigns.end_timestamp AS campaign_end_timestamp,
          campaigns.max_redemptions AS campaign_max_redemptions,
          campaigns.redemptions_count AS campaign_redemptions_count,
          campaigns.created_at AS campaign_created_at,
          campaigns.updated_at AS campaign_updated_at
        FROM coupons
        INNER JOIN campaigns ON campaigns.id = coupons.campaign_id
        WHERE campaigns.status = 'available'
          AND coupons.status = 'available'
          AND campaigns.end_timestamp >= $1
          AND (
            coupons.expiration_timestamp IS NULL
            OR coupons.expiration_timestamp >= $1
          )
        ORDER BY campaigns.start_timestamp ASC, coupons.code ASC, coupons.id ASC
        LIMIT $2 OFFSET $3
      `,
      values: [now, query.pageSize, offset]
    }),
    pool.query<CountRow>({
      name: "count_available_coupons",
      text: `
        SELECT count(*) AS total
        FROM coupons
        INNER JOIN campaigns ON campaigns.id = coupons.campaign_id
        WHERE campaigns.status = 'available'
          AND coupons.status = 'available'
          AND campaigns.end_timestamp >= $1
          AND (
            coupons.expiration_timestamp IS NULL
            OR coupons.expiration_timestamp >= $1
          )
      `,
      values: [now]
    })
  ]);

  return {
    page: query.page,
    pageSize: query.pageSize,
    total: Number(countResult.rows[0]?.total ?? 0),
    items: itemsResult.rows.map(mapCouponWithCampaign)
  };
}

export async function createCoupon(payload: CreateCouponBody) {
  return withTransaction(async (client) => {
    const campaign = await findOrCreateCampaign(client, payload);
    ensureCampaignIsNotExpired(campaign);

    try {
      const couponResult = await client.query<CouponRow>({
        name: "create_coupon",
        text: `
          INSERT INTO coupons (
            code,
            status,
            expiration_timestamp,
            max_redemptions,
            campaign_id
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING *
        `,
        values: [
          payload.coupon.code,
          payload.coupon.status,
          payload.coupon.expirationTimestamp,
          payload.coupon.maxRedemptions,
          campaign.id
        ]
      });

      return {
        campaign: mapCampaign(campaign),
        coupon: mapCoupon(couponResult.rows[0])
      };
    } catch (error) {
      if (isUniqueViolation(error, "coupons_code_unique")) {
        throw new AppError(409, "COUPON_ALREADY_EXISTS", "Coupon code already exists");
      }

      throw error;
    }
  });
}

export async function redeemCoupon(code: string, payload: RedeemCouponBody) {
  return withTransaction(async (client) => {
    const userResult = await client.query<UserRow>({
      name: "find_user_for_redemption",
      text: "SELECT id FROM users WHERE id = $1",
      values: [payload.userId]
    });

    if (userResult.rowCount === 0) {
      throw new AppError(404, "USER_NOT_FOUND", "User does not exist");
    }

    const lockedCouponResult = await client.query<CouponWithCampaignRow>({
      name: "lock_coupon_and_campaign_for_redemption",
      text: `
        SELECT
          coupons.id AS coupon_id,
          coupons.code AS coupon_code,
          coupons.status AS coupon_status,
          coupons.expiration_timestamp AS coupon_expiration_timestamp,
          coupons.max_redemptions AS coupon_max_redemptions,
          coupons.redemptions_count AS coupon_redemptions_count,
          coupons.created_at AS coupon_created_at,
          coupons.updated_at AS coupon_updated_at,
          campaigns.id AS campaign_id,
          campaigns.name AS campaign_name,
          campaigns.description AS campaign_description,
          campaigns.status AS campaign_status,
          campaigns.start_timestamp AS campaign_start_timestamp,
          campaigns.end_timestamp AS campaign_end_timestamp,
          campaigns.max_redemptions AS campaign_max_redemptions,
          campaigns.redemptions_count AS campaign_redemptions_count,
          campaigns.created_at AS campaign_created_at,
          campaigns.updated_at AS campaign_updated_at
        FROM coupons
        INNER JOIN campaigns ON campaigns.id = coupons.campaign_id
        WHERE coupons.code = $1
        FOR UPDATE OF coupons, campaigns
      `,
      values: [code]
    });

    if (lockedCouponResult.rowCount === 0) {
      throw new AppError(404, "COUPON_NOT_FOUND", "Coupon does not exist");
    }

    const row = lockedCouponResult.rows[0];
    validateRedeemable(row);

    const existingRedemptionResult = await client.query({
      name: "find_existing_redemption",
      text: `
        SELECT 1
        FROM redemptions
        WHERE user_id = $1 AND coupon_id = $2
        LIMIT 1
      `,
      values: [payload.userId, row.coupon_id]
    });

    if (existingRedemptionResult.rowCount !== null && existingRedemptionResult.rowCount > 0) {
      throw new AppError(
        409,
        "COUPON_ALREADY_REDEEMED",
        "User already redeemed this coupon"
      );
    }

    try {
      const redemptionResult = await client.query<RedemptionRow>({
        name: "insert_redemption",
        text: `
          INSERT INTO redemptions (user_id, coupon_id)
          VALUES ($1, $2)
          RETURNING *
        `,
        values: [payload.userId, row.coupon_id]
      });

      await client.query({
        name: "increment_coupon_redemption_count",
        text: `
          UPDATE coupons
          SET redemptions_count = redemptions_count + 1
          WHERE id = $1
        `,
        values: [row.coupon_id]
      });

      await client.query({
        name: "increment_campaign_redemption_count",
        text: `
          UPDATE campaigns
          SET redemptions_count = redemptions_count + 1
          WHERE id = $1
        `,
        values: [row.campaign_id]
      });

      return {
        redemption: {
          id: redemptionResult.rows[0].id,
          userId: redemptionResult.rows[0].user_id,
          couponId: redemptionResult.rows[0].coupon_id,
          redeemedAt: redemptionResult.rows[0].redeemed_at
        }
      };
    } catch (error) {
      if (isUniqueViolation(error, "redemptions_user_coupon_unique")) {
        throw new AppError(
          409,
          "COUPON_ALREADY_REDEEMED",
          "User already redeemed this coupon"
        );
      }

      throw error;
    }
  });
}

async function findOrCreateCampaign(client: DbClient, payload: CreateCouponBody) {
  const insertedCampaignResult = await client.query<CampaignRow>({
    name: "insert_campaign_if_absent",
    text: `
      INSERT INTO campaigns (
        name,
        description,
        status,
        start_timestamp,
        end_timestamp,
        max_redemptions
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `,
    values: [
      payload.campaign.name,
      payload.campaign.description ?? null,
      payload.campaign.status,
      payload.campaign.startTimestamp,
      payload.campaign.endTimestamp,
      payload.campaign.maxRedemptions
    ]
  });

  if (insertedCampaignResult.rows[0]) {
    return insertedCampaignResult.rows[0];
  }

  const existingCampaignResult = await client.query<CampaignRow>({
    name: "find_campaign_by_name",
    text: "SELECT * FROM campaigns WHERE name = $1",
    values: [payload.campaign.name]
  });

  if (!existingCampaignResult.rows[0]) {
    throw new AppError(500, "CAMPAIGN_LOOKUP_FAILED", "Campaign lookup failed");
  }

  return existingCampaignResult.rows[0];
}

function validateRedeemable(row: CouponWithCampaignRow): void {
  const now = Date.now();

  if (row.coupon_status !== "available") {
    throw new AppError(409, "COUPON_NOT_AVAILABLE", "Coupon is not available");
  }

  if (row.campaign_status !== "available") {
    throw new AppError(409, "CAMPAIGN_NOT_AVAILABLE", "Campaign is not available");
  }

  if (row.campaign_start_timestamp.getTime() > now) {
    throw new AppError(409, "CAMPAIGN_NOT_STARTED", "Campaign is not started yet");
  }

  if (row.campaign_end_timestamp.getTime() < now) {
    throw new AppError(409, "CAMPAIGN_EXPIRED", "Campaign is expired");
  }

  if (
    row.coupon_expiration_timestamp !== null &&
    row.coupon_expiration_timestamp.getTime() < now
  ) {
    throw new AppError(409, "COUPON_EXPIRED", "Coupon is expired");
  }

  if (
    row.coupon_max_redemptions !== null &&
    row.coupon_redemptions_count >= row.coupon_max_redemptions
  ) {
    throw new AppError(409, "COUPON_REDEMPTION_LIMIT_REACHED", "Coupon limit reached");
  }

  if (
    row.campaign_max_redemptions !== null &&
    row.campaign_redemptions_count >= row.campaign_max_redemptions
  ) {
    throw new AppError(
      409,
      "CAMPAIGN_REDEMPTION_LIMIT_REACHED",
      "Campaign limit reached"
    );
  }
}

function ensureCampaignIsNotExpired(campaign: CampaignRow): void {
  if (campaign.end_timestamp.getTime() < Date.now()) {
    throw new AppError(409, "CAMPAIGN_EXPIRED", "Campaign is expired");
  }
}

function mapCouponWithCampaign(row: CouponWithCampaignRow) {
  return {
    id: row.coupon_id,
    code: row.coupon_code,
    status: row.coupon_status,
    expirationTimestamp: row.coupon_expiration_timestamp,
    maxRedemptions: row.coupon_max_redemptions,
    redemptionsCount: row.coupon_redemptions_count,
    createdAt: row.coupon_created_at,
    updatedAt: row.coupon_updated_at,
    campaign: {
      id: row.campaign_id,
      name: row.campaign_name,
      description: row.campaign_description,
      status: row.campaign_status,
      startTimestamp: row.campaign_start_timestamp,
      endTimestamp: row.campaign_end_timestamp,
      maxRedemptions: row.campaign_max_redemptions,
      redemptionsCount: row.campaign_redemptions_count,
      createdAt: row.campaign_created_at,
      updatedAt: row.campaign_updated_at
    }
  };
}

function mapCampaign(row: CampaignRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    startTimestamp: row.start_timestamp,
    endTimestamp: row.end_timestamp,
    maxRedemptions: row.max_redemptions,
    redemptionsCount: row.redemptions_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCoupon(row: CouponRow) {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    expirationTimestamp: row.expiration_timestamp,
    maxRedemptions: row.max_redemptions,
    redemptionsCount: row.redemptions_count,
    campaignId: row.campaign_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pgError = error as pg.DatabaseError;
  return pgError.code === "23505" && pgError.constraint === constraint;
}
