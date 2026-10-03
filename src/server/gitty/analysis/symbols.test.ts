import { describe, expect, it } from "vitest";

import { analyzeSource, nextRouteOf } from "./symbols";

describe("analyzeSource", () => {
  it("finds TypeScript classes, functions and arrow functions with spans", () => {
    const text = [
      "export class Cart {",
      "  items = [];",
      "}",
      "",
      "export async function total(cart: Cart) {",
      "  return 0;",
      "}",
      "",
      "const helper = (x: number) => x * 2;",
    ].join("\n");
    const { symbols } = analyzeSource("src/cart.ts", text);
    expect(symbols).toEqual([
      expect.objectContaining({
        name: "Cart",
        kind: "class",
        line: 1,
        endLine: 3,
        exported: true,
      }),
      expect.objectContaining({
        name: "total",
        kind: "function",
        line: 5,
        endLine: 7,
        exported: true,
      }),
      expect.objectContaining({
        name: "helper",
        kind: "function",
        line: 9,
        exported: false,
      }),
    ]);
  });

  it("turns Next.js route handlers into API routes", () => {
    const text =
      "export async function GET() {\n  return Response.json({});\n}\n";
    const { symbols } = analyzeSource(
      "src/app/api/(public)/users/[id]/route.ts",
      text,
    );
    expect(symbols).toEqual([
      expect.objectContaining({
        kind: "route",
        route: "GET /api/users/[id]",
        line: 1,
        endLine: 3,
      }),
    ]);
  });

  it("finds FastAPI routes and attaches the handler name", () => {
    const text = [
      "from fastapi import APIRouter",
      "router = APIRouter()",
      "",
      '@router.post("/items")',
      "async def create_item(item):",
      "    return item",
      "",
      "class Item:",
      "    pass",
    ].join("\n");
    const { symbols, imports } = analyzeSource("app/items.py", text);
    expect(symbols).toContainEqual(
      expect.objectContaining({
        name: "create_item",
        kind: "route",
        route: "POST /items",
      }),
    );
    expect(symbols).toContainEqual(
      expect.objectContaining({ name: "Item", kind: "class", line: 8 }),
    );
    expect(
      symbols.filter((symbol) => symbol.name === "create_item"),
    ).toHaveLength(1);
    expect(imports).toContainEqual({ specifier: "fastapi", line: 1 });
  });

  it("finds Go functions, types and handlers", () => {
    const text = [
      'import "github.com/jackc/pgx/v5"',
      "type Server struct {}",
      "func (s *Server) Start() {",
      '  http.HandleFunc("/health", s.health)',
      "}",
    ].join("\n");
    const { symbols, imports } = analyzeSource("cmd/server/main.go", text);
    expect(symbols.map((symbol) => symbol.name)).toEqual([
      "Server",
      "Start",
      "ANY /health",
    ]);
    expect(imports[0]?.specifier).toBe("github.com/jackc/pgx/v5");
  });

  it("collects external JS imports and skips relative and built-in ones", () => {
    const text =
      'import fs from "node:fs";\nimport path from "path";\nimport x from "./x";\nimport Stripe from "stripe";\nimport { a } from "@aws-sdk/client-s3";';
    const { imports } = analyzeSource("src/a.ts", text);
    expect(imports.map((entry) => entry.specifier)).toEqual([
      "stripe",
      "@aws-sdk/client-s3",
    ]);
  });
});

describe("nextRouteOf", () => {
  it("maps App Router and Pages API files to URLs", () => {
    expect(nextRouteOf("src/app/api/orders/route.ts")).toBe("/api/orders");
    expect(nextRouteOf("app/(marketing)/feed/route.js")).toBe("/feed");
    expect(nextRouteOf("pages/api/users/index.ts")).toBe("/api/users");
    expect(nextRouteOf("src/lib/route.ts")).toBeNull();
  });
});
