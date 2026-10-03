import { describe, expect, it } from "vitest";

import { AI_VISIBILITY_PROMPTS, readAnswer, toolsNamed } from "./ai-answer";

describe("reading an assistant's answer", () => {
  it("finds GitDiagram, its place among the tools, and a link to it", () => {
    const text = [
      "Several tools do this:",
      "",
      "- **Swark** is a VS Code extension that draws diagrams with an LLM.",
      "- **GitDiagram** (localhost:3000): swap github.com for localhost:3000 in a repo URL.",
      "- **Mermaid** or PlantUML with an LLM.",
    ].join("\n");
    expect(readAnswer(text, ["http://localhost:3000/"], [])).toEqual({
      mentioned: true,
      cited: true,
      inSources: true,
      position: 2,
      tools: ["Swark", "GitDiagram", "Mermaid", "PlantUML"],
    });
  });

  it("counts a written localhost:3000 link as a citation", () => {
    const reading = readAnswer(
      "Try [GitDiagram](http://localhost:3000/owner/repo) for a quick map.",
    );
    expect(reading.cited).toBe(true);
    expect(reading.position).toBe(1);
  });

  it("does not take Eraser's Git Diagrammer or unrelated hosts for GitDiagram", () => {
    const reading = readAnswer(
      "Eraser's Git Diagrammer draws repos. See https://notgitty.com.evil.io/x",
      ["https://example.com/gitdiagram"],
      ["http://localhost:3000.evil.io/"],
    );
    expect(reading).toMatchObject({
      mentioned: false,
      cited: false,
      inSources: false,
      position: null,
    });
    expect(reading.tools).toEqual(["Eraser"]);
  });

  it("notices GitDiagram only among the pages a search returned", () => {
    expect(
      readAnswer("Use Madge.", [], ["http://localhost:3000/"]),
    ).toMatchObject({ mentioned: false, inSources: true });
  });

  it("names unknown tools from bolded list items, not labels or headings", () => {
    const text = [
      "### 1. Choose the view you need",
      "- **Entry points:** servers and workers.",
      "- **Major modules**",
      "- **Architecture**",
      "- **For a README-ready image**",
      "- **GitHub Insights → Network**",
      "1. **CodeLayers** maps your repo.",
      "2. **Visual Studio Code Maps** (Enterprise only)",
      "3. **dependency-cruiser** for JavaScript.",
    ].join("\n");
    expect(toolsNamed(text)).toEqual([
      "CodeLayers",
      "Visual Studio Code Maps",
      "dependency-cruiser",
    ]);
  });

  it("keeps D2 and Cursor to their product spellings", () => {
    expect(toolsNamed("Move the cursor over a D2 diagram")).toEqual(["D2"]);
    expect(toolsNamed("Ask Cursor to explain it")).toEqual(["Cursor"]);
  });

  it("asks twelve fixed questions with stable, unique ids", () => {
    const ids = AI_VISIBILITY_PROMPTS.map((prompt) => prompt.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
