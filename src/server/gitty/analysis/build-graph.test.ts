import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SHOP_FILES, fixtureRepository } from "../test-fixture";
import { evidenceLine, symbolNameOf } from "./build-graph";

describe("buildCodebaseGraph", () => {
  const loaded = fixtureRepository(SHOP_FILES);
  const { graph } = loaded;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));

  it("builds the directory hierarchy with file counts", () => {
    expect(byId.get("repo")).toMatchObject({ type: "REPOSITORY", label: "acme/shop" });
    expect(byId.get("dir:src")).toMatchObject({ parentId: "repo", fileCount: 7 });
    expect(byId.get("file:src/server/db.ts")).toMatchObject({
      parentId: "dir:src/server",
      analyzed: true,
      language: "TypeScript",
    });
  });

  it("never puts secret files on the map", () => {
    expect(byId.has("file:.env")).toBe(false);
  });

  it("extracts symbols and API routes as children of their file", () => {
    expect(byId.get("sym:src/app/api/orders/route.ts#POST@3")).toMatchObject({
      type: "API_ROUTE",
      label: "POST /api/orders",
      parentId: "file:src/app/api/orders/route.ts",
      startLine: 3,
      endLine: 6,
    });
    expect(byId.get("sym:src/server/orders/service.ts#createOrder@4")).toMatchObject({
      type: "FUNCTION",
    });
  });

  it("links files only through resolved imports, with evidence lines", () => {
    expect(graph.edges).toContainEqual({
      from: "file:src/server/orders/service.ts",
      to: "file:src/server/orders/repository.ts",
      kind: "imports",
      evidence: { path: "src/server/orders/service.ts", startLine: 1, endLine: 1 },
    });
    // The client calls the route over HTTP; there is no import, so no edge.
    expect(
      graph.edges.some(
        (edge) => edge.from === "file:src/lib/orders.ts" && edge.to === "file:src/app/api/orders/route.ts",
      ),
    ).toBe(false);
  });

  it("adds databases and services only from known imports", () => {
    expect(byId.get("ext:stripe")).toMatchObject({ type: "EXTERNAL_SERVICE", label: "Stripe" });
    expect(byId.get("db:postgres")).toMatchObject({ type: "DATABASE" });
    expect(byId.get("db:orm-drizzle")).toMatchObject({ type: "DATABASE" });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: "file:src/server/orders/service.ts",
        to: "ext:stripe",
        kind: "uses_service",
        evidence: { path: "src/server/orders/service.ts", startLine: 2, endLine: 2 },
      }),
    );
  });

  it("reports stats", () => {
    expect(graph.stats).toMatchObject({ files: 9, analyzedFiles: 8, truncated: false });
    expect(graph.stats.importEdges).toBeGreaterThanOrEqual(5);
  });
});

describe("helpers", () => {
  it("finds the import line that names a target", () => {
    expect(evidenceLine('const a = 1;\nimport { x } from "./orders/service";', "src/orders/service.ts")).toBe(2);
  });

  it("reads the name back out of a symbol id", () => {
    expect(symbolNameOf("sym:src/app/[id]/route.ts#GET@4")).toBe("GET");
    expect(symbolNameOf("sym:a.go#ANY /health@9")).toBe("ANY /health");
  });
});
