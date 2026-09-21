import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { authenticate } from "../auth/middleware.ts";
import * as repository from "./repository.ts";

export function createCategoriesRouter(deps: Deps): Router {
  const router = Router();

  router.get(
    "/categories",
    authenticate(deps),
    async (_req, res) =>
      res.json({ data: await repository.listActive(deps.pool) }),
  );

  return router;
}
