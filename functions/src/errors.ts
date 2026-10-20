// Safe, stable error codes. Never include stack traces, UIDs or account details in responses.
export type ErrorCode =
  | "NOT_OPEN"
  | "ALREADY_FINISHED"
  | "INELIGIBLE"
  | "INVALID_SOLUTION"
  | "SUBMISSION_CLOSED"
  | "RATE_LIMITED"
  | "ACCOUNT_REQUIRED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN_ORIGIN"
  | "BAD_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "CONFLICT"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  NOT_OPEN: 409,
  ALREADY_FINISHED: 409,
  INELIGIBLE: 403,
  INVALID_SOLUTION: 422,
  SUBMISSION_CLOSED: 409,
  RATE_LIMITED: 429,
  ACCOUNT_REQUIRED: 403,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ORIGIN: 403,
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  NOT_FOUND: 404,
  CONFLICT: 409,
  METHOD_NOT_ALLOWED: 405,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode) {
    super(code);
    this.status = STATUS[code];
  }
}

export const fail = (code: ErrorCode): never => {
  throw new ApiError(code);
};
