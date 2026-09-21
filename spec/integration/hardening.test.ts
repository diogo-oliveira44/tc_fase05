import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  resetDatabase,
  send,
  startServerWith,
  startTestServer,
} from "../support/server.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("request correlation", () => {
  it("tags every response with a request id", async () => {
    const response = await send("/health");

    const id = response.headers.get("x-request-id");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("repeats that id inside the error envelope, so a log line can be found", async () => {
    const response = await send("/api/v1/me");
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("gives each request its own id", async () => {
    const first = await send("/health");
    const second = await send("/health");

    expect(first.headers.get("x-request-id")).not.toBe(
      second.headers.get("x-request-id"),
    );
  });
});

describe("security headers", () => {
  it("sets the baseline headers on every response", async () => {
    const response = await send("/health");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("upload limits", () => {
  it("honours a smaller configured payload limit", async () => {
    const strict = await startServerWith({ MAX_UPLOAD_BYTES: "1024" });

    const registered = await strict.api("/auth/register", {
      body: {
        name: "Limite Estrito",
        email: `strict-${Date.now()}@resolveai.test`,
        password: "senha-de-teste",
      },
    });
    expect(registered.status).toBe(201);

    const session = await strict.api("/auth/login", {
      body: { email: registered.body.email, password: "senha-de-teste" },
    });
    const categories = await strict.api("/categories", {
      token: session.body.accessToken,
    });
    const incident = await strict.api("/incidents", {
      token: session.body.accessToken,
      body: {
        categoryId: categories.body.data[0].id,
        title: "Ocorrência com imagem grande",
        description: "Testando o limite de upload",
        address: "Rua das Flores, 100",
      },
    });

    const response = await strict.api(
      `/incidents/${incident.body.id}/attachments`,
      {
        token: session.body.accessToken,
        method: "POST",
        raw: new Uint8Array(Buffer.alloc(4096)),
        headers: { "content-type": "image/png" },
      },
    );

    expect(response.status).toBe(413);
  });
});
