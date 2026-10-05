import express, { Router } from "express";
import type { Deps } from "../../shared/http.ts";
import { authenticate } from "../auth/middleware.ts";
import { acceptedTypes } from "./images.ts";
import * as service from "./service.ts";

export function createAttachmentsRouter(deps: Deps): Router {
  const { pool, config } = deps;
  const router = Router();
  const authenticated = authenticate(deps);

  router.post(
    "/incidents/:id/attachments",
    // Ahead of authentication on purpose: an oversized body is rejected as 413
    // before it is buffered any further.
    express.raw({ type: acceptedTypes, limit: config.maxUploadBytes }),
    authenticated,
    async (req, res) => {
      const mime = String(req.headers["content-type"] ?? "").split(";")[0]!;
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      res
        .status(201)
        .json(
          await service.upload(
            pool,
            config,
            req.params.id,
            req.auth!,
            mime,
            data,
            req.headers["x-file-name"],
          ),
        );
    },
  );

  router.get("/incidents/:id/attachments", authenticated, async (req, res) =>
    res.json({ data: await service.list(pool, req.params.id, req.auth!) }),
  );

  router.get(
    "/incidents/:id/attachments/:attachmentId",
    authenticated,
    async (req, res) => {
      const { data, fileName, mimeType } = await service.download(
        pool,
        config,
        req.params.id,
        req.params.attachmentId,
        req.auth!,
      );

      res
        .type(mimeType)
        .setHeader(
          "content-disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        );
      res.send(data);
    },
  );

  return router;
}
