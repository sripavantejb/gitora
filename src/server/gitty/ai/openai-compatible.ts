import { readSseData } from "./sse-lines";
import { AiProviderError, type AiProvider, type AiRequest } from "./types";

const REQUEST_TIMEOUT_MS = 90_000;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    delta?: { content?: string | null };
  }>;
}

/** Any Chat Completions endpoint: OpenAI, OpenRouter, a local server. */
export class OpenAICompatibleProvider implements AiProvider {
  constructor(
    readonly id: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string,
  ) {}

  private request(body: AiRequest, stream: boolean) {
    const signal = body.signal
      ? AbortSignal.any([body.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: body.messages,
        temperature: body.temperature ?? 0.2,
        max_tokens: body.maxOutputTokens ?? 2048,
        stream,
      }),
      signal,
      cache: "no-store",
    });
  }

  private failure(status: number): AiProviderError {
    if (status === 401 || status === 403)
      return new AiProviderError("The AI provider rejected the API key.", status);
    if (status === 429)
      return new AiProviderError(
        "The AI provider is rate limited right now. Try again in a moment.",
        status,
      );
    return new AiProviderError(`AI request failed (${status}).`, status);
  }

  async complete(request: AiRequest): Promise<string> {
    const response = await this.request(request, false);
    if (!response.ok) {
      await response.body?.cancel();
      throw this.failure(response.status);
    }
    const body = (await response.json()) as ChatCompletionResponse;
    return body.choices?.[0]?.message?.content ?? "";
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const response = await this.request(request, true);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw this.failure(response.status);
    }
    for await (const data of readSseData(response.body)) {
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data) as ChatCompletionResponse;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // Keep-alive comments and partial frames are skipped.
      }
    }
  }
}
