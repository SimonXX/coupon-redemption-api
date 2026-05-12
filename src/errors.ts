import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

type PgError = Error & {
  code?: string;
  constraint?: string;
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    async (
      error: FastifyError | AppError | ZodError | PgError,
      _request: FastifyRequest,
      reply: FastifyReply
    ) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: error.code,
          message: error.message
        });
      }

      if (error instanceof ZodError) {
        return reply.status(400).send({
          error: "VALIDATION_ERROR",
          message: "Invalid request payload",
          issues: error.issues
        });
      }

      if ("code" in error && error.code === "23505") {
        return reply.status(409).send({
          error: "CONFLICT",
          message: "A unique database constraint was violated"
        });
      }

      if ("code" in error && error.code === "23503") {
        return reply.status(400).send({
          error: "FOREIGN_KEY_VIOLATION",
          message: "A referenced resource does not exist"
        });
      }

      if ("code" in error && error.code === "23514") {
        return reply.status(400).send({
          error: "CHECK_CONSTRAINT_VIOLATION",
          message: "A database check constraint was violated"
        });
      }

      app.log.error(error);

      return reply.status(500).send({
        error: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error"
      });
    }
  );
}
