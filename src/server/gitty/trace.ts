import type { TraceResult, TraceStep } from "~/features/gitty/types";

import { fileId } from "./analysis/build-graph";
import type { AiProvider } from "./ai/types";
import { parseModelJson } from "./model-json";
import { numberedLines, type LoadedRepository } from "./repository";

// Feature tracing is deterministic first: candidate files are scored by how
// strongly they mention the feature, placed in a layer by convention, and
// linked only where one actually imports another. The model may then order
// and explain those candidates, but cannot add a file or a link.

export type Layer = "ui" | "route" | "service" | "data" | "other";

export interface TraceCandidate {
  nodeId: string;
  path: string;
  layer: Layer;
  score: number;
  matched: string[];
  /** First line that mentions the feature. */
  line?: number;
  /** Other candidates this file imports. */
  linksTo: string[];
}

export const NO_EVIDENCE_MESSAGE =
  "I couldn't find enough evidence in this repository to answer that confidently.";

const MAX_CANDIDATES = 10;
const MAX_STEPS = 8;

const STOPWORDS = new Set(
  "the and for with from that this how does what when where which into flow feature trace show work works working handle handled handles user users data file files code app via".split(
    " ",
  ),
);

const LAYER_ORDER: Record<Layer, number> = {
  ui: 0,
  route: 1,
  service: 2,
  other: 2.5,
  data: 3,
};

export function featureTokens(feature: string): string[] {
  const words = feature
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
    .map((word) =>
      word.length > 4 && word.endsWith("s") && !word.endsWith("ss")
        ? word.slice(0, -1)
        : word,
    );
  return [...new Set(words)].slice(0, 8);
}

