import "server-only";

import { AiProviderError } from "./types";

/** Statuses worth retrying: timeouts, rate limits and server-side failures. */
export const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_DELAY_MS = 8_000;

export interface EndpointOptions {
  /** Human name used in error messages, e.g. "Gemma". */
  label: string;
  /** Where requests go, for error messages (no credentials). */
  endpoint: string;
  /** Wait for response headers, and the longest silence while reading a body. */
  timeoutMs: number;
  /** Extra attempts after the first for network errors and transient statuses. */
  maxRetries: number;
}

export interface TimedResponse {
  response: Response;
  /** Restart the idle timer (call on every streamed chunk). */
  touch(): void;
  /** Stop the timer once the body is fully read. */
  done(): void;
  /** Whether a failure came from the idle timer rather than the caller. */
  timedOut(): boolean;
}

export function describeEndpoint(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch {
    return "the configured endpoint";
  }
}

export function isLocalEndpoint(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "host.docker.internal" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function backoffDelay(
  attempt: number,
  retryAfter: number | null,
  random = Math.random,
): number {
  const base = retryAfter ?? 500 * 2 ** attempt;
  return Math.min(MAX_RETRY_DELAY_MS, base + Math.floor(random() * 250));
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * POSTs with a per-attempt timeout, retrying network errors and transient
 * statuses with exponential backoff (honouring Retry-After). Returns the last
 * response, ok or not, for the caller to interpret. A caller abort is never
 * retried and is rethrown as is.
 */
export async function postWithRetry(
  url: string,
  init: RequestInit,
  options: EndpointOptions & { signal?: AbortSignal },
): Promise<TimedResponse> {
  const local = isLocalEndpoint(url);
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        expired = true;
        controller.abort(new Error("timeout"));
      }, options.timeoutMs);
    };
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    arm();
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal, cache: "no-store" });
    } catch (error) {
      clearTimeout(timer);
      if (options.signal?.aborted) throw error;
      if (attempt < options.maxRetries) {
        await sleep(backoffDelay(attempt, null), options.signal);
        continue;
      }
      throw expired
        ? new AiProviderError(
            `${options.label} didn't respond within ${Math.round(options.timeoutMs / 1000)} seconds (${options.endpoint}).`,
            504,
          )
        : new AiProviderError(
            `Couldn't reach ${options.label} at ${options.endpoint}.${local ? " Is the local inference server running?" : " Check the endpoint URL and that the server is up."}`,
            502,
          );
    }
    if (
      !response.ok &&
      TRANSIENT_STATUSES.has(response.status) &&
      attempt < options.maxRetries
    ) {
      clearTimeout(timer);
      const wait = retryAfterMs(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => undefined);
      await sleep(backoffDelay(attempt, wait), options.signal);
      continue;
    }
    arm();
    return {
      response,
      touch: arm,
      done: () => clearTimeout(timer),
      timedOut: () => expired,
    };
  }
}

/** The provider's own error text, for server logs only. */
export async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 2000);
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string } | string;
        message?: string;
        detail?: string;
      };
      const error = body.error;
      return (
        (typeof error === "string" ? error : error?.message) ??
        body.message ??
        body.detail ??
        text
      );
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}
