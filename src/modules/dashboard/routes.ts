import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { string } from "../../shared/validation.ts";
import { authenticate, requireManager } from "../auth/middleware.ts";
import * as repository from "./repository.ts";

export function createDashboardRouter(deps: Deps): Router {
  const { pool, config } = deps;
  const router = Router();

  router.get(
    "/dashboard/summary",
    authenticate(deps),
    requireManager,
    async (req, res) =>
      res.json(
        await repository.summary(
          pool,
          {
            createdFrom: req.query.createdFrom
              ? string(req.query.createdFrom, "createdFrom")
              : undefined,
            createdTo: req.query.createdTo
              ? string(req.query.createdTo, "createdTo")
              : undefined,
          },
          config.slaHours,
        ),
      ),
  );

  return router;
}
