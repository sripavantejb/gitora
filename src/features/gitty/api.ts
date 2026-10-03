import type {
  AskMode,
  AskStreamEvent,
  ChatTurn,
  GraphResponse,
  ImpactResult,
  LearnResult,
  SourceRef,
  TraceResult,
} from "./types";

export interface RepoRef {
  owner: string;
  repo: string;
}

export class GittyApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GittyApiError";
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GittyApiError("Network error. Check your connection and retry.");
  }
  const data = (await response.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string; error_code?: string } & T)
    | null;
  if (!response.ok || !data || data.ok === false)
    throw new GittyApiError(
      data?.error ?? `Request failed (${response.status}).`,
      data?.error_code,
      response.status,
    );
  return data;
}

export const fetchGraph = (repo: RepoRef, refresh = false, signal?: AbortSignal) =>
  post<GraphResponse>("/api/gitty/graph", { ...repo, refresh }, signal);

export interface Relation {
  path: string;
  via: string;
  kind: "imports" | "uses_service" | "uses_database";
  evidence?: SourceRef;
}

export const fetchRelations = (
  repo: RepoRef,
  nodeId: string,
  kind: "dependencies" | "dependents",
  signal?: AbortSignal,
) =>
  post<{ relations: Relation[]; total: number; analyzedFiles: number }>(
    "/api/gitty/relations",
    { ...repo, nodeId, kind },
    signal,
  );

export const fetchImpact = (repo: RepoRef, nodeId: string, signal?: AbortSignal) =>
  post<{ impact: ImpactResult }>("/api/gitty/relations", { ...repo, nodeId, kind: "impact" }, signal);

export const fetchTrace = (repo: RepoRef, feature: string, signal?: AbortSignal) =>
  post<{ trace: TraceResult }>("/api/gitty/trace", { ...repo, feature }, signal);

export interface Brief {
  brief: string;
  sources: SourceRef[];
  rejected: string[];
  model: string;
}

export const fetchBrief = (repo: RepoRef, nodeId: string, signal?: AbortSignal) =>
  post<Brief>("/api/gitty/brief", { ...repo, nodeId }, signal);

export const fetchLearn = (repo: RepoRef, signal?: AbortSignal) =>
  post<{ learn: LearnResult }>("/api/gitty/learn", repo, signal);

export interface SourceFile {
  path: string;
  text: string;
  totalLines: number;
  language: string | null;
  githubUrl: string;
}

export const fetchSource = (repo: RepoRef, path: string, signal?: AbortSignal) =>
  post<SourceFile>("/api/gitty/source", { ...repo, path }, signal);

/** Streams /api/gitty/ask events until the answer is done. */
export async function* streamAsk(
  repo: RepoRef,
  request: { mode: AskMode; question: string; nodeId?: string; history: ChatTurn[] },
  signal?: AbortSignal,
): AsyncGenerator<AskStreamEvent> {
  let response: Response;
  try {
    response = await fetch("/api/gitty/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...repo, ...request }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GittyApiError("Network error. Check your connection and retry.");
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: string; error_code?: string } | null;
    throw new GittyApiError(data?.error ?? `Request failed (${response.status}).`, data?.error_code, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          yield JSON.parse(data) as AskStreamEvent;
        } catch {
          // A malformed frame is skipped rather than ending the answer.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
