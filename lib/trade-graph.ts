/**
 * Lays the trade tree out as a graph, with the trades themselves as nodes.
 *
 * WHY A SECOND VIEW AT ALL. In the cascade a trade is an edge label, so a deal
 * that also sent out assets from elsewhere can only be described in text. Here a
 * trade is a BOX that several things enter and several leave, which makes the
 * outside assets visible as arrows rather than a footnote — the one thing the
 * cascade structurally cannot show.
 *
 * LAYERED, NOT FORCE-DIRECTED. A physics layout of nine nodes lands somewhere
 * arbitrary, differs on every render, and discards time — which is the spine of
 * the whole feature. Columns here are generations, so the graph reads left to
 * right in chronological order and is identical on every load.
 *
 * Rows come from a tidy-tree pass: leaves take the next free row, parents centre
 * on their children. That keeps edges short and, for a tree this small, crossing
 * free without a general crossing-minimisation pass.
 */

import type { TradeTree, TreeNode } from "./trade-tree.ts";
import type { Trade } from "./types.ts";

export const NODE_W = 150;
export const NODE_H = 34;
export const COL_GAP = 54;
export const ROW_H = 44;

export interface GraphNode {
  id: string;
  kind: "trade" | "asset" | "outside";
  col: number;
  row: number;
  x: number;
  y: number;
  /** The owner this node belongs to, for grouping and colour. */
  owner: string | null;
  /** Set for asset and outside nodes. */
  node?: TreeNode;
  outside?: { playerId?: string; pick?: { season: number; round: number; originalSlug: string | null }; amount?: number; kind: string };
  /** Set for trade nodes. */
  trade?: { id: string; season: number; week: number; root: boolean };
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Dimmed: an asset that came from outside this lineage. */
  outside: boolean;
  /** Drawn dashed, for a pick becoming a player rather than changing hands. */
  draft: boolean;
  label?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  /** Row bands per owner, for the lane labels down the left. */
  lanes: Array<{ owner: string; top: number; bottom: number }>;
}

export function layoutTradeGraph(trade: Trade, tree: TradeTree): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let nextRow = 0;

  const rootId = `trade:${trade.id}`;
  nodes.push({
    id: rootId,
    kind: "trade",
    col: 0,
    row: 0,
    x: 0,
    y: 0,
    owner: null,
    trade: { id: trade.id, season: trade.season, week: trade.week, root: true },
  });

  const lanes: Array<{ owner: string; top: number; bottom: number }> = [];

  /** Places one asset and everything below it. Returns the row it settled on. */
  const place = (n: TreeNode, col: number, owner: string): number => {
    const id = `asset:${n.id}`;
    const childRows: number[] = [];

    if (n.ended.kind === "traded") {
      const tradeCol = col + 1;
      const tradeId = `trade:${n.ended.tradeId}:${n.id}`;

      // Outside assets sit in the same column as the asset feeding the trade,
      // taking their own rows so nothing overlaps.
      const outsideIds: string[] = [];
      for (const [i, a] of (n.ended.alsoSent ?? []).entries()) {
        const oid = `outside:${n.id}:${i}`;
        const row = nextRow++;
        outsideIds.push(oid);
        nodes.push({
          id: oid,
          kind: "outside",
          col,
          row,
          x: 0,
          y: 0,
          owner,
          outside: { ...a },
        });
      }

      for (const c of n.children) childRows.push(place(c, tradeCol + 1, owner));

      const tradeRow = childRows.length
        ? childRows.reduce((a, b) => a + b, 0) / childRows.length
        : nextRow++;
      nodes.push({
        id: tradeId,
        kind: "trade",
        col: tradeCol,
        row: tradeRow,
        x: 0,
        y: 0,
        owner,
        trade: {
          id: n.ended.tradeId,
          season: n.ended.season,
          week: n.ended.week,
          root: false,
        },
      });

      edges.push({ from: id, to: tradeId, outside: false, draft: false });
      for (const oid of outsideIds) edges.push({ from: oid, to: tradeId, outside: true, draft: false });
      for (const c of n.children) edges.push({ from: tradeId, to: `asset:${c.id}`, outside: false, draft: false });
    } else if (n.ended.kind === "drafted") {
      // A pick becoming a player is not a change of hands, so there is no trade
      // box — just a dashed edge carrying the slot it was used at.
      for (const c of n.children) {
        const row = place(c, col + 1, owner);
        childRows.push(row);
        edges.push({
          from: id,
          to: `asset:${c.id}`,
          outside: false,
          draft: true,
          label: `${n.ended.round}.${String(n.ended.slot).padStart(2, "0")}`,
        });
      }
    }

    const row = childRows.length
      ? childRows.reduce((a, b) => a + b, 0) / childRows.length
      : nextRow++;
    nodes.push({ id, kind: "asset", col, row, x: 0, y: 0, owner, node: n });
    return row;
  };

  for (const side of tree.roots) {
    if (!side.nodes.length) continue;
    const top = nextRow;
    const rows = side.nodes.map((n) => place(n, 1, side.owner));
    for (const n of side.nodes) {
      edges.push({ from: rootId, to: `asset:${n.id}`, outside: false, draft: false });
    }
    lanes.push({ owner: side.owner, top, bottom: Math.max(nextRow - 1, ...rows) });
  }

  // The root trade centres on everything it produced.
  const rootNode = nodes.find((n) => n.id === rootId)!;
  const firstCol = nodes.filter((n) => n.col === 1 && n.kind === "asset");
  rootNode.row = firstCol.length
    ? firstCol.reduce((a, b) => a + b.row, 0) / firstCol.length
    : 0;

  for (const n of nodes) {
    n.x = n.col * (NODE_W + COL_GAP);
    n.y = n.row * ROW_H;
  }

  const width = Math.max(...nodes.map((n) => n.x + NODE_W), NODE_W);
  const height = Math.max(...nodes.map((n) => n.y + NODE_H), NODE_H);
  return { nodes, edges, width, height, lanes };
}

/** An elbow from the right edge of one node to the left edge of another. */
export function edgePath(a: GraphNode, b: GraphNode): string {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mid = x1 + (x2 - x1) / 2;
  if (Math.abs(y1 - y2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  // A rounded step reads better than a diagonal when several edges share a
  // column, because the vertical runs stack instead of fanning.
  const r = Math.min(10, Math.abs(y2 - y1) / 2, (x2 - x1) / 2);
  const dir = y2 > y1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `L ${mid - r} ${y1}`,
    `Q ${mid} ${y1} ${mid} ${y1 + r * dir}`,
    `L ${mid} ${y2 - r * dir}`,
    `Q ${mid} ${y2} ${mid + r} ${y2}`,
    `L ${x2} ${y2}`,
  ].join(" ");
}
