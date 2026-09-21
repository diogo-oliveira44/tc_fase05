import express from "express";
import type { Pool } from "pg";
import defaultPool from "../db/pool.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { errorHandler, notFound } from "./shared/errors.ts";
import { cors, securityHeaders, type Deps } from "./shared/http.ts";
import { requestLogger } from "./shared/observability.ts";
import { createAttachmentsRouter } from "./modules/attachments/routes.ts";
import { createAuthRouter } from "./modules/auth/routes.ts";
import { createCategoriesRouter } from "./modules/categories/routes.ts";
import { createCommentsRouter } from "./modules/comments/routes.ts";
import { createDashboardRouter } from "./modules/dashboard/routes.ts";
import { createIncidentsRouter } from "./modules/incidents/routes.ts";
import { createRatingsRouter } from "./modules/ratings/routes.ts";
import { createUsersRouter } from "./modules/users/routes.ts";
import {
  createDiscoveryRouter,
  createHealthHandler,
  createHealthRouter,
} from "./modules/platform/routes.ts";

const prefix = "/api/v1";

export function createApp(
  pool: Pool = defaultPool,
  config: AppConfig = loadConfig(),
) {
  const deps: Deps = { pool, config };
  const app = express();

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(cors(config));
  app.use(express.json());

  app.get("/health", createHealthHandler(deps));
  app.use(createDiscoveryRouter());

  for (const router of [
    createHealthRouter(deps),
    createAuthRouter(deps),
    createUsersRouter(deps),
    createCategoriesRouter(deps),
    createIncidentsRouter(deps),
    createCommentsRouter(deps),
    createAttachmentsRouter(deps),
    createRatingsRouter(deps),
    createDashboardRouter(deps),
  ])
  app.use(prefix, router);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp();
