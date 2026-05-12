import { z } from "zod";

const statusSchema = z.enum(["available", "not-available"]);

const nullableLimitSchema = z
  .number()
  .int()
  .min(0)
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const nullableDateSchema = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((value) => (value === undefined ? null : value));

export const listCouponsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10)
});

export const createCouponBodySchema = z
  .object({
    campaign: z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().min(1).nullable().optional(),
      status: statusSchema,
      startTimestamp: z.string().datetime(),
      endTimestamp: z.string().datetime(),
      maxRedemptions: nullableLimitSchema
    }),
    coupon: z.object({
      code: z.string().trim().min(1),
      status: statusSchema,
      expirationTimestamp: nullableDateSchema,
      maxRedemptions: nullableLimitSchema
    })
  })
  .refine(
    (payload) =>
      new Date(payload.campaign.endTimestamp).getTime() >=
      new Date(payload.campaign.startTimestamp).getTime(),
    {
      message: "campaign.endTimestamp must be greater than or equal to campaign.startTimestamp",
      path: ["campaign", "endTimestamp"]
    }
  );

export const redeemCouponParamsSchema = z.object({
  code: z.string().trim().min(1)
});

export const redeemCouponBodySchema = z.object({
  userId: z.string().uuid()
});

export type ListCouponsQuery = z.infer<typeof listCouponsQuerySchema>;
export type CreateCouponBody = z.infer<typeof createCouponBodySchema>;
export type RedeemCouponBody = z.infer<typeof redeemCouponBodySchema>;
