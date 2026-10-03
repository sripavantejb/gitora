import type { LearnResult, LearnStep } from "~/features/gitty/types";
import { isManifestPath } from "~/server/generate/repository-context";

import { fileId } from "./analysis/build-graph";
import type { AiProvider } from "./ai/types";
import { nodeIndex } from "./graph-queries";
import { parseModelJson } from "./model-json";
import { numberedLines, type LoadedRepository } from "./repository";
import { layerOf } from "./trace";

const MAX_STEPS = 7;

interface Stop {
  nodeId: string;
  path: string;
  reason: string;
}

/** A reading order chosen from the analysis: overview, entry, core, edges. */
export function learningStops(loaded: LoadedRepository): Stop[] {
  const stops: Stop[] = [];
  const used = new Set<string>();
  const index = nodeIndex(loaded);
  const add = (path: string | undefined, reason: string) => {
    if (!path || used.has(path) || stops.length >= MAX_STEPS) return;
    if (!index.has(fileId(path))) return;
    used.add(path);
    stops.push({ nodeId: fileId(path), path, reason });
  };
  const paths = [...loaded.githubData.pathTypes.keys()];
  add(
    paths.find((path) => /^readme(?:\.\w+)?$/i.test(path)),
    "Project overview",
  );
  add(
    paths.find((path) => !path.includes("/") && isManifestPath(path)),
    "Dependencies and scripts",
  );
  for (const id of loaded.graph.entryPoints.slice(0, 2))
    add(index.get(id)?.path, "Entry point");
  const core = [...loaded.texts.keys()]
    .map((path) => ({ path, users: loaded.importers.get(path)?.length ?? 0 }))
    .filter(
      (entry) =>
        entry.users >= 2 &&
        !/(?:^|\/)(?:types?|constants?|utils?|index)\.[^/]+$/i.test(entry.path),
    )
    .sort((a, b) => b.users - a.users);
  for (const entry of core.slice(0, 2))
    add(entry.path, `Core module (imported by ${entry.users} files)`);
  const route = loaded.graph.nodes.find((node) => node.type === "API_ROUTE");
  add(route?.path, "Request boundary");
  const databaseUser = loaded.graph.edges.find(
    (edge) => edge.kind === "uses_database",
  )?.evidence?.path;
  add(databaseUser, "Data access");
  for (const entry of core.slice(2))
    add(entry.path, `Core module (imported by ${entry.users} files)`);
  return stops;
}

function fallback(stops: Stop[], note: string): LearnResult {
  return {
    method: "graph",
    note,
    steps: stops.map((stop) => ({
      nodeId: stop.nodeId,
      title: stop.reason,
      path: stop.path,
      description: `${stop.path} — ${stop.reason.toLowerCase()}.`,
    })),
  };
}

export async function runLearn(
  loaded: LoadedRepository,
  provider: AiProvider | null,
  signal?: AbortSignal,
): Promise<LearnResult> {
  const stops = learningStops(loaded);
  if (!stops.length)
    return {
      method: "graph",
      steps: [],
      note: "I couldn't find enough evidence in this repository to build a learning path.",
    };
  if (!provider)
    return fallback(
      stops,
      "AI is not configured, so only the reading order is shown.",
    );

  const excerpts = stops.map((stop) => {
    const text =
      loaded.texts.get(stop.path) ??
      (stop.path.toLowerCase().startsWith("readme")
        ? loaded.githubData.readme
        : "");
    return `STOP node_id=${stop.nodeId} path=${stop.path} (${stop.reason}, layer ${layerOf(stop.path, false, false)})\n${text ? numberedLines(text, 1, 40).text : "(not read)"}`;
  });
  let parsed: unknown;
  try {
    const reply = await provider.complete({
      messages: [
        {
          role: "user",
          content: [
            "Write a short learning path for a developer new to this repository. The stops and their order are fixed; describe each one.",
            'Reply with JSON only: {"steps": [{"node_id": string, "title": string, "description": string}]}.',
            "One entry per stop, same order. Title: 2-5 words. Description: 1-2 sentences saying what to look for in that file, based only on its excerpt. Never mention files that are not listed.",
            "",
            ...excerpts,
          ].join("\n"),
        },
      ],
      temperature: 0.2,
      maxOutputTokens: 1200,
      signal,
    });
    parsed = parseModelJson(reply);
  } catch (error) {
    signal?.throwIfAborted();
    return fallback(
      stops,
      `Gemma was unavailable (${error instanceof Error ? error.message : "error"}), so only the reading order is shown.`,
    );
  }
  const raw = (parsed as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(raw))
    return fallback(
      stops,
      "Gemma returned an unusable reply, so only the reading order is shown.",
    );
  const described = new Map<
    string,
    { title?: unknown; description?: unknown }
  >();
  for (const entry of raw)
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as { node_id?: unknown }).node_id === "string"
    )
      described.set(
        (entry as { node_id: string }).node_id,
        entry as { title?: unknown; description?: unknown },
      );
  const steps: LearnStep[] = stops.map((stop) => {
    const entry = described.get(stop.nodeId);
    return {
      nodeId: stop.nodeId,
      path: stop.path,
      title:
        typeof entry?.title === "string" && entry.title.trim()
          ? entry.title.trim().slice(0, 60)
          : stop.reason,
      description:
        typeof entry?.description === "string" && entry.description.trim()
          ? entry.description.trim().slice(0, 400)
          : `${stop.path} — ${stop.reason.toLowerCase()}.`,
    };
  });
  return { method: "ai", steps };
}
