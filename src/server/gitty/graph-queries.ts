import type {
  CodeNode,
  ImpactEntry,
  ImpactResult,
  SourceRef,
} from "~/features/gitty/types";

import { dirId, evidenceLine, fileId } from "./analysis/build-graph";
import type { ExtractedSymbol } from "./analysis/symbols";
import type { LoadedRepository } from "./repository";

// Every relationship returned here comes from the repository analysis: the
// resolved imports of files Gitty read, or a name match in their text. The
// model receives these results; it never supplies relationships itself.

const MAX_IMPACT_DEPTH = 4;
const MAX_IMPACT_ENTRIES = 80;
const MAX_SEARCH_RESULTS = 40;

const nodeIndexCache = new WeakMap<LoadedRepository, Map<string, CodeNode>>();

export function nodeIndex(loaded: LoadedRepository): Map<string, CodeNode> {
  let index = nodeIndexCache.get(loaded);
  if (!index) {
    index = new Map(loaded.graph.nodes.map((node) => [node.id, node]));
    nodeIndexCache.set(loaded, index);
  }
  return index;
}

export function nodeById(
  loaded: LoadedRepository,
  id: string,
): CodeNode | undefined {
  return nodeIndex(loaded).get(id);
}

/** The repository paths a node stands for. */
export function pathsOfNode(
  loaded: LoadedRepository,
  node: CodeNode,
): string[] {
  if (node.type === "REPOSITORY") return [...loaded.texts.keys()];
  if (node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE")
    return loaded.graph.edges
      .filter((edge) => edge.to === node.id && edge.evidence)
      .map((edge) => edge.evidence!.path);
  if (!node.path) return [];
  if (node.type === "FILE" || node.parentId?.startsWith("file:"))
    return [node.path];
  const prefix = `${node.path}/`;
  return [...loaded.texts.keys()].filter((path) => path.startsWith(prefix));
}

function insideNode(node: CodeNode, path: string): boolean {
  if (!node.path) return false;
  if (node.type === "FILE" || node.parentId?.startsWith("file:"))
    return path === node.path;
  return path === node.path || path.startsWith(`${node.path}/`);
}

export interface Relationship {
  path: string;
  /** The file inside the selected node on this side of the edge. */
  via: string;
  kind: "imports" | "uses_service" | "uses_database";
  evidence?: SourceRef;
}

export function getDependencies(
  loaded: LoadedRepository,
  node: CodeNode,
): Relationship[] {
  const results = new Map<string, Relationship>();
  for (const path of pathsOfNode(loaded, node)) {
    const text = loaded.texts.get(path) ?? "";
    for (const target of loaded.references.get(path) ?? []) {
      if (insideNode(node, target) || results.has(target)) continue;
      const line = evidenceLine(text, target);
      results.set(target, {
        path: target,
        via: path,
        kind: "imports",
        evidence: { path, startLine: line, endLine: line },
      });
    }
  }
  const sources = new Set(pathsOfNode(loaded, node));
  for (const edge of loaded.graph.edges) {
    if (edge.kind === "imports" || !edge.evidence) continue;
    if (!sources.has(edge.evidence.path)) continue;
    const target = nodeIndex(loaded).get(edge.to);
    if (!target || results.has(target.label)) continue;
    results.set(target.label, {
      path: target.label,
      via: edge.evidence.path,
      kind: edge.kind,
      evidence: edge.evidence,
    });
  }
  return [...results.values()];
}

function importersOf(loaded: LoadedRepository, path: string): string[] {
  const direct = loaded.importers.get(path) ?? [];
  // Folder-level references (Go packages, monorepo workspaces) name the folder.
  let folder = path;
  const viaFolders: string[] = [];
  while (folder.includes("/")) {
    folder = folder.slice(0, folder.lastIndexOf("/"));
    for (const importer of loaded.importers.get(folder) ?? [])
      if (!importer.startsWith(`${folder}/`)) viaFolders.push(importer);
  }
  return [...new Set([...direct, ...viaFolders])];
}

export function getDependents(
  loaded: LoadedRepository,
  node: CodeNode,
): Relationship[] {
  const results = new Map<string, Relationship>();
  if (node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE") {
    for (const edge of loaded.graph.edges)
      if (
        edge.to === node.id &&
        edge.evidence &&
        !results.has(edge.evidence.path)
      )
        results.set(edge.evidence.path, {
          path: edge.evidence.path,
          via: node.label,
          kind: edge.kind,
          evidence: edge.evidence,
        });
    return [...results.values()];
  }
  const targets = node.path
    ? [node.path, ...pathsOfNode(loaded, node)]
    : pathsOfNode(loaded, node);
  for (const target of new Set(targets)) {
    for (const importer of importersOf(loaded, target)) {
      if (insideNode(node, importer) || results.has(importer)) continue;
      const line = evidenceLine(loaded.texts.get(importer) ?? "", target);
      results.set(importer, {
        path: importer,
        via: target,
        kind: "imports",
        evidence: { path: importer, startLine: line, endLine: line },
      });
    }
  }
  return [...results.values()];
}

/** Everything that imports the node, directly or through other files. */
export function getImpact(
  loaded: LoadedRepository,
  node: CodeNode,
  maxDepth = MAX_IMPACT_DEPTH,
  maxEntries = MAX_IMPACT_ENTRIES,
): ImpactResult {
  const direct = getDependents(loaded, node);
  const seen = new Set<string>(pathsOfNode(loaded, node));
  if (node.path) seen.add(node.path);
  const directEntries: ImpactEntry[] = [];
  const indirect: ImpactEntry[] = [];
  let frontier: string[] = [];
  for (const relation of direct) {
    if (seen.has(relation.path)) continue;
    seen.add(relation.path);
    directEntries.push({
      nodeId: fileId(relation.path),
      path: relation.path,
      depth: 1,
      via: relation.via,
      evidence: relation.evidence,
    });
    frontier.push(relation.path);
  }
  let truncated = false;
  for (let depth = 2; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const importer of importersOf(loaded, path)) {
        if (seen.has(importer)) continue;
        seen.add(importer);
        if (directEntries.length + indirect.length >= maxEntries) {
          truncated = true;
          continue;
        }
        const line = evidenceLine(loaded.texts.get(importer) ?? "", path);
        indirect.push({
          nodeId: fileId(importer),
          path: importer,
          depth,
          via: path,
          evidence: { path: importer, startLine: line, endLine: line },
        });
        next.push(importer);
      }
    }
    frontier = next;
    if (
      depth === maxDepth &&
      frontier.some((path) =>
        importersOf(loaded, path).some((p) => !seen.has(p)),
      )
    )
      truncated = true;
  }
  return {
    selected: { nodeId: node.id, paths: pathsOfNode(loaded, node) },
    direct: directEntries,
    indirect,
    truncated,
  };
}

export interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

/** Literal, case-insensitive search over the files Gitty has read, plus paths. */
export function searchCode(
  loaded: LoadedRepository,
  query: string,
  limit = 20,
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: SearchHit[] = [];
  const max = Math.min(limit, MAX_SEARCH_RESULTS);
  for (const [path] of loaded.githubData.pathTypes) {
    if (hits.length >= max / 2) break;
    if (
      path.toLowerCase().includes(needle) &&
      loaded.githubData.pathTypes.get(path) === "blob"
    )
      hits.push({ path, line: 1, preview: `(path match) ${path}` });
  }
  for (const [path, text] of loaded.texts) {
    if (hits.length >= max) break;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && hits.length < max; index++) {
      if (lines[index]!.toLowerCase().includes(needle))
        hits.push({
          path,
          line: index + 1,
          preview: lines[index]!.trim().slice(0, 200),
        });
    }
  }
  return hits;
}

export interface SymbolHit {
  name: string;
  kind: ExtractedSymbol["kind"];
  path: string;
  startLine: number;
  endLine: number;
  route?: string;
}

export function findSymbol(
  loaded: LoadedRepository,
  name: string,
  limit = 15,
): SymbolHit[] {
  const wanted = name.trim();
  if (!wanted) return [];
  const exact: SymbolHit[] = [];
  const partial: SymbolHit[] = [];
  const lower = wanted.toLowerCase();
  for (const [path, analysis] of loaded.analyses)
    for (const symbol of analysis.symbols) {
      const hit = {
        name: symbol.name,
        kind: symbol.kind,
        path,
        startLine: symbol.line,
        endLine: symbol.endLine,
        route: symbol.route,
      };
      if (symbol.name === wanted || symbol.route === wanted) exact.push(hit);
      else if (
        symbol.name.toLowerCase().includes(lower) ||
        symbol.route?.toLowerCase().includes(lower)
      )
        partial.push(hit);
    }
  return [...exact, ...partial].slice(0, limit);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word uses of a name in the files Gitty has read. */
export function findReferences(
  loaded: LoadedRepository,
  name: string,
  limit = 30,
): SearchHit[] {
  if (!/^[\w$.:-]{2,120}$/.test(name)) return [];
  const pattern = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);
  const hits: SearchHit[] = [];
  for (const [path, text] of loaded.texts) {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!pattern.test(lines[index]!)) continue;
      hits.push({
        path,
        line: index + 1,
        preview: lines[index]!.trim().slice(0, 200),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function enclosingSymbol(
  loaded: LoadedRepository,
  path: string,
  line: number,
): ExtractedSymbol | undefined {
  let best: ExtractedSymbol | undefined;
  for (const symbol of loaded.analyses.get(path)?.symbols ?? [])
    if (symbol.line <= line && symbol.endLine >= line)
      if (!best || symbol.line >= best.line) best = symbol;
  return best;
}

export interface CallSite {
  path: string;
  line: number;
  caller?: string;
  preview: string;
}

/**
 * Places that call `name(...)`, found by name. Approximate: same-named
 * functions in different files are not told apart.
 */
export function getCallers(
  loaded: LoadedRepository,
  symbol: { name: string; path: string; startLine?: number; endLine?: number },
  limit = 25,
): CallSite[] {
  if (!/^[A-Za-z_$][\w$]*$/.test(symbol.name)) return [];
  const pattern = new RegExp(
    `(?<![\\w$.])${escapeRegExp(symbol.name)}\\s*(?:<[^>]*>)?\\(|\\.${escapeRegExp(symbol.name)}\\s*\\(|<${escapeRegExp(symbol.name)}[\\s/>]`,
  );
  const sites: CallSite[] = [];
  for (const [path, text] of loaded.texts) {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = index + 1;
      if (
        path === symbol.path &&
        symbol.startLine !== undefined &&
        line >= symbol.startLine &&
        line <= (symbol.endLine ?? symbol.startLine)
      )
        continue;
      if (!pattern.test(lines[index]!)) continue;
      if (
        /^\s*(?:export\s+)?(?:async\s+)?(?:function|def|fn|func)\b/.test(
          lines[index]!,
        )
      )
        continue;
      sites.push({
        path,
        line,
        caller: enclosingSymbol(loaded, path, line)?.name,
        preview: lines[index]!.trim().slice(0, 200),
      });
      if (sites.length >= limit) return sites;
    }
  }
  return sites;
}

/** Known symbols called inside a symbol's body (its file and files it imports). */
export function getCallees(
  loaded: LoadedRepository,
  symbol: { name: string; path: string; startLine?: number; endLine?: number },
  limit = 25,
): SymbolHit[] {
  const text = loaded.texts.get(symbol.path);
  if (!text) return [];
  const lines = text.split("\n");
  const start = symbol.startLine ?? 1;
  const end = symbol.endLine ?? lines.length;
  const body = lines.slice(start - 1, end).join("\n");
  const called = new Set<string>();
  for (const match of body.matchAll(
    /(?<![\w$])([A-Za-z_$][\w$]*)\s*\(|<([A-Z][\w$]*)[\s/>]/g,
  ))
    called.add(match[1] ?? match[2]!);
  called.delete(symbol.name);
  const candidates = [
    symbol.path,
    ...(loaded.references.get(symbol.path) ?? []),
  ];
  const hits: SymbolHit[] = [];
  for (const path of candidates) {
    for (const entry of loaded.analyses.get(path)?.symbols ?? []) {
      if (!called.has(entry.name)) continue;
      if (path === symbol.path && entry.line === start) continue;
      hits.push({
        name: entry.name,
        kind: entry.kind,
        path,
        startLine: entry.line,
        endLine: entry.endLine,
      });
      called.delete(entry.name);
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** Child nodes in the hierarchy. */
export function childrenOf(loaded: LoadedRepository, id: string): CodeNode[] {
  return loaded.graph.nodes.filter((node) => node.parentId === id);
}

export function nodeForPath(
  loaded: LoadedRepository,
  path: string,
): CodeNode | undefined {
  const index = nodeIndex(loaded);
  return index.get(fileId(path)) ?? index.get(dirId(path));
}
