"use client";

import { ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  type LaidOutNode,
  type MapLayout,
} from "~/features/gitty/map-layout";
import type { CodeEdge } from "~/features/gitty/types";
import { cn } from "~/lib/utils";

import { NODE_FILL, NODE_ICONS, NODE_TYPE_LABEL } from "./node-style";

export interface MapHandle {
  focus(id: string): void;
  fit(): void;
  /** Frame these nodes (or their visible ancestors). */
  fitTo(ids: string[]): void;
}

interface CodebaseMapProps {
  layout: MapLayout;
  edges: CodeEdge[];
  selectedId: string | null;
  /** Ids (any level) to highlight as the selection's dependencies / dependents. */
  dependencyIds: ReadonlySet<string>;
  dependentIds: ReadonlySet<string>;
  /** Ordered node ids of the active trace. */
  traceIds: string[];
  activeTraceIndex: number | null;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onShowMore(parentId: string): void;
  handleRef?: Ref<MapHandle>;
}

interface View {
  x: number;
  y: number;
  k: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 2.2;
const MAX_SERVICE_LINKS = 240;

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

function visibleIds(layout: MapLayout, ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const visible = layout.visibleFor(id);
    if (visible) out.add(visible);
  }
  return out;
}

function elbow(parent: LaidOutNode, child: LaidOutNode): string {
  const x1 = parent.x + NODE_WIDTH;
  const y1 = parent.y + NODE_HEIGHT / 2;
  const x2 = child.x;
  const y2 = child.y + NODE_HEIGHT / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M${x1},${y1} H${mid} V${y2} H${x2}`;
}

function CodebaseMapInner({
  layout,
  edges,
  selectedId,
  dependencyIds,
  dependentIds,
  traceIds,
  activeTraceIndex,
  onSelect,
  onToggle,
  onShowMore,
  handleRef,
}: CodebaseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);

  const fit = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const k = Math.min(
      1,
      Math.max(MIN_SCALE, Math.min((width - 80) / layout.width, (height - 80) / layout.height)),
    );
    setView({
      k,
      x: (width - layout.width * k) / 2,
      y: Math.max(40, (height - layout.height * k) / 2),
    });
  }, [layout]);

  const focus = useCallback(
    (id: string) => {
      const element = containerRef.current;
      const target = byId.get(layout.visibleFor(id) ?? id);
      if (!element || !target) return;
      const { width, height } = element.getBoundingClientRect();
      const k = Math.max(viewRef.current.k, 0.75);
      setView({
        k,
        x: width / 2 - (target.x + NODE_WIDTH / 2) * k,
        y: height / 2 - (target.y + NODE_HEIGHT / 2) * k,
      });
    },
    [byId, layout],
  );

  const fitTo = useCallback(
    (ids: string[]) => {
      const element = containerRef.current;
      const targets = ids
        .map((id) => byId.get(layout.visibleFor(id) ?? id))
        .filter((node): node is LaidOutNode => Boolean(node));
      if (!element || !targets.length) return;
      const minX = Math.min(...targets.map((node) => node.x));
      const minY = Math.min(...targets.map((node) => node.y));
      const maxX = Math.max(...targets.map((node) => node.x + NODE_WIDTH));
      const maxY = Math.max(...targets.map((node) => node.y + NODE_HEIGHT));
      const { width, height } = element.getBoundingClientRect();
      const k = Math.min(1.1, Math.max(MIN_SCALE, Math.min((width - 120) / (maxX - minX), (height - 120) / (maxY - minY))));
      setView({
        k,
        x: width / 2 - ((minX + maxX) / 2) * k,
        y: height / 2 - ((minY + maxY) / 2) * k,
      });
    },
    [byId, layout],
  );

  useImperativeHandle(handleRef, () => ({ focus, fit, fitTo }), [focus, fit, fitTo]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !layout.nodes.length) return;
    fitted.current = true;
    fit();
  }, [fit, layout.nodes.length]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        // Sideways trackpad scrolling pans; wheel and pinch zoom.
        if (!event.ctrlKey && !event.metaKey && event.deltaX !== 0)
          return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
        const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.k * factor));
        return {
          k,
          x: px - ((px - current.x) / current.k) * k,
          y: py - ((py - current.y) / current.k) * k,
        };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setView((current) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.k * factor));
      return {
        k,
        x: width / 2 - ((width / 2 - current.x) / current.k) * k,
        y: height / 2 - ((height / 2 - current.y) / current.k) * k,
      };
    });
  };

  const selectedVisible = selectedId ? layout.visibleFor(selectedId) : undefined;
  const dependencyVisible = useMemo(() => visibleIds(layout, dependencyIds), [dependencyIds, layout]);
  const dependentVisible = useMemo(() => visibleIds(layout, dependentIds), [dependentIds, layout]);
  const traceVisible = useMemo(
    () =>
      traceIds
        .map((id) => layout.visibleFor(id))
        .filter((id, index, list): id is string => Boolean(id) && list.indexOf(id) === index),
    [traceIds, layout],
  );
  const traceOrder = useMemo(() => new Map(traceVisible.map((id, index) => [id, index + 1])), [traceVisible]);
  const highlighting = Boolean(selectedVisible && (dependencyVisible.size || dependentVisible.size)) || traceVisible.length > 0;

  const serviceLinks = useMemo(() => {
    const seen = new Set<string>();
    const links: Array<{ from: string; to: string }> = [];
    for (const edge of edges) {
      if (edge.kind === "imports") continue;
      const from = layout.visibleFor(edge.from);
      if (!from || from === edge.to) continue;
      const key = `${from}>${edge.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from, to: edge.to });
      if (links.length >= MAX_SERVICE_LINKS) break;
    }
    return links;
  }, [edges, layout]);

  const anchor = (node: LaidOutNode, side: "left" | "right") => ({
    x: node.x + (side === "right" ? NODE_WIDTH : 0),
    y: node.y + NODE_HEIGHT / 2,
  });
  const relationPath = (fromId: string, toId: string) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to || from === to) return null;
    const leftToRight = from.x <= to.x;
    const a = anchor(from, leftToRight ? "right" : "left");
    const b = anchor(to, leftToRight ? "left" : "right");
    return curve(a.x, a.y, b.x, b.y);
  };

  return (
    <div
      ref={containerRef}
      className="gitty-map relative h-full w-full touch-none overflow-hidden select-none"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
        setView((current) => ({ ...current, x: state.vx + dx, y: state.vy + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      role="application"
      aria-label="Codebase map. Drag to pan, scroll to zoom."
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg
          width={layout.width + 40}
          height={layout.height + 40}
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          aria-hidden
        >
          <defs>
            <marker id="gitty-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#0a0a0a" />
            </marker>
          </defs>
          {layout.links.map((link) => {
            const parent = byId.get(link.from);
            const child = byId.get(link.to);
            if (!parent || !child) return null;
            return (
              <path
                key={`${link.from}>${link.to}`}
                d={elbow(parent, child)}
                className={cn("fill-none stroke-[#0a0a0a]", highlighting ? "opacity-15" : "opacity-35")}
                strokeWidth={1.5}
              />
            );
          })}
          {serviceLinks.map((link) => {
            const d = relationPath(link.from, link.to);
            if (!d) return null;
            const active = link.from === selectedVisible || link.to === selectedVisible;
            return (
              <path
                key={`svc:${link.from}>${link.to}`}
                d={d}
                className={cn("fill-none", active ? "stroke-ink opacity-90" : "stroke-[#0a0a0a] opacity-[0.08]")}
                strokeWidth={active ? 2 : 1.25}
                strokeDasharray="5 5"
              />
            );
          })}
          {selectedVisible &&
            [...dependencyVisible].map((id) => {
              const d = relationPath(selectedVisible, id);
              return d ? (
                <path key={`dep:${id}`} d={d} className="gitty-flow fill-none stroke-[#2f7de1]" strokeWidth={2.5} markerEnd="url(#gitty-arrow)" />
              ) : null;
            })}
          {selectedVisible &&
            [...dependentVisible].map((id) => {
              const d = relationPath(id, selectedVisible);
              return d ? (
                <path key={`rdep:${id}`} d={d} className="gitty-flow fill-none stroke-orange" strokeWidth={2.5} markerEnd="url(#gitty-arrow)" />
              ) : null;
            })}
          {traceVisible.slice(1).map((id, index) => {
            const d = relationPath(traceVisible[index]!, id);
            return d ? (
              <path
                key={`trace:${index}`}
                d={d}
                className={cn("gitty-trace fill-none stroke-ink", activeTraceIndex !== null && activeTraceIndex !== index + 1 && "opacity-40")}
                strokeWidth={4}
                markerEnd="url(#gitty-arrow)"
              />
            ) : null;
          })}
        </svg>

        {layout.nodes.map((entry) => {
          if (entry.more)
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onShowMore(entry.more!.parentId)}
                className="absolute flex items-center justify-center border-2 border-dashed border-ink bg-paper text-xs font-semibold text-ink hover:bg-lime"
                style={{ left: entry.x, top: entry.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                +{entry.more.hidden} more
              </button>
            );
          const node = entry.node!;
          const Icon = NODE_ICONS[node.type];
          const selected = entry.id === selectedVisible;
          const isDependency = dependencyVisible.has(entry.id);
          const isDependent = dependentVisible.has(entry.id);
          const step = traceOrder.get(entry.id);
          const related = selected || isDependency || isDependent || step !== undefined;
          return (
            <div
              key={entry.id}
              className={cn(
                "group absolute flex items-stretch border-2 border-ink transition-[opacity,box-shadow,transform] duration-150",
                NODE_FILL[node.type],
                selected
                  ? "z-20 -translate-x-0.5 -translate-y-0.5 !bg-lime !text-ink shadow-[4px_4px_0_0_#0a0a0a]"
                  : "shadow-[2px_2px_0_0_#0a0a0a] hover:z-10 hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_0_#0a0a0a]",
                isDependency && !selected && "ring-4 ring-[#2f7de1]/60",
                isDependent && !selected && "ring-4 ring-orange/60",
                step !== undefined && !selected && "ring-4 ring-ink/70",
                highlighting && !related && "opacity-35",
                node.type === "FILE" && !node.analyzed && "border-dashed",
              )}
              style={{ left: entry.x, top: entry.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink"
                onClick={() => onSelect(entry.id)}
                onDoubleClick={() => entry.hasChildren && onToggle(entry.id)}
                title={`${NODE_TYPE_LABEL[node.type]}: ${node.path ?? node.label}`}
                aria-pressed={selected}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden />
                <span className="truncate text-[13px] leading-none font-semibold">{node.label}</span>
                {node.fileCount && node.type !== "FILE" && node.type !== "REPOSITORY" ? (
                  <span className="ml-auto shrink-0 text-[10px] font-bold opacity-60">{node.fileCount}</span>
                ) : null}
              </button>
              {entry.hasChildren && (
                <button
                  type="button"
                  className="flex w-7 shrink-0 items-center justify-center border-l-2 border-ink hover:bg-ink hover:text-lime"
                  onClick={() => onToggle(entry.id)}
                  aria-label={entry.expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
                  aria-expanded={entry.expanded}
                >
                  <ChevronRight className={cn("h-4 w-4 transition-transform", entry.expanded && "rotate-180")} />
                </button>
              )}
              {step !== undefined && (
                <span className="absolute -top-3 -left-3 grid h-6 w-6 place-items-center rounded-full border-2 border-ink bg-ink text-[11px] font-bold text-lime">
                  {step}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col border-2 border-ink bg-white shadow-[3px_3px_0_0_#0a0a0a]">
        <button type="button" className="p-2 hover:bg-lime" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className="border-y-2 border-ink p-2 hover:bg-lime" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <button type="button" className="p-2 hover:bg-lime" onClick={fit} aria-label="Fit map to view">
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 border-2 border-ink bg-white px-2 py-1 text-[11px] font-semibold">
        {Math.round(view.k * 100)}%
      </div>
    </div>
  );
}

export const CodebaseMap = memo(CodebaseMapInner);
