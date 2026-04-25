import { describe, it, expect } from "vitest";
import { ArcFXError } from "../src/error";

describe("ArcFXError", () => {
  it("has a discriminated code", () => {
    const e = new ArcFXError("INVALID_API_KEY", "bad key");
    expect(e.code).toBe("INVALID_API_KEY");
    expect(e.message).toBe("bad key");
    expect(e.name).toBe("ArcFXError");
  });
  it("preserves cause", () => {
    const cause = new Error("network down");
    const e = new ArcFXError("NETWORK", "fetch failed", { cause });
    expect(e.cause).toBe(cause);
  });
  it("retains optional context", () => {
    const e = new ArcFXError("SERVER_ERROR", "oops", { retryAfter: 30 });
    expect(e.retryAfter).toBe(30);
  });
});
