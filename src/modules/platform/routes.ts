import { Router, type RequestHandler } from "express";
import type { Deps } from "../../shared/http.ts";

/** Reports the process and the database; mounted both at the root and under the API prefix. */
export const createHealthHandler = ({ pool }: Deps): RequestHandler =>
  async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  };

/** The OpenAPI contract and the Swagger UI that renders it. */
export function createDiscoveryRouter(): Router {
  const router = Router();

  router.get("/openapi.json", (_req, res) =>
    res.sendFile("openapi.json", { root: process.cwd() }),
  );
  router.get("/docs", (_req, res) =>
    res
      .type("html")
      .send(
        `<!doctype html><title>Resolve Aí API</title><div id="swagger-ui"></div><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"><script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui'})</script>`,
      ),
  );

  return router;
}

/** Carries the health check into the versioned API without a second mount level. */
export function createHealthRouter(deps: Deps): Router {
  const router = Router();
  router.get("/health", createHealthHandler(deps));
  return router;
}
