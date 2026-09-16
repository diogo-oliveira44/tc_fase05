import { Router } from "express";
import { AppError } from "../../shared/errors.ts";
import type { Deps } from "../../shared/http.ts";
import { object, string } from "../../shared/validation.ts";
import { authenticate } from "./middleware.ts";
import * as service from "./service.ts";

export function createAuthRouter(deps: Deps): Router {
  const { pool, config } = deps;
  const router = Router();

  router.post("/auth/register", async (req, res) => {
    const body = object(req.body);
    const name = string(body.name, "name", 2, 150);
    const email = string(body.email, "email", 3, 320).toLowerCase();

    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new AppError(422, "VALIDATION_ERROR", "email is invalid", [
        { field: "email" },
      ]);

    const password = string(body.password, "password", 8, 200);

    res.status(201).json(await service.register(pool, name, email, password));
  });

  router.post("/auth/login", async (req, res) => {
    const body = object(req.body);
    const email = string(body.email, "email").toLowerCase();
    const password = string(body.password, "password");

    res.json(await service.login(pool, config, email, password));
  });

  router.post("/auth/refresh", async (req, res) => {
    const refreshToken = string(object(req.body).refreshToken, "refreshToken");

    res.json(await service.refresh(pool, config, refreshToken));
  });

  router.post("/auth/logout", authenticate(deps), async (req, res) => {
    const refreshToken = string(object(req.body).refreshToken, "refreshToken");
    await service.logout(pool, req.auth!.userId, refreshToken);
    res.sendStatus(204);
  });

  return router;
}
