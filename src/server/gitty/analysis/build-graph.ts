import type {
  CodeEdge,
  CodeNode,
  CodebaseGraph,
  RepositorySummary,
  SourceRef,
} from "~/features/gitty/types";
import type { RepositoryPathType } from "~/server/generate/github";
import { isSensitivePath } from "~/server/generate/repository-context";

import { matchService } from "./services";
import { analyzeSource, ecosystemOf, type FileAnalysis } from "./symbols";

/** Files placed on the map; bigger trees show the most relevant ones. */
export const MAX_GRAPH_FILES = 2500;

const APP_MANIFEST =
  /^(?:package\.json|go\.mod|Cargo\.toml|pyproject\.toml|setup\.py|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|Gemfile|mix\.exs)$/;
const APP_ROOTS = /^(?:apps?|services|cmd|web|frontend|backend|server|client|api)$/i;
const MODULE_ROOTS = /^(?:packages|libs?|crates|modules|internal|pkg)$/i;
const ENTRY_NAME =
  /^(?:main|index|app|server|cli|__main__|manage|wsgi|asgi|program|lib|mod)\.[^/]+$/i;

const LANGUAGES: Array<[RegExp, string]> = [
  [/\.tsx?$/i, "TypeScript"],
  [/\.[cm]?jsx?$/i, "JavaScript"],
  [/\.py$/i, "Python"],
  [/\.go$/i, "Go"],
  [/\.rs$/i, "Rust"],
  [/\.java$/i, "Java"],
  [/\.kts?$/i, "Kotlin"],
  [/\.rb$/i, "Ruby"],
  [/\.php$/i, "PHP"],
  [/\.cs$/i, "C#"],
  [/\.(?:c|h)$/i, "C"],
  [/\.(?:cpp|cc|hpp)$/i, "C++"],
  [/\.swift$/i, "Swift"],
  [/\.vue$/i, "Vue"],
  [/\.svelte$/i, "Svelte"],
  [/\.(?:css|scss)$/i, "CSS"],
  [/\.md$/i, "Markdown"],
  [/\.json$/i, "JSON"],
  [/\.ya?ml$/i, "YAML"],
];

export function languageOf(path: string): string | undefined {
  return LANGUAGES.find(([pattern]) => pattern.test(path))?.[1];
}

export const fileId = (path: string) => `file:${path}`;
export const dirId = (path: string) => `dir:${path}`;
export const symbolId = (path: string, name: string, line: number) =>
  `sym:${path}#${name}@${line}`;
/** The declared name inside a symbol id. */
export const symbolNameOf = (id: string) => {
  const at = id.lastIndexOf("@");
  return id.slice(id.lastIndexOf("#", at) + 1, at);
};

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The line where `text` names `target` (an import line, preferably). */
export function evidenceLine(text: string, target: string): number | undefined {
  const stem = baseName(target).replace(/\.[^.]+$/, "");
  const token = stem === "index" || stem === "__init__" || stem === "mod"
    ? baseName(parentOf(target))
    : stem;
  if (!token) return undefined;
  const lines = text.split("\n");
  let fallback: number | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.includes(token)) continue;
    if (/\b(?:import|from|require|use|include|mod)\b/.test(line)) return index + 1;
    fallback ??= index + 1;
  }
  return fallback;
}

export interface BuildGraphInput {
  repository: RepositorySummary;
  pathTypes: ReadonlyMap<string, RepositoryPathType>;
  treeTruncated: boolean;
  /** Analyzed files' text. */
  texts: ReadonlyMap<string, string>;
  /** For each analyzed file, the repository paths it imports or names. */
  references: ReadonlyMap<string, string[]>;
  /** Paths in reading-priority order, so large trees keep the important ones. */
  rankedPaths: string[];
}

export interface BuiltGraph {
  graph: CodebaseGraph;
  analyses: Map<string, FileAnalysis>;
}

