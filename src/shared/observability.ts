import type { RequestHandler } from "express";

export const requestCorrelation: RequestHandler = (req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

// Only to help debug
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();
  res.on("finish", () =>
    console.log(
      JSON.stringify({
        event: "request",
        requestId: req.requestId,
        method: req.method,
        path: req.route?.path ? req.baseUrl + req.route.path : req.path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    ),
  );

  next();
};
