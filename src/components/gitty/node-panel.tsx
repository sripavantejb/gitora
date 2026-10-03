"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Code2,
  HelpCircle,
  MessageSquare,
  Route as RouteIcon,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  GittyApiError,
  fetchImpact,
  fetchRelations,
  type Relation,
  type RepoRef,
} from "~/features/gitty/api";
import type { ChildIndex } from "~/features/gitty/map-layout";
import { ancestorsOf } from "~/features/gitty/map-layout";
import type { AiStatus, CodeNode, ImpactResult, SourceRef } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

import { GitBriefPanel } from "./gitbrief-panel";
import { NODE_FILL, NODE_ICONS, NODE_TYPE_LABEL } from "./node-style";

export type NodeAction = "explain" | "ask" | "trace" | "why" | "impact" | "source";
type View = "overview" | "dependencies" | "dependents" | "impact";

export interface Highlight {
  dependencies: string[];
  dependents: string[];
}

interface NodePanelProps {
  repoRef: RepoRef;
  node: CodeNode;
  index: ChildIndex;
  ai: AiStatus;
  analyzedFiles: number;
  onAction(action: NodeAction): void;
  onSelect(id: string): void;
  onOpenSource(source: SourceRef): void;
  onHighlight(highlight: Highlight): void;
}

const fileNode = (path: string) => `file:${path}`;

