"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Route as RouteIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { GittyApiError, fetchTrace, type RepoRef } from "~/features/gitty/api";
import type { SourceRef, TraceResult } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

interface TracePanelProps {
  repoRef: RepoRef;
  initialFeature: string;
  /** Changes when another part of the UI asks for a trace. */
  requestNonce: number;
  onTrace(trace: TraceResult | null): void;
  activeStep: number | null;
  onStep(index: number): void;
  onOpenSource(source: SourceRef): void;
}

const EXAMPLES = ["authentication", "checkout", "file upload", "search"];

export function TracePanel({
  repoRef,
  initialFeature,
  requestNonce,
  onTrace,
  activeStep,
  onStep,
  onOpenSource,
}: TracePanelProps) {
  const [feature, setFeature] = useState(initialFeature);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (value: string) => {
    const query = value.trim();
    if (query.length < 2) return;
    setLoading(true);
    setError(null);
    setTrace(null);
    onTrace(null);
    try {
      const { trace: result } = await fetchTrace(repoRef, query);
      setTrace(result);
      onTrace(result.steps.length ? result : null);
      if (result.steps.length) onStep(0);
    } catch (caught) {
      setError(
        caught instanceof GittyApiError
          ? caught.message
          : "The trace could not be computed.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!requestNonce) return;
    setFeature(initialFeature);
    void run(initialFeature);
    // A new request from elsewhere in the UI starts a trace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestNonce]);

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Feature trace"
    >
      <form
        className="border-ink border-b-[3px] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(feature);
        }}
      >
        <label htmlFor="gitty-trace" className="meta-label">
          Trace a feature
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="gitty-trace"
            value={feature}
            onChange={(event) => setFeature(event.target.value)}
            placeholder="e.g. how does login work?"
            maxLength={200}
            className="neo-input h-10 min-w-0 flex-1 px-3 text-[13px]"
          />
          <button
            type="submit"
            disabled={loading || feature.trim().length < 2}
            className="neo-button flex h-10 items-center gap-1.5 px-3 text-[12px] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RouteIcon className="h-4 w-4" />
            )}
            Trace
          </button>
        </div>
        {!trace && !loading && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setFeature(example);
                  void run(example);
                }}
                className="border-ink hover:bg-lime border-2 bg-white px-2 py-0.5 text-[11.5px] font-semibold"
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="space-y-3" aria-busy>
            <p className="text-ink/70 flex items-center gap-2 text-[12px] font-semibold">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding the files
              involved and ordering them
            </p>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="gitty-skeleton h-14 w-full" />
            ))}
          </div>
        )}
        {error && (
          <p className="text-orange flex items-center gap-1.5 text-[12.5px] font-semibold">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
        )}
        {trace && (
          <div>
            <h3 className="font-archivo text-ink text-[15px] leading-tight uppercase">
              {trace.title}
            </h3>
            <p className="text-ink/60 mt-1 text-[11.5px]">
              {trace.method === "ai"
                ? "Files found by Gitty's analysis; Gemma ordered and explained them."
                : "Deterministic ordering from Gitty's analysis."}
            </p>
            {trace.note && (
              <p className="border-ink mt-2 border-2 bg-[#fff4c2] p-2 text-[12px]">
                {trace.note}
              </p>
            )}
            <ol className="mt-4 space-y-2">
              {trace.steps.map((step, index) => (
                <li key={step.nodeId}>
                  {index > 0 && (
                    <p
                      className={cn(
                        "my-1 ml-3 flex items-center gap-1 text-[10.5px] font-semibold",
                        step.verifiedLink ? "text-ink/70" : "text-ink/40",
                      )}
                    >
                      {step.verifiedLink ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <CircleDashed className="h-3 w-3" />
                      )}
                      {step.verifiedLink
                        ? "import link verified"
                        : "no direct import (HTTP, events or indirect)"}
                    </p>
                  )}
                  <div
                    className={cn(
                      "border-ink border-2 p-3 transition-transform",
                      activeStep === index
                        ? "bg-lime shadow-[3px_3px_0_0_#0a0a0a]"
                        : "bg-white hover:-translate-y-px",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 text-left"
                      onClick={() => onStep(index)}
                    >
                      <span className="border-ink bg-ink text-lime grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[12px] font-semibold">
                          {step.path ?? step.label}
                        </span>
                        <span className="text-ink/80 mt-0.5 block text-[12.5px]">
                          {step.explanation}
                        </span>
                      </span>
                    </button>
                    {step.source && (
                      <button
                        type="button"
                        onClick={() => onOpenSource(step.source!)}
                        className="border-ink/50 hover:bg-ink hover:text-lime mt-2 ml-8 border px-1.5 font-mono text-[10.5px]"
                      >
                        view source
                        {step.source.startLine
                          ? ` · L${step.source.startLine}`
                          : ""}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
