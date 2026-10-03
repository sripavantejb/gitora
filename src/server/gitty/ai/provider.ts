import "server-only";

import type { AiStatus } from "~/features/gitty/types";

import { GemmaProvider } from "./gemma";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { AiNotConfiguredError, type AiProvider } from "./types";

export const DEFAULT_GEMMA_MODEL = "gemma-4-26b-a4b";

type ProviderId = "gemma" | "openai" | "openrouter" | "openai-compatible";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Gitty's provider: GITTY_AI_PROVIDER, else Gemma. AI_PROVIDER also selects
 * the diagram generator (openai | openrouter), so it only counts here when it
 * says "gemma" (which the generator treats as its OpenAI default).
 */
function providerId(): ProviderId {
  const configured = env("GITTY_AI_PROVIDER")?.toLowerCase();
  if (
    configured === "openai" ||
    configured === "openrouter" ||
    configured === "openai-compatible"
  )
    return configured;
  return "gemma";
}

function describe(): { id: ProviderId; model: string; missing?: string } {
  const id = providerId();
  switch (id) {
    case "gemma":
      return {
        id,
        model: env("GEMMA_MODEL") ?? DEFAULT_GEMMA_MODEL,
        missing:
          env("GEMMA_API_KEY") ?? env("GOOGLE_API_KEY") ?? env("GEMINI_API_KEY")
            ? undefined
            : "GEMMA_API_KEY",
      };
    case "openai":
      return {
        id,
        model: env("GITTY_MODEL") ?? "gpt-4.1-mini",
        missing: env("OPENAI_API_KEY") ? undefined : "OPENAI_API_KEY",
      };
    case "openrouter":
      return {
        id,
        model: env("GITTY_MODEL") ?? "google/gemma-4-26b-a4b-it",
        missing: env("OPENROUTER_API_KEY") ? undefined : "OPENROUTER_API_KEY",
      };
    case "openai-compatible":
      return {
        id,
        model: env("GITTY_MODEL") ?? "",
        missing: !env("GITTY_AI_BASE_URL")
          ? "GITTY_AI_BASE_URL"
          : !env("GITTY_MODEL")
            ? "GITTY_MODEL"
            : undefined,
      };
  }
}

export function getAiStatus(): AiStatus {
  const { id, model, missing } = describe();
  return missing
    ? {
        configured: false,
        provider: id,
        model,
        reason: `Set ${missing} to enable Gitty's AI features.`,
      }
    : { configured: true, provider: id, model };
}

export function getAiProvider(): AiProvider {
  const { id, model, missing } = describe();
  if (missing)
    throw new AiNotConfiguredError(
      `AI is not configured. Set ${missing} to enable Gitty's AI features.`,
    );
  switch (id) {
    case "gemma":
      return new GemmaProvider(
        (env("GEMMA_API_KEY") ?? env("GOOGLE_API_KEY") ?? env("GEMINI_API_KEY"))!,
        model,
        env("GEMMA_BASE_URL"),
      );
    case "openai":
      return new OpenAICompatibleProvider(
        id,
        env("OPENAI_API_KEY")!,
        model,
        "https://api.openai.com/v1",
      );
    case "openrouter":
      return new OpenAICompatibleProvider(
        id,
        env("OPENROUTER_API_KEY")!,
        model,
        "https://openrouter.ai/api/v1",
      );
    case "openai-compatible":
      return new OpenAICompatibleProvider(
        id,
        env("GITTY_AI_API_KEY") ?? "",
        model,
        env("GITTY_AI_BASE_URL")!,
      );
  }
}
