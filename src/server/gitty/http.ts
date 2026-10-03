import "server-only";

import { z, type ZodType } from "zod";

import {
  EMPTY_REPOSITORY_ERROR,
  REPOSITORY_TOO_LARGE_ERROR,
} from "~/server/generate/github";
import { classifyGitHubError } from "~/server/generate/github-errors";
import {
  consumeRateLimit,
  readEnvInt,
  toRateLimitBucket,
} from "~/server/generate/rate-limit";
import { getClientIp } from "~/server/http/client-ip";
import { resolveRequestCredentials } from "~/server/http/request-credentials";
import {
  NO_STORE_RESPONSE_HEADERS,
  jsonErrorResponse,
  parseSameOriginJsonRequest,
} from "~/server/http/same-origin-json";

import { AiNotConfiguredError, AiProviderError } from "./ai/types";
import { consumeLocalRateLimit } from "./local-rate-limit";

export const repositorySchema = {
  owner: z.string().regex(/^[A-Za-z0-9-_]{1,100}$/),
  repo: z.string().regex(/^[A-Za-z0-9-_.]{1,100}$/),
};

export const nodeIdSchema = z.string().min(1).max(700);

const MAX_BODY_BYTES = 64_000;

async function gittyRateLimit(request: Request) {
  const max = readEnvInt("GITTY_RATE_LIMIT_MAX", 120);
  const windowSeconds = readEnvInt("GITTY_RATE_LIMIT_WINDOW_SECONDS", 600);
  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    const clientIp = getClientIp(request);
    return clientIp
      ? consumeLocalRateLimit(toRateLimitBucket(clientIp), max, windowSeconds)
      : { allowed: true, retryAfterSeconds: 0 };
  }
  return consumeRateLimit({
    clientIp: getClientIp(request),
    buildKey: (clientIp, windowStartSeconds) =>
      `ratelimit:v2:gitty:${encodeURIComponent(toRateLimitBucket(clientIp))}:${windowStartSeconds}`,
    max,
    windowSeconds,
    unavailableEvent: "gitty.rate_limit.unavailable",
  });
}

export type AdmittedRequest<T> =
  { ok: true; data: T; githubPat?: string } | { ok: false; response: Response };

/** Same-origin JSON, a valid payload, the caller's GitHub token and a rate-limit slot. */
export async function admitGittyRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<AdmittedRequest<T>> {
  const parsed = await parseSameOriginJsonRequest(request, {
    schema,
    maxBytes: MAX_BODY_BYTES,
    crossOriginError: "Cross-origin requests are not allowed.",
  });
  if (!parsed.success) return { ok: false, response: parsed.response };
  const limit = await gittyRateLimit(request);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return {
      ok: false,
      response: jsonErrorResponse(
        `Too many requests from this network. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        429,
      ),
    };
  }
  const { githubPat } = await resolveRequestCredentials(request);
  return { ok: true, data: parsed.data, githubPat };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_RESPONSE_HEADERS });
}

export interface PublicError {
  message: string;
  code: string;
  status: number;
}

/** A message safe to show for any failure; upstream bodies stay in the log. */
export function toPublicError(error: unknown, hasToken: boolean): PublicError {
  if (error instanceof AiNotConfiguredError)
    return { message: error.message, code: "AI_NOT_CONFIGURED", status: 503 };
  if (error instanceof AiProviderError)
    return {
      message: error.message,
      code: "AI_PROVIDER_FAILED",
      status: error.status === 429 ? 429 : 502,
    };
  const github = classifyGitHubError(error, hasToken);
  if (github)
    return {
      message:
        github.errorCode === "GITHUB_AUTH_REQUIRED"
          ? "This repository is private. Connect GitHub or add a token with access to explore it."
          : github.errorCode === "REPOSITORY_NOT_FOUND"
            ? "Repository not found. Check the owner and name, or connect GitHub if it is private."
            : github.message,
      code: github.errorCode,
      status: github.status,
    };
  if (error instanceof Error) {
    if (error.message === REPOSITORY_TOO_LARGE_ERROR)
      return {
        message: error.message,
        code: "REPOSITORY_TOO_LARGE",
        status: 413,
      };
    if (error.message === EMPTY_REPOSITORY_ERROR)
      return {
        message:
          "This repository is empty, so there is nothing to explore yet.",
        code: "REPOSITORY_EMPTY",
        status: 422,
      };
    if (error.name === "AbortError" || error.name === "TimeoutError")
      return {
        message: "The request timed out. Please retry.",
        code: "TIMEOUT",
        status: 504,
      };
  }
  console.error(
    JSON.stringify({
      event: "gitty.request_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return {
    message: "Something went wrong. Please retry.",
    code: "INTERNAL",
    status: 500,
  };
}

export function errorResponse(error: unknown, hasToken: boolean): Response {
  const failure = toPublicError(error, hasToken);
  return json(
    { ok: false, error: failure.message, error_code: failure.code },
    failure.status,
  );
}
