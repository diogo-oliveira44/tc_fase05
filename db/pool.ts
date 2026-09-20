import { Pool } from "pg";

export function createPool(env = process.env) {
  let database = env.POSTGRES_DB || "tc_db_dev";
  const secure = env.POSTGRES_SSL === "true";

  switch (env.NODE_ENV) {
    case "test":
      database = env.POSTGRES_TEST_DB || "tc_db_test";
      break;
    case "production":
      database = env.POSTGRES_PROD_DB || "tc_db_prod";
  }

  return new Pool({
    user: env.POSTGRES_USER || "postgres",
    password: env.POSTGRES_PASSWORD || "postgres",
    database,
    host: env.POSTGRES_HOST || "db",
    port: Number(env.POSTGRES_PORT || 5432),
    ssl: secure
      ? { rejectUnauthorized: env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined,
    max: Number(env.POSTGRES_POOL_MAX || 10),
    connectionTimeoutMillis: 10_000,
  });
}

export default createPool();
