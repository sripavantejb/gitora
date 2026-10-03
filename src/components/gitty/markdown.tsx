"use client";

import { FileCode2 } from "lucide-react";
import { Fragment, type ReactNode } from "react";

import { citationKey } from "~/features/gitty/citations";
import type { SourceRef } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

export type CitationState = "pending" | "verified" | "rejected";

interface MarkdownProps {
  text: string;
  /** Verified sources by citation key; undefined while the answer streams. */
  verified?: ReadonlyMap<string, SourceRef>;
  rejected?: ReadonlySet<string>;
  onOpenSource(source: SourceRef): void;
}

const INLINE =
  /(\[\[[^\n]+?(?::\d+(?:-\d+)?)?\]\](?!\]))|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function parseCitation(raw: string): SourceRef {
  const inner = raw.slice(2, -2);
  const match = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(inner)!;
  const start = match[2] ? Number(match[2]) : undefined;
  return {
    path: match[1]!.trim(),
    startLine: start,
    endLine: match[3] ? Number(match[3]) : start,
  };
}

function Inline({
  text,
  verified,
  rejected,
  onOpenSource,
}: MarkdownProps): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [token, citation, code, bold, italic, link] = match;
    if (citation) {
      const source = parseCitation(citation);
      const state: CitationState = rejected?.has(citation)
        ? "rejected"
        : verified
          ? verified.has(citationKey(source))
            ? "verified"
            : "rejected"
          : "pending";
      const label = `${source.path.split("/").at(-1)}${source.startLine ? `:${source.startLine}${source.endLine && source.endLine !== source.startLine ? `-${source.endLine}` : ""}` : ""}`;
      parts.push(
        state === "verified" ? (
          <button
            key={key++}
            type="button"
            onClick={() => onOpenSource(verified!.get(citationKey(source)) ?? source)}
            className="mx-0.5 inline-flex items-center gap-1 border-2 border-ink bg-lime px-1.5 py-px align-baseline font-mono text-[11px] font-semibold text-ink hover:bg-ink hover:text-lime"
            title={`Open ${source.path}`}
          >
            <FileCode2 className="h-3 w-3" aria-hidden />
            {label}
          </button>
        ) : (
          <span
            key={key++}
            className={cn(
              "mx-0.5 inline-flex items-center gap-1 border-2 px-1.5 py-px align-baseline font-mono text-[11px]",
              state === "pending"
                ? "border-ink/40 text-ink/60"
                : "border-dashed border-orange text-orange line-through",
            )}
            title={state === "rejected" ? "Unverified reference: removed from the evidence" : "Checking reference"}
          >
            {label}
          </span>
        ),
      );
    } else if (code) {
      parts.push(
        <code key={key++} className="border border-ink/20 bg-paper px-1 py-px font-mono text-[0.85em]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      parts.push(<strong key={key++}>{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      parts.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (link) {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(link)!;
      parts.push(
        <a key={key++} href={linkMatch[2]} target="_blank" rel="noreferrer noopener" className="neo-link">
          {linkMatch[1]}
        </a>,
      );
    } else parts.push(token);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** A small, safe Markdown subset; nothing is injected as HTML. */
export function Markdown(props: MarkdownProps) {
  const lines = props.text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;
  const inline = (text: string) => <Inline {...props} text={text} />;
  while (index < lines.length) {
    const line = lines[index]!;
    if (/^```/.test(line)) {
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index]!)) body.push(lines[index++]!);
      index++;
      blocks.push(
        <pre key={key++} className="my-2 overflow-x-auto border-2 border-ink bg-ink p-3 font-mono text-[12px] leading-relaxed text-paper">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(
        <p
          key={key++}
          className={cn(
            "mt-3 mb-1 font-archivo text-ink uppercase",
            level <= 2 ? "text-[13px] tracking-wide" : "text-[12px] tracking-wide opacity-80",
          )}
          role="heading"
          aria-level={level + 2}
        >
          {inline(heading[2]!)}
        </p>,
      );
      index++;
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""));
        index++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={cn("my-1.5 space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      index++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^```|^#{1,4}\s|^\s*(?:[-*]|\d+\.)\s+/.test(lines[index]!)
    )
      paragraph.push(lines[index++]!);
    blocks.push(
      <p key={key++} className="my-1.5">
        {paragraph.map((text, lineIndex) => (
          <Fragment key={lineIndex}>
            {lineIndex > 0 && " "}
            {inline(text)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="text-[13.5px] leading-relaxed text-ink">{blocks}</div>;
}
