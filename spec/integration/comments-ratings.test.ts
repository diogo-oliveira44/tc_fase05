import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { api, resetDatabase, startTestServer } from "../support/server.ts";
import {
  advanceTo,
  createIncident,
  createManager,
  createRequester,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("comments", () => {
  it("lets the requester and the manager talk on the same incident, in order", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const fromRequester = await api(`/incidents/${incident.id}/comments`, {
      token: requester.accessToken,
      body: { body: "Alguma previsão?" },
    });
    expect(fromRequester.status).toBe(201);
    expect(fromRequester.body).toMatchObject({
      incidentId: incident.id,
      authorId: requester.id,
      body: "Alguma previsão?",
    });

    const fromManager = await api(`/incidents/${incident.id}/comments`, {
      token: manager.accessToken,
      body: { body: "Equipe acionada." },
    });
    expect(fromManager.status).toBe(201);

    const listed = await api(`/incidents/${incident.id}/comments`, {
      token: requester.accessToken,
    });
    expect(listed.status).toBe(200);
    expect(
      listed.body.data.map((comment: { body: string }) => comment.body),
    ).toEqual(["Alguma previsão?", "Equipe acionada."]);
    expect(listed.body.data[1]).toMatchObject({ authorName: manager.name });
  });

  it("rejects an empty comment", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    for (const body of [{ body: "" }, { body: "   " }, {}]) {
      const response = await api(`/incidents/${incident.id}/comments`, {
        token: requester.accessToken,
        body,
      });
      expect(response.status).toBe(422);
      expect(response.body.error.details).toContainEqual({ field: "body" });
    }
  });
});

describe("ratings", () => {
  it("accepts one rating from the owner of a resolved incident", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );

    const response = await api(`/incidents/${resolved.id}/rating`, {
      token: requester.accessToken,
      body: { score: 5, comment: "Resolvido rápido." },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      incidentId: resolved.id,
      score: 5,
      comment: "Resolvido rápido.",
    });
  });

  it("refuses a second rating", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );
    await api(`/incidents/${resolved.id}/rating`, {
      token: requester.accessToken,
      body: { score: 5 },
    });

    const duplicate = await api(`/incidents/${resolved.id}/rating`, {
      token: requester.accessToken,
      body: { score: 3 },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("RATING_ALREADY_EXISTS");
  });

  it("refuses a rating before the incident is resolved", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await advanceTo(
      manager,
      await createIncident(requester),
      "in_progress",
    );

    const response = await api(`/incidents/${incident.id}/rating`, {
      token: requester.accessToken,
      body: { score: 4 },
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INCIDENT_NOT_RESOLVED");
  });

  it("refuses a rating from anyone but the owner", async () => {
    const requester = await createRequester();
    const stranger = await createRequester();
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );

    const byStranger = await api(`/incidents/${resolved.id}/rating`, {
      token: stranger.accessToken,
      body: { score: 1 },
    });
    expect(byStranger.status).toBe(404);

    const byManager = await api(`/incidents/${resolved.id}/rating`, {
      token: manager.accessToken,
      body: { score: 5 },
    });
    expect(byManager.status).toBe(403);
    expect(byManager.body.error.code).toBe("INCIDENT_OWNER_REQUIRED");
  });

  it("only accepts an integer score from 1 to 5", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );

    for (const score of [0, 6, 2.5, "cinco", null]) {
      const response = await api(`/incidents/${resolved.id}/rating`, {
        token: requester.accessToken,
        body: { score },
      });
      expect(response.status).toBe(422);
      expect(response.body.error.details).toContainEqual({ field: "score" });
    }
  });
});
