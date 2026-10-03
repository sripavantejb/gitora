import { z } from "zod";

import { getAiProvider } from "~/server/gitty/ai/provider";
import { runBrief } from "~/server/gitty/brief";
import { nodeById } from "~/server/gitty/graph-queries";
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

const schema = z.object({ ...repositorySchema, nodeId: nodeIdSchema });

/** GitBrief: a concise Gemma explanation of the clicked map entity. */
export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, nodeId } = admitted.data;
  try {
    const provider = getAiProvider();
    const loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
    const node = nodeById(loaded, nodeId);
    if (!node)
      return json({ ok: false, error: "That node is not on the map." }, 404);
    return json({
      ok: true,
      ...(await runBrief(loaded, node, provider, request.signal)),
    });
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
