import { beforeAll, describe, expect, it } from "bun:test";
import { api, send, startTestServer } from "../support/server.ts";

beforeAll(startTestServer);

describe("service endpoints", () => {
  it("reports the API and the database in /health", async () => {
    for (const path of ["/health", "/api/v1/health"]) {
      const response = await api(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok", database: "up" });
    }
  });

  it("publishes the OpenAPI contract and the Swagger page", async () => {
    const contract = await api("/openapi.json");
    expect(contract.status).toBe(200);
    expect(contract.body.openapi).toStartWith("3.");
    expect(Object.keys(contract.body.paths).length).toBeGreaterThan(0);

    const docs = await send("/docs");
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("swagger-ui");
  });

  it("answers an unknown route with the standard error envelope", async () => {
    const response = await api("/nao-existe");

    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NOT_FOUND" });
    expect(response.body.error.message).toBeString();
  });

  it("rejects a malformed JSON body", async () => {
    const response = await api("/auth/login", {
      method: "POST",
      raw: "{nao-e-json",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });
});

describe("CORS", () => {
  it("allows the methods and headers the frontend actually uses", async () => {
    const response = await send("/api/v1/incidents", { method: "OPTIONS" });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "PATCH",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "X-File-Name",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "Authorization",
    );
  });

  it("announces the configured origin instead of a wildcard", async () => {
    const { config } = await startTestServer();

    const response = await send("/health");

    expect(response.headers.get("access-control-allow-origin")).toBe(
      config.corsOrigin,
    );
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("vary")).toContain("Origin");
  });
});
