"use client";

import { GraduationCap, Maximize2, MessageSquare, Minimize2, Route as RouteIcon, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { CodeNode } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

import { NODE_ICONS, NODE_TYPE_LABEL } from "./node-style";

export type Command =
  | { kind: "node"; id: string }
  | { kind: "ask"; question: string }
  | { kind: "trace"; feature: string }
  | { kind: "learn" }
  | { kind: "fit" }
  | { kind: "collapse" };

interface Item {
  key: string;
  icon: ReactNode;
  title: string;
  detail?: string;
  command: Command;
}

const MAX_RESULTS = 40;

function score(node: CodeNode, query: string): number {
  const label = node.label.toLowerCase();
  const path = (node.path ?? "").toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80 - label.length / 100;
  if (label.includes(query)) return 60 - label.length / 100;
  if (path.includes(query)) return 40 - path.length / 1000;
  // Subsequence match ("chkfrm" -> "checkout-form").
  let position = 0;
  for (const char of label) if (char === query[position]) position++;
  return position === query.length ? 20 - label.length / 100 : 0;
}

export function CommandSearch({
  open,
  nodes,
  aiConfigured,
  onClose,
  onCommand,
}: {
  open: boolean;
  nodes: CodeNode[];
  aiConfigured: boolean;
  onClose(): void;
  onCommand(command: Command): void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();
    const commands: Item[] = [];
    if (trimmed) {
      if (aiConfigured)
        commands.push({
          key: "ask",
          icon: <MessageSquare className="h-4 w-4" />,
          title: `Ask Gemma: “${trimmed}”`,
          command: { kind: "ask", question: trimmed },
        });
      if (trimmed.length >= 2)
        commands.push({
          key: "trace",
          icon: <RouteIcon className="h-4 w-4" />,
          title: `Trace feature: “${trimmed}”`,
          command: { kind: "trace", feature: trimmed },
        });
    } else {
      commands.push(
        { key: "learn", icon: <GraduationCap className="h-4 w-4" />, title: "Teach me this repo", command: { kind: "learn" } },
        { key: "fit", icon: <Maximize2 className="h-4 w-4" />, title: "Fit map to view", command: { kind: "fit" } },
        { key: "collapse", icon: <Minimize2 className="h-4 w-4" />, title: "Collapse all", command: { kind: "collapse" } },
      );
    }
    const matches = lower
      ? nodes
          .map((node) => ({ node, score: score(node, lower) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RESULTS)
          .map(({ node }) => node)
      : [];
    const Icon = (node: CodeNode) => {
      const NodeIcon = NODE_ICONS[node.type];
      return <NodeIcon className="h-4 w-4" />;
    };
    return [
      ...matches.map((node) => ({
        key: node.id,
        icon: Icon(node),
        title: node.label,
        detail: `${NODE_TYPE_LABEL[node.type]}${node.path && node.path !== node.label ? ` · ${node.path}` : ""}${node.startLine ? `:${node.startLine}` : ""}`,
        command: { kind: "node", id: node.id } as Command,
      })),
      ...commands,
    ];
  }, [query, nodes, aiConfigured]);

  if (!open) return null;
  const choose = (item: Item | undefined) => {
    if (!item) return;
    onCommand(item.command);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh]" onClick={onClose} role="dialog" aria-modal aria-label="Search the codebase">
      <div className="w-full max-w-xl border-[3px] border-ink bg-white shadow-[8px_8px_0_0_#0a0a0a]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b-[3px] border-ink px-3">
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(items.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(items[active]);
              } else if (event.key === "Escape") onClose();
            }}
            placeholder="Search files, functions, routes, or ask a question…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="gitty-command-results"
            aria-activedescendant={items[active] ? `gitty-cmd-${active}` : undefined}
          />
          <kbd className="border-2 border-ink px-1.5 text-[10px] font-bold">ESC</kbd>
        </div>
        <ul id="gitty-command-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item, index) => (
            <li key={item.key} id={`gitty-cmd-${index}`} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(item)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", index === active && "bg-lime")}
              >
                {item.icon}
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{item.title}</span>
                  {item.detail && <span className="block truncate font-mono text-[11px] text-ink/60">{item.detail}</span>}
                </span>
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-4 text-[13px] text-ink/60">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
