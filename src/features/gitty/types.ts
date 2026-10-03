// Shared shapes for Gitty's codebase explorer. The graph is built
// deterministically on the server from the repository itself; the model only
// reasons over it and never adds nodes or edges.

export const CODE_NODE_TYPES = [
  "REPOSITORY",
  "APPLICATION",
  "MODULE",
  "DIRECTORY",
  "FILE",
  "CLASS",
  "FUNCTION",
  "API_ROUTE",
  "DATABASE",
  "EXTERNAL_SERVICE",
] as const;

export type CodeNodeType = (typeof CODE_NODE_TYPES)[number];

export interface CodeNode {
  /** Stable id: `repo`, `dir:<path>`, `file:<path>`, `sym:<path>#<name>@<line>`, `ext:<name>`, `db:<name>`. */
  id: string;
  type: CodeNodeType;
  label: string;
  /** Repository path for directories, files and symbols. */
  path?: string;
  parentId?: string;
  startLine?: number;
  endLine?: number;
  /** Files under this node (directories) or 1 (files). */
  fileCount?: number;
  /** Set on files whose source was read and analyzed. */
  analyzed?: boolean;
  language?: string;
  /** HTTP method and route for API_ROUTE symbols. */
  route?: string;
}

export type CodeEdgeKind = "imports" | "uses_service" | "uses_database";

export interface CodeEdge {
  from: string;
  to: string;
  kind: CodeEdgeKind;
  /** Where the relationship is visible in the source. */
  evidence?: SourceRef;
}

export interface SourceRef {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface RepositorySummary {
  owner: string;
  repo: string;
  defaultBranch: string;
  description?: string;
  language?: string;
  stars: number | null;
  isPrivate: boolean;
  hasReadme: boolean;
}

export interface CodebaseGraph {
  repository: RepositorySummary;
  nodes: CodeNode[];
  edges: CodeEdge[];
  /** Likely entry points (file node ids), best first. */
  entryPoints: string[];
  stats: {
    files: number;
    shownFiles: number;
    analyzedFiles: number;
    symbols: number;
    importEdges: number;
    /** GitHub or Gitty listed only part of the repository. */
    truncated: boolean;
  };
  generatedAt: string;
}

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  /** Why the AI layer is unavailable, when it is. */
  reason?: string;
}

export interface GraphResponse {
  ok: true;
  graph: CodebaseGraph;
  ai: AiStatus;
}

export interface ImpactEntry {
  nodeId: string;
  path: string;
  depth: number;
  /** The file it imports on the way to the selected node. */
  via?: string;
  evidence?: SourceRef;
}

export interface ImpactResult {
  selected: { nodeId: string; paths: string[] };
  direct: ImpactEntry[];
  indirect: ImpactEntry[];
  /** More dependents exist than were listed. */
  truncated: boolean;
}

export interface TraceStep {
  nodeId: string;
  label: string;
  path?: string;
  explanation: string;
  source?: SourceRef;
  /** The import graph connects this step to the previous one. */
  verifiedLink: boolean;
}

export interface TraceResult {
  feature: string;
  title: string;
  steps: TraceStep[];
  /** "ai" when the model ordered and explained the steps; "graph" when only the deterministic ordering was available. */
  method: "ai" | "graph";
  note?: string;
}

export interface LearnStep {
  nodeId: string;
  title: string;
  path?: string;
  description: string;
}

export interface LearnResult {
  steps: LearnStep[];
  method: "ai" | "graph";
  note?: string;
}

export type AskMode = "ask" | "explain" | "why" | "impact";

/** Server-sent events from /api/gitty/ask. */
export type AskStreamEvent =
  | { type: "status"; message: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "chunk"; text: string }
  | { type: "sources"; sources: SourceRef[]; rejected: string[] }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
