import type { CodeNode, CodeNodeType } from "./types";

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 36;
const COLUMN_GAP = 64;
const ROW_GAP = 12;
/** Children shown per expanded node before a "+N more" entry. */
const DEFAULT_CHILD_LIMIT = 30;

const TYPE_ORDER: Record<CodeNodeType, number> = {
  REPOSITORY: 0,
  APPLICATION: 1,
  MODULE: 2,
  DIRECTORY: 3,
  API_ROUTE: 4,
  CLASS: 5,
  FUNCTION: 6,
  FILE: 7,
  DATABASE: 8,
  EXTERNAL_SERVICE: 9,
};

export interface LaidOutNode {
  id: string;
  node?: CodeNode;
  /** "+N more" placeholder under `parentId`. */
  more?: { parentId: string; hidden: number };
  x: number;
  y: number;
  depth: number;
  parentId?: string;
  hasChildren: boolean;
  expanded: boolean;
}

export interface MapLayout {
  nodes: LaidOutNode[];
  links: Array<{ from: string; to: string }>;
  width: number;
  height: number;
  /** Visible id for every node id (itself, or its nearest visible ancestor). */
  visibleFor: (id: string) => string | undefined;
}

export interface ChildIndex {
  children: Map<string, CodeNode[]>;
  byId: Map<string, CodeNode>;
}

export function indexChildren(nodes: CodeNode[]): ChildIndex {
  const children = new Map<string, CodeNode[]>();
  const byId = new Map<string, CodeNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
    if (!node.parentId) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  for (const list of children.values())
    list.sort(
      (a, b) =>
        TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
        (a.startLine ?? 0) - (b.startLine ?? 0) ||
        a.label.localeCompare(b.label),
    );
  return { children, byId };
}

/** Ids from the root down to (not including) `id`. */
export function ancestorsOf(index: ChildIndex, id: string): string[] {
  const chain: string[] = [];
  let current = index.byId.get(id)?.parentId;
  while (current && chain.length < 64) {
    chain.unshift(current);
    current = index.byId.get(current)?.parentId;
  }
  return chain;
}

export function layoutMap(
  index: ChildIndex,
  expanded: ReadonlySet<string>,
  childLimits: ReadonlyMap<string, number>,
): MapLayout {
  const laid: LaidOutNode[] = [];
  const links: MapLayout["links"] = [];
  const visible = new Set<string>();
  let row = 0;
  let maxDepth = 0;
  const rowHeight = NODE_HEIGHT + ROW_GAP;
  const columnWidth = NODE_WIDTH + COLUMN_GAP;

  const place = (node: CodeNode, depth: number, parentId?: string): number => {
    maxDepth = Math.max(maxDepth, depth);
    const children = index.children.get(node.id) ?? [];
    const isExpanded = expanded.has(node.id) && children.length > 0;
    const entry: LaidOutNode = {
      id: node.id,
      node,
      x: depth * columnWidth,
      y: 0,
      depth,
      parentId,
      hasChildren: children.length > 0,
      expanded: isExpanded,
    };
    laid.push(entry);
    visible.add(node.id);
    if (parentId) links.push({ from: parentId, to: node.id });
    if (!isExpanded) {
      entry.y = row++ * rowHeight;
      return entry.y;
    }
    const limit = childLimits.get(node.id) ?? DEFAULT_CHILD_LIMIT;
    const shown = children.slice(0, limit);
    const ys = shown.map((child) => place(child, depth + 1, node.id));
    if (children.length > shown.length) {
      const id = `more:${node.id}`;
      const y = row++ * rowHeight;
      laid.push({
        id,
        more: { parentId: node.id, hidden: children.length - shown.length },
        x: (depth + 1) * columnWidth,
        y,
        depth: depth + 1,
        parentId: node.id,
        hasChildren: false,
        expanded: false,
      });
      links.push({ from: node.id, to: id });
      ys.push(y);
    }
    entry.y = (ys[0]! + ys[ys.length - 1]!) / 2;
    return entry.y;
  };

  const root = index.byId.get("repo");
  if (root) place(root, 0);

  // Databases and services sit in their own column to the right.
  const services = [...index.byId.values()].filter(
    (node) => node.type === "DATABASE" || node.type === "EXTERNAL_SERVICE",
  );
  const servicesX = (maxDepth + 1) * columnWidth + COLUMN_GAP * 2;
  const treeHeight = Math.max(1, row) * rowHeight;
  const serviceStart = Math.max(
    0,
    (treeHeight - services.length * rowHeight * 1.4) / 2,
  );
  services
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label),
    )
    .forEach((node, position) => {
      laid.push({
        id: node.id,
        node,
        x: servicesX,
        y: serviceStart + position * rowHeight * 1.4,
        depth: maxDepth + 1,
        hasChildren: false,
        expanded: false,
      });
      visible.add(node.id);
    });

  const visibleFor = (id: string): string | undefined => {
    let current: string | undefined = id;
    while (current) {
      if (visible.has(current)) return current;
      current = index.byId.get(current)?.parentId;
    }
    return undefined;
  };

  return {
    nodes: laid,
    links,
    width: (services.length ? servicesX : maxDepth * columnWidth) + NODE_WIDTH,
    height: Math.max(
      treeHeight,
      serviceStart + services.length * rowHeight * 1.4,
    ),
    visibleFor,
  };
}
