import "server-only";

import {
  AiToolsUnsupportedError,
  type AiProvider,
  type AiRequest,
  type AiToolSpec,
  type AiToolTurn,
} from "./types";

function shouldFallBack(error: unknown, signal?: AbortSignal): boolean {
  return !signal?.aborted && !(error instanceof AiToolsUnsupportedError);
}

function logFallback(primary: AiProvider, backup: AiProvider, error: unknown) {
  console.warn(
    JSON.stringify({
      event: "gitty.ai.fallback",
      from: primary.model,
      to: backup.model,
      reason: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * Uses `backup` when `primary` fails before producing output (out of credits,
 * rate limited, unreachable). A stream that already yielded text is never
 * restarted, so an answer is never duplicated. `model` reports whichever
 * provider served the latest call.
 */
export class FallbackProvider implements AiProvider {
  readonly id: string;
  private active: AiProvider;

  constructor(
    private readonly primary: AiProvider,
    private readonly backup: AiProvider,
  ) {
    this.id = primary.id;
    this.active = primary;
  }

  get model(): string {
    return this.active.model;
  }

  async complete(request: AiRequest): Promise<string> {
    try {
      this.active = this.primary;
      return await this.primary.complete(request);
    } catch (error) {
      if (!shouldFallBack(error, request.signal)) throw error;
      logFallback(this.primary, this.backup, error);
      this.active = this.backup;
      return this.backup.complete(request);
    }
  }

  async completeWithTools(
    request: AiRequest & { tools: AiToolSpec[] },
  ): Promise<AiToolTurn> {
    const primary = this.primary.completeWithTools?.bind(this.primary);
    const backup = this.backup.completeWithTools?.bind(this.backup);
    if (!primary && !backup) throw new AiToolsUnsupportedError();
    if (primary)
      try {
        this.active = this.primary;
        return await primary(request);
      } catch (error) {
        if (!backup || !shouldFallBack(error, request.signal)) throw error;
        logFallback(this.primary, this.backup, error);
      }
    this.active = this.backup;
    return backup!(request);
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    let started = false;
    try {
      this.active = this.primary;
      for await (const text of this.primary.stream(request)) {
        started = true;
        yield text;
      }
      return;
    } catch (error) {
      if (started || !shouldFallBack(error, request.signal)) throw error;
      logFallback(this.primary, this.backup, error);
    }
    this.active = this.backup;
    yield* this.backup.stream(request);
  }
}
