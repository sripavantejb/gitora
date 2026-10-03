import { z } from "zod";

import { getAiProvider, getAiStatus } from "~/server/gitty/ai/provider";
import { admitGittyRequest, json, toPublicError } from "~/server/gitty/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Whether Gitty's AI is configured (provider and model only; never endpoints or keys). */
export function GET() {
  return json({ ok: true, ai: getAiStatus() });
}

/** A one-token round trip to the configured model, to verify a deployment's endpoint. */
export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, z.object({}));
  if (!admitted.ok) return admitted.response;
  const ai = getAiStatus();
  if (!ai.configured) return json({ ok: false, ai, error: ai.reason }, 503);
  const started = Date.now();
  try {
    await getAiProvider().complete({
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      temperature: 0,
      maxOutputTokens: 5,
      signal: request.signal,
    });
    return json({ ok: true, ai, latencyMs: Date.now() - started });
  } catch (error) {
    const failure = toPublicError(error, false);
    return json({ ok: false, ai, error: failure.message, error_code: failure.code }, failure.status);
  }
}
