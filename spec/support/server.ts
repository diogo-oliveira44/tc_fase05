import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { createPool } from "../../db/pool.ts";
import { migrate } from "../../db/migrate.ts";
import { ensureTestDatabase } from "../db/test-database.ts";
import { createApp } from "../../src/app.ts";
import { loadConfig, type AppConfig } from "../../src/config.ts";

// A dedicated pool: spec/db ends its own, and `bun test` shares one process.
export const testPool = createPool();

let boot:
  | Promise<{ baseUrl: string; uploadDirectory: string; config: AppConfig }>
  | undefined;

async function start(env: Record<string, string> = {}) {
  await ensureTestDatabase();
  await migrate(testPool);

  const uploadDirectory = await mkdtemp(path.join(tmpdir(), "resolveai-spec-"));
  const config = loadConfig({
    ...process.env,
    UPLOAD_DIRECTORY: uploadDirectory,
    ...env,
  });
  const server: Server = createApp(testPool, config).listen(0);
  await once(server, "listening");
  // Keeps `bun test` from hanging on the listening socket once the specs finish.
  server.unref();

  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, uploadDirectory, config };
}

export function startTestServer() {
  boot ??= start();
  return boot;
}

/** A second app with its own configuration, for specs that need different limits. */
export async function startServerWith(env: Record<string, string>) {
  const { baseUrl } = await start(env);
  const call = (path: string, options: ApiOptions = {}) =>
    api(path, { ...options, baseUrl });
  return { baseUrl, api: call };
}

export async function clearUploads() {
  const { uploadDirectory } = await startTestServer();
  await rm(uploadDirectory, { recursive: true, force: true });
}

const truncated = [
  "users",
  "refresh_tokens",
  "incidents",
  "comments",
  "attachments",
  "status_history",
  "assignment_history",
  "priority_history",
  "ratings",
];

export async function resetDatabase() {
  await startTestServer();
  // The append-only triggers are FOR EACH ROW on UPDATE/DELETE, so TRUNCATE bypasses them.
  await testPool.query(
    `TRUNCATE ${truncated.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export interface ApiOptions {
  baseUrl?: string;
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
  raw?: BodyInit;
  query?: Record<string, string | number | undefined>;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function send(
  path: string,
  options: ApiOptions = {},
): Promise<Response> {
  const baseUrl = options.baseUrl ?? (await startTestServer()).baseUrl;
  // Routes outside the versioned prefix are addressed as-is.
  const rootPaths = ["/health", "/docs", "/openapi.json"];
  const absolute =
    path.startsWith("/api") || rootPaths.includes(path.split("?")[0]!);
  const url = new URL(absolute ? path : `/api/v1${path}`, baseUrl);

  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined) url.searchParams.set(key, String(value));

  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
  } else if (options.body !== undefined) {
    headers["content-type"] ??= "application/json";
    body = JSON.stringify(options.body);
  }

  return fetch(url, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
}

export async function api<T = any>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const response = await send(path, options);
  const text = await response.text();
  let parsed: unknown = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    status: response.status,
    body: parsed as T,
    headers: response.headers,
  };
}
