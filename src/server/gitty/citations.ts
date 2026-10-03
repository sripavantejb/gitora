import { citationKey, extractCitations } from "~/features/gitty/citations";
import type { SourceRef } from "~/features/gitty/types";

import { readFile, type LoadedRepository } from "./repository";

export interface CitationCheck {
  sources: SourceRef[];
  /** Citations that were removed from the evidence: wrong path, unseen file or lines out of range. */
  rejected: string[];
}

/**
 * Keeps only citations that point at a file the model was actually shown,
 * with lines that exist in it. Anything else is reported as rejected, so the
 * interface never presents an invented reference as real.
 */
export async function validateCitations(
  loaded: LoadedRepository,
  answer: string,
  seenPaths: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<CitationCheck> {
  const sources = new Map<string, SourceRef>();
  const rejected = new Set<string>();
  for (const citation of extractCitations(answer)) {
    const path = citation.path.replace(/^\.\//, "");
    if (!seenPaths.has(path)) {
      rejected.add(citation.raw);
      continue;
    }
    const file = await readFile(loaded, path, signal);
    if (!file.ok) {
      rejected.add(citation.raw);
      continue;
    }
    if (
      citation.startLine !== undefined &&
      (citation.startLine < 1 ||
        (citation.endLine ?? citation.startLine) > file.totalLines)
    ) {
      rejected.add(citation.raw);
      continue;
    }
    const source: SourceRef = {
      path: file.path,
      startLine: citation.startLine,
      endLine: citation.endLine,
    };
    sources.set(citationKey(source), source);
  }
  return { sources: [...sources.values()], rejected: [...rejected] };
}