export function buildCodebaseGraph(input: BuildGraphInput): BuiltGraph {
  const allFiles: string[] = [];
  for (const [path, type] of input.pathTypes)
    if (type === "blob" && !isSensitivePath(path)) allFiles.push(path);
  allFiles.sort();

  // Large trees: keep analyzed and ranked files, then the shallowest others.
  let shownFiles = allFiles;
  if (allFiles.length > MAX_GRAPH_FILES) {
    const keep = new Set<string>([...input.texts.keys(), ...input.rankedPaths]);
    const rest = allFiles
      .filter((path) => !keep.has(path))
      .sort(
        (a, b) =>
          a.split("/").length - b.split("/").length || (a < b ? -1 : 1),
      );
    for (const path of rest) {
      if (keep.size >= MAX_GRAPH_FILES) break;
      keep.add(path);
    }
    shownFiles = allFiles.filter((path) => keep.has(path));
  }

  const nodes = new Map<string, CodeNode>();
  const edges: CodeEdge[] = [];
  const { owner, repo } = input.repository;
  nodes.set("repo", {
    id: "repo",
    type: "REPOSITORY",
    label: `${owner}/${repo}`,
    fileCount: allFiles.length,
  });

  const fileCounts = new Map<string, number>();
  for (const path of allFiles) {
    let directory = parentOf(path);
    while (directory) {
      fileCounts.set(directory, (fileCounts.get(directory) ?? 0) + 1);
      directory = parentOf(directory);
    }
  }

  const manifestDirectories = new Set<string>();
  for (const path of allFiles)
    if (APP_MANIFEST.test(baseName(path)) && parentOf(path))
      manifestDirectories.add(parentOf(path));

  const directoryType = (path: string): CodeNode["type"] => {
    const segments = path.split("/");
    const root = segments[0]!;
    if (segments.length === 2 && APP_ROOTS.test(root)) return "APPLICATION";
    if (segments.length === 2 && MODULE_ROOTS.test(root)) return "MODULE";
    if (manifestDirectories.has(path))
      return segments.some((segment) => MODULE_ROOTS.test(segment))
        ? "MODULE"
        : "APPLICATION";
    return "DIRECTORY";
  };

  const ensureDirectory = (path: string): string => {
    if (!path) return "repo";
    const id = dirId(path);
    if (!nodes.has(id)) {
      const parentId = ensureDirectory(parentOf(path));
      nodes.set(id, {
        id,
        type: directoryType(path),
        label: baseName(path),
        path,
        parentId,
        fileCount: fileCounts.get(path) ?? 0,
      });
    }
    return id;
  };

  for (const path of shownFiles) {
    const parentId = ensureDirectory(parentOf(path));
    nodes.set(fileId(path), {
      id: fileId(path),
      type: "FILE",
      label: baseName(path),
      path,
      parentId,
      fileCount: 1,
      analyzed: input.texts.has(path),
      language: languageOf(path),
    });
  }

  const analyses = new Map<string, FileAnalysis>();
  let symbolCount = 0;
  let importEdges = 0;
  const localRoots = new Set(
    allFiles.map((path) => path.split("/")[0]!.replace(/\.py$/, "")),
  );
  for (const [path, text] of input.texts) {
    const from = fileId(path);
    if (!nodes.has(from)) continue;
    const analysis = analyzeSource(path, text);
    analyses.set(path, analysis);
    nodes.get(from)!.endLine = text.split("\n").length;

    for (const symbol of analysis.symbols) {
      if (!symbol.exported && symbol.kind !== "route") continue;
      const id = symbolId(path, symbol.name, symbol.line);
      nodes.set(id, {
        id,
        type:
          symbol.kind === "route"
            ? "API_ROUTE"
            : symbol.kind === "class"
              ? "CLASS"
              : "FUNCTION",
        label: symbol.route ?? symbol.name,
        path,
        parentId: from,
        startLine: symbol.line,
        endLine: symbol.endLine,
        route: symbol.route,
      });
      symbolCount++;
    }

    for (const target of input.references.get(path) ?? []) {
      const to = input.pathTypes.get(target) === "tree" ? dirId(target) : fileId(target);
      if (!nodes.has(to) || to === from) continue;
      const line = evidenceLine(text, target);
      edges.push({
        from,
        to,
        kind: "imports",
        evidence: { path, startLine: line, endLine: line },
      });
      importEdges++;
    }

    const ecosystem = analysis.ecosystem ?? ecosystemOf(path);
    if (!ecosystem) continue;
    const linked = new Set<string>();
    for (const external of analysis.imports) {
      const entry = matchService(ecosystem, external.specifier);
      if (!entry) continue;
      // A Python/Ruby module named like a local package is the local one.
      const first = external.specifier.split(/[./]/)[0]!;
      if ((ecosystem === "py" || ecosystem === "ruby") && localRoots.has(first))
        continue;
      const id = `${entry.kind === "DATABASE" ? "db" : "ext"}:${entry.id}`;
      if (!nodes.has(id))
        nodes.set(id, { id, type: entry.kind, label: entry.label });
      if (linked.has(id)) continue;
      linked.add(id);
      const evidence: SourceRef = {
        path,
        startLine: external.line,
        endLine: external.line,
      };
      edges.push({
        from,
        to: id,
        kind: entry.kind === "DATABASE" ? "uses_database" : "uses_service",
        evidence,
      });
    }
  }

  const importedBy = new Map<string, number>();
  for (const edge of edges)
    if (edge.kind === "imports")
      importedBy.set(edge.to, (importedBy.get(edge.to) ?? 0) + 1);
  const entryPoints = shownFiles
    .filter(
      (path) =>
        ENTRY_NAME.test(baseName(path)) ||
        /(?:^|\/)app\/(?:page|layout)\.[jt]sx?$/.test(path) ||
        /(?:^|\/)cmd\/[^/]+\/main\.go$/.test(path) ||
        /(?:^|\/)src\/main\.rs$/.test(path),
    )
    .filter((path) => input.texts.has(path))
    .sort(
      (a, b) =>
        a.split("/").length - b.split("/").length ||
        (importedBy.get(fileId(a)) ?? 0) - (importedBy.get(fileId(b)) ?? 0) ||
        (a < b ? -1 : 1),
    )
    .slice(0, 6)
    .map(fileId);

  return {
    analyses,
    graph: {
      repository: input.repository,
      nodes: [...nodes.values()],
      edges,
      entryPoints,
      stats: {
        files: allFiles.length,
        shownFiles: shownFiles.length,
        analyzedFiles: analyses.size,
        symbols: symbolCount,
        importEdges,
        truncated: input.treeTruncated || shownFiles.length < allFiles.length,
      },
      generatedAt: new Date().toISOString(),
    },
  };
}
