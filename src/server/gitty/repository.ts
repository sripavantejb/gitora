import "server-only";

import { createHash } from "node:crypto";

import type { CodebaseGraph } from "~/features/gitty/types";
import { getGitHubApiHeaders } from "~/server/github-auth";
import { getGithubData, type GithubData } from "~/server/generate/github";
import { rankSourcePaths } from "~/server/generate/repository-context";
import { readRepositorySource } from "~/server/generate/source-context";
import { createReferenceResolver } from "~/server/generate/source-references";

import { buildCodebaseGraph } from "./analysis/build-graph";
import type { FileAnalysis } from "./analysis/symbols";
import { checkRepositoryPath } from "./paths";

/** Source files read and analyzed per repository. */
export const MAX_ANALYZED_FILES = 160;
/** Private reads go through the REST API, which has a smaller budget. */
const MAX_ANALYZED_PRIVATE_FILES = 80;
const READ_CONCURRENCY = 8;
const ANALYSIS_DEADLINE_MS = 25_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHED_REPOSITORIES = 6;
const MAX_EXTRA_TEXT_CHARACTERS = 6_000_000;
/** Lines returned per read_file call. */
export const MAX_READ_LINES = 400;

export interface LoadedRepository {
  owner: string;
  repo: string;
  githubData: GithubData;
  githubPat?: string;
  graph: CodebaseGraph;
  analyses: Map<string, FileAnalysis>;
  texts: Map<string, string>;
  /** Analyzed file -> repository paths it imports. */
  references: Map<string, string[]>;
  /** Imported path -> analyzed files that import it. */
  importers: Map<string, string[]>;
  extraCharacters: number;
}

interface CacheEntry {
  expires: number;
  value: Promise<LoadedRepository>;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(owner: string, repo: string, githubPat?: string): string {
  const identity = githubPat?.trim()
    ? createHash("sha256").update(githubPat).digest("hex").slice(0, 24)
    : "public";
  return `${owner.toLowerCase()}/${repo.toLowerCase()}:${identity}`;
}

async function analyze(
  owner: string,
  repo: string,
  githubPat: string | undefined,
  signal?: AbortSignal,
): Promise<LoadedRepository> {
  const githubData = await getGithubData(owner, repo, githubPat, signal);
  const limit = githubData.isPrivate
    ? MAX_ANALYZED_PRIVATE_FILES
    : MAX_ANALYZED_FILES;
  const ranked = rankSourcePaths(githubData, limit);
  const deadline = AbortSignal.timeout(ANALYSIS_DEADLINE_MS);
  const readSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const texts = new Map<string, string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: READ_CONCURRENCY }, async () => {
      while (next < ranked.length && !readSignal.aborted) {
        const path = ranked[next++]!;
        const text = await readRepositorySource({
          username: owner,
          repo,
          githubData,
          path,
          githubPat,
          signal: readSignal,
          apiFallback: githubData.isPrivate,
        });
        if (text !== null) texts.set(path, text);
      }
    }),
  );
  signal?.throwIfAborted();

  const resolve = createReferenceResolver(githubData.pathTypes);
  const references = new Map<string, string[]>();
  const importers = new Map<string, string[]>();
  for (const [path, text] of texts) {
    const targets = resolve(path, text);
    references.set(path, targets);
    for (const target of targets) {
      const list = importers.get(target) ?? [];
      list.push(path);
      importers.set(target, list);
    }
  }

  const { graph, analyses } = buildCodebaseGraph({
    repository: {
      owner,
      repo,
      defaultBranch: githubData.defaultBranch,
      description: githubData.description,
      language: githubData.language,
      stars: githubData.stargazerCount,
      isPrivate: githubData.isPrivate,
      hasReadme: Boolean(githubData.readme),
    },
    pathTypes: githubData.pathTypes,
    treeTruncated: Boolean(githubData.treeTruncated),
    texts,
    references,
    rankedPaths: ranked,
  });

  return {
    owner,
    repo,
    githubData,
    githubPat,
    graph,
    analyses,
    texts,
    references,
    importers,
    extraCharacters: 0,
  };
}

