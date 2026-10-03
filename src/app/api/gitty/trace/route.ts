import { z } from "zod";

import { getAiProvider } from "~/server/gitty/ai/provider";
import { AiNotConfiguredError } from "~/server/gitty/ai/types";
import {
  admitGittyRequest,
  errorResponse,
  json,
  repositorySchema,
} from "~/server/gitty/http";
import { loadRepository } from "~/server/gitty/repository";
import { runTrace } from "~/server/gitty/trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const schema = z.object({
  ...repositorySchema,
  feature: z.string().trim().min(2).max(200),
});

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, feature } = admitted.data;
  try {
    const loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
    let provider = null;
    try {
      provider = getAiProvider();
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) throw error;
    }
    const trace = await runTrace(loaded, feature, provider, request.signal);
    return json({ ok: true, trace });
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
