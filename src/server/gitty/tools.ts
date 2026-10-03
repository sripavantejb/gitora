import { z } from "zod";

import type { CodeNode, SourceRef } from "~/features/gitty/types";

import { symbolNameOf } from "./analysis/build-graph";
import { buildNodeContext, repositoryStructure } from "./context";
import {
  findReferences,
  findSymbol,
  getCallees,
  getCallers,
  getDependencies,
  getDependents,
  nodeById,
  nodeForPath,
  searchCode,
} from "./graph-queries";
import { checkRepositoryPath } from "./paths";
import {
  getGitHistory,
  numberedLines,
  readFile,
  type LoadedRepository,
} from "./repository";
import { traceCandidates } from "./trace";

// The only way the model touches the repository. Each tool validates its
// arguments, runs read-only against the analyzed repository and returns a
// bounded JSON result. Nothing here runs commands, writes files or reads
// outside the repository's own listing.

export const MAX_TOOL_RESULT_CHARACTERS = 12_000;

export interface ToolOutput {
  result: unknown;
  /** Repository locations the result showed the model. */
  sources: SourceRef[];
}

interface ToolDefinition<T> {
  name: string;
  description: string;
  /** Argument shape shown to the model. */
  signature: string;
  schema: z.ZodType<T>;
  run(
    loaded: LoadedRepository,
    args: T,
    signal?: AbortSignal,
  ): Promise<ToolOutput> | ToolOutput;
}

function define<T>(definition: ToolDefinition<T>): ToolDefinition<unknown> {
  return definition as ToolDefinition<unknown>;
}

const target = z
  .object({
    node_id: z.string().min(1).max(700).optional(),
    path: z.string().min(1).max(500).optional(),
  })
  .refine((value) => value.node_id || value.path, {
    message: "Give node_id or path.",
  });

type Target = z.infer<typeof target>;

function resolveTarget(loaded: LoadedRepository, args: Target): CodeNode {
  if (args.node_id) {
    const node = nodeById(loaded, args.node_id);
    if (node) return node;
    throw new ToolError(`Unknown node_id: ${args.node_id}`);
  }
  const checked = checkRepositoryPath(args.path, loaded.githubData.pathTypes, "any");
  if (!checked.ok) throw new ToolError(checked.reason);
  const node = nodeForPath(loaded, checked.path);
  if (!node) throw new ToolError(`${checked.path} is not on the map.`);
  return node;
}

function symbolTarget(loaded: LoadedRepository, args: Target) {
  const node = resolveTarget(loaded, args);
  if (!node.parentId?.startsWith("file:") || !node.path)
    throw new ToolError("node_id must be a function, class or route.");
  return {
    name: symbolNameOf(node.id),
    path: node.path,
    startLine: node.startLine,
    endLine: node.endLine,
  };
}

export class ToolError extends Error {}

const relationships = (list: ReturnType<typeof getDependencies>, limit = 40) => ({
  count: list.length,
  items: list.slice(0, limit).map((item) => ({
    path: item.path,
    via: item.via,
    kind: item.kind,
    evidence: item.evidence,
  })),
  note:
    "From resolved imports in the files Gitty analyzed. Dynamic, HTTP, event and configuration wiring is not included.",
});

const evidenceSources = (list: ReturnType<typeof getDependencies>) =>
  list.flatMap((item) => (item.evidence ? [item.evidence] : []));

