/**
 * The topology layout. Every endpoint's home is derived from the graph; the
 * canvas file holds only what the designer chose. No DOM, React or store
 * imports, so the topology view, the 3D view's sketch and the build sheet
 * can all draw from the same picture.
 */
import { buildGraph, degree, harnesses, otherEnd, pieces, type Graph, type Piece } from "./derive";
import { allNets, type Project } from "./project";
import type { Endpoint, Position, Segment, Topology, TopologyCanvas } from "./schema";

/** The drawn length of every logical edge, in canvas pixels. */
export const UNIFORM_LENGTH = 150;
/** The least distance between two siblings on a crowded arc: a connector box and a little air. */
export const SIBLING_PITCH = 104;
/** The angle between neighbouring children of a node that has a parent. */
export const STEP_DEGREES = 15;
/** Clear space between packed pieces, with room above each for its harness label. */
export const PIECE_GAP = 80;
/** Air between a harness box's edge and the endpoint boxes inside it. Fits inside PIECE_GAP with the title band. */
export const BOX_PAD = 12;
/** The band on a harness box's top edge that holds its name and part number. */
export const BOX_TITLE = 24;
/** Space between connectors in the waiting grid, down a column and between columns. */
export const WAITING_GAP = 16;
/** Room over each waiting column for its component's name. */
export const WAITING_LABEL = 22;

/** The box each endpoint kind draws as, centred on its position. */
export const ENDPOINT_SIZE: Record<Endpoint["kind"], { w: number; h: number }> = {
  connector: { w: 88, h: 22 },
  point: { w: 12, h: 12 },
  breakout: { w: 20, h: 20 },
  splice: { w: 22, h: 22 },
};

export interface EndpointLayout {
  /** Where the layout puts the endpoint's centre. */
  home: Position;
  /** Where it draws: home plus the designer's offset. */
  drawn: Position;
}

