import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { api, resetDatabase, startTestServer } from "../support/server.ts";
import { createManager, createRequester } from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("POST /auth/register", () => {
  it("creates a requester account", async () => {
    const response = await api("/auth/register", {
      body: {
        name: "Ana Souza",
        email: "Ana@Example.com",
        password: "senha-super-secreta",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: "Ana Souza",
      email: "ana@example.com",
      role: "requester",
    });
    expect(response.body.password).toBeUndefined();
    expect(response.body.passwordHash).toBeUndefined();
  });

  it("never lets a public registration choose the manager role", async () => {
    const response = await api("/auth/register", {
      body: {
        name: "Ana Souza",
        email: "ana@example.com",
        password: "senha-super-secreta",
        role: "manager",
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.role).toBe("requester");
  });

  it("rejects a duplicated email", async () => {
    const body = {
      name: "Ana Souza",
      email: "ana@example.com",
      password: "senha-super-secreta",
    };
    await api("/auth/register", { body });

    const response = await api("/auth/register", { body });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it("rejects a malformed email and a short password", async () => {
    const invalidEmail = await api("/auth/register", {
      body: {
        name: "Ana Souza",
        email: "not-an-email",
        password: "senha-super-secreta",
      },
    });
    expect(invalidEmail.status).toBe(422);
    expect(invalidEmail.body.error.code).toBe("VALIDATION_ERROR");

    const shortPassword = await api("/auth/register", {
      body: { name: "Ana Souza", email: "ana@example.com", password: "curta" },
    });
    expect(shortPassword.status).toBe(422);
    expect(shortPassword.body.error.details).toContainEqual({
      field: "password",
    });
  });
});

describe("POST /auth/login", () => {
  it("returns a token pair and the user", async () => {
    const requester = await createRequester();

    const response = await api("/auth/login", {
      body: { email: requester.email, password: requester.password },
    });

    expect(response.status).toBe(200);
    expect(response.body.tokenType).toBe("Bearer");
    expect(response.body.expiresIn).toBeGreaterThan(0);
    expect(response.body.accessToken).toBeString();
    expect(response.body.refreshToken).toBeString();
    expect(response.body.user).toMatchObject({
      id: requester.id,
      email: requester.email,
      role: "requester",
    });
  });

  it("rejects a wrong password and an unknown email with the same error", async () => {
    const requester = await createRequester();

    const wrongPassword = await api("/auth/login", {
      body: { email: requester.email, password: "senha-errada" },
    });
    const unknownEmail = await api("/auth/login", {
      body: { email: "ninguem@example.com", password: requester.password },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknownEmail.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("POST /auth/refresh", () => {
  it("rotates the refresh token", async () => {
    const requester = await createRequester();

    const response = await api("/auth/refresh", {
      body: { refreshToken: requester.refreshToken },
    });

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).not.toBe(requester.refreshToken);
    expect(response.body.accessToken).toBeString();
  });

  it("revokes the previous token, so replaying it fails", async () => {
    const requester = await createRequester();
    await api("/auth/refresh", {
      body: { refreshToken: requester.refreshToken },
    });

    const replay = await api("/auth/refresh", {
      body: { refreshToken: requester.refreshToken },
    });

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects an unknown refresh token", async () => {
    const response = await api("/auth/refresh", {
      body: { refreshToken: "nao-existe" },
    });

    expect(response.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  it("revokes the refresh token", async () => {
    const requester = await createRequester();

    const response = await api("/auth/logout", {
      token: requester.accessToken,
      body: { refreshToken: requester.refreshToken },
    });
    expect(response.status).toBe(204);

    const refreshed = await api("/auth/refresh", {
      body: { refreshToken: requester.refreshToken },
    });
    expect(refreshed.status).toBe(401);
  });
});

describe("GET /me", () => {
  it("describes the authenticated user", async () => {
    const manager = await createManager();

    const response = await api("/me", { token: manager.accessToken });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: manager.id,
      email: manager.email,
      role: "manager",
    });
  });

  it("requires a bearer token", async () => {
    const missing = await api("/me");
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("AUTHENTICATION_REQUIRED");

    const invalid = await api("/me", { token: "nao.e.um.jwt" });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe("INVALID_ACCESS_TOKEN");
  });
});
