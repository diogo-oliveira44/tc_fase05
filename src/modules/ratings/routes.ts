import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { authenticate } from "../auth/middleware.ts";
import * as service from "./service.ts";

export function createRatingsRouter(deps: Deps): Router {
  const { pool } = deps;
  const router = Router();
  const authenticated = authenticate(deps);

  router.post(
    "/incidents/:id/rating",
    authenticated,
    async (req, res) =>
      res
        .status(201)
        .json(await service.rate(pool, req.params.id, req.auth!, req.body)),
  );

  router.get(
    "/incidents/:id/rating",
    authenticated,
    async (req, res) =>
      res.json(await service.find(pool, req.params.id, req.auth!)),
  );

  return router;
}
