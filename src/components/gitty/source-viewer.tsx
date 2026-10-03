"use client";

import { AlertTriangle, ExternalLink, MapPin, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  GittyApiError,
  fetchSource,
  type RepoRef,
  type SourceFile,
} from "~/features/gitty/api";
import type { SourceRef } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

const MAX_RENDERED_LINES = 6000;

interface SourceViewerProps {
  repoRef: RepoRef;
  source: SourceRef;
  onClose(): void;
  onLocate(path: string): void;
}

export function SourceViewer({
  repoRef,
  source,
  onClose,
  onLocate,
}: SourceViewerProps) {
  const [file, setFile] = useState<SourceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setError(null);
    fetchSource(repoRef, source.path, controller.signal).then(
      setFile,
      (caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof GittyApiError
              ? caught.message
              : "Could not load this file.",
          );
      },
    );
    return () => controller.abort();
  }, [repoRef, source.path]);

  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [file, source.startLine]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = source.startLine;
  const end = source.endLine ?? source.startLine;
  const lines = file?.text.split("\n").slice(0, MAX_RENDERED_LINES) ?? [];
  const githubUrl = file
    ? `${file.githubUrl}${start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""}`
    : null;

  return (
    <div
      className="bg-ink/40 fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal
      aria-label={`Source of ${source.path}`}
      onClick={onClose}
    >
      <div
        className="border-ink flex h-full w-full max-w-3xl flex-col border-l-[3px] bg-white"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-ink bg-ink text-paper flex items-center gap-2 border-b-[3px] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-lime truncate font-mono text-[13px]">
              {source.path}
            </p>
            <p className="text-paper/70 text-[11px]">
              {start
                ? `Lines ${start}${end && end !== start ? `-${end}` : ""}`
                : "Whole file"}
              {file
                ? ` · ${file.totalLines} lines${file.language ? ` · ${file.language}` : ""}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onLocate(source.path)}
            className="border-paper hover:bg-lime hover:text-ink flex items-center gap-1 border-2 px-2 py-1 text-[11px] font-semibold"
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden /> On map
          </button>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="border-paper hover:bg-lime hover:text-ink flex items-center gap-1 border-2 px-2 py-1 text-[11px] font-semibold"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> GitHub
            </a>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="hover:text-lime p-1"
            aria-label="Close source"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-[#fbfbf8]">
          {!file && !error && (
            <div className="space-y-2 p-4" aria-busy>
              {Array.from({ length: 14 }, (_, index) => (
                <div
                  key={index}
                  className="gitty-skeleton h-3.5"
                  style={{ width: `${40 + ((index * 37) % 55)}%` }}
                />
              ))}
            </div>
          )}
          {error && (
            <p className="text-orange m-4 flex items-center gap-2 text-[13px] font-semibold">
              <AlertTriangle className="h-4 w-4" aria-hidden /> {error}
            </p>
          )}
          {file && (
            <pre className="text-ink min-w-max py-2 font-mono text-[12px] leading-[1.6]">
              {lines.map((line, index) => {
                const number = index + 1;
                const inRange =
                  start !== undefined &&
                  number >= start &&
                  number <= (end ?? start);
                return (
                  <div
                    key={number}
                    ref={number === start ? highlightRef : undefined}
                    className={cn("flex", inRange && "bg-lime/60")}
                  >
                    <span
                      className={cn(
                        "text-ink/40 w-14 shrink-0 pr-3 text-right select-none",
                        inRange && "text-ink font-bold",
                      )}
                    >
                      {number}
                    </span>
                    <span className="pr-6 whitespace-pre">{line || " "}</span>
                  </div>
                );
              })}
              {file.totalLines > MAX_RENDERED_LINES && (
                <div className="text-ink/60 px-4 py-2">
                  … {file.totalLines - MAX_RENDERED_LINES} more lines on GitHub.
                </div>
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
