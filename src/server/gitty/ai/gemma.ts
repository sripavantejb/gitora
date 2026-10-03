import "server-only";

import {
  describeEndpoint,
  postWithRetry,
  readErrorDetail,
  type EndpointOptions,
} from "./http";
import { DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./openai-compatible";
import { readSseData } from "./sse-lines";
import {
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiRequest,
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiPart {
  text?: string;
  /** Reasoning parts some models return; never shown to users. */
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Gemma on the Gemini API takes no system instruction, so system messages are
 * folded into the first user turn. Consecutive turns of the same role are
 * merged because the API requires them to alternate.
 */
export function toGeminiContents(messages: AiMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const turns: Array<{ role: "user" | "model"; parts: { text: string }[] }> =
    [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "model" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.parts[0]!.text += `\n\n${message.content}`;
    } else {
      turns.push({ role, parts: [{ text: message.content }] });
    }
  }
  if (system) {
    const first = turns[0];
    if (first?.role === "user") {
      first.parts[0]!.text = `${system}\n\n---\n\n${first.parts[0]!.text}`;
    } else {
      turns.unshift({ role: "user", parts: [{ text: system }] });
    }
  }
  return turns;
}

function textOf(response: GeminiResponse): string {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

async function errorFrom(
  response: Response,
  model: string,
): Promise<AiProviderError> {
  const detail = await readErrorDetail(response);
  console.warn(
    JSON.stringify({
      event: "gitty.ai.request_failed",
      provider: "gemma",
      endpoint: "google",
      status: response.status,
      detail: detail.slice(0, 500),
    }),
  );
  if (response.status === 400 && /api key/i.test(detail))
    return new AiProviderError(
      "The Gemma API key was rejected. Check GEMMA_API_KEY.",
      401,
    );
  if (response.status === 400 && /developer instruction|system/i.test(detail))
    return new AiProviderError(
      "This Gemma model rejected the request format.",
      400,
    );
  if (response.status === 401 || response.status === 403)
    return new AiProviderError(
      "The Gemma API key is missing permission for this model.",
      response.status,
    );
  if (response.status === 404)
    return new AiProviderError(
      `The Gemma model "${model}" was not found. Check GEMMA_MODEL.`,
      404,
    );
  if (response.status === 429)
    return new AiProviderError(
      "Gemma is rate limited right now. Try again in a moment.",
      429,
    );
  if (response.status >= 500)
    return new AiProviderError(
      `Gemma had a server error (${response.status}). Try again shortly.`,
      response.status,
    );
  return new AiProviderError(
    `Gemma request failed (${response.status}).`,
    response.status,
  );
}

/** Gemma on Google AI Studio (the Gemini API's native format). */
export class GemmaProvider implements AiProvider {
  readonly id = "gemma";
  private readonly options: EndpointOptions;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = DEFAULT_BASE_URL,
    limits: { timeoutMs?: number; maxRetries?: number } = {},
  ) {
    this.options = {
      label: "Gemma",
      endpoint: describeEndpoint(baseUrl),
      timeoutMs: limits.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: limits.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
  }

  private request(path: string, body: AiRequest) {
    return postWithRetry(
      `${this.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(this.model)}:${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: toGeminiContents(body.messages),
          generationConfig: {
            temperature: body.temperature ?? 0.2,
            maxOutputTokens: body.maxOutputTokens ?? 2048,
          },
        }),
      },
      { ...this.options, signal: body.signal },
    );
  }

  async complete(request: AiRequest): Promise<string> {
    const { response, done } = await this.request("generateContent", request);
    try {
      if (!response.ok) throw await errorFrom(response, this.model);
      const body = (await response.json()) as GeminiResponse;
      if (body.promptFeedback?.blockReason)
        throw new AiProviderError("Gemma declined to answer this request.");
      return textOf(body);
    } finally {
      done();
    }
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const { response, touch, done, timedOut } = await this.request(
      "streamGenerateContent?alt=sse",
      request,
    );
    try {
      if (!response.ok || !response.body)
        throw await errorFrom(response, this.model);
      for await (const data of readSseData(response.body)) {
        touch();
        let chunk: GeminiResponse;
        try {
          chunk = JSON.parse(data) as GeminiResponse;
        } catch {
          continue;
        }
        if (chunk.error?.message)
          throw new AiProviderError("Gemma stopped while answering.");
        const text = textOf(chunk);
        if (text) yield text;
      }
    } catch (error) {
      if (timedOut())
        throw new AiProviderError("Gemma stopped responding mid-answer.", 504);
      throw error;
    } finally {
      done();
    }
  }
}
