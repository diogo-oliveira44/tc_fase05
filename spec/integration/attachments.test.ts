import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  api,
  resetDatabase,
  send,
  startTestServer,
} from "../support/server.ts";
import {
  createIncident,
  createManager,
  createRequester,
  images,
} from "../support/fixtures.ts";

beforeAll(startTestServer);
beforeEach(resetDatabase);

const upload = (
  token: string,
  id: string,
  data: Buffer,
  mime = "image/png",
  fileName?: string,
) =>
  api(`/incidents/${id}/attachments`, {
    token,
    method: "POST",
    raw: new Uint8Array(data),
    headers: {
      "content-type": mime,
      ...(fileName ? { "x-file-name": fileName } : {}),
    },
  });

describe("POST /incidents/:id/attachments", () => {
  it("accepts the three allowed image types", async () => {
    const requester = await createRequester();

    for (const [mime, data] of [
      ["image/png", images.png],
      ["image/jpeg", images.jpeg],
      ["image/webp", images.webp],
    ] as const) {
      const incident = await createIncident(requester);
      const response = await upload(
        requester.accessToken,
        incident.id,
        data,
        mime,
        "foto.bin",
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        incidentId: incident.id,
        mimeType: mime,
        fileName: "foto.bin",
        size: data.length,
      });
      expect(response.body.objectKey).toBeUndefined();
    }
  });

  it("falls back to a default file name", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await upload(
      requester.accessToken,
      incident.id,
      images.png,
    );

    expect(response.status).toBe(201);
    expect(response.body.fileName).toBe("image.png");
  });

  it("rejects an empty upload", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await upload(
      requester.accessToken,
      incident.id,
      Buffer.alloc(0),
      "image/png",
    );

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("INVALID_IMAGE_CONTENT");
  });

  it("rejects a media type outside the allowlist", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await api(`/incidents/${incident.id}/attachments`, {
      token: requester.accessToken,
      method: "POST",
      raw: "%PDF-1.7",
      headers: { "content-type": "application/pdf" },
    });

    expect(response.status).toBe(415);
  });

  it("stops at five attachments", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    for (let index = 0; index < 5; index++) {
      const accepted = await upload(
        requester.accessToken,
        incident.id,
        images.png,
      );
      expect(accepted.status).toBe(201);
    }

    const rejected = await upload(
      requester.accessToken,
      incident.id,
      images.png,
    );

    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("ATTACHMENT_LIMIT_REACHED");
  });

  it("rejects a payload above the configured limit", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);
    const oversized = Buffer.concat([
      images.png,
      Buffer.alloc(6 * 1024 * 1024),
    ]);

    const response = await upload(
      requester.accessToken,
      incident.id,
      oversized,
    );

    expect(response.status).toBe(413);
  });

  it("only lets the owning requester upload", async () => {
    const requester = await createRequester();
    const stranger = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);

    const byStranger = await upload(
      stranger.accessToken,
      incident.id,
      images.png,
    );
    expect(byStranger.status).toBe(404);

    const byManager = await upload(
      manager.accessToken,
      incident.id,
      images.png,
    );
    expect(byManager.status).toBe(403);
    expect(byManager.body.error.code).toBe("INCIDENT_OWNER_REQUIRED");
  });
});

describe("GET /incidents/:id/attachments/:attachmentId", () => {
  it("returns the stored bytes to the owner and to a manager", async () => {
    const requester = await createRequester();
    const manager = await createManager();
    const incident = await createIncident(requester);
    const uploaded = await upload(
      requester.accessToken,
      incident.id,
      images.png,
      "image/png",
      "corredor.png",
    );

    for (const actor of [requester, manager]) {
      const response = await send(
        `/incidents/${incident.id}/attachments/${uploaded.body.id}`,
        { token: actor.accessToken },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(response.headers.get("content-disposition")).toContain(
        "corredor.png",
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array(images.png),
      );
    }
  });

  it("hides the attachment from another requester", async () => {
    const requester = await createRequester();
    const stranger = await createRequester();
    const incident = await createIncident(requester);
    const uploaded = await upload(
      requester.accessToken,
      incident.id,
      images.png,
    );

    const response = await api(
      `/incidents/${incident.id}/attachments/${uploaded.body.id}`,
      { token: stranger.accessToken },
    );

    expect(response.status).toBe(404);
  });

  it("404s for an unknown attachment id", async () => {
    const requester = await createRequester();
    const incident = await createIncident(requester);

    const response = await api(
      `/incidents/${incident.id}/attachments/00000000-0000-4000-8000-000000000000`,
      {
        token: requester.accessToken,
      },
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ATTACHMENT_NOT_FOUND");
  });
});
