import { z } from "zod";

import type { GraphResponse } from "~/features/gitty/types";
import { getAiStatus } from "~/server/gitty/ai/provider";
import {
  admitGittyRequest,
  errorResponse,
  json,
  repositorySchema,
} from "~/server/gitty/http";
import { loadRepository } from "~/server/gitty/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  ...repositorySchema,
  refresh: z.boolean().optional(),
});

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, refresh } = admitted.data;
  try {
    const loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
      refresh,
    });
    const body: GraphResponse = {
      ok: true,
      graph: loaded.graph,
      ai: getAiStatus(),
    };
    return json(body);
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
