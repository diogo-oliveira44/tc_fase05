import type { Pool } from "pg";
import { transaction, type Queryable } from "../../shared/db.ts";
import { AppError } from "../../shared/errors.ts";
import {
  object,
  optionalString,
  string,
  uuid,
} from "../../shared/validation.ts";
import {
  parseCoordinates,
  validateTransition,
  type IncidentStatus,
} from "./domain.ts";
import * as repository from "./repository.ts";

export interface Auth {
  userId: string;
  role: "requester" | "manager";
}

/**
 * Loads an incident the caller may see. A requester only ever reaches their own, and
 * someone else's is reported as missing rather than forbidden, so ids do not leak.
 */
export async function visibleIncident(
  db: Queryable,
  rawId: unknown,
  auth: Auth,
) {
  const incident = await repository.findById(db, uuid(rawId, "id"));

  if (
    !incident ||
    (auth.role === "requester" && incident.requesterId !== auth.userId)
  )
    throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found");

  return incident;
}

/**
 * Field validation lives here rather than in the router because the checks are
 * interleaved with the category lookup, and the order decides which error wins.
 */
export async function create(pool: Pool, auth: Auth, rawBody: unknown) {
  if (auth.role !== "requester")
    throw new AppError(
      403,
      "REQUESTER_REQUIRED",
      "Only requesters can create incidents",
    );

  const body = object(rawBody);
  const categoryId = uuid(body.categoryId, "categoryId");

  if (!(await repository.categoryExists(pool, categoryId)))
    throw new AppError(
      422,
      "INVALID_CATEGORY",
      "Category does not exist or is inactive",
    );

  const { latitude, longitude } = parseCoordinates(
    body.latitude,
    body.longitude,
  );
  const id = await repository.insert(pool, {
    requesterId: auth.userId,
    categoryId,
    title: string(body.title, "title", 3, 200),
    description: string(body.description, "description", 3),
    address: string(body.address, "address", 1, 300),
    locationDetails:
      optionalString(body.locationDetails, "locationDetails", 300) ?? null,
    latitude,
    longitude,
  });

  return repository.findById(pool, id);
}

export async function changePriority(
  pool: Pool,
  rawId: unknown,
  auth: Auth,
  input: { priority: string; reason: string; version: number },
) {
  const id = await transaction(pool, async (client) => {
    const incidentId = uuid(rawId, "id");
    const current = await repository.lock(client, "priority", incidentId);

    if (!current)
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found");
    if (current.version !== input.version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Incident was modified by another request",
      );
    if (current.priority === input.priority)
      throw new AppError(409, "PRIORITY_UNCHANGED", "Priority is unchanged");

    await repository.updatePriority(client, incidentId, input.priority);
    await repository.insertPriorityHistory(
      client,
      incidentId,
      current.priority,
      input.priority,
      auth.userId,
      input.reason,
    );

    return incidentId;
  });

  return repository.findById(pool, id);
}

export async function changeAssignee(
  pool: Pool,
  rawId: unknown,
  auth: Auth,
  input: { assigneeId: string; reason: string; version: number },
) {
  const id = await transaction(pool, async (client) => {
    // Checked before the incident is even resolved, matching the original precedence.
    if (!(await repository.isEligibleAssignee(client, input.assigneeId)))
      throw new AppError(
        422,
        "INVALID_ASSIGNEE",
        "Assignee must be an active manager",
      );

    const incidentId = uuid(rawId, "id");
    const current = await repository.lock(client, "assignee_id", incidentId);

    if (!current)
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found");
    if (current.version !== input.version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Incident was modified by another request",
      );
    if (current.assignee_id === input.assigneeId)
      throw new AppError(409, "ASSIGNEE_UNCHANGED", "Assignee is unchanged");

    await repository.updateAssignee(client, incidentId, input.assigneeId);
    await repository.insertAssignmentHistory(
      client,
      incidentId,
      current.assignee_id,
      input.assigneeId,
      auth.userId,
      input.reason,
    );

    return incidentId;
  });

  return repository.findById(pool, id);
}

export async function transition(
  pool: Pool,
  rawId: unknown,
  auth: Auth,
  input: {
    to: IncidentStatus;
    observation?: string;
    solution?: string;
    version: number;
  },
) {
  const id = await transaction(pool, async (client) => {
    const incidentId = uuid(rawId, "id");
    const current = await repository.lock(client, "status", incidentId);

    if (!current)
      throw new AppError(404, "INCIDENT_NOT_FOUND", "Incident not found");
    if (current.version !== input.version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Incident was modified by another request",
      );

    validateTransition(
      current.status as IncidentStatus,
      input.to,
      input.observation,
      input.solution,
    );

    await repository.applyTransition(
      client,
      incidentId,
      input.to,
      input.solution ?? null,
      auth.userId,
    );
    await repository.insertStatusHistory(
      client,
      incidentId,
      current.status,
      input.to,
      auth.userId,
      input.observation ?? null,
    );

    return incidentId;
  });

  return repository.findById(pool, id);
}
