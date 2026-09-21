import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  api,
  resetDatabase,
  startTestServer,
  testPool as pool,
} from "../support/server.ts";
import {
  advanceTo,
  createIncident,
  createManager,
  createRequester,
  images,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("GET /users", () => {
  it("lists the managers a gestor can assign work to", async () => {
    const manager = await createManager({ name: "Ana Gestora" });
    const other = await createManager({ name: "Bruno Gestor" });
    await createRequester({ name: "Carla Solicitante" });

    const response = await api("/users", {
      token: manager.accessToken,
      query: { role: "manager" },
    });

    expect(response.status).toBe(200);
    expect(
      response.body.data.map((user: { id: string }) => user.id).sort(),
    ).toEqual([manager.id, other.id].sort());
    expect(response.body.data[0].passwordHash).toBeUndefined();
  });

  it("is closed to requesters", async () => {
    const requester = await createRequester();

    const response = await api("/users", { token: requester.accessToken });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("MANAGER_REQUIRED");
  });

  it("rejects an unknown role", async () => {
    const manager = await createManager();

    const response = await api("/users", {
      token: manager.accessToken,
      query: { role: "tecnico" },
    });

    expect(response.status).toBe(422);
  });
});

describe("GET /incidents/:id/attachments", () => {
  it("lists what was uploaded, for the owner and for a manager", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    await api(`/incidents/${incident.id}/attachments`, {
      token: requester.accessToken,
      method: "POST",
      raw: new Uint8Array(images.png),
      headers: { "content-type": "image/png", "x-file-name": "corredor.png" },
    });

    for (const actor of [requester, manager]) {
      const response = await api(`/incidents/${incident.id}/attachments`, {
        token: actor.accessToken,
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        incidentId: incident.id,
        fileName: "corredor.png",
        mimeType: "image/png",
        uploadedBy: requester.id,
      });
      // The storage key must never leak: downloads go through the attachment id.
      expect(response.body.data[0].objectKey).toBeUndefined();
    }
  });

  it("returns an empty list when there is nothing attached", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await api(`/incidents/${incident.id}/attachments`, {
      token: requester.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("hides the list from another requester", async () => {
    const requester = await createRequester();
    const stranger = await createRequester();
    const incident = await createIncident(requester);

    const response = await api(`/incidents/${incident.id}/attachments`, {
      token: stranger.accessToken,
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /incidents/:id/rating", () => {
  it("reads back an existing rating", async () => {
    const requester = await createRequester({ name: "Carla Solicitante" });
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );
    await api(`/incidents/${resolved.id}/rating`, {
      token: requester.accessToken,
      body: { score: 4, comment: "Demorou, mas resolveu." },
    });

    const response = await api(`/incidents/${resolved.id}/rating`, {
      token: manager.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      incidentId: resolved.id,
      score: 4,
      comment: "Demorou, mas resolveu.",
      authorName: "Carla Solicitante",
    });
  });

  it("404s while the incident has not been rated", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await api(`/incidents/${incident.id}/rating`, {
      token: requester.accessToken,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("RATING_NOT_FOUND");
  });
});

describe("history labels", () => {
  it("names the people behind each change", async () => {
    const requester = await createRequester({ name: "Carla Solicitante" });
    const manager = await createManager({ name: "Ana Gestora" });
    const incident = await createIncident(requester);

    const assigned = await api(`/incidents/${incident.id}/assignee`, {
      token: manager.accessToken,
      method: "PATCH",
      body: {
        assigneeId: manager.id,
        reason: "Responsável pela área",
        version: incident.version,
      },
    });
    expect(assigned.status).toBe(200);

    const history = await api(`/incidents/${incident.id}/history`, {
      token: requester.accessToken,
    });

    const [opened, assignment] = history.body.data;
    expect(opened).toMatchObject({
      type: "status",
      changedByName: "Carla Solicitante",
    });
    expect(assigned.body.assigneeName).toBe("Ana Gestora");
    expect(assignment).toMatchObject({
      type: "assignment",
      changedByName: "Ana Gestora",
      previousLabel: null,
      newLabel: "Ana Gestora",
    });
  });
});

describe("dashboard SLA", () => {
  it("counts nothing as overdue while everything is inside the SLA", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    await createIncident(requester);

    const response = await api("/dashboard/summary", {
      token: manager.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.overdue).toBe(0);
    expect(response.body.slaHours).toMatchObject({ critical: 24, medium: 168 });
  });

  it("counts an incident that outlived its SLA, and stops counting it once closed", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);
    await pool.query(
      "UPDATE incidents SET created_at=now() - interval '30 days' WHERE id=$1",
      [incident.id],
    );

    const overdue = await api("/dashboard/summary", {
      token: manager.accessToken,
    });
    expect(overdue.body.overdue).toBe(1);

    await advanceTo(manager, incident, "cancelled");

    const closed = await api("/dashboard/summary", {
      token: manager.accessToken,
    });
    expect(closed.body.overdue).toBe(0);
  });
});
