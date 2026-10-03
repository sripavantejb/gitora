import type { CodeNode, SourceRef } from "~/features/gitty/types";

import type { AiProvider } from "./ai/types";
import { validateCitations } from "./citations";
import { buildNodeContext } from "./context";
import type { LoadedRepository } from "./repository";
import { NO_EVIDENCE_MESSAGE } from "./trace";

export interface BriefResult {
  brief: string;
  sources: SourceRef[];
  rejected: string[];
  model: string;
}

const BRIEF_CACHE_LIMIT = 500;
const cache = new Map<string, BriefResult>();

const INSTRUCTIONS = `You are GitBrief, a code explainer. Using ONLY the context below, explain the selected entity to a developer seeing it for the first time.
- At most 90 words: one sentence on what it is, then up to 3 short bullets on what it does and how it connects.
- Cite code inline as [[path:start-end]] using only paths and line numbers shown in the context.
- Never invent files, functions, dependencies or behavior. If the context is not enough, reply exactly: "${NO_EVIDENCE_MESSAGE}"`;

/** A short, cited explanation of one map entity, cached per repository snapshot. */
export async function runBrief(
  loaded: LoadedRepository,
  node: CodeNode,
  provider: AiProvider,
  signal?: AbortSignal,
): Promise<BriefResult> {
  const { owner, repo } = loaded.graph.repository;
  const key = `${owner}/${repo}@${loaded.graph.generatedAt}#${node.id}:${provider.model}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const context = await buildNodeContext(loaded, node, signal);
  const answer =
    (
      await provider.complete({
        messages: [
          { role: "system", content: INSTRUCTIONS },
          {
            role: "user",
            content: `CONTEXT\n${context.text}\n\nExplain ${node.type} ${node.label}.`,
          },
        ],
        temperature: 0.2,
        maxOutputTokens: 400,
        signal,
      })
    ).trim() || NO_EVIDENCE_MESSAGE;
  const check = await validateCitations(
    loaded,
    answer,
    new Set(context.sources.map((source) => source.path)),
    signal,
  );
  const result: BriefResult = {
    brief: answer,
    sources: check.sources,
    rejected: check.rejected,
    model: provider.model,
  };
  if (cache.size >= BRIEF_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
