import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { api, resetDatabase, startTestServer } from "../support/server.ts";
import {
  createIncident,
  createManager,
  createRequester,
  firstCategoryId,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("profile separation", () => {
  it("keeps manager-only routes closed to requesters", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const routes = [
      { path: "/dashboard/summary", options: { token: requester.accessToken } },
      {
        path: `/incidents/${incident.id}/priority`,
        options: {
          token: requester.accessToken,
          method: "PATCH",
          body: {
            priority: "high",
            reason: "Urgente",
            version: incident.version,
          },
        },
      },
      {
        path: `/incidents/${incident.id}/assignee`,
        options: {
          token: requester.accessToken,
          method: "PATCH",
          body: {
            assigneeId: requester.id,
            reason: "Eu mesmo",
            version: incident.version,
          },
        },
      },
      {
        path: `/incidents/${incident.id}/transitions`,
        options: {
          token: requester.accessToken,
          body: { to: "under_review", version: incident.version },
        },
      },
    ];

    for (const { path, options } of routes) {
      const response = await api(path, options);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("MANAGER_REQUIRED");
    }
  });

  it("only lets requesters open an incident", async () => {
    const manager = await createManager();
    const requester = await createRequester();

    const response = await api("/incidents", {
      token: manager.accessToken,
      body: {
        categoryId: await firstCategoryId(requester),
        title: "Gestor tentando abrir",
        description: "Gestores administram, não registram.",
        address: "Rua das Flores, 100",
      },
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("REQUESTER_REQUIRED");
  });
});

describe("requester data isolation", () => {
  it("hides another requester's incident behind a 404", async () => {
    const owner = await createRequester();
    const stranger = await createRequester();
    const incident = await createIncident(owner);

    for (const path of [
      `/incidents/${incident.id}`,
      `/incidents/${incident.id}/history`,
      `/incidents/${incident.id}/comments`,
    ]) {
      const response = await api(path, { token: stranger.accessToken });
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("INCIDENT_NOT_FOUND");
    }
  });

  it("never lists incidents owned by someone else", async () => {
    const owner = await createRequester();
    const stranger = await createRequester();
    await createIncident(owner);
    await createIncident(stranger, { title: "Vazamento na garagem" });

    const mine = await api("/incidents", { token: stranger.accessToken });

    expect(mine.status).toBe(200);
    expect(mine.body.meta.total).toBe(1);
    expect(
      mine.body.data.every(
        (incident: { requesterId: string }) =>
          incident.requesterId === stranger.id,
      ),
    ).toBe(true);
  });

  it("lets a manager see every incident", async () => {
    const manager = await createManager();
    const first = await createRequester();
    const second = await createRequester();
    await createIncident(first);
    await createIncident(second);

    const all = await api("/incidents", { token: manager.accessToken });

    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
  });

  it("stops a stranger from commenting on someone else's incident", async () => {
    const owner = await createRequester();
    const stranger = await createRequester();
    const incident = await createIncident(owner);

    const response = await api(`/incidents/${incident.id}/comments`, {
      token: stranger.accessToken,
      body: { body: "Bisbilhotando" },
    });

    expect(response.status).toBe(404);
  });
});
