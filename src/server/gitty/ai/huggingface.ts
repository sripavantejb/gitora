import "server-only";

import {
  InferenceClient,
  InferenceClientProviderApiError,
  InferenceClientHubApiError,
} from "@huggingface/inference";

import { backoffDelay, TRANSIENT_STATUSES } from "./http";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./openai-compatible";
import {
  AiProviderError,
  AiToolsUnsupportedError,
  type AiProvider,
  type AiRequest,
  type AiToolSpec,
  type AiToolTurn,
} from "./types";

export const DEFAULT_HF_GEMMA_MODEL = "google/gemma-4-31B-it";

function statusOf(error: unknown): number | undefined {
  return error instanceof InferenceClientProviderApiError ||
    error instanceof InferenceClientHubApiError
    ? error.httpResponse.status
    : undefined;
}

function detailOf(error: unknown): string {
  if (
    error instanceof InferenceClientProviderApiError ||
    error instanceof InferenceClientHubApiError
  ) {
    const body = error.httpResponse.body;
    return typeof body === "string" ? body : JSON.stringify(body);
  }
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Gemma through Hugging Face Inference Providers, authenticated with HF_TOKEN. */
export class HuggingFaceProvider implements AiProvider {
  readonly id = "gemma";
  private readonly client: InferenceClient;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    token: string,
    readonly model = DEFAULT_HF_GEMMA_MODEL,
    limits: { timeoutMs?: number; maxRetries?: number } = {},
  ) {
    this.client = new InferenceClient(token);
    this.timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = limits.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private failure(error: unknown, withTools = false): AiProviderError {
    const status = statusOf(error);
    const detail = detailOf(error);
    console.warn(
      JSON.stringify({
        event: "gitty.ai.request_failed",
        provider: "huggingface",
        status,
        detail: detail.slice(0, 500),
      }),
    );
    if (
      withTools &&
      (status === 400 || status === 422) &&
      /tool|function/i.test(detail)
    )
      return new AiToolsUnsupportedError();
    if (status === 401 || status === 403)
      return new AiProviderError(
        "Hugging Face rejected HF_TOKEN. Check the token and its Inference Providers permission.",
        status,
      );
    if (status === 404 || /does not exist|model_not_found/i.test(detail))
      return new AiProviderError(
        `The model "${this.model}" isn't available on Hugging Face Inference. Check HF_GEMMA_MODEL.`,
        404,
      );
    if (status === 402)
      return new AiProviderError(
        "The Hugging Face account has run out of inference credits.",
        402,
      );
    if (status === 429)
      return new AiProviderError(
        "Gemma on Hugging Face is rate limited right now. Try again in a moment.",
        429,
      );
    if (status && status >= 500)
      return new AiProviderError(
        `Hugging Face had a server error (${status}). Try again shortly.`,
        status,
      );
    if (/timeout/i.test(detail))
      return new AiProviderError(
        `Gemma didn't respond within ${Math.round(this.timeoutMs / 1000)} seconds.`,
        504,
      );
    return new AiProviderError(
      "Gemma request to Hugging Face failed.",
      status ?? 502,
    );
  }

  /** Runs one call with a timeout, retrying transient failures that happen before any output. */
  private async withRetry<T>(
    request: AiRequest,
    run: (signal: AbortSignal) => Promise<T>,
    withTools = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      request.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout;
      try {
        return await run(signal);
      } catch (error) {
        if (request.signal?.aborted) throw error;
        const status = statusOf(error);
        const transient =
          timeout.aborted ||
          status === undefined ||
          TRANSIENT_STATUSES.has(status);
        if (
          transient &&
          !(error instanceof AiProviderError) &&
          attempt < this.maxRetries
        ) {
          await sleep(backoffDelay(attempt, null), request.signal);
          continue;
        }
        if (error instanceof AiProviderError) throw error;
        throw timeout.aborted
          ? new AiProviderError(
              `Gemma didn't respond within ${Math.round(this.timeoutMs / 1000)} seconds.`,
              504,
            )
          : this.failure(error, withTools);
      }
    }
  }

  private args(request: AiRequest) {
    return {
      model: this.model,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxOutputTokens ?? 2048,
    };
  }

  complete(request: AiRequest): Promise<string> {
    return this.withRetry(request, async (signal) => {
      const output = await this.client.chatCompletion(this.args(request), {
        signal,
      });
      return output.choices[0]?.message?.content ?? "";
    });
  }

  completeWithTools(
    request: AiRequest & { tools: AiToolSpec[] },
  ): Promise<AiToolTurn> {
    return this.withRetry(
      request,
      async (signal) => {
        const output = await this.client.chatCompletion(
          {
            ...this.args(request),
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: "auto",
          },
          { signal },
        );
        const message = output.choices[0]?.message;
        const calls = (message?.tool_calls ?? []).map((call, index) => ({
          id: call.id ?? `call_${index}`,
          name: call.function.name,
          arguments:
            typeof call.function.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function.arguments ?? {}),
        }));
        return calls.length
          ? { kind: "tool_calls", calls }
          : { kind: "text", text: message?.content ?? "" };
      },
      true,
    );
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(new Error("timeout")),
        this.timeoutMs,
      );
    };
    const signal = request.signal
      ? AbortSignal.any([request.signal, controller.signal])
      : controller.signal;
    arm();
    try {
      for await (const chunk of this.client.chatCompletionStream(
        this.args(request),
        { signal },
      )) {
        arm();
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    } catch (error) {
      if (request.signal?.aborted) throw error;
      if (controller.signal.aborted)
        throw new AiProviderError("Gemma stopped responding mid-answer.", 504);
      throw this.failure(error);
    } finally {
      clearTimeout(idle);
    }
  }
}
