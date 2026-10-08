// Typed application errors.
//
// Controllers/services throw these; a single Express error handler renders
// them as the standard wire format:
//
//   { "error": { "code": "...", "message": "...", "requestId": "..." } }
//
// Stack traces and database internals never reach the client.

export const ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONTACT_NOT_FOUND: "CONTACT_NOT_FOUND",
  TAG_NOT_FOUND: "TAG_NOT_FOUND",
  EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
  CONTACT_VERSION_CONFLICT: "CONTACT_VERSION_CONFLICT",
  TAG_ALREADY_ASSIGNED: "TAG_ALREADY_ASSIGNED",
  TAG_NOT_ASSIGNED: "TAG_NOT_ASSIGNED",
  INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorDetails {
  /** Field-level validation problems, if any. */
  issues?: Array<{ path: string; message: string }>;
  /** Extra machine-readable context (e.g. missing ids in a bulk request). */
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetails;

  constructor(code: ErrorCode, status: number, message: string, details?: ErrorDetails) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const errors = {
  invalidRequest: (message: string, details?: ErrorDetails) =>
    new AppError(ERROR_CODES.INVALID_REQUEST, 400, message, details),

  validationError: (message: string, details?: ErrorDetails) =>
    new AppError(ERROR_CODES.VALIDATION_ERROR, 400, message, details),

  contactNotFound: (id: string) =>
    new AppError(
      ERROR_CODES.CONTACT_NOT_FOUND,
      404,
      `Contact '${id}' does not exist.`,
    ),

  tagNotFound: (id: string) =>
    new AppError(ERROR_CODES.TAG_NOT_FOUND, 404, `Tag '${id}' does not exist.`),

  emailAlreadyExists: () =>
    new AppError(
      ERROR_CODES.EMAIL_ALREADY_EXISTS,
      409,
      "A contact with this email already exists for this account.",
    ),

  // 409 is deliberately chosen over 400: the request was well-formed, but it
  // conflicts with the current server state (another writer won the race).
  versionConflict: () =>
    new AppError(
      ERROR_CODES.CONTACT_VERSION_CONFLICT,
      409,
      "This contact was modified by another user. Reload the latest version and try again.",
    ),

  tagAlreadyAssigned: (contactId: string, tagId: string) =>
    new AppError(
      ERROR_CODES.TAG_ALREADY_ASSIGNED,
      409,
      `Tag '${tagId}' is already assigned to contact '${contactId}'.`,
    ),

  tagNotAssigned: (contactId: string, tagId: string) =>
    new AppError(
      ERROR_CODES.TAG_NOT_ASSIGNED,
      404,
      `Tag '${tagId}' is not assigned to contact '${contactId}'.`,
    ),

  internal: () =>
    new AppError(
      ERROR_CODES.INTERNAL_SERVER_ERROR,
      500,
      "An unexpected error occurred.",
    ),
};
