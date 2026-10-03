"use client";

import {
  AlertTriangle,
  ArrowLeft,
  GraduationCap,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  Route as RouteIcon,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { GittyApiError, fetchGraph, type RepoRef } from "~/features/gitty/api";
import { ancestorsOf, indexChildren, layoutMap } from "~/features/gitty/map-layout";
import type { CodeNodeType, GraphResponse, SourceRef, TraceResult } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

import { AskPanel, type AskRequest } from "./ask-panel";
import { CodebaseMap, type MapHandle } from "./codebase-map";
import { CommandSearch, type Command } from "./command-search";
import { LearnPanel } from "./learn-panel";
import { NodePanel, type Highlight, type NodeAction } from "./node-panel";
import { SourceViewer } from "./source-viewer";
import { TracePanel } from "./trace-panel";

type Tab = "node" | "ask" | "trace" | "learn";

const LOADING_STAGES = [
  "Fetching the repository tree",
  "Reading the most relevant source files",
  "Extracting functions, classes and routes",
  "Resolving imports into a dependency graph",
  "Laying out the map",
];

const TABS: Array<{ id: Tab; label: string; icon: typeof Network }> = [
  { id: "node", label: "Node", icon: Network },
  { id: "ask", label: "Ask Gemma", icon: MessageSquare },
  { id: "trace", label: "Trace", icon: RouteIcon },
  { id: "learn", label: "Teach me", icon: GraduationCap },
];

const isContainer = (type: CodeNodeType) =>
  type === "REPOSITORY" || type === "APPLICATION" || type === "MODULE" || type === "DIRECTORY";

function initialExpanded(graph: GraphResponse["graph"]): Set<string> {
  const expanded = new Set(["repo"]);
  const top = graph.nodes.filter((node) => node.parentId === "repo" && node.type !== "FILE");
  for (const node of top)
    if (node.type === "APPLICATION" || node.type === "MODULE" || /^(?:src|app|apps|packages|lib)$/i.test(node.label))
      expanded.add(node.id);
  if (expanded.size === 1 && top.length <= 3)
    for (const node of top) expanded.add(node.id);
  // Open single-folder chains (src -> pkg) so the first view shows real files.
  const children = new Map<string, string[]>();
  for (const node of graph.nodes)
    if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  for (const id of [...expanded]) {
    let current = children.get(id) ?? [];
    while (current.length === 1 && !current[0]!.startsWith("file:") && expanded.size < 24) {
      expanded.add(current[0]!);
      current = children.get(current[0]!) ?? [];
    }
  }
  return expanded;
}

export default function ExploreClient({
  owner,
  repo,
  diagramsEnabled = true,
}: RepoRef & { diagramsEnabled?: boolean }) {
  const repoRef = useMemo(() => ({ owner, repo }), [owner, repo]);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["repo"]));
  const [childLimits, setChildLimits] = useState<Map<string, number>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>("repo");
  const [highlight, setHighlight] = useState<Highlight>({ dependencies: [], dependents: [] });
  const [tab, setTab] = useState<Tab>("node");
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [traceRequest, setTraceRequest] = useState({ feature: "", nonce: 0 });
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [source, setSource] = useState<SourceRef | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [pendingFit, setPendingFit] = useState<string[] | null>(null);
  const mapRef = useRef<MapHandle>(null);
  const nonce = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      setStage(0);
      try {
        const response = await fetchGraph(repoRef, refresh);
        setData(response);
        setExpanded(initialExpanded(response.graph));
        setSelectedId("repo");
      } catch (caught) {
        setError(
          caught instanceof GittyApiError
            ? { message: caught.message, code: caught.code }
            : { message: "Could not load this repository. Please retry." },
        );
      } finally {
        setLoading(false);
      }
    },
    [repoRef],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setStage((value) => Math.min(LOADING_STAGES.length - 1, value + 1)), 2200);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const index = useMemo(() => indexChildren(data?.graph.nodes ?? []), [data]);
  const layout = useMemo(() => layoutMap(index, expanded, childLimits), [index, expanded, childLimits]);
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;
  const dependencyIds = useMemo(() => new Set(highlight.dependencies), [highlight.dependencies]);
  const dependentIds = useMemo(() => new Set(highlight.dependents), [highlight.dependents]);
  const traceIds = useMemo(() => trace?.steps.map((step) => step.nodeId) ?? [], [trace]);

  useEffect(() => {
    if (!pendingFocus) return;
    mapRef.current?.focus(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, layout]);

  useEffect(() => {
    if (!pendingFit) return;
    mapRef.current?.fitTo(pendingFit);
    setPendingFit(null);
  }, [pendingFit, layout]);

  const reveal = useCallback(
    (id: string, expandSelf = false) => {
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestor of ancestorsOf(index, id)) next.add(ancestor);
        if (expandSelf && index.children.has(id)) next.add(id);
        return next;
      });
      // A node hidden behind "+N more" needs its parent's limit raised.
      const parentId = index.byId.get(id)?.parentId;
      if (parentId) {
        const siblings = index.children.get(parentId) ?? [];
        const position = siblings.findIndex((sibling) => sibling.id === id);
        setChildLimits((current) => {
          if (position < (current.get(parentId) ?? 30)) return current;
          const next = new Map(current);
          next.set(parentId, position + 10);
          return next;
        });
      }
    },
    [index],
  );

  const selectNode = useCallback(
    (id: string, options: { focus?: boolean; expand?: boolean } = {}) => {
      const node = index.byId.get(id);
      if (!node) return;
      reveal(id, (options.expand ?? false) && isContainer(node.type));
      setSelectedId(id);
      setHighlight({ dependencies: [], dependents: [] });
      if (options.focus !== false) setPendingFocus(id);
    },
    [index, reveal],
  );

  const onMapSelect = useCallback(
    (id: string) => {
      const node = index.byId.get(id);
      if (!node) return;
      setSelectedId(id);
      setHighlight({ dependencies: [], dependents: [] });
      if (isContainer(node.type) && node.type !== "REPOSITORY" && index.children.has(id))
        setExpanded((current) => (current.has(id) ? current : new Set(current).add(id)));
      setTab((current) => (current === "learn" || current === "trace" ? current : "node"));
    },
    [index],
  );

  const onToggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onShowMore = useCallback((parentId: string) => {
    setChildLimits((current) => new Map(current).set(parentId, (current.get(parentId) ?? 30) + 60));
  }, []);

  const openSource = useCallback((ref: SourceRef) => setSource(ref), []);

  const ask = (mode: AskRequest["mode"], question = "") => {
    setTab("ask");
    setAskRequest({ mode, question, nonce: ++nonce.current });
  };

  const onAction = (action: NodeAction) => {
    if (!selected) return;
    if (action === "explain" || action === "why" || action === "impact") ask(action);
    else if (action === "ask") setTab("ask");
    else if (action === "trace") {
      setTab("trace");
      setTraceRequest({ feature: selected.label.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]/g, " "), nonce: ++nonce.current });
    } else if (action === "source" && selected.path)
      setSource({ path: selected.path, startLine: selected.startLine, endLine: selected.endLine });
  };

  const onCommand = (command: Command) => {
    if (command.kind === "node") {
      selectNode(command.id, { expand: true });
      setTab("node");
    }
    else if (command.kind === "ask") {
      setSelectedId("repo");
      ask("ask", command.question);
    } else if (command.kind === "trace") {
      setTab("trace");
      setTraceRequest({ feature: command.feature, nonce: ++nonce.current });
    } else if (command.kind === "learn") setTab("learn");
    else if (command.kind === "fit") mapRef.current?.fit();
    else if (command.kind === "collapse") {
      setExpanded(new Set(["repo"]));
      setChildLimits(new Map());
    }
  };

  const onHighlight = useCallback(
    (next: Highlight) => {
      setHighlight(next);
      const related = [...next.dependencies, ...next.dependents];
      if (!related.length) return;
      if (related.length <= 12) for (const id of related) reveal(id);
      setPendingFit(selectedId ? [selectedId, ...related] : related);
    },
    [reveal, selectedId],
  );

  const onTrace = (result: TraceResult | null) => {
    setTrace(result);
    setActiveStep(null);
    setHighlight({ dependencies: [], dependents: [] });
    if (!result) return;
    for (const step of result.steps) reveal(step.nodeId);
    setPendingFit(result.steps.map((step) => step.nodeId));
  };

  const onStep = (stepIndex: number) => {
    const step = trace?.steps[stepIndex];
    setActiveStep(stepIndex);
    if (!step) return;
    reveal(step.nodeId);
    setSelectedId(step.nodeId);
    setPendingFocus(step.nodeId);
  };

  if (error)
    return (
      <Shell repoRef={repoRef} diagramsEnabled={diagramsEnabled}>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="neo-panel max-w-lg p-6">
            <AlertTriangle className="h-8 w-8 text-orange" aria-hidden />
            <h1 className="mt-3 font-archivo text-xl uppercase">
              {error.code === "REPOSITORY_NOT_FOUND"
                ? "Repository not found"
                : error.code === "GITHUB_AUTH_REQUIRED" || error.code === "GITHUB_ACCESS_DENIED"
                  ? "Private repository"
                  : error.code === "REPOSITORY_EMPTY"
                    ? "Empty repository"
                    : error.code === "REPOSITORY_TOO_LARGE"
                      ? "Repository too large"
                      : error.code === "GITHUB_RATE_LIMITED"
                        ? "GitHub is rate limiting"
                        : "Could not explore this repository"}
            </h1>
            <p className="mt-2 text-[14px] text-ink/80">{error.message}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void load()} className="neo-button flex items-center gap-2 px-4 py-2 text-[12px]">
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
              <Link href="/" className="neo-button-muted px-4 py-2 text-[12px]">
                Try another repo
              </Link>
            </div>
          </div>
        </div>
      </Shell>
    );

  if (loading || !data)
    return (
      <Shell repoRef={repoRef} diagramsEnabled={diagramsEnabled}>
        <div className="relative flex flex-1 items-center justify-center overflow-hidden gitty-map">
          <div className="absolute inset-0 opacity-60" aria-hidden>
            {Array.from({ length: 9 }, (_, row) => (
              <div key={row} className="gitty-skeleton absolute h-9 w-52 border-2 border-ink/10" style={{ left: `${8 + (row % 3) * 26}%`, top: `${12 + row * 9}%` }} />
            ))}
          </div>
          <div className="relative border-[3px] border-ink bg-white p-5 shadow-[6px_6px_0_0_#0a0a0a]" role="status" aria-live="polite">
            <p className="meta-label">Analyzing {owner}/{repo}</p>
            <ul className="mt-3 space-y-1.5">
              {LOADING_STAGES.map((label, stageIndex) => (
                <li key={label} className={cn("flex items-center gap-2 text-[13px]", stageIndex > stage && "opacity-35")}>
                  {stageIndex < stage ? (
                    <span className="grid h-4 w-4 place-items-center bg-ink text-[10px] text-lime">✓</span>
                  ) : stageIndex === stage ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className="h-4 w-4 border-2 border-ink/40" />
                  )}
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Shell>
    );

  const { graph, ai } = data;
  return (
    <Shell
      repoRef={repoRef}
      diagramsEnabled={diagramsEnabled}
      stats={
        <div className="hidden items-center gap-1.5 text-[11px] font-semibold lg:flex">
          <span className="border-2 border-ink bg-white px-1.5 py-0.5">{graph.stats.files} files</span>
          <span className="border-2 border-ink bg-white px-1.5 py-0.5" title="Files Gitty read and analyzed">
            {graph.stats.analyzedFiles} analyzed
          </span>
          <span className="border-2 border-ink bg-white px-1.5 py-0.5">{graph.stats.symbols} symbols</span>
          <span className="border-2 border-ink bg-white px-1.5 py-0.5">{graph.stats.importEdges} imports</span>
        </div>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex items-center gap-2 border-2 border-ink bg-white px-2.5 py-1.5 text-[12px] font-semibold shadow-[2px_2px_0_0_#0a0a0a] hover:bg-lime"
          >
            <Search className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Search</span>
            <kbd className="hidden border border-ink/40 px-1 text-[10px] sm:inline">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => void load(true)}
            className="border-2 border-ink bg-white p-1.5 shadow-[2px_2px_0_0_#0a0a0a] hover:bg-lime"
            aria-label="Re-analyze repository"
            title="Re-analyze"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      {graph.stats.truncated && (
        <p className="border-b-2 border-ink bg-[#fff4c2] px-4 py-1.5 text-[12px]">
          Large repository: showing {graph.stats.shownFiles} of {graph.stats.files} files and analyzing the {graph.stats.analyzedFiles} most relevant. Relationships cover the analyzed files only.
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[55vh] min-h-[320px] border-b-[3px] border-ink lg:h-auto lg:min-h-0 lg:flex-1 lg:border-r-[3px] lg:border-b-0">
          <CodebaseMap
            handleRef={mapRef}
            layout={layout}
            edges={graph.edges}
            selectedId={selectedId}
            dependencyIds={dependencyIds}
            dependentIds={dependentIds}
            traceIds={traceIds}
            activeTraceIndex={activeStep}
            onSelect={onMapSelect}
            onToggle={onToggle}
            onShowMore={onShowMore}
          />
          <Legend />
          {trace && (
            <button
              type="button"
              onClick={() => {
                setTrace(null);
                setActiveStep(null);
              }}
              className="absolute top-3 right-3 border-2 border-ink bg-ink px-2.5 py-1 text-[11px] font-semibold text-lime shadow-[2px_2px_0_0_#c8f542]"
            >
              Clear trace ✕
            </button>
          )}
        </div>
        <aside className="flex min-h-[560px] w-full flex-col bg-white lg:min-h-0 lg:w-[420px] xl:w-[460px]">
          <div role="tablist" aria-label="Workspace panels" className="grid grid-cols-4 border-b-[3px] border-ink">
            {TABS.map((entry) => {
              const TabIcon = entry.icon;
              return (
                <button
                  key={entry.id}
                  role="tab"
                  type="button"
                  aria-selected={tab === entry.id}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 border-r-2 border-ink px-1 py-2.5 text-[11.5px] font-bold uppercase last:border-r-0",
                    tab === entry.id ? "bg-lime" : "bg-white hover:bg-paper",
                  )}
                >
                  <TabIcon className="h-3.5 w-3.5" aria-hidden />
                  <span className="truncate">{entry.label}</span>
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1">
            <div className={cn("h-full", tab !== "node" && "hidden")}>
              {selected && (
                <NodePanel
                  repoRef={repoRef}
                  node={selected}
                  index={index}
                  ai={ai}
                  analyzedFiles={graph.stats.analyzedFiles}
                  onAction={onAction}
                  onSelect={(id) => selectNode(id)}
                  onOpenSource={openSource}
                  onHighlight={onHighlight}
                />
              )}
            </div>
            <div className={cn("h-full", tab !== "ask" && "hidden")}>
              <AskPanel repoRef={repoRef} node={selected?.type === "REPOSITORY" ? null : selected} ai={ai} request={askRequest} onOpenSource={openSource} />
            </div>
            <div className={cn("h-full", tab !== "trace" && "hidden")}>
              <TracePanel
                repoRef={repoRef}
                initialFeature={traceRequest.feature}
                requestNonce={traceRequest.nonce}
                onTrace={onTrace}
                activeStep={activeStep}
                onStep={onStep}
                onOpenSource={openSource}
              />
            </div>
            <div className={cn("h-full", tab !== "learn" && "hidden")}>
              <LearnPanel repoRef={repoRef} onSelect={(id) => selectNode(id)} onOpenSource={openSource} />
            </div>
          </div>
        </aside>
      </div>
      {source && (
        <SourceViewer
          repoRef={repoRef}
          source={source}
          onClose={() => setSource(null)}
          onLocate={(path) => {
            setSource(null);
            selectNode(`file:${path}`);
          }}
        />
      )}
      <CommandSearch open={commandOpen} nodes={graph.nodes} aiConfigured={ai.configured} onClose={() => setCommandOpen(false)} onCommand={onCommand} />
    </Shell>
  );
}

function Shell({
  repoRef,
  diagramsEnabled,
  stats,
  actions,
  children,
}: {
  repoRef: RepoRef;
  diagramsEnabled: boolean;
  stats?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-2 pb-6 sm:px-4">
      <div className="mx-auto flex h-[calc(100dvh-7rem)] min-h-[640px] max-w-[1800px] flex-col overflow-hidden border-[3px] border-ink bg-paper shadow-[8px_8px_0_0_#0a0a0a] max-lg:h-auto">
        <div className="flex items-center gap-3 border-b-[3px] border-ink bg-white px-3 py-2">
          <Link
            href={diagramsEnabled ? `/${repoRef.owner}/${repoRef.repo}` : "/"}
            className="flex items-center gap-1 border-2 border-ink px-2 py-1 text-[11px] font-semibold hover:bg-lime"
            title={diagramsEnabled ? "Back to the diagram" : "Explore another repository"}
          >
            <ArrowLeft className="h-3.5 w-3.5" />{" "}
            <span className="hidden sm:inline">{diagramsEnabled ? "Diagram" : "Home"}</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-lime font-archivo text-[11px]">G</span>
            <div className="min-w-0">
              <p className="font-archivo text-[13px] leading-none uppercase">Gitty</p>
              <p className="truncate font-mono text-[11px] text-ink/70">
                {repoRef.owner}/{repoRef.repo}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {stats}
            {actions}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute top-3 left-3 hidden flex-wrap gap-x-3 gap-y-1 border-2 border-ink bg-white/95 px-2 py-1 text-[10.5px] font-semibold md:flex">
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-4 bg-[#2f7de1]" /> depends on
      </span>
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-4 bg-orange" /> used by
      </span>
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-4 border-t-2 border-dashed border-ink" /> service
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 border-2 border-dashed border-ink" /> not analyzed
      </span>
    </div>
  );
}
