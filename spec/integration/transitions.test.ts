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
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

const transition = (
  manager: { accessToken: string },
  id: string,
  body: Record<string, unknown>,
) => api(`/incidents/${id}/transitions`, { token: manager.accessToken, body });

describe("the six valid transitions", () => {
  it("walks open -> under_review -> in_progress -> resolved", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    let incident = await createIncident(requester);

    const analysed = await transition(manager, incident.id, {
      to: "under_review",
      version: incident.version,
    });
    expect(analysed.status).toBe(200);
    expect(analysed.body.status).toBe("under_review");
    expect(analysed.body.version).toBe(incident.version + 1);

    const started = await transition(manager, incident.id, {
      to: "in_progress",
      version: analysed.body.version,
    });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("in_progress");

    const resolved = await transition(manager, incident.id, {
      to: "resolved",
      version: started.body.version,
      solution: "Lâmpada substituída pela manutenção.",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      status: "resolved",
      solution: "Lâmpada substituída pela manutenção.",
    });
    expect(resolved.body.resolvedAt).toBeString();
  });

  it("cancels from open, under_review and in_progress", async () => {
    const requester = await createRequester();
    const manager = await createManager();

    for (const from of ["open", "under_review", "in_progress"] as const) {
      const created = await createIncident(requester);
      const incident =
        from === "open" ? created : await advanceTo(manager, created, from);

      const cancelled = await transition(manager, incident.id, {
        to: "cancelled",
        version: incident.version,
        observation: "Duplicada de outra ocorrência.",
      });

      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe("cancelled");
      expect(cancelled.body.solution).toBeNull();
    }
  });
});

describe("invalid transitions", () => {
  it("rejects skipping a step", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const response = await transition(manager, incident.id, {
      to: "in_progress",
      version: incident.version,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("treats resolved and cancelled as final", async () => {
    const requester = await createRequester();
    const manager = await createManager();

    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );
    const reopenResolved = await transition(manager, resolved.id, {
      to: "under_review",
      version: resolved.version,
    });
    expect(reopenResolved.status).toBe(409);
    expect(reopenResolved.body.error.code).toBe("INVALID_STATUS_TRANSITION");

    const cancelled = await advanceTo(
      manager,
      await createIncident(requester),
      "cancelled",
    );
    const reopenCancelled = await transition(manager, cancelled.id, {
      to: "under_review",
      version: cancelled.version,
    });
    expect(reopenCancelled.status).toBe(409);
  });

  it("rejects an unknown status", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const response = await transition(manager, incident.id, {
      to: "arquivada",
      version: incident.version,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.details).toContainEqual({ field: "to" });
  });
});

describe("mandatory fields", () => {
  it("requires an observation to cancel", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const response = await transition(manager, incident.id, {
      to: "cancelled",
      version: incident.version,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("OBSERVATION_REQUIRED");
  });

  it("requires a solution to resolve", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await advanceTo(
      manager,
      await createIncident(requester),
      "in_progress",
    );

    const response = await transition(manager, incident.id, {
      to: "resolved",
      version: incident.version,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("SOLUTION_REQUIRED");
  });
});

describe("audit trail", () => {
  it("records exactly one history row per successful transition, with the five required fields", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    await transition(manager, incident.id, {
      to: "under_review",
      version: incident.version,
      observation: "Triagem inicial",
    });

    const rows = await pool.query(
      "SELECT previous_status,new_status,changed_by,observation,created_at FROM status_history WHERE incident_id=$1 ORDER BY created_at",
      [incident.id],
    );

    expect(rows.rowCount).toBe(2); // the opening plus this transition
    expect(rows.rows[1]).toMatchObject({
      previous_status: "open",
      new_status: "under_review",
      changed_by: manager.id,
      observation: "Triagem inicial",
    });
    expect(rows.rows[1].created_at).toBeInstanceOf(Date);
  });

  it("leaves no history behind when the transition is rejected", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const rejected = await transition(manager, incident.id, {
      to: "resolved",
      version: incident.version,
    });
    expect(rejected.status).toBe(409);

    const rows = await pool.query(
      "SELECT count(*)::int AS count FROM status_history WHERE incident_id=$1",
      [incident.id],
    );
    const current = await api(`/incidents/${incident.id}`, {
      token: requester.accessToken,
    });

    expect(rows.rows[0].count).toBe(1);
    expect(current.body.status).toBe("open");
    expect(current.body.version).toBe(incident.version);
  });

  it("exposes status, priority and assignment changes in one chronological timeline", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    let incident = await createIncident(requester);

    const prioritised = await api(`/incidents/${incident.id}/priority`, {
      token: manager.accessToken,
      method: "PATCH",
      body: {
        priority: "high",
        reason: "Risco de acidente",
        version: incident.version,
      },
    });
    expect(prioritised.status).toBe(200);

    const assigned = await api(`/incidents/${incident.id}/assignee`, {
      token: manager.accessToken,
      method: "PATCH",
      body: {
        assigneeId: manager.id,
        reason: "Responsável pela área",
        version: prioritised.body.version,
      },
    });
    expect(assigned.status).toBe(200);

    await transition(manager, incident.id, {
      to: "under_review",
      version: assigned.body.version,
    });

    const history = await api(`/incidents/${incident.id}/history`, {
      token: requester.accessToken,
    });

    expect(history.status).toBe(200);
    expect(
      history.body.data.map((entry: { type: string }) => entry.type),
    ).toEqual(["status", "priority", "assignment", "status"]);
    expect(history.body.data[1]).toMatchObject({
      previousValue: "medium",
      newValue: "high",
      reason: "Risco de acidente",
    });
  });
});

describe("optimistic locking", () => {
  it("rejects a stale version", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const first = await transition(manager, incident.id, {
      to: "under_review",
      version: incident.version,
    });
    expect(first.status).toBe(200);

    const stale = await transition(manager, incident.id, {
      to: "in_progress",
      version: incident.version,
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
  });

  it("lets only one of two concurrent transitions win", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const [a, b] = await Promise.all([
      transition(manager, incident.id, {
        to: "under_review",
        version: incident.version,
      }),
      transition(manager, incident.id, {
        to: "cancelled",
        version: incident.version,
        observation: "Cancelada",
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("requires a version", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const response = await transition(manager, incident.id, {
      to: "under_review",
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VERSION_REQUIRED");
  });
});
