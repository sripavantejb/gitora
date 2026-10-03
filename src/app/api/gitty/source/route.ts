import { z } from "zod";

import { languageOf } from "~/server/gitty/analysis/build-graph";
import {
  admitGittyRequest,
  errorResponse,
  json,
  repositorySchema,
} from "~/server/gitty/http";
import { loadRepository, readFile } from "~/server/gitty/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  ...repositorySchema,
  path: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, path } = admitted.data;
  try {
    const loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
    const file = await readFile(loaded, path, request.signal);
    if (!file.ok) return json({ ok: false, error: file.error }, 404);
    return json({
      ok: true,
      path: file.path,
      text: file.text,
      totalLines: file.totalLines,
      language: languageOf(file.path) ?? null,
      githubUrl: `https://github.com/${loaded.owner}/${loaded.repo}/blob/${encodeURIComponent(loaded.githubData.defaultBranch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
    });
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
