import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../../shared/errors.ts";
import type { Deps } from "../../shared/http.ts";
import { verifyAccessToken } from "../../shared/tokens.ts";
import { isActive } from "./repository.ts";

/** Rejects anything without a live access token belonging to an active user. */
export const authenticate =
  ({ pool, config }: Deps): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    void (async () => {
      const match = req.headers.authorization?.match(/^Bearer (.+)$/);

      if (!match)
        throw new AppError(
          401,
          "AUTHENTICATION_REQUIRED",
          "A bearer token is required",
        );

      try {
        const payload = await verifyAccessToken(match[1]!, config.jwtSecret);

        if (!(await isActive(pool, payload.sub))) throw new Error("inactive");

        req.auth = { userId: payload.sub, role: payload.role };
      } catch (error) {
        if (error instanceof AppError) throw error;

        throw new AppError(
          401,
          "INVALID_ACCESS_TOKEN",
          "The access token is invalid",
        );
      }

      next();
    })().catch(next);
  };

export const requireManager: RequestHandler = (req, _res, next) => {
  if (req.auth?.role !== "manager")
    return next(
      new AppError(403, "MANAGER_REQUIRED", "Manager access is required"),
    );

  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.auth?.role !== "admin")
    return next(
      new AppError(403, "ADMIN_REQUIRED", "Admin access is required"),
    );
  next();
};