export const TOOLS: ToolDefinition<unknown>[] = [
  define({
    name: "read_file",
    description: "Read lines of a repository file (max 400 lines per call), numbered for citation.",
    signature: '{"path": string, "start_line"?: number, "end_line"?: number}',
    schema: z.object({
      path: z.string().min(1).max(500),
      start_line: z.number().int().min(1).max(1_000_000).optional(),
      end_line: z.number().int().min(1).max(1_000_000).optional(),
    }),
    async run(loaded, args: { path: string; start_line?: number; end_line?: number }, signal) {
      const file = await readFile(loaded, args.path, signal);
      if (!file.ok) throw new ToolError(file.error);
      const lines = numberedLines(file.text, args.start_line, args.end_line);
      return {
        result: {
          path: file.path,
          lines: `${lines.start}-${lines.end}`,
          total_lines: file.totalLines,
          content: lines.text,
        },
        sources: [{ path: file.path, startLine: lines.start, endLine: lines.end }],
      };
    },
  }),
  define({
    name: "find_symbol",
    description: "Find where a function, class or route is declared.",
    signature: '{"name": string}',
    schema: z.object({ name: z.string().min(1).max(120) }),
    run(loaded, args: { name: string }) {
      const hits = findSymbol(loaded, args.name);
      return {
        result: { matches: hits },
        sources: hits.map((hit) => ({ path: hit.path, startLine: hit.startLine, endLine: hit.endLine })),
      };
    },
  }),
  define({
    name: "find_references",
    description: "Whole-word uses of a name across the analyzed files.",
    signature: '{"name": string}',
    schema: z.object({ name: z.string().min(2).max(120) }),
    run(loaded, args: { name: string }) {
      const hits = findReferences(loaded, args.name);
      return {
        result: { references: hits },
        sources: hits.map((hit) => ({ path: hit.path, startLine: hit.line, endLine: hit.line })),
      };
    },
  }),
  define({
    name: "get_dependencies",
    description: "What a node imports or uses (files, packages in the repo, databases, services).",
    signature: '{"node_id"?: string, "path"?: string}',
    schema: target,
    run(loaded, args: Target) {
      const list = getDependencies(loaded, resolveTarget(loaded, args));
      return { result: relationships(list), sources: evidenceSources(list) };
    },
  }),
  define({
    name: "get_dependents",
    description: "Which analyzed files import or use a node.",
    signature: '{"node_id"?: string, "path"?: string}',
    schema: target,
    run(loaded, args: Target) {
      const list = getDependents(loaded, resolveTarget(loaded, args));
      return { result: relationships(list), sources: evidenceSources(list) };
    },
  }),
  define({
    name: "get_callers",
    description: "Call sites of a function or class (matched by name, so approximate).",
    signature: '{"node_id": string}',
    schema: target,
    run(loaded, args: Target) {
      const sites = getCallers(loaded, symbolTarget(loaded, args));
      return {
        result: { callers: sites, note: "Matched by name; same-named functions are not told apart." },
        sources: sites.map((site) => ({ path: site.path, startLine: site.line, endLine: site.line })),
      };
    },
  }),
  define({
    name: "get_callees",
    description: "Known functions and classes called inside a function's body.",
    signature: '{"node_id": string}',
    schema: target,
    run(loaded, args: Target) {
      const hits = getCallees(loaded, symbolTarget(loaded, args));
      return {
        result: { callees: hits },
        sources: hits.map((hit) => ({ path: hit.path, startLine: hit.startLine, endLine: hit.endLine })),
      };
    },
  }),
  define({
    name: "get_node_context",
    description: "A node's metadata, children, relationships and source excerpt.",
    signature: '{"node_id"?: string, "path"?: string}',
    schema: target,
    async run(loaded, args: Target, signal) {
      const context = await buildNodeContext(loaded, resolveTarget(loaded, args), signal);
      return { result: context.text, sources: context.sources };
    },
  }),
  define({
    name: "get_repository_structure",
    description: "Top-level layout, entry points, languages, services and README excerpt.",
    signature: "{}",
    schema: z.object({}).passthrough(),
    run(loaded) {
      const structure = repositoryStructure(loaded);
      return { result: structure.text, sources: structure.sources };
    },
  }),
  define({
    name: "search_code",
    description: "Literal, case-insensitive text search over analyzed files and all paths.",
    signature: '{"query": string}',
    schema: z.object({ query: z.string().min(2).max(120) }),
    run(loaded, args: { query: string }) {
      const hits = searchCode(loaded, args.query, 30);
      return {
        result: { matches: hits },
        sources: hits.map((hit) => ({ path: hit.path, startLine: hit.line, endLine: hit.line })),
      };
    },
  }),
  define({
    name: "get_git_history",
    description: "Recent commits, optionally for one path.",
    signature: '{"path"?: string}',
    schema: z.object({ path: z.string().min(1).max(500).optional() }),
    async run(loaded, args: { path?: string }, signal) {
      let path: string | undefined;
      if (args.path) {
        const checked = checkRepositoryPath(args.path, loaded.githubData.pathTypes, "any");
        if (!checked.ok) throw new ToolError(checked.reason);
        path = checked.path;
      }
      const commits = await getGitHistory(loaded, path, 8, signal);
      return { result: { path: path ?? "(repository)", commits }, sources: [] };
    },
  }),
  define({
    name: "trace_feature",
    description: "Candidate files for a feature, ordered UI → route → service → data, with import links.",
    signature: '{"feature": string}',
    schema: z.object({ feature: z.string().min(2).max(200) }),
    run(loaded, args: { feature: string }) {
      const candidates = traceCandidates(loaded, args.feature);
      return {
        result: {
          candidates: candidates.map((candidate) => ({
            node_id: candidate.nodeId,
            path: candidate.path,
            layer: candidate.layer,
            matched: candidate.matched,
            imports_next: candidate.linksTo,
          })),
        },
        sources: candidates.map((candidate) => ({ path: candidate.path })),
      };
    },
  }),
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

export function toolCatalog(): string {
  return TOOLS.map(
    (tool) => `- ${tool.name} ${tool.signature}: ${tool.description}`,
  ).join("\n");
}

export type ToolCallResult =
  | { ok: true; name: string; output: ToolOutput; text: string }
  | { ok: false; name: string; error: string };

function truncateResult(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > MAX_TOOL_RESULT_CHARACTERS
    ? `${text.slice(0, MAX_TOOL_RESULT_CHARACTERS)}\n[result truncated]`
    : text;
}

/** Validates and runs one tool call from the model. Never throws. */
export async function executeToolCall(
  loaded: LoadedRepository,
  name: unknown,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolCallResult> {
  const toolName = typeof name === "string" ? name : "";
  const tool = TOOL_MAP.get(toolName);
  if (!tool) return { ok: false, name: toolName, error: `Unknown tool: ${toolName || "(none)"}` };
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success)
    return {
      ok: false,
      name: toolName,
      error: `Invalid arguments for ${toolName}. Expected ${tool.signature}.`,
    };
  try {
    const output = await tool.run(loaded, parsed.data, signal);
    return { ok: true, name: toolName, output, text: truncateResult(output.result) };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      ok: false,
      name: toolName,
      error: error instanceof ToolError ? error.message : `${toolName} failed.`,
    };
  }
}
