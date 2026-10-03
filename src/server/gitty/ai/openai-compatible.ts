import "server-only";

import {
  describeEndpoint,
  postWithRetry,
  readErrorDetail,
  type EndpointOptions,
} from "./http";
import { readSseData } from "./sse-lines";
import {
  AiProviderError,
  AiToolsUnsupportedError,
  type AiProvider,
  type AiRequest,
  type AiToolSpec,
  type AiToolTurn,
} from "./types";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;

interface ChatToolCall {
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ChatToolCall[] };
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string } | string;
}

export interface OpenAICompatibleConfig {
  id: string;
  /** Name used in error messages. */
  label?: string;
  model: string;
  /** Up to and including the version segment, e.g. https://host/v1. */
  baseUrl: string;
  /** Optional: self-hosted servers often need none. */
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

/**
 * A server-side client for any OpenAI-compatible `/chat/completions`
 * endpoint: vLLM, Ollama, LM Studio, TGI, OpenRouter, OpenAI or a hosted
 * Gemma. Requests time out, transient failures are retried, and failures
 * become messages that are safe to show (no provider text, no credentials).
 */
export class OpenAICompatibleProvider implements AiProvider {
  readonly id: string;
  readonly model: string;
  private readonly url: string;
  private readonly options: EndpointOptions;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.model = config.model;
    this.url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this.options = {
      label: config.label ?? config.id,
      endpoint: describeEndpoint(config.baseUrl),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
  }

  private send(request: AiRequest, extra: Record<string, unknown>) {
    return postWithRetry(
      this.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify({
          model: this.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxOutputTokens ?? 2048,
          ...extra,
        }),
      },
      { ...this.options, signal: request.signal },
    );
  }

  private async failure(response: Response, withTools = false): Promise<AiProviderError> {
    const detail = await readErrorDetail(response);
    const { label, endpoint } = this.options;
    console.warn(
      JSON.stringify({ event: "gitty.ai.request_failed", provider: this.id, endpoint, status: response.status, detail: detail.slice(0, 500) }),
    );
    const status = response.status;
    if (withTools && (status === 400 || status === 422 || status === 501) && /tool|function/i.test(detail))
      return new AiToolsUnsupportedError();
    if (status === 401 || status === 403)
      return new AiProviderError(`${label} rejected the API key for ${endpoint}. Check the configured key.`, status);
    if (status === 404)
      return /model/i.test(detail)
        ? new AiProviderError(`The model "${this.model}" isn't available at ${endpoint}. Check the model name.`, 404)
        : new AiProviderError(`${endpoint} has no /chat/completions endpoint. The base URL usually ends in /v1.`, 404);
    if (status === 400 && /context|too long|maximum.*tokens|max_tokens|token limit/i.test(detail))
      return new AiProviderError(`The request was too large for the model's context window.`, 400);
    if (status === 429)
      return new AiProviderError(`${label} is rate limited right now. Try again in a moment.`, 429);
    if (status >= 500)
      return new AiProviderError(`${label} had a server error (${status}) at ${endpoint}. Try again shortly.`, status);
    return new AiProviderError(`${label} request failed (${status}).`, status);
  }

  async complete(request: AiRequest): Promise<string> {
    const { response, done } = await this.send(request, { stream: false });
    try {
      if (!response.ok) throw await this.failure(response);
      const body = (await response.json()) as ChatCompletionResponse;
      return body.choices?.[0]?.message?.content ?? "";
    } finally {
      done();
    }
  }

  async completeWithTools(request: AiRequest & { tools: AiToolSpec[] }): Promise<AiToolTurn> {
    const { response, done } = await this.send(request, {
      stream: false,
      tools: request.tools.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: "auto",
    });
    try {
      if (!response.ok) throw await this.failure(response, true);
      const message = ((await response.json()) as ChatCompletionResponse).choices?.[0]?.message;
      const calls = (message?.tool_calls ?? []).flatMap((call, index) =>
        call.function?.name
          ? [
              {
                id: call.id ?? `call_${index}`,
                name: call.function.name,
                arguments:
                  typeof call.function.arguments === "string"
                    ? call.function.arguments
                    : JSON.stringify(call.function.arguments ?? {}),
              },
            ]
          : [],
      );
      return calls.length ? { kind: "tool_calls", calls } : { kind: "text", text: message?.content ?? "" };
    } finally {
      done();
    }
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const timed = await this.send(request, { stream: true });
    const { response, touch, done, timedOut } = timed;
    try {
      if (!response.ok || !response.body) throw await this.failure(response);
      for await (const data of readSseData(response.body)) {
        touch();
        if (data === "[DONE]") return;
        let chunk: ChatCompletionResponse;
        try {
          chunk = JSON.parse(data) as ChatCompletionResponse;
        } catch {
          continue;
        }
        if (chunk.error) throw new AiProviderError(`${this.options.label} stopped while answering.`);
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    } catch (error) {
      if (timedOut())
        throw new AiProviderError(`${this.options.label} stopped responding mid-answer (${this.options.endpoint}).`, 504);
      throw error;
    } finally {
      done();
    }
  }
}
