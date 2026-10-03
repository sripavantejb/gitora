"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, GraduationCap, Loader2 } from "lucide-react";
import { useState } from "react";

import { GittyApiError, fetchLearn, type RepoRef } from "~/features/gitty/api";
import type { LearnResult, SourceRef } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

interface LearnPanelProps {
  repoRef: RepoRef;
  onSelect(id: string): void;
  onOpenSource(source: SourceRef): void;
}

export function LearnPanel({ repoRef, onSelect, onOpenSource }: LearnPanelProps) {
  const [learn, setLearn] = useState<LearnResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const { learn: result } = await fetchLearn(repoRef);
      setLearn(result);
      setCurrent(0);
      if (result.steps[0]) onSelect(result.steps[0].nodeId);
    } catch (caught) {
      setError(caught instanceof GittyApiError ? caught.message : "The learning path could not be built.");
    } finally {
      setLoading(false);
    }
  };

  const go = (index: number) => {
    if (!learn?.steps[index]) return;
    setCurrent(index);
    onSelect(learn.steps[index].nodeId);
  };

  if (!learn)
    return (
      <section className="p-4" aria-label="Teach me this repo">
        <div className="border-[3px] border-ink bg-lime p-4 shadow-[5px_5px_0_0_#0a0a0a]">
          <GraduationCap className="h-7 w-7" aria-hidden />
          <h3 className="mt-2 font-archivo text-lg leading-tight uppercase">Teach me this repo</h3>
          <p className="mt-1 text-[13px]">
            A guided reading order (overview, entry point, core modules, request boundary, data access) picked from the analysis, with a short note on what to look for in each file.
          </p>
          <button type="button" onClick={() => void start()} disabled={loading} className="neo-button mt-3 flex items-center gap-2 px-4 py-2 text-[12px]">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? "Building path" : "Start the tour"}
          </button>
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-orange">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
      </section>
    );

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Teach me this repo">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {learn.note && <p className="mb-3 border-2 border-ink bg-[#fff4c2] p-2 text-[12px]">{learn.note}</p>}
        <ol className="space-y-2">
          {learn.steps.map((step, index) => (
            <li key={step.nodeId}>
              <div className={cn("border-2 border-ink p-3", index === current ? "bg-lime shadow-[3px_3px_0_0_#0a0a0a]" : "bg-white")}>
                <button type="button" onClick={() => go(index)} className="flex w-full items-start gap-2 text-left">
                  <span className="grid h-6 w-6 shrink-0 place-items-center border-2 border-ink bg-white text-[11px] font-bold">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block font-archivo text-[13px] uppercase">{step.title}</span>
                    {step.path && <span className="block truncate font-mono text-[11px] text-ink/60">{step.path}</span>}
                    {index === current && <span className="mt-1 block text-[12.5px]">{step.description}</span>}
                  </span>
                </button>
                {index === current && step.path && (
                  <button
                    type="button"
                    onClick={() => onOpenSource({ path: step.path! })}
                    className="mt-2 ml-8 border border-ink px-1.5 font-mono text-[10.5px] hover:bg-ink hover:text-lime"
                  >
                    read the file
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center justify-between border-t-[3px] border-ink p-3">
        <button type="button" onClick={() => go(current - 1)} disabled={current === 0} className="flex items-center gap-1 border-2 border-ink bg-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <span className="text-[12px] font-semibold">
          {current + 1} / {learn.steps.length}
        </span>
        <button
          type="button"
          onClick={() => go(current + 1)}
          disabled={current >= learn.steps.length - 1}
          className="flex items-center gap-1 border-2 border-ink bg-lime px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
        >
          Next <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
