import type { CodeNode, SourceRef } from "~/features/gitty/types";

import {
  childrenOf,
  getDependencies,
  getDependents,
  nodeIndex,
  pathsOfNode,
} from "./graph-queries";
import { numberedLines, readFile, type LoadedRepository } from "./repository";

// Context selection: for a node, the facts and source that matter most,
// within a fixed budget. Everything in here was computed from, or read out
// of, the repository; nothing is generated.

const MAX_CONTEXT_CHARACTERS = 30_000;
const MAX_EXCERPT_LINES = 220;
const MAX_LISTED = 25;
const MAX_README_CHARACTERS = 4_000;

export interface SelectedContext {
  text: string;
  sources: SourceRef[];
}

function describeNode(node: CodeNode): string {
  const parts = [
    `${node.type} ${JSON.stringify(node.label)} (node_id: ${node.id})`,
  ];
  if (node.path) parts.push(`path: ${node.path}`);
  if (node.startLine)
    parts.push(`lines: ${node.startLine}-${node.endLine ?? node.startLine}`);
  if (node.route) parts.push(`route: ${node.route}`);
  if (node.fileCount && node.type !== "FILE")
    parts.push(`files: ${node.fileCount}`);
  return parts.join(", ");
}

function ancestry(loaded: LoadedRepository, node: CodeNode): string[] {
  const index = nodeIndex(loaded);
  const chain: string[] = [];
  let parent = node.parentId ? index.get(node.parentId) : undefined;
  while (parent && chain.length < 12) {
    chain.unshift(parent.label);
    parent = parent.parentId ? index.get(parent.parentId) : undefined;
  }
  return chain;
}

export async function buildNodeContext(
  loaded: LoadedRepository,
  node: CodeNode,
  signal?: AbortSignal,
  budget = MAX_CONTEXT_CHARACTERS,
): Promise<SelectedContext> {
  const sections: string[] = [];
  const sources: SourceRef[] = [];
  sections.push(
    `SELECTED NODE\n${describeNode(node)}\nlocation: ${ancestry(loaded, node).join(" / ") || "(root)"}`,
  );

  if (node.type === "REPOSITORY") {
    const structure = repositoryStructure(loaded);
    sections.push(structure.text);
    sources.push(...structure.sources);
  }

  const children = childrenOf(loaded, node.id);
  if (children.length && node.type !== "REPOSITORY") {
    const shown = children
      .slice()
      .sort((a, b) => (b.fileCount ?? 0) - (a.fileCount ?? 0))
      .slice(0, MAX_LISTED);
    sections.push(
      `CHILDREN (${children.length})\n${shown.map((child) => `- ${describeNode(child)}`).join("\n")}${children.length > shown.length ? `\n- … ${children.length - shown.length} more` : ""}`,
    );
  }

  const dependencies = getDependencies(loaded, node);
  const dependents = getDependents(loaded, node);
  const relation = (list: typeof dependencies) =>
    list
      .slice(0, MAX_LISTED)
      .map(
        (item) =>
          `- ${item.path} (${item.kind}; ${item.evidence?.path ?? item.via}${item.evidence?.startLine ? `:${item.evidence.startLine}` : ""})`,
      )
      .join("\n") || "- none found";
  sections.push(
    `DEPENDENCIES (what it imports/uses, from resolved imports: ${dependencies.length})\n${relation(dependencies)}`,
  );
  sections.push(
    `DEPENDENTS (analyzed files that import it: ${dependents.length})\n${relation(dependents)}`,
  );
  for (const list of [dependencies, dependents])
    for (const item of list.slice(0, MAX_LISTED))
      if (item.evidence) sources.push(item.evidence);

  // Source: the node's own span, or the most connected files inside it.
  let used = sections.join("\n\n").length;
  const excerptPaths: Array<{ path: string; start?: number; end?: number }> =
    [];
  if (node.path && (node.type === "FILE" || node.parentId?.startsWith("file:")))
    excerptPaths.push({
      path: node.path,
      start: node.startLine,
      end: node.endLine,
    });
  else if (
    node.type !== "REPOSITORY" &&
    node.type !== "DATABASE" &&
    node.type !== "EXTERNAL_SERVICE"
  ) {
    const inside = pathsOfNode(loaded, node);
    const degree = (path: string) =>
      (loaded.importers.get(path)?.length ?? 0) * 2 +
      (loaded.references.get(path)?.length ?? 0);
    for (const path of inside.sort((a, b) => degree(b) - degree(a)).slice(0, 4))
      excerptPaths.push({ path });
  } else if (node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE") {
    for (const item of dependents.slice(0, 4))
      excerptPaths.push({
        path: item.path,
        start: Math.max(1, (item.evidence?.startLine ?? 1) - 5),
        end: (item.evidence?.startLine ?? 1) + 60,
      });
  }

  for (const excerpt of excerptPaths) {
    if (used >= budget) break;
    const file = await readFile(loaded, excerpt.path, signal);
    if (!file.ok) continue;
    const lineBudget = Math.max(
      30,
      Math.min(MAX_EXCERPT_LINES, Math.floor((budget - used) / 60)),
    );
    const start = excerpt.start ?? 1;
    const end = Math.min(
      excerpt.end ?? start + lineBudget - 1,
      start + lineBudget - 1,
    );
    const lines = numberedLines(file.text, start, end);
    const block = `SOURCE ${file.path} lines ${lines.start}-${lines.end} of ${file.totalLines}\n${lines.text}\nEND SOURCE`;
    const room = budget - used;
    if (room < 400) break;
    sections.push(
      block.length > room
        ? `${block.slice(0, room)}\n[excerpt truncated]`
        : block,
    );
    used += Math.min(block.length, room);
    sources.push({
      path: file.path,
      startLine: lines.start,
      endLine: lines.end,
    });
  }

  return { text: sections.join("\n\n"), sources };
}