export interface PieceLayout {
  /** The smallest segment id in the piece, as `pieces` derives it. */
  id: string;
  built: boolean;
  /** Bounds of every endpoint box in the piece, after packing and the box offset. */
  rect: Rect;
  /** The harness box. Purchased cables have none. */
  box?: HarnessBox;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The rounded box a harness draws in, with its name and part number on the top edge. */
export interface HarnessBox {
  rect: Rect;
  /** The harness name, or its fallback label when unnamed. Never a bus name. */
  label: string;
  partNumber?: string;
  /** No segment of the piece carries a name, so the label is the fallback. */
  unnamed: boolean;
  /** The stored offset from the packed place, zero when the box has not been dragged. */
  offset: Position;
}

export interface TopologyLayout {
  /** Every endpoint of the topology, by id. Centres, in canvas pixels. */
  endpoints: Map<string, EndpointLayout>;
  /** Where each segment's two ends land, in the order of `segment.ends`. */
  segments: Map<string, [Position, Position]>;
  /** Built harnesses first, then purchased cables, each in piece id order. */
  pieces: PieceLayout[];
  /** Connectors with nets and no segment, under the pieces, by component name. */
  waiting: WaitingGroup[];
}

/** One component's connectors in the waiting grid. */
export interface WaitingGroup {
  component: string;
  /** The component's name, drawn over its column. */
  name: string;
  /** The column, name included. */
  rect: { x: number; y: number; w: number; h: number };
  /** By designator. */
  connectors: WaitingConnector[];
}

export interface WaitingConnector {
  /** `<component id>/<designator>` */
  address: string;
  /** The endpoint record, when the topology file holds one for this connector. */
  endpoint?: string;
  /** Where the connector box's centre draws. Waiting connectors have no offset. */
  position: Position;
}

type Positions = Map<string, Position>;

/** Lay out one topology from the graph and its canvas file. */
export function layoutTopology(project: Project, topology: Topology, canvas: TopologyCanvas): TopologyLayout {
  const graph = buildGraph(topology);
  const all = pieces(graph);
  const ordered = [...all.filter((p) => p.built), ...all.filter((p) => !p.built)];
  const roots = new Set(canvas.roots);
  const named = new Map(harnesses(project, graph).map((h) => [h.piece.id, h]));
  // Each piece in its own frame first. A turn about the piece's centre belongs here, before the bounds are taken.
  const laid = ordered.map((piece) => {
    const local = layoutPiece(graph, piece, roots);
    return { piece, local, rect: bounds(graph, local) };
  });
  const home: Positions = new Map();
  const out: PieceLayout[] = [];
  const bottom = pack(
    laid.map((l) => l.rect),
    (i, x, y) => {
      const { piece, local, rect } = laid[i];
      // The box offset is added after packing and moves the homes, so a dragged box carries every endpoint with it.
      const offset = canvas.pieces[piece.id]?.offset ?? { x: 0, y: 0 };
      const placed = { x: x + offset.x, y: y + offset.y, w: rect.w, h: rect.h };
      for (const [id, p] of local) home.set(id, { x: p.x - rect.x + placed.x, y: p.y - rect.y + placed.y });
      const h = named.get(piece.id);
      const box = h && { rect: boxAround(placed), label: h.label, partNumber: h.partNumber, unnamed: h.anchors.length === 0, offset };
      out.push({ id: piece.id, built: piece.built, rect: placed, ...(box ? { box } : {}) });
    },
  );
  const width = Math.max(0, ...out.map((p) => p.rect.x + p.rect.w));
  const waiting = waitingGrid(project, graph, bottom, width);
  // A waiting connector with an endpoint record draws where the grid puts it. Other endpoints with no segment have no home.
  for (const g of waiting) for (const c of g.connectors) if (c.endpoint) home.set(c.endpoint, c.position);

  const endpoints = new Map<string, EndpointLayout>();
  for (const [id, p] of home) endpoints.set(id, { home: p, drawn: p });
  const segments = new Map<string, [Position, Position]>();
  for (const s of topology.segments) {
    const a = endpoints.get(s.ends[0]);
    const b = endpoints.get(s.ends[1]);
    if (a && b) segments.set(s.id, [a.drawn, b.drawn]);
  }
  return { endpoints, segments, pieces: out, waiting };
}

// The waiting grid ------------------------------------------------------------------

/**
 * Every connector that ends a net and no segment, grouped by component and
 * ordered by component name then designator. Each group is a column under
 * its name; columns run left to right under the pieces and wrap at their width.
 */
function waitingGrid(project: Project, graph: Graph, top: number, width: number): WaitingGroup[] {
  const routed = new Set<string>();
  for (const [address, id] of graph.connectorEndpoint) if (degree(graph, id) > 0) routed.add(address);
  const byComponent = new Map<string, Set<string>>();
  for (const { net } of allNets(project)) {
    for (const address of net.connectors) {
      const component = address.split("/")[0];
      if (routed.has(address) || !project.components.has(component)) continue;
      if (!byComponent.has(component)) byComponent.set(component, new Set());
      byComponent.get(component)!.add(address);
    }
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const groups = [...byComponent].map(([component, addresses]) => ({ component, name: project.components.get(component)!.name ?? component, addresses: [...addresses] }));
  groups.sort((a, b) => byName(a.name, b.name) || byName(a.component, b.component));

  const { w, h } = ENDPOINT_SIZE.connector;
  const rowWidth = Math.max(width, 6 * (w + 2 * WAITING_GAP));
  const out: WaitingGroup[] = [];
  let x = 0;
  let y = top;
  let rowHeight = 0;
  for (const g of groups) {
    const designator = (a: string) => a.split("/")[1];
    g.addresses.sort((a, b) => byName(designator(a), designator(b)));
    const rect = { x, y, w, h: WAITING_LABEL + g.addresses.length * (h + WAITING_GAP) - WAITING_GAP };
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y += rowHeight + WAITING_GAP * 2;
      rowHeight = 0;
      Object.assign(rect, { x, y });
    }
    const connectors = g.addresses.map((address, i) => ({
      address,
      endpoint: graph.connectorEndpoint.get(address),
      position: { x: x + w / 2, y: y + WAITING_LABEL + i * (h + WAITING_GAP) + h / 2 },
    }));
    out.push({ component: g.component, name: g.name, rect, connectors });
    x += w + 2 * WAITING_GAP;
    rowHeight = Math.max(rowHeight, rect.h);
  }
  return out;
}

// One piece ---------------------------------------------------------------------

/** One edge of the logical tree, seen from `a`. */
interface LogicalEdge {
  a: string;
  b: string;
  /** Collapsed points between the two ends, in order from `a`. */
  between: string[];
}

interface LogicalTree {
  nodes: string[];
  edges: Map<string, LogicalEdge[]>;
}

/**
 * The piece as a tree of logical nodes. A chain of degree-two points becomes
 * one edge, so a corner marker never bends a tree that has no geometry.
 */
function logicalTree(graph: Graph, piece: Piece, roots: Set<string>): LogicalTree {
  // A marked root stays a node even when it is a point of degree two.
  const collapses = (id: string) => graph.endpoints.get(id)!.kind === "point" && degree(graph, id) === 2 && !roots.has(id);
  let nodes = [...piece.endpoints].filter((id) => !collapses(id)).sort();
  // Only a ring of points has no node left; keep every endpoint so the walk still reaches it.
  const isNode = nodes.length > 0 ? (id: string) => !collapses(id) : () => true;
  if (nodes.length === 0) nodes = [...piece.endpoints].sort();
  const edges = new Map<string, LogicalEdge[]>(nodes.map((n) => [n, []]));
  const walked = new Set<string>();
  for (const a of nodes) {
    for (const first of graph.incident.get(a) ?? []) {
      if (walked.has(first.id)) continue;
      walked.add(first.id);
      const between: string[] = [];
      let seg: Segment = first;
      let cur = otherEnd(seg, a);
      while (!isNode(cur)) {
        between.push(cur);
        const next = (graph.incident.get(cur) ?? []).find((s) => s.id !== seg.id);
        if (!next || walked.has(next.id)) break;
        seg = next;
        walked.add(seg.id);
        cur = otherEnd(seg, cur);
      }
      if (!isNode(cur)) continue;
      edges.get(a)!.push({ a, b: cur, between });
      edges.get(cur)!.push({ a: cur, b: a, between: [...between].reverse() });
    }
  }
  return { nodes, edges };
}

/** Homes for one piece, relative to its root at the origin. */
function layoutPiece(graph: Graph, piece: Piece, roots: Set<string>): Positions {
  const tree = logicalTree(graph, piece, roots);
  const marked = tree.nodes.filter((n) => roots.has(n));
  const trunk = marked.length >= 2 ? longestPathBetween(tree, marked) : [marked[0] ?? middleOfLongestPath(tree)];
  const root = trunk[0];
  const pos: Positions = new Map([[root, { x: 0, y: 0 }]]);
  const visited = new Set<string>();
  /** Lay out a node's children, or only the ones in `only` when the trunk splits them between its two sides. */
  const grow = (node: string, parent: string | undefined, away: number, only?: LogicalEdge[]) => {
    visited.add(node);
    const kids = only ?? tree.edges.get(node)!.filter((e) => e.b !== parent && !visited.has(e.b));
    const k = kids.length;
    // A root spreads its children evenly over the whole circle; every other node fans them around the direction away from its parent.
    const angles = parent === undefined ? kids.map((_, i) => (i * 360) / k) : kids.map((_, i) => away + (i - (k - 1) / 2) * STEP_DEGREES);
    kids.forEach((e, i) => {
      if (visited.has(e.b)) return;
      pos.set(e.b, step(pos.get(node)!, angles[i], UNIFORM_LENGTH));
      spaceEvenly(pos, e);
      grow(e.b, node, angles[i]);
    });
  };
  if (trunk.length === 1) grow(root, undefined, 0);
  else layTrunk(tree, trunk, pos, visited, grow);
  // A cycle is a design rule error; anything the walk could not reach sits on the root so it stays visible.
  for (const id of piece.endpoints) if (!pos.has(id)) pos.set(id, { x: 0, y: 0 });
  return pos;
}

/**
 * Two or more roots: the trunk lies flat along the x axis from its first
 * node. Its ends fan the rest of their children onward along the line.
 * Every branch off a trunk node between them hangs square off the trunk,
 * and the sides take turns in trunk order.
 */
function layTrunk(
  tree: LogicalTree,
  trunk: string[],
  pos: Positions,
  visited: Set<string>,
  grow: (node: string, parent: string | undefined, away: number, only?: LogicalEdge[]) => void,
) {
  const along = (a: string, b: string) => tree.edges.get(a)!.find((e) => e.b === b)!;
  for (const n of trunk) visited.add(n);
  trunk.slice(1).forEach((n, i) => {
    pos.set(n, step(pos.get(trunk[i])!, 0, UNIFORM_LENGTH));
    spaceEvenly(pos, along(trunk[i], n));
  });
  let side = 0;
  trunk.forEach((n, i) => {
    if (i === 0) return grow(n, trunk[1], 180);
    if (i === trunk.length - 1) return grow(n, trunk[i - 1], 0);
    const kids = tree.edges.get(n)!.filter((e) => !visited.has(e.b));
    const sides: [LogicalEdge[], LogicalEdge[]] = [[], []];
    for (const e of kids) sides[side++ % 2].push(e);
    grow(n, trunk[i - 1], 90, sides[0]);
    grow(n, trunk[i - 1], -90, sides[1]);
  });
}

/** Collapsed points sit evenly on the straight line between their edge's ends. */
function spaceEvenly(pos: Positions, e: LogicalEdge) {
  const a = pos.get(e.a)!;
  const b = pos.get(e.b)!;
  e.between.forEach((id, i) => {
    const f = (i + 1) / (e.between.length + 1);
    pos.set(id, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  });
}

/** The farthest node from `from`, and the walk back to it. */
function farthest(tree: LogicalTree, from: string): { far: string; parent: Map<string, string | undefined> } {
  const parent = new Map<string, string | undefined>([[from, undefined]]);
  const queue = [from];
  let far = from;
  while (queue.length) {
    const n = queue.shift()!;
    far = n;
    for (const e of tree.edges.get(n)!) {
      if (parent.has(e.b)) continue;
      parent.set(e.b, n);
      queue.push(e.b);
    }
  }
  return { far, parent };
}

/** The longest path between two marked nodes, starting from the one that sorts first. */
function longestPathBetween(tree: LogicalTree, marked: string[]): string[] {
  let best: string[] = [marked[0]];
  for (const a of marked) {
    const { parent } = farthest(tree, a);
    for (const b of marked) {
      if (b <= a || !parent.has(b)) continue;
      const path: string[] = [];
      for (let n: string | undefined = b; n !== undefined; n = parent.get(n)) path.unshift(n);
      if (path.length > best.length) best = path;
    }
  }
  return best;
}

/** Two walks find the longest path through a tree; its middle node balances the picture. */
function middleOfLongestPath(tree: LogicalTree): string {
  const a = farthest(tree, tree.nodes[0]).far;
  const { far: b, parent } = farthest(tree, a);
  const path: string[] = [];
  for (let n: string | undefined = b; n !== undefined; n = parent.get(n)) path.push(n);
  return path[Math.floor((path.length - 1) / 2)];
}

function step(from: Position, degrees: number, length: number): Position {
  const r = (degrees * Math.PI) / 180;
  return { x: from.x + Math.cos(r) * length, y: from.y + Math.sin(r) * length };
}

// Packing ---------------------------------------------------------------------------

/**
 * Shelf packing: rectangles in rows, in the order given, each row's tops
 * level, wrapping at a width that keeps the whole roughly square. Calls
 * `place` with each rectangle's top-left and returns the y under the last row.
 */
function pack(rects: { w: number; h: number }[], place: (index: number, x: number, y: number) => void): number {
  const area = rects.reduce((sum, r) => sum + (r.w + PIECE_GAP) * (r.h + PIECE_GAP), 0);
  const rowWidth = Math.max(Math.sqrt(area), ...rects.map((r) => r.w));
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  rects.forEach((r, i) => {
    if (x > 0 && x + r.w > rowWidth) {
      x = 0;
      y += rowHeight + PIECE_GAP;
      rowHeight = 0;
    }
    place(i, x, y);
    x += r.w + PIECE_GAP;
    rowHeight = Math.max(rowHeight, r.h);
  });
  return rects.length ? y + rowHeight + PIECE_GAP : 0;
}

/** A harness box: the endpoint bounds with air on every side and the title band on top. */
function boxAround(r: Rect): Rect {
  return { x: r.x - BOX_PAD, y: r.y - BOX_PAD - BOX_TITLE, w: r.w + 2 * BOX_PAD, h: r.h + 2 * BOX_PAD + BOX_TITLE };
}

/** The harness box around endpoint boxes wherever they are drawn, so a view can redraw it mid-glide or mid-drag. */
export function harnessBoxRect(endpoints: { at: Position; size: { w: number; h: number } }[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { at, size } of endpoints) {
    minX = Math.min(minX, at.x - size.w / 2);
    maxX = Math.max(maxX, at.x + size.w / 2);
    minY = Math.min(minY, at.y - size.h / 2);
    maxY = Math.max(maxY, at.y + size.h / 2);
  }
  return boxAround({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
}

function bounds(graph: Graph, pos: Positions): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, p] of pos) {
    const s = ENDPOINT_SIZE[graph.endpoints.get(id)?.kind ?? "point"];
    minX = Math.min(minX, p.x - s.w / 2);
    maxX = Math.max(maxX, p.x + s.w / 2);
    minY = Math.min(minY, p.y - s.h / 2);
    maxY = Math.max(maxY, p.y + s.h / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
