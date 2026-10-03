import { z } from "zod";

import type { AskStreamEvent } from "~/features/gitty/types";
import { runAgent } from "~/server/gitty/agent";
import { getAiProvider } from "~/server/gitty/ai/provider";
import { getImpact, nodeById } from "~/server/gitty/graph-queries";
import {
  admitGittyRequest,
  errorResponse,
  json,
  nodeIdSchema,
  repositorySchema,
  toPublicError,
} from "~/server/gitty/http";
import { loadRepository } from "~/server/gitty/repository";
import { NO_STORE_RESPONSE_HEADERS } from "~/server/http/same-origin-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  ...repositorySchema,
  mode: z.enum(["ask", "explain", "why", "impact"]),
  question: z.string().max(2000).default(""),
  nodeId: nodeIdSchema.optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(12)
    .default([]),
});

export async function POST(request: Request) {
  const admitted = await admitGittyRequest(request, schema);
  if (!admitted.ok) return admitted.response;
  const { owner, repo, mode, question, nodeId, history } = admitted.data;
  const hasToken = Boolean(admitted.githubPat);

  let provider;
  let loaded;
  try {
    provider = getAiProvider();
    loaded = await loadRepository({
      owner,
      repo,
      githubPat: admitted.githubPat,
      signal: request.signal,
    });
  } catch (error) {
    return errorResponse(error, hasToken);
  }
  const node = nodeId ? nodeById(loaded, nodeId) : undefined;
  if (nodeId && !node)
    return json({ ok: false, error: "That node is not on the map." }, 404);
  if ((mode === "why" || mode === "impact") && !node)
    return json({ ok: false, error: "Select a node first." }, 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskStreamEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of runAgent({
          loaded,
          provider,
          mode,
          question,
          node,
          impact: mode === "impact" && node ? getImpact(loaded, node) : undefined,
          history,
          signal: request.signal,
        }))
          send(event);
      } catch (error) {
        if (!request.signal.aborted)
          send({ type: "error", message: toPublicError(error, hasToken).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      ...NO_STORE_RESPONSE_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
