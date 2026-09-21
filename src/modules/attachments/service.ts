import type { Pool } from "pg";
import type { AppConfig } from "../../config.ts";
import { AppError } from "../../shared/errors.ts";
import { string, uuid } from "../../shared/validation.ts";
import { visibleIncident, type Auth } from "../incidents/service.ts";
import * as images from "./images.ts";
import * as repository from "./repository.ts";
import * as storage from "./storage.ts";

export async function upload(
  pool: Pool,
  config: AppConfig,
  rawId: unknown,
  auth: Auth,
  mime: string,
  data: Buffer,
  rawFileName: unknown,
) {
  const incident = await visibleIncident(pool, rawId, auth);

  if (auth.role !== "requester" || incident.requesterId !== auth.userId)
    throw new AppError(
      403,
      "INCIDENT_OWNER_REQUIRED",
      "Only the requester can upload attachments",
    );

  if (!images.isAccepted(mime))
    throw new AppError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Only JPEG, PNG and WebP images are accepted",
    );

  if (data.length === 0)
    throw new AppError(
      415,
      "INVALID_IMAGE_CONTENT",
      "File content must not be empty",
    );

  if (
    (await repository.countByIncident(pool, incident.id)) >=
    images.maxPerIncident
  )
    throw new AppError(
      409,
      "ATTACHMENT_LIMIT_REACHED",
      `An incident can have at most ${images.maxPerIncident} attachments`,
    );

  const extension = images.extensionFor(mime);
  const key = `${incident.id}/${crypto.randomUUID()}.${extension}`;
  await storage.store(config.uploadDirectory, key, data);

  return repository.insert(pool, {
    incidentId: incident.id,
    uploadedBy: auth.userId,
    objectKey: key,
    fileName: string(
      rawFileName ?? `image.${extension}`,
      "x-file-name",
      1,
      255,
    ),
    mimeType: mime,
    sizeBytes: data.length,
  });
}

export async function list(pool: Pool, rawId: unknown, auth: Auth) {
  const incident = await visibleIncident(pool, rawId, auth);
  return repository.listByIncident(pool, incident.id);
}

export async function download(
  pool: Pool,
  config: AppConfig,
  rawId: unknown,
  rawAttachmentId: unknown,
  auth: Auth,
) {
  const incident = await visibleIncident(pool, rawId, auth);
  const attachment = await repository.findContent(
    pool,
    uuid(rawAttachmentId, "attachmentId"),
    incident.id,
  );

  if (!attachment)
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");

  try {
    return {
      data: await storage.read(config.uploadDirectory, attachment.object_key),
      fileName: attachment.file_name as string,
      mimeType: attachment.mime_type as string,
    };
  } catch {
    throw new AppError(
      404,
      "ATTACHMENT_NOT_FOUND",
      "Attachment content not found",
    );
  }
}
