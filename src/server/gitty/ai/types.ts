export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  /** Configured provider id, e.g. "gemma". */
  readonly id: string;
  readonly model: string;
  complete(request: AiRequest): Promise<string>;
  stream(request: AiRequest): AsyncIterable<string>;
}

/** A failure the user can act on; its message is safe to show. */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiNotConfiguredError extends AiProviderError {
  constructor(message: string) {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}
