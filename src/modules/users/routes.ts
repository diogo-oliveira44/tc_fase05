import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { oneOf } from "../../shared/validation.ts";
import { authenticate, requireManager } from "../auth/middleware.ts";
import * as repository from "./repository.ts";

export function createUsersRouter(deps: Deps): Router {
  const { pool } = deps;
  const router = Router();

  router.get(
    "/me",
    authenticate(deps),
    async (req, res) =>
      res.json(await repository.findById(pool, req.auth!.userId)),
  );

  router.get(
    "/users",
    authenticate(deps),
    requireManager,
    async (req, res) => {
      const role = req.query.role
        ? oneOf(req.query.role, ["requester", "manager"] as const, "role")
        : undefined;

      res.json({ data: await repository.listActive(pool, role) });
    },
  );

  return router;
}
