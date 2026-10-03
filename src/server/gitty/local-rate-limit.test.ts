import { describe, expect, it } from "vitest";

import { consumeLocalRateLimit } from "./local-rate-limit";

describe("consumeLocalRateLimit", () => {
  it("allows up to the limit per window, then resets in the next window", () => {
    const start = 1_800_000_000_000;
    const results = Array.from({ length: 4 }, () => consumeLocalRateLimit("ip-a", 3, 60, start));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
    expect(consumeLocalRateLimit("ip-b", 3, 60, start).allowed).toBe(true);
    expect(consumeLocalRateLimit("ip-a", 3, 60, start + 60_000).allowed).toBe(true);
  });
});
