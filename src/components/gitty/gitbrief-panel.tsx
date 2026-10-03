"use client";

import { AlertTriangle, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { GittyApiError, fetchBrief, type Brief, type RepoRef } from "~/features/gitty/api";
import { citationKey } from "~/features/gitty/citations";
import type { AiStatus, CodeNode, SourceRef } from "~/features/gitty/types";

import { Markdown } from "./markdown";

const DEBOUNCE_MS = 250;

/** GitBrief: a concise Gemma explanation of the selected map entity, loaded on click. */
export function GitBriefPanel({
  repoRef,
  node,
  ai,
  onOpenSource,
}: {
  repoRef: RepoRef;
  node: CodeNode;
  ai: AiStatus;
  onOpenSource(source: SourceRef): void;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setBrief(null);
    setError(null);
    if (!ai.configured) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchBrief(repoRef, node.id, controller.signal)
        .then(setBrief)
        .catch((caught: unknown) => {
          if (!controller.signal.aborted)
            setError(caught instanceof GittyApiError ? caught.message : "GitBrief could not explain this entity.");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [repoRef, node.id, ai.configured, attempt]);

  const verified = useMemo(
    () => (brief ? new Map(brief.sources.map((source) => [citationKey(source), source])) : undefined),
    [brief],
  );
  const rejected = useMemo(() => new Set(brief?.rejected ?? []), [brief]);

  return (
    <section className="mb-4 border-2 border-ink bg-white p-3 shadow-[3px_3px_0_0_#0a0a0a]" aria-label="GitBrief" aria-busy={!brief && !error && ai.configured}>
      <header className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        <p className="meta-label">GitBrief</p>
        {brief && <span className="ml-auto truncate font-mono text-[10px] text-ink/50">{brief.model}</span>}
      </header>
      {!ai.configured ? (
        <p className="text-[12px] text-ink/60">{ai.reason ?? "AI is not configured."}</p>
      ) : error ? (
        <div className="flex items-start gap-1.5 text-[12.5px] font-semibold text-orange">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" className="flex items-center gap-1 border-2 border-ink px-1.5 py-0.5 text-[11px] text-ink hover:bg-lime" onClick={() => setAttempt((count) => count + 1)}>
            <RotateCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      ) : brief ? (
        <div className="text-[13px] leading-relaxed">
          <Markdown text={brief.brief} verified={verified} rejected={rejected} onOpenSource={onOpenSource} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="gitty-skeleton h-3.5 w-full" />
          <div className="gitty-skeleton h-3.5 w-11/12" />
          <div className="gitty-skeleton h-3.5 w-8/12" />
        </div>
      )}
    </section>
  );
}
