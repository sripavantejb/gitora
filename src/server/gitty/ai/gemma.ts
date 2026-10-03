import { readSseData } from "./sse-lines";
import {
  AiProviderError,
  type AiMessage,
  type AiProvider,
  type AiRequest,
} from "./types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 90_000;

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

async function errorFrom(response: Response): Promise<AiProviderError> {
  let detail = "";
  try {
    const body = (await response.json()) as GeminiResponse;
    detail = body.error?.message ?? "";
  } catch {
    // Non-JSON error bodies carry nothing worth showing.
  }
  if (response.status === 400 && /api key/i.test(detail))
    return new AiProviderError("The Gemma API key was rejected.", 401);
  if (response.status === 401 || response.status === 403)
    return new AiProviderError(
      "The Gemma API key is missing permission for this model.",
      response.status,
    );
  if (response.status === 404)
    return new AiProviderError(
      "The configured Gemma model was not found. Check GEMMA_MODEL.",
      404,
    );
  if (response.status === 429)
    return new AiProviderError(
      "Gemma is rate limited right now. Try again in a moment.",
      429,
    );
  return new AiProviderError(
    `Gemma request failed (${response.status}).`,
    response.status,
  );
}

export class GemmaProvider implements AiProvider {
  readonly id = "gemma";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = DEFAULT_BASE_URL,
  ) {}

  private request(path: string, body: AiRequest) {
    const signal = body.signal
      ? AbortSignal.any([body.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return fetch(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:${path}`,
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
        signal,
        cache: "no-store",
      },
    );
  }

  async complete(request: AiRequest): Promise<string> {
    const response = await this.request("generateContent", request);
    if (!response.ok) throw await errorFrom(response);
    const body = (await response.json()) as GeminiResponse;
    if (body.promptFeedback?.blockReason)
      throw new AiProviderError("Gemma declined to answer this request.");
    return textOf(body);
  }

  async *stream(request: AiRequest): AsyncIterable<string> {
    const response = await this.request(
      "streamGenerateContent?alt=sse",
      request,
    );
    if (!response.ok || !response.body) throw await errorFrom(response);
    for await (const data of readSseData(response.body)) {
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
  }
}
