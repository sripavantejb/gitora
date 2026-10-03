const OPEN = "<thought>";
const CLOSE = "</thought>";

/** Length of the longest suffix of `text` that could start `tag`. */
function partialSuffix(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--)
    if (tag.startsWith(text.slice(-length))) return length;
  return 0;
}

/**
 * Removes `<thought>…</thought>` reasoning that some endpoints (Gemma 4 on
 * Google's OpenAI-compatible API) put inline in the answer, including tags
 * split across streamed chunks.
 */
export class ThoughtFilter {
  private inThought = false;
  private pending = "";
  private started = false;

  push(text: string): string {
    let rest = this.pending + text;
    this.pending = "";
    let out = "";
    while (rest) {
      if (this.inThought) {
        const end = rest.indexOf(CLOSE);
        if (end < 0) {
          this.pending = rest.slice(rest.length - partialSuffix(rest, CLOSE));
          return this.emit(out);
        }
        rest = rest.slice(end + CLOSE.length);
        this.inThought = false;
      } else {
        const start = rest.indexOf(OPEN);
        const orphan = rest.indexOf(CLOSE);
        // A closing tag whose opening half arrived in a reasoning-only chunk.
        if (orphan >= 0 && (start < 0 || orphan < start)) {
          out += rest.slice(0, orphan);
          rest = rest.slice(orphan + CLOSE.length);
          continue;
        }
        if (start < 0) {
          const keep = Math.max(
            partialSuffix(rest, OPEN),
            partialSuffix(rest, CLOSE),
          );
          out += rest.slice(0, rest.length - keep);
          this.pending = rest.slice(rest.length - keep);
          return this.emit(out);
        }
        out += rest.slice(0, start);
        rest = rest.slice(start + OPEN.length);
        this.inThought = true;
      }
    }
    return this.emit(out);
  }

  flush(): string {
    const rest = this.inThought ? "" : this.pending;
    this.pending = "";
    return this.emit(rest);
  }

  /** Drops the whitespace a removed thought leaves before the answer. */
  private emit(text: string): string {
    if (this.started) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed) this.started = true;
    return trimmed;
  }
}

export function stripThoughts(text: string): string {
  const filter = new ThoughtFilter();
  return filter.push(text) + filter.flush();
}
