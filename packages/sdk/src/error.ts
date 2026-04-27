export type ArcFXErrorCode =
  | "INVALID_API_KEY"
  | "NETWORK"
  | "SERVER_ERROR"
  | "INVALID_URL"
  | "TIMEOUT"
  | "UNKNOWN";

export interface ArcFXErrorOptions {
  cause?: unknown;
  retryAfter?: number;
}

export class ArcFXError extends Error {
  readonly code: ArcFXErrorCode;
  readonly retryAfter?: number;

  constructor(code: ArcFXErrorCode, message: string, opts: ArcFXErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.name = "ArcFXError";
    this.code = code;
    this.retryAfter = opts.retryAfter;
  }
}
