import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractCitations } from "~/features/gitty/citations";

import { parseDecision } from "./agent";
import { toGeminiContents } from "./ai/gemma";
import { validateCitations } from "./citations";
import { parseModelJson } from "./model-json";
import { checkRepositoryPath } from "./paths";
import { SHOP_FILES, fixtureRepository } from "./test-fixture";
import { executeToolCall } from "./tools";

const loaded = fixtureRepository(SHOP_FILES);
const pathTypes = loaded.githubData.pathTypes;

describe("checkRepositoryPath", () => {
  it.each([
    "../etc/passwd",
    "src/../../secret",
    "/etc/passwd",
    "src\\server\\db.ts",
    "file:///etc/passwd",
    "src/./db.ts",
    "src/server/db.ts\0",
    "",
  ])("rejects %j", (path) => {
    expect(checkRepositoryPath(path, pathTypes).ok).toBe(false);
  });

  it("rejects secrets even when they are in the repository", () => {
    expect(checkRepositoryPath(".env", pathTypes)).toMatchObject({ ok: false });
  });

  it("rejects paths the repository does not have", () => {
    expect(checkRepositoryPath("src/nope.ts", pathTypes)).toMatchObject({
      ok: false,
    });
  });

  it("accepts real files and normalizes a leading ./", () => {
    expect(checkRepositoryPath("./src/server/db.ts", pathTypes)).toEqual({
      ok: true,
      path: "src/server/db.ts",
    });
  });

  it("checks the expected kind", () => {
    expect(checkRepositoryPath("src/server", pathTypes).ok).toBe(false);
    expect(checkRepositoryPath("src/server", pathTypes, "tree").ok).toBe(true);
  });
});

describe("executeToolCall", () => {
  it("reads numbered lines of a real file", async () => {
    const result = await executeToolCall(loaded, "read_file", {
      path: "src/server/db.ts",
      start_line: 2,
      end_line: 3,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.text).toContain("2| import { Pool }");
    expect(result.output.sources).toEqual([
      { path: "src/server/db.ts", startLine: 2, endLine: 3 },
    ]);
  });

  it("refuses traversal, secrets, unknown tools and bad arguments", async () => {
    await expect(
      executeToolCall(loaded, "read_file", { path: "../../etc/passwd" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      executeToolCall(loaded, "read_file", { path: ".env" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      executeToolCall(loaded, "run_shell", { command: "ls" }),
    ).resolves.toMatchObject({
      ok: false,
      error: "Unknown tool: run_shell",
    });
    await expect(
      executeToolCall(loaded, "find_symbol", { name: 42 }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      executeToolCall(loaded, "get_dependencies", {}),
    ).resolves.toMatchObject({ ok: false });
  });

  it("answers graph tools from the analysis", async () => {
    const result = await executeToolCall(loaded, "get_dependents", {
      path: "src/server/db.ts",
    });
    expect(result.ok && result.text).toContain(
      "src/server/orders/repository.ts",
    );
  });
});

describe("citations", () => {
  it("parses double-bracket citations, including bracketed paths", () => {
    expect(
      extractCitations(
        "See [[src/app/[id]/page.tsx:3-9]] and [[src/a.ts:4]] and [[README.md]].",
      ),
    ).toEqual([
      {
        raw: "[[src/app/[id]/page.tsx:3-9]]",
        path: "src/app/[id]/page.tsx",
        startLine: 3,
        endLine: 9,
      },
      { raw: "[[src/a.ts:4]]", path: "src/a.ts", startLine: 4, endLine: 4 },
      {
        raw: "[[README.md]]",
        path: "README.md",
        startLine: undefined,
        endLine: undefined,
      },
    ]);
  });

  it("keeps only citations to files the model was shown, with real lines", async () => {
    const answer =
      "Saves via [[src/server/orders/repository.ts:3-5]]. Also [[src/server/db.ts:1-999]], [[src/invented.ts:1]] and [[src/lib/orders.ts:1]].";
    const check = await validateCitations(
      loaded,
      answer,
      new Set([
        "src/server/orders/repository.ts",
        "src/server/db.ts",
        "src/invented.ts",
      ]),
    );
    expect(check.sources).toEqual([
      { path: "src/server/orders/repository.ts", startLine: 3, endLine: 5 },
    ]);
    expect(check.rejected).toEqual([
      "[[src/server/db.ts:1-999]]",
      "[[src/invented.ts:1]]",
      "[[src/lib/orders.ts:1]]",
    ]);
  });
});

describe("model replies", () => {
  it("extracts JSON from fenced or chatty replies", () => {
    expect(parseModelJson('Sure!\n```json\n{"ready": true}\n```')).toEqual({
      ready: true,
    });
    expect(parseModelJson('{"a": "}"} trailing')).toEqual({ a: "}" });
    expect(parseModelJson("no json here")).toBeNull();
  });

  it("parses tool decisions", () => {
    expect(
      parseDecision('{"tool":"read_file","arguments":{"path":"a.ts"}}'),
    ).toEqual({
      kind: "calls",
      calls: [{ tool: "read_file", arguments: { path: "a.ts" } }],
    });
    expect(
      parseDecision(
        '{"calls":[{"tool":"a"},{"tool":"b"},{"tool":"c"},{"tool":"d"}]}',
      ),
    ).toMatchObject({
      kind: "calls",
      calls: [{ tool: "a" }, { tool: "b" }, { tool: "c" }],
    });
    expect(parseDecision('{"ready": true}')).toEqual({ kind: "ready" });
    expect(parseDecision("I think we should read the file")).toEqual({
      kind: "malformed",
    });
  });
});

describe("toGeminiContents", () => {
  it("folds system text into the first user turn and merges same-role turns", () => {
    expect(
      toGeminiContents([
        { role: "system", content: "Rules" },
        { role: "user", content: "Hi" },
        { role: "user", content: "Again" },
        { role: "assistant", content: "Hello" },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "Rules\n\n---\n\nHi\n\nAgain" }] },
      { role: "model", parts: [{ text: "Hello" }] },
    ]);
  });
});
