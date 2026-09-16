import app from "./app.ts";
import pool from "../db/pool.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const server = app.listen(config.port);

async function shutdown() {
  server.close(async () => {
    await pool.end();

    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

// Fix CTRL+C to stop server entirely
process.once("SIGTERM", () => void shutdown());
// Avoid the problem with deployment to azure
process.once("SIGINT", () => void shutdown());
