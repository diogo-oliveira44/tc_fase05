export type AppConfig = ReturnType<typeof loadConfig>;

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = env.NODE_ENV ?? "development";
  const jwtSecret =
    env.JWT_SECRET ??
    (nodeEnv === "production" ? "" : "development-only-change-me");
  if (jwtSecret.length < 24)
    throw new Error("JWT_SECRET must contain at least 24 characters");

  return {
    nodeEnv,
    port: integer(env.PORT, 3000, "PORT"),
    jwtSecret,
    accessTokenTtlSeconds: integer(
      env.ACCESS_TOKEN_TTL_SECONDS,
      900, // 15 seconds
      "ACCESS_TOKEN_TTL_SECONDS",
    ),
    refreshTokenTtlSeconds: integer(
      env.REFRESH_TOKEN_TTL_SECONDS,
      2_592_000, // 30 days
      "REFRESH_TOKEN_TTL_SECONDS",
    ),
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
    maxUploadBytes: integer(
      env.MAX_UPLOAD_BYTES,
      5_242_880, // 5mb
      "MAX_UPLOAD_BYTES",
    ),
    uploadDirectory: env.UPLOAD_DIRECTORY ?? "uploads",
    // An incident is "overdue" once it has spent longer than this in a non-final
    // status. The PDF leaves the SLA open, so it is configurable per priority.
    slaHours: {
      critical: integer(env.SLA_CRITICAL_HOURS, 24, "SLA_CRITICAL_HOURS"),
      high: integer(env.SLA_HIGH_HOURS, 72, "SLA_HIGH_HOURS"),
      medium: integer(env.SLA_MEDIUM_HOURS, 168, "SLA_MEDIUM_HOURS"),
      low: integer(env.SLA_LOW_HOURS, 360, "SLA_LOW_HOURS"),
    },
  };
}
