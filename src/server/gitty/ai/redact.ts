import "server-only";

import type { AiProvider, AiRequest, AiToolSpec, AiToolTurn } from "./types";

export const REDACTED = "[REDACTED]";

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  /\bsk-(?:proj-|ant-|or-v1-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/gi,
];

/** `password = "..."`, `API_KEY: '...'` and the like: keep the name, drop the value. */
const ASSIGNED_SECRET =
  /\b([A-Za-z0-9_.-]*(?:secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["'])([^"'\n]{8,})\3/gi;

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PAT|PATS|CREDENTIAL)S?$/i;

/** This server's own secret values, so they can never reach a model even if a repository echoes them. */
function serverSecrets(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => SECRET_ENV_NAME.test(name) && value && value.trim().length >= 12)
    .flatMap(([, value]) => value!.split(",").map((part) => part.trim()))
    .filter((value) => value.length >= 12);
}

export function redactSecrets(text: string, extra: string[] = serverSecrets()): string {
  let result = text;
  for (const secret of extra) if (result.includes(secret)) result = result.split(secret).join(REDACTED);
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, (match) =>
    match.includes("://") ? match.replace(/:[^:@/]+@$/, `:${REDACTED}@`) : REDACTED,
  );
  return result.replace(ASSIGNED_SECRET, (_match, name: string, separator: string, quote: string) =>
    `${name}${separator}${quote}${REDACTED}${quote}`,
  );
}

function redactRequest<T extends AiRequest>(request: T): T {
  const extra = serverSecrets();
  return {
    ...request,
    messages: request.messages.map((message) => ({ ...message, content: redactSecrets(message.content, extra) })),
  };
}

/** Wraps a provider so every outgoing message is scrubbed of credentials first. */
export function withRedaction(provider: AiProvider): AiProvider {
  const wrapped: AiProvider = {
    id: provider.id,
    model: provider.model,
    complete: (request) => provider.complete(redactRequest(request)),
    stream: (request) => provider.stream(redactRequest(request)),
  };
  if (provider.completeWithTools) {
    const completeWithTools = provider.completeWithTools.bind(provider);
    wrapped.completeWithTools = (request: AiRequest & { tools: AiToolSpec[] }): Promise<AiToolTurn> =>
      completeWithTools(redactRequest(request));
  }
  return wrapped;
}
