"use client";

import { AlertTriangle, ArrowUp, Loader2, Sparkles, Square, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GittyApiError, streamAsk, type RepoRef } from "~/features/gitty/api";
import { citationKey } from "~/features/gitty/citations";
import type { AiStatus, AskMode, ChatTurn, CodeNode, SourceRef } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

import { Markdown } from "./markdown";
import { NODE_TYPE_LABEL } from "./node-style";

export interface AskRequest {
  mode: AskMode;
  question: string;
  /** Changes on every request so repeated actions re-run. */
  nonce: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  status?: string;
  tools?: string[];
  sources?: SourceRef[];
  rejected?: string[];
  error?: string;
  done?: boolean;
}

const ACTION_LABEL: Record<AskMode, string> = {
  ask: "",
  explain: "Explain this",
  why: "Why does this exist?",
  impact: "What breaks if this changes?",
};

const NODE_SUGGESTIONS = ["What does this do?", "Where is it used?", "How would I extend it safely?"];
const REPO_SUGGESTIONS = [
  "What does this repository do?",
  "Where does a request enter the system?",
  "What are the main modules and how do they connect?",
];

interface AskPanelProps {
  repoRef: RepoRef;
  node: CodeNode | null;
  ai: AiStatus;
  request: AskRequest | null;
  onOpenSource(source: SourceRef): void;
}

