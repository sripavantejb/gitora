import { z } from "zod";

import {
  getDependencies,
  getDependents,
  getImpact,
  nodeById,
} from "~/server/gitty/graph-queries";
import {
  admitGittyRequest,
  errorResponse,
  json,
  nodeIdSchema,
  repositorySchema,
} from "~/server/gitty/http";
import { loadRepository } from "~/server/gitty/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  ...repositorySchema,
  nodeId: nodeIdSchema,
  kind: z.enum(["dependencies", "dependents", "impact"]),
});

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, nodeId, kind } = admitted.data;
  try {
    const loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
    const node = nodeById(loaded, nodeId);
    if (!node) return json({ ok: false, error: "Unknown node." }, 404);
    if (kind === "impact") return json({ ok: true, impact: getImpact(loaded, node) });
    const list =
      kind === "dependencies"
        ? getDependencies(loaded, node)
        : getDependents(loaded, node);
    return json({
      ok: true,
      relations: list.slice(0, 200),
      total: list.length,
      analyzedFiles: loaded.graph.stats.analyzedFiles,
    });
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
