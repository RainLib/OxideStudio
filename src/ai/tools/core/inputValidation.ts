export function assertObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("tool input must be an object");
  }
  return input as Record<string, unknown>;
}

export function requireRecordArray(
  payload: Record<string, unknown>,
  field: string,
): Array<Record<string, unknown>> {
  const value = payload[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  if (!value.every(isRecord)) {
    throw new Error(`${field} must contain objects`);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function requireRecordField(
  payload: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = payload[field];
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

export function requireString(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

export function optionalString(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  return typeof value === "string" && value.trim() ? value : null;
}

export function requireStringArray(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim())
  ) {
    throw new Error(`${field} must contain one or more strings`);
  }
  return value;
}

export function requirePresent(
  payload: Record<string, unknown>,
  field: string,
) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) {
    throw new Error(`${field} is required`);
  }
  return payload[field];
}

export function optionalBoolean(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  return typeof value === "boolean" ? value : undefined;
}

export function optionalPositiveInteger(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(value);
}

export function requireNonNegativeInteger(
  payload: Record<string, unknown>,
  field: string,
) {
  const value = payload[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return Math.floor(value);
}