/** The analyzed repository, shared across requests from the same caller. */
export function loadRepository(params: {
  owner: string;
  repo: string;
  githubPat?: string;
  signal?: AbortSignal;
  refresh?: boolean;
}): Promise<LoadedRepository> {
  const key = cacheKey(params.owner, params.repo, params.githubPat);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now && !params.refresh) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.value;
  }
  // The shared analysis outlives any one request, so it is not tied to the
  // first caller's abort signal.
  const value = analyze(params.owner, params.repo, params.githubPat);
  cache.set(key, { expires: now + CACHE_TTL_MS, value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  while (cache.size > MAX_CACHED_REPOSITORIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
  if (!params.signal) return value;
  const signal = params.signal;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    value.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort),
    );
  });
}

export type FileRead =
  | { ok: true; path: string; text: string; totalLines: number }
  | { ok: false; error: string };

/** A validated, read-only fetch of one repository file. */
export async function readFile(
  loaded: LoadedRepository,
  rawPath: unknown,
  signal?: AbortSignal,
): Promise<FileRead> {
  const checked = checkRepositoryPath(rawPath, loaded.githubData.pathTypes);
  if (!checked.ok) return { ok: false, error: checked.reason };
  const { path } = checked;
  let text = loaded.texts.get(path);
  if (text === undefined) {
    const read = await readRepositorySource({
      username: loaded.owner,
      repo: loaded.repo,
      githubData: loaded.githubData,
      path,
      githubPat: loaded.githubPat,
      signal,
    });
    if (read === null)
      return {
        ok: false,
        error: `${path} could not be read (binary, too large, or unavailable).`,
      };
    text = read;
    if (loaded.extraCharacters + text.length <= MAX_EXTRA_TEXT_CHARACTERS) {
      loaded.texts.set(path, text);
      loaded.extraCharacters += text.length;
    }
  }
  return { ok: true, path, text, totalLines: text.split("\n").length };
}

/** Lines `start`..`end` (1-based, inclusive), numbered for citation. */
export function numberedLines(
  text: string,
  start = 1,
  end = start + MAX_READ_LINES - 1,
): { text: string; start: number; end: number } {
  const lines = text.split("\n");
  const from = Math.max(1, Math.min(start, lines.length));
  const to = Math.min(lines.length, Math.max(from, end), from + MAX_READ_LINES - 1);
  return {
    start: from,
    end: to,
    text: lines
      .slice(from - 1, to)
      .map((line, index) => `${from + index}| ${line}`)
      .join("\n"),
  };
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/** Recent commits touching a path, newest first. */
export async function getGitHistory(
  loaded: LoadedRepository,
  path: string | undefined,
  limit = 8,
  signal?: AbortSignal,
): Promise<CommitSummary[]> {
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(loaded.owner)}/${encodeURIComponent(loaded.repo)}/commits`,
  );
  url.searchParams.set("per_page", String(Math.min(20, Math.max(1, limit))));
  url.searchParams.set("sha", loaded.githubData.defaultBranch);
  if (path) url.searchParams.set("path", path);
  const headers = await getGitHubApiHeaders({
    githubPat: loaded.githubData.usedPublicFallback ? undefined : loaded.githubPat,
  });
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`GitHub history is unavailable (${response.status}).`);
  }
  const body = (await response.json()) as Array<{
    sha?: string;
    commit?: {
      message?: string;
      author?: { name?: string; date?: string };
    };
  }>;
  return body.slice(0, limit).map((entry) => ({
    sha: (entry.sha ?? "").slice(0, 7),
    message: (entry.commit?.message ?? "").split("\n")[0]!.slice(0, 200),
    author: entry.commit?.author?.name ?? "unknown",
    date: entry.commit?.author?.date ?? "",
  }));
}