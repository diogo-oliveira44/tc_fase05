import { api, testPool as pool } from "./server.ts";

export interface Incident {
  id: string;
  version: number;
  status: "open" | "under_review" | "in_progress" | "resolved" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  requesterId: string;
  assigneeId: string | null;
  categoryId: string;
  categoryName: string;
  title: string;
  solution: string | null;
  resolvedAt: string | null;
}

export interface Actor {
  id: string;
  name: string;
  email: string;
  password: string;
  role: "requester" | "manager";
  accessToken: string;
  refreshToken: string;
}

let sequence = 0;
const uniqueEmail = (prefix: string) =>
  `${prefix}-${++sequence}-${Date.now()}@resolveai.test`;

async function login(email: string, password: string) {
  const response = await api("/auth/login", { body: { email, password } });
  if (response.status !== 200)
    throw new Error(`login failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function createRequester(
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<Actor> {
  const name = overrides.name ?? "Solicitante de Teste";
  const email = (overrides.email ?? uniqueEmail("requester")).toLowerCase();
  const password = overrides.password ?? "requester-password";

  const registered = await api("/auth/register", {
    body: { name, email, password },
  });
  if (registered.status !== 201)
    throw new Error(`register failed: ${JSON.stringify(registered.body)}`);

  const session = await login(email, password);
  return {
    id: registered.body.id,
    name,
    email,
    password,
    role: "requester",
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}

// Managers are never created by the public API — the real system seeds them (db/seed.ts).
export async function createManager(
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<Actor> {
  const name = overrides.name ?? "Gestor de Teste";
  const email = (overrides.email ?? uniqueEmail("manager")).toLowerCase();
  const password = overrides.password ?? "manager-password";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });

  const result = await pool.query(
    "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'manager') RETURNING id",
    [name, email, hash],
  );

  const session = await login(email, password);
  return {
    id: result.rows[0].id,
    name,
    email,
    password,
    role: "manager",
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}

export async function firstCategoryId(actor: Actor): Promise<string> {
  const response = await api("/categories", { token: actor.accessToken });
  if (response.status !== 200)
    throw new Error(`categories failed: ${JSON.stringify(response.body)}`);
  return response.body.data[0].id;
}

export async function createIncident(
  actor: Actor,
  overrides: Record<string, unknown> = {},
): Promise<Incident> {
  const categoryId =
    (overrides.categoryId as string) ?? (await firstCategoryId(actor));
  const response = await api("/incidents", {
    token: actor.accessToken,
    body: {
      categoryId,
      title: "Lâmpada queimada no corredor",
      description: "A lâmpada do segundo andar está queimada há três dias.",
      address: "Rua das Flores, 100",
      ...overrides,
    },
  });
  if (response.status !== 201)
    throw new Error(
      `incident creation failed: ${JSON.stringify(response.body)}`,
    );
  return response.body;
}

export async function advanceTo(
  manager: Actor,
  incident: { id: string; version: number },
  target: "under_review" | "in_progress" | "resolved" | "cancelled",
): Promise<Incident> {
  const path: Record<string, string[]> = {
    under_review: ["under_review"],
    in_progress: ["under_review", "in_progress"],
    resolved: ["under_review", "in_progress", "resolved"],
    cancelled: ["cancelled"],
  };

  let current = incident as Incident;
  for (const to of path[target]!) {
    const response = await api(`/incidents/${current.id}/transitions`, {
      token: manager.accessToken,
      body: {
        to,
        version: current.version,
        ...(to === "cancelled" ? { observation: "Cancelada pelo gestor" } : {}),
        ...(to === "resolved" ? { solution: "Lâmpada substituída" } : {}),
      },
    });
    if (response.status !== 200)
      throw new Error(
        `transition to ${to} failed: ${JSON.stringify(response.body)}`,
      );
    current = response.body;
  }
  return current;
}

// Minimal image headers used as upload payloads in integration tests.
export const images = {
  jpeg: Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]),
  png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  webp: Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x1a, 0, 0, 0]),
    Buffer.from("WEBP"),
    Buffer.from("VP8 "),
  ]),
};
