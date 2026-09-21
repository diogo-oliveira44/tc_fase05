import type { Pool } from "pg";
import { AppError } from "../../shared/errors.ts";
import { object, optionalString } from "../../shared/validation.ts";
import { visibleIncident, type Auth } from "../incidents/service.ts";
import * as repository from "./repository.ts";

/** Only the requester who owns a resolved incident may rate it, exactly once. */
export async function rate(
  pool: Pool,
  rawId: unknown,
  auth: Auth,
  rawBody: unknown,
) {
  const incident = await visibleIncident(pool, rawId, auth);

  if (auth.role !== "requester" || incident.requesterId !== auth.userId)
    throw new AppError(
      403,
      "INCIDENT_OWNER_REQUIRED",
      "Only the requester can rate this incident",
    );
  if (incident.status !== "resolved")
    throw new AppError(
      409,
      "INCIDENT_NOT_RESOLVED",
      "Only resolved incidents can be rated",
    );

  const body = object(rawBody);
  const score = Number(body.score);
  if (!Number.isInteger(score) || score < 1 || score > 5)
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      "score must be an integer from 1 to 5",
      [{ field: "score" }],
    );

  try {
    return await repository.insert(
      pool,
      incident.id,
      auth.userId,
      score,
      optionalString(body.comment, "comment") ?? null,
    );
  } catch (error: any) {
    if (error?.code === "23505")
      throw new AppError(
        409,
        "RATING_ALREADY_EXISTS",
        "Incident has already been rated",
      );
    throw error;
  }
}

export async function find(pool: Pool, rawId: unknown, auth: Auth) {
  const incident = await visibleIncident(pool, rawId, auth);
  const rating = await repository.findByIncident(pool, incident.id);

  if (!rating)
    throw new AppError(404, "RATING_NOT_FOUND", "Incident has not been rated");

  return rating;
}
