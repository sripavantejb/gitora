import "server-only";

import type { AiStatus } from "~/features/gitty/types";

import { FallbackProvider } from "./fallback";
import { GemmaProvider } from "./gemma";
import { isLocalEndpoint } from "./http";
import { DEFAULT_HF_GEMMA_MODEL, HuggingFaceProvider } from "./huggingface";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { withRedaction } from "./redact";
import { AiNotConfiguredError, type AiProvider } from "./types";

const DEFAULT_GEMMA_MODEL = "gemma-4-26b-a4b";

type ProviderId = "gemma" | "openai" | "openrouter" | "openai-compatible";
type ToolCalling = "auto" | "native" | "json";

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function int(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(read(env, name));
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

/**
 * Gitty's provider: GITTY_AI_PROVIDER, else AI_PROVIDER when it names a Gitty
 * provider (gemma | openai-compatible), else Gemma. AI_PROVIDER=openai or
 * openrouter configures the diagram generator, so Gitty ignores those values
 * unless GITTY_AI_PROVIDER repeats them.
 */
function providerId(env: Env): ProviderId {
  const gitty = read(env, "GITTY_AI_PROVIDER")?.toLowerCase();
  if (
    gitty === "openai" ||
    gitty === "openrouter" ||
    gitty === "openai-compatible" ||
    gitty === "gemma"
  )
    return gitty;
  const shared = read(env, "AI_PROVIDER")?.toLowerCase();
  if (shared === "openai-compatible") return shared;
  return "gemma";
}

export interface ResolvedAiConfig {
  id: ProviderId;
  model: string;
  /**
   * "openai": any /chat/completions endpoint. "huggingface": HF Inference
   * Providers. "google-openai": Google AI Studio's OpenAI-compatible endpoint.
   * "google": Google AI Studio's native API.
   */
  style: "google" | "google-openai" | "openai" | "huggingface";
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
  toolCalling: ToolCalling;
  /** Why AI can't run, in words an operator can act on. */
  problem?: string;
  /** Used when the primary fails before answering (Google AI Studio). */
  fallback?: ResolvedAiConfig;
}

export const GOOGLE_OPENAI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GOOGLE_GEMMA_MODEL = "gemma-4-26b-a4b-it";
/** Gemma 4 on Google always reasons first, and that counts against max_tokens. */
const GOOGLE_REASONING_TOKENS = 2048;

function checkBaseUrl(
  env: Env,
  name: string,
  baseUrl: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `${name} is not a valid URL.`;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return `${name} must be an http(s) URL.`;
  if (url.username || url.password)
    return `${name} must not contain credentials; use the API key variable instead.`;
  if (read(env, "VERCEL") && isLocalEndpoint(baseUrl))
    return `${name} points to a local address (${url.host}), which a Vercel deployment can't reach. Set it to your production inference endpoint.`;
  return undefined;
}

export function resolveAiConfig(env: Env = process.env): ResolvedAiConfig {
  const id = providerId(env);
  const timeoutMs = int(
    env,
    id === "gemma" ? "GEMMA_TIMEOUT_MS" : "GITTY_AI_TIMEOUT_MS",
    60_000,
    5_000,
    300_000,
  );
  const maxRetries = int(
    env,
    id === "gemma" ? "GEMMA_MAX_RETRIES" : "GITTY_AI_MAX_RETRIES",
    2,
    0,
    5,
  );
  const toolSetting = read(
    env,
    id === "gemma" ? "GEMMA_TOOL_CALLING" : "GITTY_AI_TOOL_CALLING",
  )?.toLowerCase();
  const toolCalling: ToolCalling =
    toolSetting === "native" || toolSetting === "json" ? toolSetting : "auto";
  const base = { id, timeoutMs, maxRetries, toolCalling };

  switch (id) {
    case "gemma": {
      const baseUrl = read(env, "GEMMA_BASE_URL");
      const hfToken = read(env, "HF_TOKEN");
      const googleKey =
        read(env, "GEMMA_API_KEY") ??
        read(env, "GOOGLE_API_KEY") ??
        read(env, "GEMINI_API_KEY");
      const googleModel =
        read(env, "GEMMA_GOOGLE_MODEL") ?? DEFAULT_GOOGLE_GEMMA_MODEL;
      const explicit = read(env, "GEMMA_API_STYLE")?.toLowerCase();
      const style: ResolvedAiConfig["style"] =
        explicit === "google" ||
        explicit === "google-openai" ||
        explicit === "openai" ||
        explicit === "huggingface"
          ? explicit
          : baseUrl
            ? /generativelanguage\.googleapis\.com(?!.*\/openai)/.test(baseUrl)
              ? "google"
              : "openai"
            : hfToken
              ? "huggingface"
              : "google-openai";
      const fallback: ResolvedAiConfig | undefined =
        googleKey &&
        style !== "google" &&
        style !== "google-openai" &&
        read(env, "GEMMA_FALLBACK")?.toLowerCase() !== "off"
          ? {
              ...base,
              style: "google-openai",
              model: googleModel,
              baseUrl: GOOGLE_OPENAI_BASE_URL,
              apiKey: googleKey,
            }
          : undefined;
      if (style === "huggingface")
        return {
          ...base,
          style,
          model: read(env, "HF_GEMMA_MODEL") ?? DEFAULT_HF_GEMMA_MODEL,
          apiKey: hfToken,
          problem: hfToken
            ? undefined
            : "Set HF_TOKEN to use Gemma on Hugging Face.",
          fallback,
        };
      if (style === "google" || style === "google-openai")
        return {
          ...base,
          style,
          model: googleModel,
          baseUrl: style === "google-openai" ? GOOGLE_OPENAI_BASE_URL : baseUrl,
          apiKey: googleKey,
          problem: googleKey
            ? undefined
            : "Set GEMMA_BASE_URL to your Gemma inference endpoint, HF_TOKEN for Hugging Face, or GEMMA_API_KEY for Google AI Studio.",
        };
      return {
        ...base,
        model: read(env, "GEMMA_MODEL") ?? DEFAULT_GEMMA_MODEL,
        style,
        baseUrl,
        apiKey: googleKey,
        problem: baseUrl
          ? checkBaseUrl(env, "GEMMA_BASE_URL", baseUrl)
          : "Set GEMMA_BASE_URL to your Gemma inference endpoint (an OpenAI-compatible /v1 URL).",
        fallback,
      };
    }
    case "openai":
      return {
        ...base,
        style: "openai",
        model: read(env, "GITTY_MODEL") ?? "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        apiKey: read(env, "OPENAI_API_KEY"),
        problem: read(env, "OPENAI_API_KEY")
          ? undefined
          : "Set OPENAI_API_KEY to enable Gitty's AI features.",
      };
    case "openrouter":
      return {
        ...base,
        style: "openai",
        model: read(env, "GITTY_MODEL") ?? "google/gemma-4-26b-a4b-it",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: read(env, "OPENROUTER_API_KEY"),
        problem: read(env, "OPENROUTER_API_KEY")
          ? undefined
          : "Set OPENROUTER_API_KEY to enable Gitty's AI features.",
      };
    case "openai-compatible": {
      const baseUrl = read(env, "GITTY_AI_BASE_URL");
      const model = read(env, "GITTY_MODEL") ?? "";
      return {
        ...base,
        style: "openai",
        model,
        baseUrl,
        apiKey: read(env, "GITTY_AI_API_KEY"),
        problem: !baseUrl
          ? "Set GITTY_AI_BASE_URL to enable Gitty's AI features."
          : (checkBaseUrl(env, "GITTY_AI_BASE_URL", baseUrl) ??
            (!model
              ? "Set GITTY_MODEL to enable Gitty's AI features."
              : undefined)),
      };
    }
  }
}

export function getAiStatus(): AiStatus {
  const { id, model, problem, fallback } = resolveAiConfig();
  if (problem && fallback)
    return { configured: true, provider: id, model: fallback.model };
  return problem
    ? { configured: false, provider: id, model, reason: problem }
    : { configured: true, provider: id, model };
}

function buildProvider(config: ResolvedAiConfig): AiProvider {
  const limits = { timeoutMs: config.timeoutMs, maxRetries: config.maxRetries };
  switch (config.style) {
    case "huggingface":
      return new HuggingFaceProvider(config.apiKey!, config.model, limits);
    case "google":
      return new GemmaProvider(
        config.apiKey!,
        config.model,
        config.baseUrl,
        limits,
      );
    case "google-openai":
      return new OpenAICompatibleProvider({
        id: config.id,
        label: "Gemma (Google AI Studio)",
        model: config.model,
        baseUrl: config.baseUrl!,
        apiKey: config.apiKey,
        reasoningTokens: GOOGLE_REASONING_TOKENS,
        ...limits,
      });
    case "openai":
      return new OpenAICompatibleProvider({
        id: config.id,
        label:
          config.id === "gemma"
            ? "Gemma"
            : config.id === "openrouter"
              ? "OpenRouter"
              : config.id === "openai"
                ? "OpenAI"
                : "The AI endpoint",
        model: config.model,
        baseUrl: config.baseUrl!,
        apiKey: config.apiKey,
        ...limits,
        ...(config.id === "openrouter"
          ? { headers: { "X-Title": "Gitty" } }
          : {}),
      });
  }
}

/** The configured provider, server-side only, with outgoing messages scrubbed of secrets. */
export function getAiProvider(): AiProvider {
  const config = resolveAiConfig();
  if (config.problem && !config.fallback)
    throw new AiNotConfiguredError(`AI is not configured. ${config.problem}`);
  const provider = config.problem
    ? buildProvider(config.fallback!)
    : config.fallback
      ? new FallbackProvider(
          buildProvider(config),
          buildProvider(config.fallback),
        )
      : buildProvider(config);
  const safe = withRedaction(provider);
  if (config.toolCalling === "json") delete safe.completeWithTools;
  return safe;
}

/** Whether the agent must use native tool calls (no JSON fallback). */
export function requiresNativeTools(): boolean {
  return resolveAiConfig().toolCalling === "native";
}
