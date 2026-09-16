import { MAX, NIL, validate as isUuid } from "uuid";
import { AppError } from "./errors.ts";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "INVALID_JSON", "A JSON object is required");

  return value as Record<string, unknown>;
}

export function string(value: unknown, name: string, min = 1, max = 10_000) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `${name} must contain between ${min} and ${max} characters`,
      [{ field: name }],
    );

  return value.trim();
}

export function optionalString(value: unknown, name: string, max = 10_000) {
  return value == null ? undefined : string(value, name, 1, max);
}

export function uuid(value: unknown, name: string) {
  if (
    typeof value !== "string" ||
    !isUuid(value) ||
    value === NIL ||
    value.toLowerCase() === MAX
  )
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      `${name} must be a valid UUID`,
      [{ field: name }],
    );

  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw new AppError(422, "VALIDATION_ERROR", `${name} is invalid`, [
      { field: name },
    ]);

  return value as T;
}
