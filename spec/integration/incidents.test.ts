import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  api,
  resetDatabase,
  startTestServer,
  testPool as pool,
} from "../support/server.ts";
import {
  createIncident,
  createManager,
  createRequester,
  firstCategoryId,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

describe("POST /incidents", () => {
  it("opens the incident with the documented defaults", async () => {
    const requester = await createRequester();
    const categoryId = await firstCategoryId(requester);

    const response = await api("/incidents", {
      token: requester.accessToken,
      body: {
        categoryId,
        title: "Lâmpada queimada no corredor",
        description: "A lâmpada do segundo andar está queimada há três dias.",
        address: "Rua das Flores, 100",
        locationDetails: "Próximo ao elevador",
        latitude: -23.5505,
        longitude: -46.6333,
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      status: "open",
      priority: "medium",
      requesterId: requester.id,
      categoryId,
      locationDetails: "Próximo ao elevador",
      version: 1,
    });
    expect(response.body.assigneeId).toBeNull();
    expect(response.body.assigneeName).toBeNull();
    expect(response.body.requesterName).toBe(requester.name);
    expect(response.body.solution).toBeNull();
    expect(response.body.categoryName).toBeString();
  });

  it("records the opening in the status history", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const history = await api(`/incidents/${incident.id}/history`, {
      token: requester.accessToken,
    });

    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      type: "status",
      previousValue: null,
      newValue: "open",
      changedBy: requester.id,
    });
  });

  it("rejects an unknown or inactive category", async () => {
    const requester = await createRequester();
    const base = {
      title: "Lâmpada queimada",
      description: "Descrição suficiente",
      address: "Rua das Flores, 100",
    };

    const unknown = await api("/incidents", {
      token: requester.accessToken,
      body: { ...base, categoryId: "00000000-0000-4000-8000-000000000000" },
    });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.code).toBe("INVALID_CATEGORY");

    const categoryId = await firstCategoryId(requester);
    await pool.query("UPDATE categories SET active=false WHERE id=$1", [
      categoryId,
    ]);
    try {
      const inactive = await api("/incidents", {
        token: requester.accessToken,
        body: { ...base, categoryId },
      });
      expect(inactive.status).toBe(422);
      expect(inactive.body.error.code).toBe("INVALID_CATEGORY");
    } finally {
      await pool.query("UPDATE categories SET active=true WHERE id=$1", [
        categoryId,
      ]);
    }
  });

  it("rejects missing fields and out-of-range coordinates", async () => {
    const requester = await createRequester();
    const categoryId = await firstCategoryId(requester);

    const short = await api("/incidents", {
      token: requester.accessToken,
      body: {
        categoryId,
        title: "ab",
        description: "Descrição suficiente",
        address: "Rua das Flores, 100",
      },
    });
    expect(short.status).toBe(422);
    expect(short.body.error.details).toContainEqual({ field: "title" });

    const coordinates = await api("/incidents", {
      token: requester.accessToken,
      body: {
        categoryId,
        title: "Título válido",
        description: "Descrição suficiente",
        address: "Rua das Flores, 100",
        latitude: 120,
      },
    });
    expect(coordinates.status).toBe(422);
  });
});

describe("GET /incidents", () => {
  it("filters by status, priority and category", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const categories = await api("/categories", {
      token: requester.accessToken,
    });
    const [lighting, cleaning] = categories.body.data;

    const first = await createIncident(requester, {
      categoryId: lighting.id,
      title: "Lâmpada queimada",
    });
    await createIncident(requester, {
      categoryId: cleaning.id,
      title: "Corredor sujo",
    });

    await api(`/incidents/${first.id}/transitions`, {
      token: manager.accessToken,
      body: { to: "under_review", version: first.version },
    });
    const prioritised = await api("/incidents", {
      token: manager.accessToken,
      query: { status: "under_review" },
    });
    expect(prioritised.body.meta.total).toBe(1);
    expect(prioritised.body.data[0].id).toBe(first.id);

    const byCategory = await api("/incidents", {
      token: requester.accessToken,
      query: { categoryId: cleaning.id },
    });
    expect(byCategory.body.meta.total).toBe(1);
    expect(byCategory.body.data[0].title).toBe("Corredor sujo");

    const byPriority = await api("/incidents", {
      token: requester.accessToken,
      query: { priority: "medium" },
    });
    expect(byPriority.body.meta.total).toBe(2);
  });

  it("rejects an invalid enum value", async () => {
    const requester = await createRequester();

    const response = await api("/incidents", {
      token: requester.accessToken,
      query: { status: "concluida" },
    });

    expect(response.status).toBe(422);
    expect(response.body.error.details).toContainEqual({ field: "status" });
  });

  it("paginates and sorts", async () => {
    const requester = await createRequester();
    for (const title of [
      "Primeira ocorrência",
      "Segunda ocorrência",
      "Terceira ocorrência",
    ])
      await createIncident(requester, { title });

    const page = await api("/incidents", {
      token: requester.accessToken,
      query: { page: 2, pageSize: 2, sort: "createdAt" },
    });

    expect(page.body.meta).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].title).toBe("Terceira ocorrência");

    const newestFirst = await api("/incidents", {
      token: requester.accessToken,
      query: { sort: "-createdAt" },
    });
    expect(newestFirst.body.data[0].title).toBe("Terceira ocorrência");
  });

  it("caps the page size at 100", async () => {
    const requester = await createRequester();

    const response = await api("/incidents", {
      token: requester.accessToken,
      query: { pageSize: 5000 },
    });

    expect(response.body.meta.pageSize).toBe(100);
  });
});
