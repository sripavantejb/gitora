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

/** A function the model may call, described with a JSON Schema for its arguments. */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool call exactly as the model sent it; nothing here has been validated. */
export interface AiToolCall {
  id: string;
  name: string;
  /** The raw JSON argument string from the model. */
  arguments: string;
}

export type AiToolTurn =
  | { kind: "tool_calls"; calls: AiToolCall[] }
  | { kind: "text"; text: string };

export interface AiProvider {
  /** Configured provider id, e.g. "gemma". */
  readonly id: string;
  readonly model: string;
  complete(request: AiRequest): Promise<string>;
  stream(request: AiRequest): AsyncIterable<string>;
  /** Native function calling, when the endpoint supports it. */
  completeWithTools?(request: AiRequest & { tools: AiToolSpec[] }): Promise<AiToolTurn>;
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

/** The endpoint rejected the `tools` parameter; callers fall back to the JSON protocol. */
export class AiToolsUnsupportedError extends AiProviderError {
  constructor() {
    super("The AI endpoint does not support native tool calls.", 400);
    this.name = "AiToolsUnsupportedError";
  }
}
