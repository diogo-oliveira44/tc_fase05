import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  api,
  resetDatabase,
  startTestServer,
  testPool,
} from "../support/server.ts";
import {
  createAdmin,
  createManager,
  createRequester,
  createIncident,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);
const input = {
  name: "New Manager",
  email: "new@example.com",
  password: "manager-secret",
};

describe("admin manager creation", () => {
  it("creates a manager who can log in, and supports admin refresh and profile", async () => {
    const admin = await createAdmin();
    const refreshed = await api("/auth/refresh", {
      body: { refreshToken: admin.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const token = refreshed.body.accessToken;
    expect((await api("/me", { token })).body.role).toBe("admin");
    const response = await api("/users/managers", {
      token,
      body: { ...input, email: "NEW@EXAMPLE.COM", role: "admin" },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      email: input.email,
      role: "manager",
    });
    expect(response.body.password).toBeUndefined();
    expect(response.body.password_hash).toBeUndefined();
    const login = await api("/auth/login", { body: input });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("manager");
    expect(
      (await api("/users", { token, query: { role: "manager" } })).body.data,
    ).toHaveLength(1);
  });

  it("rejects anonymous users, requesters, managers and inactive admins", async () => {
    expect((await api("/users/managers", { body: input })).status).toBe(401);
    for (const actor of [await createRequester(), await createManager()]) {
      const response = await api("/users/managers", {
        token: actor.accessToken,
        body: input,
      });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("ADMIN_REQUIRED");
    }
    const admin = await createAdmin();
    await testPool.query("UPDATE users SET active=false WHERE id=$1", [
      admin.id,
    ]);
    expect(
      (await api("/users/managers", { token: admin.accessToken, body: input }))
        .status,
    ).toBe(401);
  });

  it("validates inputs and rejects duplicate emails without promoting accounts", async () => {
    const admin = await createAdmin();
    for (const override of [
      { name: "" },
      { email: "invalid" },
      { password: "short" },
    ]) {
      expect(
        (
          await api("/users/managers", {
            token: admin.accessToken,
            body: { ...input, ...override },
          })
        ).status,
      ).toBe(422);
    }
    const requester = await createRequester({ email: input.email });
    const duplicate = await api("/users/managers", {
      token: admin.accessToken,
      body: input,
    });
    expect(duplicate.status).toBe(409);
    expect((await api("/me", { token: requester.accessToken })).body.role).toBe(
      "requester",
    );
  });

  it("keeps public registration requester-only and admin access separate from incidents", async () => {
    const registration = await api("/auth/register", {
      body: { ...input, role: "admin" },
    });
    expect(registration.body.role).toBe("requester");
    const requester = await createRequester();
    const incident = await createIncident(requester);
    const admin = await createAdmin();
    const token = admin.accessToken;
    expect((await api("/incidents", { token })).body.data).toHaveLength(0);
    expect((await api(`/incidents/${incident.id}`, { token })).status).toBe(
      404,
    );
    expect((await api("/dashboard/summary", { token })).status).toBe(403);
    expect(
      (
        await api(`/incidents/${incident.id}/transitions`, {
          token,
          body: { to: "under_review", version: incident.version },
        })
      ).status,
    ).toBe(403);
  });
});
