export type ArcoraErrorCode =
  | "INVALID_API_KEY"
  | "NETWORK"
  | "SERVER_ERROR"
  | "INVALID_URL"
  | "TIMEOUT"
  | "NO_SECURE_RANDOM"
  | "UNKNOWN";

export interface ArcoraErrorOptions {
  cause?: unknown;
  retryAfter?: number;
}

export class ArcoraError extends Error {
  readonly code: ArcoraErrorCode;
  readonly retryAfter?: number;

  constructor(code: ArcoraErrorCode, message: string, opts: ArcoraErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = "ArcoraError";
    this.code = code;
    this.retryAfter = opts.retryAfter;
  }
}
