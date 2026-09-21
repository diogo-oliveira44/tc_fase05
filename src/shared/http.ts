import type { RequestHandler } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../config.ts";

export interface Deps {
  pool: Pool;
  config: AppConfig;
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
};

export const cors =
  (config: AppConfig): RequestHandler =>
    (req, res, next) => {
      res.header("Access-Control-Allow-Origin", config.corsOrigin);
      res.header("Vary", "Origin");
      res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-File-Name",
      );

      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      );

      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }

      next();
    };
