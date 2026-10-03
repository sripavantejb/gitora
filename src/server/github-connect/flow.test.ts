// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseRepository, returnUrl, sanitizeReturnPath } from "./flow";

describe("GitHub connect flow helpers", () => {
  it("accepts only valid owner/repo pairs", () => {
    expect(parseRepository("Octo-Cat/Hello.World")).toEqual({
      owner: "Octo-Cat",
      repo: "Hello.World",
      full: "octo-cat/hello.world",
    });
    for (const bad of [
      null,
      "",
      "owner",
      "a/b/c",
      "-bad/repo",
      "o/..",
      "o/r?x",
    ]) {
      expect(parseRepository(bad)).toBeNull();
    }
  });

  it("only returns to paths on this site", () => {
    expect(sanitizeReturnPath("/browse?page=2")).toBe("/browse?page=2");
    expect(sanitizeReturnPath("/o/r?github=denied&github_from=menu&x=1")).toBe(
      "/o/r?x=1",
    );
    for (const bad of [
      null,
      "",
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "evil",
      "/api/github/connect",
      `/${"a".repeat(600)}`,
    ]) {
      expect(sanitizeReturnPath(bad)).toBeNull();
    }
  });

  it("attaches the outcome for the page that started the sign-in", () => {
    expect(
      returnUrl(
        "http://localhost:3000",
        { returnTo: "/o/r", source: "repo" },
        "connected",
      ).toString(),
    ).toBe("http://localhost:3000/o/r?github=connected");
    expect(
      returnUrl(
        "http://localhost:3000",
        { returnTo: "/browse?page=2", source: "menu" },
        "denied",
      ).toString(),
    ).toBe(
      "http://localhost:3000/browse?page=2&github=denied&github_from=menu",
    );
  });
});