export function NodePanel({
  repoRef,
  node,
  index,
  ai,
  analyzedFiles,
  onAction,
  onSelect,
  onOpenSource,
  onHighlight,
}: NodePanelProps) {
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relations, setRelations] = useState<{ list: Relation[]; total: number } | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);

  useEffect(() => {
    setView("overview");
    setRelations(null);
    setImpact(null);
    setError(null);
  }, [node.id]);

  useEffect(() => {
    if (view === "overview") {
      onHighlight({ dependencies: [], dependents: [] });
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const run = async () => {
      try {
        if (view === "impact") {
          const { impact: result } = await fetchImpact(repoRef, node.id, controller.signal);
          setImpact(result);
          onHighlight({
            dependencies: [],
            dependents: [...result.direct, ...result.indirect].map((entry) => entry.nodeId),
          });
        } else {
          const result = await fetchRelations(repoRef, node.id, view, controller.signal);
          setRelations({ list: result.relations, total: result.total });
          const ids = result.relations.map((relation) =>
            relation.kind === "imports"
              ? fileNode(relation.path)
              : (findServiceId(index, relation.path) ?? fileNode(relation.path)),
          );
          onHighlight(view === "dependencies" ? { dependencies: ids, dependents: [] } : { dependencies: [], dependents: ids });
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(caught instanceof GittyApiError ? caught.message : "Could not load relationships.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void run();
    return () => controller.abort();
    // Re-run only for a new node or view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, view]);

  const Icon = NODE_ICONS[node.type];
  const breadcrumb = ancestorsOf(index, node.id)
    .map((id) => index.byId.get(id))
    .filter((entry): entry is CodeNode => Boolean(entry));
  const children = index.children.get(node.id) ?? [];
  const isSource = Boolean(node.path) && (node.type === "FILE" || node.parentId?.startsWith("file:"));

  const actions: Array<{ id: NodeAction | View; label: string; icon: typeof Sparkles; ai?: boolean; disabled?: boolean }> = [
    { id: "explain", label: "Explain", icon: Sparkles, ai: true },
    { id: "ask", label: "Ask Gemma", icon: MessageSquare, ai: true },
    { id: "trace", label: "Trace", icon: RouteIcon },
    { id: "dependencies", label: "Dependencies", icon: ArrowUpRight },
    { id: "dependents", label: "Dependents", icon: ArrowDownLeft },
    { id: "why", label: "Why?", icon: HelpCircle, ai: true },
    { id: "impact", label: "What breaks if changed?", icon: Zap },
    { id: "source", label: "Open source", icon: Code2, disabled: !isSource },
  ];

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Selected node">
      <div className="border-b-[3px] border-ink p-4">
        {breadcrumb.length > 0 && (
          <nav className="mb-2 flex flex-wrap items-center gap-0.5 text-[11px] text-ink/60" aria-label="Location">
            {breadcrumb.map((entry) => (
              <span key={entry.id} className="flex items-center gap-0.5">
                <button type="button" className="hover:text-ink hover:underline" onClick={() => onSelect(entry.id)}>
                  {entry.label}
                </button>
                <ChevronRight className="h-3 w-3" aria-hidden />
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-start gap-3">
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center border-2 border-ink shadow-[2px_2px_0_0_#0a0a0a]", NODE_FILL[node.type])}>
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="meta-label">{NODE_TYPE_LABEL[node.type]}</p>
            <h2 className="font-archivo text-lg leading-tight break-words text-ink">{node.label}</h2>
            {node.path && node.path !== node.label && (
              <p className="mt-0.5 font-mono text-[11px] break-all text-ink/60">
                {node.path}
                {node.startLine ? `:${node.startLine}-${node.endLine ?? node.startLine}` : ""}
              </p>
            )}
          </div>
        </div>
        <dl className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {node.fileCount !== undefined && node.type !== "FILE" && <Fact label="Files" value={node.fileCount} />}
          {children.length > 0 && <Fact label="Children" value={children.length} />}
          {node.language && <Fact label="Language" value={node.language} />}
          {node.endLine && node.type === "FILE" && <Fact label="Lines" value={node.endLine} />}
          {node.type === "FILE" && <Fact label="Analyzed" value={node.analyzed ? "yes" : "no (not read)"} />}
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-b-[3px] border-ink bg-paper p-3">
        {actions.map((action) => {
          const ActionIcon = action.icon;
          const active = view === action.id;
          const disabled = action.disabled || (action.ai && !ai.configured);
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (action.id === "dependencies" || action.id === "dependents") setView(active ? "overview" : action.id);
                else if (action.id === "impact") {
                  setView("impact");
                  if (ai.configured) onAction("impact");
                } else onAction(action.id as NodeAction);
              }}
              title={action.ai && !ai.configured ? ai.reason : undefined}
              className={cn(
                "flex items-center gap-1.5 border-2 border-ink px-2 py-1.5 text-left text-[12px] font-semibold transition-transform disabled:cursor-not-allowed disabled:opacity-40",
                active ? "bg-ink text-lime" : "bg-white text-ink hover:-translate-y-px hover:bg-lime",
                action.id === "impact" && "col-span-2",
              )}
            >
              <ActionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {view === "overview" && (
          <>
            <GitBriefPanel repoRef={repoRef} node={node} ai={ai} onOpenSource={onOpenSource} />
            <Overview node={node} childNodes={children} onSelect={onSelect} />
          </>
        )}
        {view !== "overview" && loading && (
          <div className="space-y-2" aria-busy>
            <div className="gitty-skeleton h-8 w-full" />
            <div className="gitty-skeleton h-8 w-10/12" />
            <div className="gitty-skeleton h-8 w-11/12" />
          </div>
        )}
        {error && (
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-orange">
            <AlertTriangle className="h-4 w-4" aria-hidden /> {error}
          </p>
        )}
        {!loading && !error && (view === "dependencies" || view === "dependents") && relations && (
          <RelationList
            title={view === "dependencies" ? "Imports and uses" : "Imported by"}
            relations={relations.list}
            total={relations.total}
            analyzedFiles={analyzedFiles}
            onSelect={(path, kind) => onSelect(kind === "imports" ? fileNode(path) : (findServiceId(index, path) ?? fileNode(path)))}
            onOpenSource={onOpenSource}
          />
        )}
        {!loading && !error && view === "impact" && impact && (
          <ImpactView impact={impact} analyzedFiles={analyzedFiles} aiConfigured={ai.configured} onSelect={onSelect} onOpenSource={onOpenSource} />
        )}
      </div>
    </section>
  );
}

function findServiceId(index: ChildIndex, label: string): string | undefined {
  for (const node of index.byId.values())
    if ((node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE") && node.label === label) return node.id;
  return undefined;
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-2 border-ink bg-white px-1.5 py-0.5">
      <dt className="inline font-bold">{label}: </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}

function Overview({ node, childNodes, onSelect }: { node: CodeNode; childNodes: CodeNode[]; onSelect(id: string): void }) {
  if (!childNodes.length)
    return (
      <p className="text-[13px] text-ink/70">
        {node.type === "FILE" && !node.analyzed
          ? "Gitty did not read this file during analysis (only the most relevant files are read), so it has no symbols or import edges. You can still open its source."
          : "Use the actions above to explore this node. Dependencies and impact are computed from the repository; Gemma only explains them."}
      </p>
    );
  return (
    <div>
      <p className="meta-label mb-2">Contains</p>
      <ul className="space-y-1">
        {childNodes.slice(0, 60).map((child) => {
          const ChildIcon = NODE_ICONS[child.type];
          return (
            <li key={child.id}>
              <button
                type="button"
                onClick={() => onSelect(child.id)}
                className="flex w-full items-center gap-2 border-2 border-transparent px-1.5 py-1 text-left text-[13px] hover:border-ink hover:bg-white"
              >
                <ChildIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate font-medium">{child.label}</span>
                {child.startLine && <span className="ml-auto font-mono text-[10px] text-ink/50">L{child.startLine}</span>}
                {child.fileCount && child.type !== "FILE" ? (
                  <span className="ml-auto text-[10px] font-bold text-ink/50">{child.fileCount}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {childNodes.length > 60 && <p className="mt-2 text-[12px] text-ink/60">… and {childNodes.length - 60} more on the map.</p>}
    </div>
  );
}

function EvidenceLink({ evidence, onOpenSource }: { evidence?: SourceRef; onOpenSource(source: SourceRef): void }) {
  if (!evidence) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenSource(evidence)}
      className="shrink-0 border border-ink/40 px-1 font-mono text-[10px] hover:border-ink hover:bg-lime"
      title="Show the line that creates this relationship"
    >
      {evidence.path.split("/").at(-1)}
      {evidence.startLine ? `:${evidence.startLine}` : ""}
    </button>
  );
}

function RelationList({
  title,
  relations,
  total,
  analyzedFiles,
  onSelect,
  onOpenSource,
}: {
  title: string;
  relations: Relation[];
  total: number;
  analyzedFiles: number;
  onSelect(path: string, kind: Relation["kind"]): void;
  onOpenSource(source: SourceRef): void;
}) {
  return (
    <div>
      <p className="meta-label mb-1">
        {title} · {total}
      </p>
      <p className="mb-3 text-[11.5px] text-ink/60">
        From resolved imports in {analyzedFiles} analyzed files. Dynamic, HTTP and config wiring is not included.
      </p>
      {!relations.length && <p className="text-[13px] text-ink/70">None found in the analyzed files.</p>}
      <ul className="space-y-1">
        {relations.map((relation) => (
          <li key={`${relation.kind}:${relation.path}`} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(relation.path, relation.kind)}
              className="min-w-0 flex-1 truncate border-2 border-ink bg-white px-2 py-1 text-left font-mono text-[11.5px] hover:bg-lime"
              title={relation.path}
            >
              {relation.kind !== "imports" && <span className="mr-1 font-sans font-bold">{relation.kind === "uses_database" ? "DB" : "SERVICE"}</span>}
              {relation.path}
            </button>
            <EvidenceLink evidence={relation.evidence} onOpenSource={onOpenSource} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImpactView({
  impact,
  analyzedFiles,
  aiConfigured,
  onSelect,
  onOpenSource,
}: {
  impact: ImpactResult;
  analyzedFiles: number;
  aiConfigured: boolean;
  onSelect(id: string): void;
  onOpenSource(source: SourceRef): void;
}) {
  const section = (title: string, entries: ImpactResult["direct"], tone: string) => (
    <div className="mb-4">
      <p className="meta-label mb-1.5">
        {title} · {entries.length}
      </p>
      {!entries.length && <p className="text-[13px] text-ink/70">None found.</p>}
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li key={entry.nodeId} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(entry.nodeId)}
              className={cn("min-w-0 flex-1 truncate border-2 border-ink px-2 py-1 text-left font-mono text-[11.5px] hover:bg-lime", tone)}
              title={entry.via ? `${entry.path} (via ${entry.via})` : entry.path}
            >
              {entry.depth > 1 && <span className="mr-1 font-sans text-[10px] font-bold">L{entry.depth}</span>}
              {entry.path}
            </button>
            <EvidenceLink evidence={entry.evidence} onOpenSource={onOpenSource} />
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div>
      <div className="mb-3 flex gap-2 border-2 border-ink bg-[#ffe1d2] p-2.5 text-[12px]">
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        <p>
          Computed from imports across {analyzedFiles} analyzed files.{" "}
          {aiConfigured ? "Gemma's explanation of the risk is in the Ask tab." : "Configure AI for an explanation of the risk."}
        </p>
      </div>
      {section("Direct dependents", impact.direct, "bg-[#ffd8c2]")}
      {section("Indirect dependents", impact.indirect, "bg-white")}
      {impact.truncated && <p className="text-[12px] text-ink/60">More dependents exist beyond this list.</p>}
      {!impact.direct.length && !impact.indirect.length && (
        <p className="text-[12.5px] text-ink/70">
          Nothing in the analyzed files imports this, so a change here has no known blast radius.
        </p>
      )}
    </div>
  );
}
