import { Router } from "express";
import { AppError } from "../../shared/errors.ts";
import type { Deps } from "../../shared/http.ts";
import {
  object,
  oneOf,
  optionalString,
  string,
  uuid,
} from "../../shared/validation.ts";
import { authenticate, requireManager } from "../auth/middleware.ts";
import { priorities, statuses } from "./domain.ts";
import * as repository from "./repository.ts";
import * as service from "./service.ts";

/** Every mutating route is optimistic: the client echoes the version it saw. */
function requiredVersion(body: Record<string, unknown>) {
  const version = Number(body.version);
  if (!Number.isInteger(version))
    throw new AppError(422, "VERSION_REQUIRED", "version is required");
  return version;
}

export function createIncidentsRouter(deps: Deps): Router {
  const { pool } = deps;
  const router = Router();
  const authenticated = authenticate(deps);

  router.post(
    "/incidents",
    authenticated,
    async (req, res) =>
      res.status(201).json(await service.create(pool, req.auth!, req.body)),
  );

  router.get(
    "/incidents",
    authenticated,
    async (req, res) => {
      const page = Math.max(
        1,
        Number.parseInt(String(req.query.page ?? "1")) || 1,
      );
      const pageSize = Math.min(
        100,
        Math.max(1, Number.parseInt(String(req.query.pageSize ?? "20")) || 20),
      );
      const filters = {
        // A requester never sees anyone else's incidents, whatever they filter by.
        requesterId:
          req.auth!.role === "requester" ? req.auth!.userId : undefined,
        status: req.query.status
          ? oneOf(req.query.status, statuses, "status")
          : undefined,
        priority: req.query.priority
          ? oneOf(req.query.priority, priorities, "priority")
          : undefined,
        categoryId: req.query.categoryId
          ? uuid(req.query.categoryId, "categoryId")
          : undefined,
        assigneeId: req.query.assigneeId
          ? uuid(req.query.assigneeId, "assigneeId")
          : undefined,
        createdFrom: req.query.createdFrom
          ? string(req.query.createdFrom, "createdFrom")
          : undefined,
        createdTo: req.query.createdTo
          ? string(req.query.createdTo, "createdTo")
          : undefined,
      };

      const { rows, total } = await repository.list(
        pool,
        filters,
        req.query.sort as string | undefined,
        page,
        pageSize,
      );

      res.json({
        data: rows,
        meta: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    },
  );

  router.get(
    "/incidents/:id",
    authenticated,
    async (req, res) =>
      res.json(await service.visibleIncident(pool, req.params.id, req.auth!)),
  );

  router.get(
    "/incidents/:id/history",
    authenticated,
    async (req, res) => {
      const incident = await service.visibleIncident(
        pool,
        req.params.id,
        req.auth!,
      );
      res.json({ data: await repository.history(pool, incident.id) });
    },
  );

  router.patch(
    "/incidents/:id/priority",
    authenticated,
    requireManager,
    async (req, res) => {
      const body = object(req.body);
      const priority = oneOf(body.priority, priorities, "priority");
      const reason = string(body.reason, "reason");

      res.json(
        await service.changePriority(pool, req.params.id, req.auth!, {
          priority,
          reason,
          version: requiredVersion(body),
        }),
      );
    },
  );

  router.patch(
    "/incidents/:id/assignee",
    authenticated,
    requireManager,
    async (req, res) => {
      const body = object(req.body);
      const assigneeId = uuid(body.assigneeId, "assigneeId");
      const reason = string(body.reason, "reason");

      res.json(
        await service.changeAssignee(pool, req.params.id, req.auth!, {
          assigneeId,
          reason,
          version: requiredVersion(body),
        }),
      );
    },
  );

  router.post(
    "/incidents/:id/transitions",
    authenticated,
    requireManager,
    async (req, res) => {
      const body = object(req.body);
      const to = oneOf(body.to, statuses, "to");
      const observation = optionalString(body.observation, "observation");
      const solution = optionalString(body.solution, "solution");

      res.json(
        await service.transition(pool, req.params.id, req.auth!, {
          to,
          observation,
          solution,
          version: requiredVersion(body),
        }),
      );
    },
  );

  return router;
}
