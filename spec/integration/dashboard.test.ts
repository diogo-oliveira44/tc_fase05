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

const countFor = (rows: { key: string; count: number }[], key: string) =>
  rows.find((row) => row.key === key)?.count ?? 0;

describe("GET /dashboard/summary", () => {
  it("is closed to requesters", async () => {
    const requester = await createRequester();

    const response = await api("/dashboard/summary", {
      token: requester.accessToken,
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("MANAGER_REQUIRED");
  });

  it("totals by status, category and priority", async () => {
    const requester = await createRequester();
    const manager = await createManager();

    const open = await createIncident(requester);
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );
    await advanceTo(manager, await createIncident(requester), "cancelled");

    const response = await api("/dashboard/summary", {
      token: manager.accessToken,
    });

    expect(response.status).toBe(200);
    expect(countFor(response.body.byStatus, "open")).toBe(1);
    expect(countFor(response.body.byStatus, "resolved")).toBe(1);
    expect(countFor(response.body.byStatus, "cancelled")).toBe(1);
    expect(countFor(response.body.byPriority, "medium")).toBe(3);
    expect(
      response.body.byCategory.reduce(
        (total: number, row: { count: number }) => total + row.count,
        0,
      ),
    ).toBe(3);

    // The aggregates must agree with what the listing reports for the same period.
    const listed = await api("/incidents", { token: manager.accessToken });
    expect(listed.body.meta.total).toBe(3);
    expect(open.status).toBe("open");
    expect(resolved.status).toBe("resolved");
  });

  it("reports the average resolution time and the ratings", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const resolved = await advanceTo(
      manager,
      await createIncident(requester),
      "resolved",
    );
    await api(`/incidents/${resolved.id}/rating`, {
      token: requester.accessToken,
      body: { score: 4 },
    });

    const response = await api("/dashboard/summary", {
      token: manager.accessToken,
    });

    expect(response.body.averageResolutionSeconds).toBeGreaterThanOrEqual(0);
    expect(response.body.ratings.average).toBe(4);
    expect(response.body.ratings.distribution).toMatchObject({ "4": 1 });
  });

  it("filters by period", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    await createIncident(requester);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const empty = await api("/dashboard/summary", {
      token: manager.accessToken,
      query: { createdFrom: future },
    });
    expect(empty.body.byStatus).toEqual([]);

    const past = new Date(Date.now() - 86_400_000).toISOString();
    const included = await api("/dashboard/summary", {
      token: manager.accessToken,
      query: { createdFrom: past },
    });
    expect(countFor(included.body.byStatus, "open")).toBe(1);
  });

  it("stays consistent when there is nothing to report", async () => {
    const manager = await createManager();

    const response = await api("/dashboard/summary", {
      token: manager.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.byStatus).toEqual([]);
    expect(response.body.averageResolutionSeconds).toBeNull();
  });
});