export function AskPanel({ repoRef, node, ai, request, onOpenSource }: AskPanelProps) {
  const scope = node?.id ?? "repo";
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => threads[scope] ?? [], [threads, scope]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const update = (key: string, change: (messages: Message[]) => Message[]) =>
    setThreads((current) => ({ ...current, [key]: change(current[key] ?? []) }));

  const send = async (mode: AskMode, question: string) => {
    if (busy || !ai.configured) return;
    const key = scope;
    const history: ChatTurn[] = (threads[key] ?? [])
      .filter((message) => message.done && !message.error)
      .map((message) => ({ role: message.role, content: message.content }));
    update(key, (list) => [
      ...list,
      { role: "user", content: question || ACTION_LABEL[mode], done: true },
      { role: "assistant", content: "", status: "Thinking", tools: [] },
    ]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const patch = (change: (message: Message) => Message) =>
      update(key, (list) => [...list.slice(0, -1), change(list[list.length - 1]!)]);
    try {
      for await (const event of streamAsk(
        repoRef,
        { mode, question, nodeId: node?.id, history },
        controller.signal,
      )) {
        if (event.type === "status") patch((message) => ({ ...message, status: event.message }));
        else if (event.type === "tool")
          patch((message) => ({
            ...message,
            tools: [...(message.tools ?? []), `${event.name}${event.summary ? ` · ${event.summary}` : ""}`],
          }));
        else if (event.type === "chunk")
          patch((message) => ({ ...message, status: undefined, content: message.content + event.text }));
        else if (event.type === "sources")
          patch((message) => ({ ...message, sources: event.sources, rejected: event.rejected }));
        else if (event.type === "error") patch((message) => ({ ...message, error: event.message }));
      }
    } catch (error) {
      if (!controller.signal.aborted)
        patch((message) => ({
          ...message,
          error: error instanceof GittyApiError ? error.message : "The answer could not be loaded. Please retry.",
        }));
    } finally {
      patch((message) => ({
        ...message,
        status: undefined,
        done: true,
        sources: message.sources ?? [],
        error: message.error ?? (controller.signal.aborted && !message.content ? "Stopped." : undefined),
      }));
      setBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.nonce === lastNonce.current) return;
    lastNonce.current = request.nonce;
    void send(request.mode, request.question);
    // Only a new request should trigger a send.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const suggestions = node ? NODE_SUGGESTIONS : REPO_SUGGESTIONS;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Ask Gemma">
      <header className="flex items-center gap-2 border-b-[3px] border-ink bg-ink px-4 py-3 text-paper">
        <Sparkles className="h-4 w-4 text-lime" aria-hidden />
        <div className="min-w-0">
          <p className="font-archivo text-[13px] tracking-wide text-lime uppercase">Ask Gemma</p>
          <p className="truncate text-[11px] text-paper/70">
            {node ? `About ${NODE_TYPE_LABEL[node.type].toLowerCase()} ${node.label}` : "About the whole repository"}
            {ai.configured ? ` · ${ai.model}` : ""}
          </p>
        </div>
      </header>

      {!ai.configured && (
        <div className="m-3 flex gap-2 border-2 border-ink bg-[#fff4c2] p-3 text-[12.5px] text-ink">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong>AI is not configured.</strong> {ai.reason} The map, search, dependencies, dependents, impact and source
            views still work.
          </p>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
        {!messages.length && ai.configured && (
          <div className="space-y-2">
            <p className="meta-label">Try asking</p>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send("ask", suggestion)}
                className="block w-full border-2 border-ink bg-white px-3 py-2 text-left text-[13px] font-medium shadow-[2px_2px_0_0_#0a0a0a] hover:-translate-y-px hover:bg-lime"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="ml-8 border-2 border-ink bg-lime px-3 py-2 text-[13px] font-semibold text-ink">
              {message.content}
            </div>
          ) : (
            <AssistantMessage key={index} message={message} onOpenSource={onOpenSource} />
          ),
        )}
      </div>

      <form
        className="border-t-[3px] border-ink bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const question = input.trim();
          if (!question) return;
          setInput("");
          void send("ask", question);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={2}
            maxLength={2000}
            disabled={!ai.configured}
            placeholder={ai.configured ? (node ? `Ask about ${node.label}…` : "Ask about this repository…") : "AI is not configured"}
            className="neo-input min-h-[44px] flex-1 resize-none px-3 py-2 text-[13px]"
            aria-label="Question for Gemma"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="neo-button-muted grid h-11 w-11 place-items-center" aria-label="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" disabled={!ai.configured || !input.trim()} className="neo-button grid h-11 w-11 place-items-center disabled:opacity-50" aria-label="Send">
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function AssistantMessage({ message, onOpenSource }: { message: Message; onOpenSource(source: SourceRef): void }) {
  const verified = useMemo(
    () => (message.sources ? new Map(message.sources.map((source) => [citationKey(source), source])) : undefined),
    [message.sources],
  );
  const rejected = useMemo(() => new Set(message.rejected ?? []), [message.rejected]);
  return (
    <div className="border-2 border-ink bg-white p-3 shadow-[3px_3px_0_0_#0a0a0a]">
      {message.tools && message.tools.length > 0 && (
        <details className="mb-2 text-[11.5px] text-ink/70" open={!message.done}>
          <summary className="flex cursor-pointer items-center gap-1 font-semibold">
            <Wrench className="h-3 w-3" aria-hidden /> {message.tools.length} tool call{message.tools.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4 font-mono">
            {message.tools.map((tool, index) => (
              <li key={index} className="truncate">
                {tool}
              </li>
            ))}
          </ul>
        </details>
      )}
      {message.status && !message.content && (
        <div className="space-y-2" aria-busy>
          <p className="flex items-center gap-2 text-[12px] font-semibold text-ink/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {message.status}
          </p>
          <div className="gitty-skeleton h-3 w-11/12" />
          <div className="gitty-skeleton h-3 w-8/12" />
        </div>
      )}
      {message.content && (
        <Markdown text={message.content} verified={message.done ? verified : undefined} rejected={rejected} onOpenSource={onOpenSource} />
      )}
      {message.error && (
        <p className={cn("mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold", message.error === "Stopped." ? "text-ink/60" : "text-orange")}>
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {message.error}
        </p>
      )}
      {message.done && message.sources && message.sources.length > 0 && (
        <div className="mt-3 border-t-2 border-dashed border-ink/30 pt-2">
          <p className="meta-label mb-1">Verified sources</p>
          <div className="flex flex-wrap gap-1.5">
            {message.sources.map((source) => (
              <button
                key={citationKey(source)}
                type="button"
                onClick={() => onOpenSource(source)}
                className="border-2 border-ink bg-paper px-1.5 py-0.5 font-mono text-[11px] hover:bg-lime"
                title={source.path}
              >
                {source.path}
                {source.startLine ? `:${source.startLine}${source.endLine && source.endLine !== source.startLine ? `-${source.endLine}` : ""}` : ""}
              </button>
            ))}
          </div>
        </div>
      )}
      {message.done && !message.error && message.content && message.sources?.length === 0 && (
        <p className="mt-2 text-[11.5px] text-ink/60">No verified source references in this answer.</p>
      )}
    </div>
  );
}
