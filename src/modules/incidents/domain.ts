import { AppError } from "../../shared/errors.ts";

export const statuses = [
  "open",
  "under_review",
  "in_progress",
  "resolved",
  "cancelled",
] as const;
export const priorities = ["low", "medium", "high", "critical"] as const;
export type IncidentStatus = (typeof statuses)[number];

const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["under_review", "cancelled"],
  under_review: ["in_progress", "cancelled"],
  in_progress: ["resolved", "cancelled"],
  resolved: [],
  cancelled: [],
};

export function validateTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  observation?: string,
  solution?: string,
) {
  if (!transitions[from].includes(to))
    throw new AppError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Cannot transition from ${from} to ${to}`,
    );
  if (to === "cancelled" && !observation?.trim())
    throw new AppError(
      422,
      "OBSERVATION_REQUIRED",
      "An observation is required to cancel an incident",
    );
  if (to === "resolved" && !solution?.trim())
    throw new AppError(
      422,
      "SOLUTION_REQUIRED",
      "A solution is required to resolve an incident",
    );
}

/** Coordinates are optional, but must be real ones when present. */
export function parseCoordinates(latitude: unknown, longitude: unknown) {
  const lat = latitude == null ? null : Number(latitude);
  const lon = longitude == null ? null : Number(longitude);

  if (
    (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
    (lon != null && (!Number.isFinite(lon) || lon < -180 || lon > 180))
  )
    throw new AppError(422, "VALIDATION_ERROR", "Invalid coordinates");

  return { latitude: lat, longitude: lon };
}
