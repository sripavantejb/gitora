/**
 * The first JSON object or array in a model reply, tolerating code fences and
 * surrounding prose. Null when there is none.
 */
export function parseModelJson(reply: string): unknown {
  const text = reply.replace(/```(?:json)?/gi, "").trim();
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
