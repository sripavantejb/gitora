import { describe, expect, it } from "vitest";

import { ancestorsOf, indexChildren, layoutMap } from "./map-layout";
import type { CodeNode } from "./types";

const nodes: CodeNode[] = [
  { id: "repo", type: "REPOSITORY", label: "acme/shop" },
  { id: "dir:src", type: "DIRECTORY", label: "src", path: "src", parentId: "repo" },
  { id: "file:README.md", type: "FILE", label: "README.md", path: "README.md", parentId: "repo" },
  { id: "file:src/a.ts", type: "FILE", label: "a.ts", path: "src/a.ts", parentId: "dir:src" },
  { id: "file:src/b.ts", type: "FILE", label: "b.ts", path: "src/b.ts", parentId: "dir:src" },
  { id: "sym:src/a.ts#run@1", type: "FUNCTION", label: "run", path: "src/a.ts", parentId: "file:src/a.ts", startLine: 1 },
  { id: "db:postgres", type: "DATABASE", label: "PostgreSQL" },
];

describe("layoutMap", () => {
  const index = indexChildren(nodes);

  it("shows only expanded branches and maps hidden nodes to a visible ancestor", () => {
    const layout = layoutMap(index, new Set(["repo"]), new Map());
    expect(layout.nodes.map((node) => node.id)).toEqual(["repo", "dir:src", "file:README.md", "db:postgres"]);
    expect(layout.visibleFor("sym:src/a.ts#run@1")).toBe("dir:src");
    expect(layout.links).toEqual([
      { from: "repo", to: "dir:src" },
      { from: "repo", to: "file:README.md" },
    ]);
  });

  it("puts directories before files and centres parents on their children", () => {
    const layout = layoutMap(index, new Set(["repo", "dir:src"]), new Map());
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const a = byId.get("file:src/a.ts")!;
    const b = byId.get("file:src/b.ts")!;
    expect(byId.get("dir:src")!.y).toBe((a.y + b.y) / 2);
    expect(byId.get("file:README.md")!.y).toBeGreaterThan(b.y);
    expect(byId.get("db:postgres")!.x).toBeGreaterThan(a.x);
  });

  it("collapses long child lists behind a +N more entry", () => {
    const layout = layoutMap(index, new Set(["repo", "dir:src"]), new Map([["dir:src", 1]]));
    expect(layout.nodes.find((node) => node.id === "more:dir:src")?.more).toEqual({
      parentId: "dir:src",
      hidden: 1,
    });
    expect(layout.visibleFor("file:src/b.ts")).toBe("dir:src");
  });

  it("lists ancestors root first", () => {
    expect(ancestorsOf(index, "sym:src/a.ts#run@1")).toEqual(["repo", "dir:src", "file:src/a.ts"]);
  });
});