export function layerOf(
  path: string,
  hasRoute: boolean,
  usesDatabase: boolean,
): Layer {
  const lower = path.toLowerCase();
  if (hasRoute || /(?:^|\/)(?:api|routes?|controllers?|handlers?|endpoints?|views\.py)(?:\/|\.|$)/.test(lower))
    return "route";
  if (usesDatabase || /(?:^|\/)(?:db|database|models?|repositor(?:y|ies)|schema|prisma|drizzle|migrations?|store|dao|entities)(?:\/|\.|$)/.test(lower))
    return "data";
  if (/\.(?:tsx|jsx|vue|svelte)$/.test(lower) || /(?:^|\/)(?:components?|pages|views|screens|ui|templates)\//.test(lower))
    return "ui";
  if (/(?:^|\/)(?:services?|lib|server|core|domain|usecases?|actions?|features?|modules?)\//.test(lower))
    return "service";
  return "other";
}

export function traceCandidates(
  loaded: LoadedRepository,
  feature: string,
): TraceCandidate[] {
  const tokens = featureTokens(feature);
  if (!tokens.length) return [];
  const databaseUsers = new Set(
    loaded.graph.edges
      .filter((edge) => edge.kind === "uses_database" && edge.evidence)
      .map((edge) => edge.evidence!.path),
  );
  const scored: TraceCandidate[] = [];
  for (const [path, text] of loaded.texts) {
    const lowerPath = path.toLowerCase();
    const lowerText = text.toLowerCase();
    const symbols = loaded.analyses.get(path)?.symbols ?? [];
    let score = 0;
    const matched: string[] = [];
    let line: number | undefined;
    for (const token of tokens) {
      let tokenScore = 0;
      if (lowerPath.includes(token)) tokenScore += 6;
      if (symbols.some((symbol) => symbol.name.toLowerCase().includes(token) || symbol.route?.toLowerCase().includes(token)))
        tokenScore += 4;
      let count = 0;
      let at = lowerText.indexOf(token);
      if (at !== -1 && line === undefined)
        line = lowerText.slice(0, at).split("\n").length;
      while (at !== -1 && count < 6) {
        count++;
        at = lowerText.indexOf(token, at + token.length);
      }
      tokenScore += count;
      if (tokenScore) {
        score += tokenScore;
        matched.push(token);
      }
    }
    // Several distinct terms matter more than one repeated term.
    if (!score) continue;
    score *= 1 + (matched.length - 1) * 0.6;
    scored.push({
      nodeId: fileId(path),
      path,
      layer: layerOf(
        path,
        symbols.some((symbol) => symbol.kind === "route"),
        databaseUsers.has(path),
      ),
      score,
      matched,
      line,
      linksTo: [],
    });
  }
  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  const minimum = (scored[0]?.score ?? 0) * 0.2;
  const picked = scored.filter((candidate) => candidate.score >= minimum).slice(0, MAX_CANDIDATES);

  // The data files the picks import complete the flow downwards.
  const pickedPaths = new Set(picked.map((candidate) => candidate.path));
  for (const candidate of [...picked]) {
    if (picked.length >= MAX_CANDIDATES + 2) break;
    for (const target of loaded.references.get(candidate.path) ?? []) {
      if (pickedPaths.has(target) || !databaseUsers.has(target)) continue;
      pickedPaths.add(target);
      picked.push({
        nodeId: fileId(target),
        path: target,
        layer: "data",
        score: 0,
        matched: [],
        linksTo: [],
      });
      break;
    }
  }
  for (const candidate of picked)
    candidate.linksTo = (loaded.references.get(candidate.path) ?? [])
      .filter((target) => pickedPaths.has(target))
      .map(fileId);
  return picked.sort(
    (a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer] || b.score - a.score,
  );
}

function linked(a: TraceCandidate | undefined, b: TraceCandidate): boolean {
  if (!a) return false;
  return a.linksTo.includes(b.nodeId) || b.linksTo.includes(a.nodeId);
}

function graphTrace(feature: string, candidates: TraceCandidate[], note?: string): TraceResult {
  const steps: TraceStep[] = candidates.slice(0, 6).map((candidate, index, list) => ({
    nodeId: candidate.nodeId,
    label: candidate.path.split("/").at(-1) ?? candidate.path,
    path: candidate.path,
    explanation: candidate.matched.length
      ? `${candidate.layer.toUpperCase()} layer · mentions ${candidate.matched.map((token) => `“${token}”`).join(", ")}`
      : `${candidate.layer.toUpperCase()} layer · imported by an earlier step and talks to a database`,
    source: { path: candidate.path, startLine: candidate.line, endLine: candidate.line },
    verifiedLink: linked(list[index - 1], candidate),
  }));
  return {
    feature,
    title: `Files involved in “${feature}”`,
    steps,
    method: "graph",
    note,
  };
}

function excerptAround(loaded: LoadedRepository, candidate: TraceCandidate): string {
  const text = loaded.texts.get(candidate.path);
  if (!text) return "";
  const center = candidate.line ?? 1;
  return numberedLines(text, Math.max(1, center - 4), center + 14).text;
}

export async function runTrace(
  loaded: LoadedRepository,
  feature: string,
  provider: AiProvider | null,
  signal?: AbortSignal,
): Promise<TraceResult> {
  const candidates = traceCandidates(loaded, feature);
  if (!candidates.length)
    return { feature, title: feature, steps: [], method: "graph", note: NO_EVIDENCE_MESSAGE };
  if (!provider)
    return graphTrace(feature, candidates, "AI is not configured, so this is the deterministic ordering only.");

  const byId = new Map(candidates.map((candidate) => [candidate.nodeId, candidate]));
  const prompt = [
    `Trace how the feature "${feature}" flows through this repository.`,
    "You may ONLY use the candidate nodes below. They were found by Gitty's analysis; their layers and import links are facts.",
    'Reply with JSON only: {"title": string, "steps": [{"node_id": string, "line": number, "explanation": string}]}.',
    `Use 2-${MAX_STEPS} steps in execution order (UI → route → service → data). Each explanation: one or two sentences about what that file does in this flow, based only on its excerpt. "line" must be a line number shown in that node's excerpt.`,
    `If the candidates do not actually implement this feature, reply {"title": "", "steps": []}.`,
    "",
    ...candidates.map(
      (candidate) =>
        `CANDIDATE node_id=${candidate.nodeId} layer=${candidate.layer} imports=[${candidate.linksTo.join(", ")}]\n${excerptAround(loaded, candidate)}`,
    ),
  ].join("\n");

  let parsed: unknown;
  try {
    const reply = await provider.complete({
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      maxOutputTokens: 1200,
      signal,
    });
    parsed = parseModelJson(reply);
  } catch (error) {
    signal?.throwIfAborted();
    return graphTrace(
      feature,
      candidates,
      `Gemma was unavailable (${error instanceof Error ? error.message : "error"}), so this is the deterministic ordering only.`,
    );
  }

  const raw = (parsed as { title?: unknown; steps?: unknown } | null) ?? null;
  const rawSteps = Array.isArray(raw?.steps) ? raw.steps : null;
  if (!rawSteps)
    return graphTrace(feature, candidates, "Gemma returned an unusable trace, so this is the deterministic ordering only.");
  if (!rawSteps.length)
    return { feature, title: feature, steps: [], method: "ai", note: NO_EVIDENCE_MESSAGE };

  const steps: TraceStep[] = [];
  const used = new Set<string>();
  let previous: TraceCandidate | undefined;
  for (const entry of rawSteps.slice(0, MAX_STEPS)) {
    const step = entry as { node_id?: unknown; line?: unknown; explanation?: unknown };
    const candidate = typeof step.node_id === "string" ? byId.get(step.node_id) : undefined;
    if (!candidate || used.has(candidate.nodeId)) continue;
    used.add(candidate.nodeId);
    const total = loaded.texts.get(candidate.path)?.split("\n").length ?? 0;
    const line =
      typeof step.line === "number" && Number.isInteger(step.line) && step.line >= 1 && step.line <= total
        ? step.line
        : candidate.line;
    steps.push({
      nodeId: candidate.nodeId,
      label: candidate.path.split("/").at(-1) ?? candidate.path,
      path: candidate.path,
      explanation:
        typeof step.explanation === "string" && step.explanation.trim()
          ? step.explanation.trim().slice(0, 500)
          : `${candidate.layer} layer`,
      source: { path: candidate.path, startLine: line, endLine: line },
      verifiedLink: linked(previous, candidate),
    });
    previous = candidate;
  }
  if (!steps.length)
    return graphTrace(feature, candidates, "Gemma referenced nodes outside the analysis, so this is the deterministic ordering only.");
  return {
    feature,
    title:
      typeof raw?.title === "string" && raw.title.trim()
        ? raw.title.trim().slice(0, 140)
        : `How “${feature}” works`,
    steps,
    method: "ai",
  };
}
