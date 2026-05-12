import Fastify from "fastify";
import { registerErrorHandler } from "./errors.js";
import { pool } from "./db.js";
import { registerCouponRoutes } from "./modules/coupons/coupon.routes.js";

export function buildApp() {
  const app = Fastify({
    logger: true
  });

  registerErrorHandler(app);

  app.get("/health", async () => {
    const result = await pool.query({ text: "SELECT 1 AS ok" });
    return {
      status: "ok",
      database: result.rows[0].ok === 1 ? "ok" : "unknown"
    };
  });

  app.register(registerCouponRoutes);

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
