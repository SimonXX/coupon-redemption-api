import { FastifyInstance } from "fastify";
import {
  createCouponBodySchema,
  listCouponsQuerySchema,
  redeemCouponBodySchema,
  redeemCouponParamsSchema
} from "./coupon.schemas.js";
import { createCoupon, listCoupons, redeemCoupon } from "./coupon.service.js";

export async function registerCouponRoutes(app: FastifyInstance): Promise<void> {
  app.get("/coupons", async (request) => {
    const query = listCouponsQuerySchema.parse(request.query);
    return listCoupons(query);
  });

  app.post("/coupons", async (request, reply) => {
    const body = createCouponBodySchema.parse(request.body);
    const result = await createCoupon(body);
    return reply.status(201).send(result);
  });

  app.post("/coupons/:code/redeem", async (request, reply) => {
    const params = redeemCouponParamsSchema.parse(request.params);
    const body = redeemCouponBodySchema.parse(request.body);
    const result = await redeemCoupon(params.code, body);
    return reply.status(201).send(result);
  });
}
