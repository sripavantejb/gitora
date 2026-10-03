import type { SourceRef } from "./types";

// Answers cite code as [[path:start-end]], [[path:line]] or [[path]]. Double
// brackets keep Next.js-style paths ("app/[id]/page.tsx") unambiguous.
const CITATION_PATTERN =
  /\[\[([^\n]+?)(?::(\d+)(?:-(\d+))?)?\]\](?!\])/g;

export interface Citation extends SourceRef {
  raw: string;
}

export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const path = match[1]!.trim();
    const start = match[2] ? Number(match[2]) : undefined;
    const end = match[3] ? Number(match[3]) : start;
    citations.push({
      raw: match[0],
      path,
      startLine: start,
      endLine:
        end !== undefined && start !== undefined && end < start ? start : end,
    });
  }
  return citations;
}

export function citationKey(source: SourceRef): string {
  return source.startLine
    ? `${source.path}:${source.startLine}-${source.endLine ?? source.startLine}`
    : source.path;
}
