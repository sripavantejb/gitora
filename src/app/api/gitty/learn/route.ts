import { z } from "zod";

import { getAiProvider } from "~/server/gitty/ai/provider";
import { AiNotConfiguredError } from "~/server/gitty/ai/types";
import {
  admitGittyRequest,
  errorResponse,
  json,
  repositorySchema,
} from "~/server/gitty/http";
import { runLearn } from "~/server/gitty/learn";
import { loadRepository } from "~/server/gitty/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const schema = z.object(repositorySchema);

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  try {
    const loaded = await loadRepository({
      ...admitted.data,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
    let provider = null;
    try {
      provider = getAiProvider();
    } catch (error) {
      if (!(error instanceof AiNotConfiguredError)) throw error;
    }
    const learn = await runLearn(loaded, provider, request.signal);
    return json({ ok: true, learn });
  } catch (error) {
    return errorResponse(error, Boolean(admitted.githubPat));
  }
}
