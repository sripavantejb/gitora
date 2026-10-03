import { describe, expect, it } from "vitest";

import { readmeMarkdown } from "./readme";

describe("README embeds", () => {
  it("links a picture of the current diagram to the tagged repository page", () => {
    expect(readmeMarkdown("fastapi", "fastapi", "picture")).toBe(
      "[![Architecture diagram of fastapi/fastapi](http://localhost:3000/fastapi/fastapi/diagram.png)](http://localhost:3000/fastapi/fastapi?utm_source=readme&utm_medium=picture)",
    );
  });

  it("links the shared badge to the tagged repository page", () => {
    expect(readmeMarkdown("acme", "demo.js", "badge")).toBe(
      "[![Architecture diagram](http://localhost:3000/diagram-badge.svg)](http://localhost:3000/acme/demo.js?utm_source=readme&utm_medium=badge)",
    );
  });
});