export function repositoryStructure(loaded: LoadedRepository): SelectedContext {
  const { graph, githubData } = loaded;
  const index = nodeIndex(loaded);
  const top = graph.nodes
    .filter((node) => node.parentId === "repo")
    .sort((a, b) => (b.fileCount ?? 0) - (a.fileCount ?? 0))
    .slice(0, 30);
  const languages = new Map<string, number>();
  for (const node of graph.nodes)
    if (node.type === "FILE" && node.language)
      languages.set(node.language, (languages.get(node.language) ?? 0) + 1);
  const services = graph.nodes.filter(
    (node) => node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE",
  );
  const routes = graph.nodes
    .filter((node) => node.type === "API_ROUTE")
    .slice(0, 30);
  const readme = githubData.readme.slice(0, MAX_README_CHARACTERS);
  const readmePath = [...githubData.pathTypes.keys()].find((path) =>
    /^readme(?:\.\w+)?$/i.test(path),
  );
  const lines = [
    `REPOSITORY ${graph.repository.owner}/${graph.repository.repo} (default branch ${graph.repository.defaultBranch})`,
    graph.repository.description
      ? `description: ${graph.repository.description}`
      : "",
    `files: ${graph.stats.files}, analyzed: ${graph.stats.analyzedFiles}, symbols: ${graph.stats.symbols}, import edges: ${graph.stats.importEdges}${graph.stats.truncated ? " (partial: large repository)" : ""}`,
    `languages: ${
      [...languages]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => `${name} ${count}`)
        .join(", ") || "unknown"
    }`,
    `TOP LEVEL\n${top.map((node) => `- ${node.type} ${node.path ?? node.label}${node.type === "FILE" ? "" : ` (${node.fileCount} files)`} [${node.id}]`).join("\n")}`,
    `ENTRY POINTS (by convention)\n${graph.entryPoints.map((id) => `- ${index.get(id)?.path ?? id}`).join("\n") || "- none identified"}`,
    `DATABASES AND SERVICES (from imports)\n${services.map((node) => `- ${node.label} [${node.id}]`).join("\n") || "- none detected"}`,
    `API ROUTES\n${routes.map((node) => `- ${node.label} in ${node.path}:${node.startLine}`).join("\n") || "- none detected"}`,
    readme
      ? `README EXCERPT (${readmePath ?? "README"})\n${readme}\nEND README`
      : "README: none",
  ].filter(Boolean);
  const sources: SourceRef[] = [];
  if (readme && readmePath) sources.push({ path: readmePath });
  for (const id of graph.entryPoints) {
    const path = index.get(id)?.path;
    if (path) sources.push({ path });
  }
  for (const node of routes)
    if (node.path)
      sources.push({
        path: node.path,
        startLine: node.startLine,
        endLine: node.endLine,
      });
  return { text: lines.join("\n\n"), sources };
}
