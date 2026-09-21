import { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { object, string } from "../../shared/validation.ts";
import { authenticate } from "../auth/middleware.ts";
import { visibleIncident } from "../incidents/service.ts";
import * as repository from "./repository.ts";

export function createCommentsRouter(deps: Deps): Router {
  const { pool } = deps;
  const router = Router();
  const authenticated = authenticate(deps);

  router.post(
    "/incidents/:id/comments",
    authenticated,
    async (req, res) => {
      const incident = await visibleIncident(pool, req.params.id, req.auth!);
      const body = string(object(req.body).body, "body", 1);

      res
        .status(201)
        .json(
          await repository.insert(pool, incident.id, req.auth!.userId, body),
        );
    },
  );

  router.get(
    "/incidents/:id/comments",
    authenticated,
    async (req, res) => {
      const incident = await visibleIncident(pool, req.params.id, req.auth!);
      res.json({ data: await repository.listByIncident(pool, incident.id) });
    },
  );

  return router;
}
