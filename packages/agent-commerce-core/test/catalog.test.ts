// packages/agent-commerce-core/test/catalog.test.ts
import { describe, it, expect } from "vitest";
import { CATALOG, findItem } from "../src/catalog";

describe("catalog", () => {
  it("exposes at least 3 priced items with unique ids", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(3);
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of CATALOG) expect(item.priceUsdc).toBeGreaterThan(0);
  });

  it("findItem returns the matching item or undefined", () => {
    const first = CATALOG[0]!;
    expect(findItem(first.id)?.id).toBe(first.id);
    expect(findItem("does-not-exist")).toBeUndefined();
  });
});
