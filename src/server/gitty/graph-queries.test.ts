import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findSymbol,
  getCallees,
  getCallers,
  getDependencies,
  getDependents,
  getImpact,
  nodeById,
  searchCode,
} from "./graph-queries";
import { SHOP_FILES, fixtureRepository } from "./test-fixture";
import { traceCandidates } from "./trace";
import { learningStops } from "./learn";

const loaded = fixtureRepository(SHOP_FILES);
const node = (id: string) => {
  const found = nodeById(loaded, id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

describe("relationships", () => {
  it("lists dependencies and dependents of a file", () => {
    const service = node("file:src/server/orders/service.ts");
    expect(getDependencies(loaded, service).map((item) => item.path)).toEqual([
      "src/server/orders/repository.ts",
      "Stripe",
    ]);
    expect(getDependents(loaded, service).map((item) => item.path)).toEqual([
      "src/app/api/orders/route.ts",
    ]);
  });

  it("treats a directory as everything inside it", () => {
    const orders = node("dir:src/server/orders");
    expect(getDependencies(loaded, orders).map((item) => item.path)).toContain(
      "src/server/db.ts",
    );
    expect(getDependents(loaded, orders).map((item) => item.path)).toEqual([
      "src/app/api/orders/route.ts",
    ]);
  });

  it("computes direct and indirect impact by walking importers", () => {
    const impact = getImpact(loaded, node("file:src/server/db.ts"));
    expect(impact.direct.map((entry) => entry.path)).toEqual([
      "src/server/orders/repository.ts",
    ]);
    expect(impact.indirect.map((entry) => [entry.path, entry.depth])).toEqual([
      ["src/server/orders/service.ts", 2],
      ["src/app/api/orders/route.ts", 3],
    ]);
    expect(impact.direct[0]?.evidence).toEqual({
      path: "src/server/orders/repository.ts",
      startLine: 1,
      endLine: 1,
    });
  });

  it("lists the files that use a database", () => {
    const postgres = node("db:postgres");
    expect(getDependents(loaded, postgres).map((item) => item.path)).toEqual([
      "src/server/db.ts",
    ]);
  });
});

describe("search", () => {
  it("finds symbols, text, callers and callees", () => {
    expect(findSymbol(loaded, "createOrder")[0]).toMatchObject({
      path: "src/server/orders/service.ts",
      startLine: 4,
    });
    expect(searchCode(loaded, "paymentIntents")[0]).toMatchObject({
      path: "src/server/orders/service.ts",
      line: 6,
    });
    const createOrder = {
      name: "createOrder",
      path: "src/server/orders/service.ts",
      startLine: 4,
      endLine: 8,
    };
    expect(getCallers(loaded, createOrder)).toEqual([
      expect.objectContaining({
        path: "src/app/api/orders/route.ts",
        line: 5,
        caller: "POST",
      }),
    ]);
    expect(getCallees(loaded, createOrder).map((hit) => hit.name)).toEqual([
      "saveOrder",
    ]);
  });
});

describe("trace and learning path", () => {
  it("orders feature candidates by layer and records real import links", () => {
    const candidates = traceCandidates(loaded, "checkout order flow");
    const paths = candidates.map((candidate) => candidate.path);
    expect(paths.indexOf("src/components/checkout-form.tsx")).toBeLessThan(
      paths.indexOf("src/app/api/orders/route.ts"),
    );
    expect(paths.indexOf("src/app/api/orders/route.ts")).toBeLessThan(
      paths.indexOf("src/server/orders/repository.ts"),
    );
    const route = candidates.find(
      (candidate) => candidate.path === "src/app/api/orders/route.ts",
    );
    expect(route?.linksTo).toContain("file:src/server/orders/service.ts");
  });

  it("returns no candidates when nothing matches", () => {
    expect(traceCandidates(loaded, "kubernetes autoscaler")).toEqual([]);
  });

  it("builds a learning path from files on the map", () => {
    const stops = learningStops(loaded);
    expect(stops[0]).toMatchObject({ path: "README.md" });
    expect(stops.map((stop) => stop.path)).toContain(
      "src/app/api/orders/route.ts",
    );
    for (const stop of stops)
      expect(nodeById(loaded, stop.nodeId)).toBeDefined();
  });
});
