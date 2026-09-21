import { AppError } from "../../shared/errors.ts";
import { register } from "../auth/service.ts";
import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { object, string, oneOf } from "../../shared/validation.ts";
import {
  authenticate,
  requireManager,
  requireAdmin,
} from "../auth/middleware.ts";
import * as repository from "./repository.ts";

export function createUsersRouter(deps: Deps): Router {
  const { pool } = deps;
  const router = Router();

  router.get("/me", authenticate(deps), async (req, res) =>
    res.json(await repository.findById(pool, req.auth!.userId)),
  );

  router.get(
    "/users",
    authenticate(deps),
    (req, res, next) =>
      req.auth?.role === "admin" ? next() : requireManager(req, res, next),
    async (req, res) => {
      const role = req.query.role
        ? oneOf(
            req.query.role,
            ["requester", "manager", "admin"] as const,
            "role",
          )
        : undefined;

      res.json({ data: await repository.listActive(pool, role) });
    },
  );

  router.post(
    "/users/managers",
    authenticate(deps),
    requireAdmin,
    async (req, res) => {
      const body = object(req.body);
      const name = string(body.name, "name", 2, 150);
      const email = string(body.email, "email", 3, 320).toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email))
        throw new AppError(422, "VALIDATION_ERROR", "email is invalid", [
          { field: "email" },
        ]);
      const password = string(body.password, "password", 8, 200);
      res
        .status(201)
        .json(await register(pool, name, email, password, "manager"));
    },
  );

  return router;
}
