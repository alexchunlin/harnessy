/**
 * PROTOTYPE for issue #31: the topology view when the app owns the layout.
 * Throwaway. Nothing here is meant to land in src/.
 *
 * Positions are derived from the graph alone: every segment draws at one
 * uniform length, and each variant is one rule for where children go.
 *
 *   A  Radial arcs: children spread evenly on an arc facing away from the parent.
 *   B  Left to right: a tidy tree, root on the left, leaves stacked on the right.
 *   C  Spine: the longest path lies flat, branches hang off it, no root at all.
 */
import { allNets, buildGraph, componentConnectors, degree, otherEnd, pieces, placeConnector, removeEndpoint, type Endpoint, type Position, type Project, type Segment, type Topology } from "../../../core";
import { ENDPOINT_SIZE } from "../model";

export type Variant = "A" | "B" | "C";
export const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Radial arcs" },
  { key: "B", name: "Left to right" },
  { key: "C", name: "Spine" },
];

/** The uniform drawn length of a segment, in canvas pixels. */
export const L = 150;
/** Leaf pitch in the left-to-right variant: a connector box plus its fan. */
const PITCH = 48;
const GAP = 70;
/** Room above a piece for its harness label. */
const LABEL_ROOM = 34;

export interface LayoutOptions {
  variant: Variant;
  /** Quarter turns per piece, clockwise. Memory only. */
  turns: Map<string, number>;
  /** The chosen root endpoint per piece. Memory only. Variant C ignores it. */
  roots: Map<string, string>;
  /** A point of degree two collapses into its segment instead of taking a step of its own. */
  collapsePoints: boolean;
  /** Arcs give each child a share proportional to the leaves under it instead of an even share. */
  weighted: boolean;
  /** A node with many children lengthens its segments until the children sit at least a box apart on the arc. */
  stretch: boolean;
}
/** The least distance between two siblings on an arc when `stretch` is on: a connector box and a little air. */
const SIBLING_PITCH = 104;
/** The radius that keeps `k` children on `span` degrees at least SIBLING_PITCH apart, never under L. */
function reach(k: number, span: number, stretch: boolean): number {
  if (!stretch || k < 2) return L;
  const stepRad = ((span / k) * Math.PI) / 180;
  return Math.max(L, SIBLING_PITCH / (2 * Math.sin(Math.min(stepRad, Math.PI) / 2)));
}

/**
 * Make the topology self-consistent with the rule that a connector with nets
 * is always on the canvas and a connector with no nets never is, unless a
 * segment already holds it. Uses the real ops so the result is an ordinary
 * project, held in memory by the prototype.
 */
export function stage(project: Project, topologyId: string): Project {
  const netted = new Set<string>();
  for (const { net } of allNets(project)) for (const c of net.connectors) netted.add(c);
  let p = project;
  const t = p.topologies.get(topologyId)!;
  const graph = buildGraph(t);
  for (const e of t.endpoints) {
    if (e.kind === "connector" && degree(graph, e.id) === 0 && !netted.has(e.connector)) p = removeEndpoint(p, topologyId, e.id);
  }
  const placed = new Set(t.endpoints.flatMap((e) => (e.kind === "connector" ? [e.connector] : [])));
  for (const c of [...p.components.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const con of componentConnectors(p, c) ?? []) {
      const address = `${c.id}/${con.designator}`;
      if (netted.has(address) && !placed.has(address)) p = placeConnector(p, topologyId, address, { x: 0, y: 0 }).project;
    }
  }
  return p;
}

// Logical tree ----------------------------------------------------------------

interface LEdge {
  a: string;
  b: string;
  /** interior points from a to b, when points collapse */
  interior: string[];
}

interface LTree {
  nodes: string[];
  adj: Map<string, LEdge[]>;
}

/** The piece as a tree of logical nodes. With `collapsePoints`, a chain of degree-two points becomes one edge. */
function logicalTree(topology: Topology, endpointIds: Set<string>, collapsePoints: boolean): LTree {
  const graph = buildGraph(topology);
  const isNode = (id: string) => !collapsePoints || graph.endpoints.get(id)!.kind !== "point" || degree(graph, id) !== 2;
  const nodes = [...endpointIds].filter(isNode).sort();
  const adj = new Map<string, LEdge[]>(nodes.map((n) => [n, []]));
  const seen = new Set<string>();
  for (const a of nodes) {
    for (const first of graph.incident.get(a) ?? []) {
      if (seen.has(first.id)) continue;
      const interior: string[] = [];
      let seg: Segment = first;
      let cur = otherEnd(seg, a);
      seen.add(seg.id);
      while (!isNode(cur)) {
        interior.push(cur);
        const next = (graph.incident.get(cur) ?? []).find((s) => s.id !== seg.id);
        if (!next) break;
        seg = next;
        seen.add(seg.id);
        cur = otherEnd(seg, cur);
      }
      if (!isNode(cur)) continue;
      adj.get(a)!.push({ a, b: cur, interior });
      adj.get(cur)!.push({ a: cur, b: a, interior: [...interior].reverse() });
    }
  }
  return { nodes, adj };
}

function bfsFar(tree: LTree, from: string): { far: string; parent: Map<string, string | undefined> } {
  const parent = new Map<string, string | undefined>([[from, undefined]]);
  const queue = [from];
  let far = from;
  while (queue.length) {
    const n = queue.shift()!;
    far = n;
    for (const e of tree.adj.get(n) ?? []) {
      if (parent.has(e.b)) continue;
      parent.set(e.b, n);
      queue.push(e.b);
    }
  }
  return { far, parent };
}

/** The longest path through the tree, as a list of logical nodes. */
function diameter(tree: LTree): string[] {
  const start = tree.nodes[0];
  const a = bfsFar(tree, start).far;
  const { far: b, parent } = bfsFar(tree, a);
  const path: string[] = [];
  for (let cur: string | undefined = b; cur !== undefined; cur = parent.get(cur)) path.push(cur);
  return path;
}

function leafCount(tree: LTree, node: string, parent: string | undefined, memo: Map<string, number>): number {
  const key = `${parent ?? ""}>${node}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const kids = (tree.adj.get(node) ?? []).filter((e) => e.b !== parent);
  const n = kids.length === 0 ? 1 : kids.reduce((s, e) => s + leafCount(tree, e.b, node, memo), 0);
  memo.set(key, n);
  return n;
}

// Placement ------------------------------------------------------------------

type Pos = Map<string, Position>;

function step(from: Position, deg: number, length = L): Position {
  const r = (deg * Math.PI) / 180;
  return { x: from.x + Math.cos(r) * length, y: from.y + Math.sin(r) * length };
}

/** Place the interior points of an edge evenly between its ends. */
function placeInterior(pos: Pos, e: LEdge) {
  const a = pos.get(e.a)!;
  const b = pos.get(e.b)!;
  e.interior.forEach((id, i) => {
    const f = (i + 1) / (e.interior.length + 1);
    pos.set(id, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  });
}

/**
 * Radial arcs. Children spread on an arc of `span` degrees centred on the
 * direction away from the parent; the root spreads over the full circle.
 */
function radial(tree: LTree, root: string, weighted: boolean, stretch: boolean, span: number, pos: Pos, visited: Set<string>, rootAngle = 0, parent?: string) {
  const memo = new Map<string, number>();
  const rec = (node: string, from: string | undefined, angleIn: number, spanHere: number) => {
    visited.add(node);
    const kids = (tree.adj.get(node) ?? []).filter((e) => e.b !== from && !visited.has(e.b));
    const k = kids.length;
    if (k === 0) return;
    let angles: number[];
    if (weighted && k > 1) {
      const total = kids.reduce((s, e) => s + leafCount(tree, e.b, node, memo), 0);
      let acc = angleIn - spanHere / 2;
      angles = kids.map((e) => {
        const slice = (leafCount(tree, e.b, node, memo) / total) * spanHere;
        const a = acc + slice / 2;
        acc += slice;
        return a;
      });
    } else {
      const s = spanHere / k;
      angles = kids.map((_, i) => angleIn + (i - (k - 1) / 2) * s);
    }
    const r = reach(k, spanHere, stretch);
    kids.forEach((e, i) => {
      pos.set(e.b, step(pos.get(node)!, angles[i], r));
      placeInterior(pos, e);
      rec(e.b, node, angles[i], span);
    });
  };
  // A root with no parent spreads its children over the whole circle; a single child goes straight on.
  rec(root, parent, rootAngle, parent === undefined ? 360 : span);
}

/** Left to right: a tidy tree. Depth sets x, leaves stack in y, a parent sits level with the middle of its children. */
function layered(tree: LTree, root: string, pos: Pos) {
  let leaf = 0;
  const visited = new Set<string>();
  const rec = (node: string, from: string | undefined, depth: number): number => {
    visited.add(node);
    const kids = (tree.adj.get(node) ?? []).filter((e) => e.b !== from && !visited.has(e.b));
    let y: number;
    if (kids.length === 0) y = leaf++ * PITCH;
    else {
      const ys = kids.map((e) => rec(e.b, node, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.set(node, { x: depth * L, y });
    for (const e of kids) placeInterior(pos, e);
    return y;
  };
  rec(root, undefined, 0);
}

/** Spine: the diameter lies flat and everything else hangs off it, alternating above and below. */
function spine(tree: LTree, weighted: boolean, stretch: boolean, pos: Pos) {
  const path = diameter(tree);
  const visited = new Set<string>(path);
  path.forEach((n, i) => pos.set(n, { x: i * L, y: 0 }));
  for (let i = 1; i < path.length; i++) placeInterior(pos, tree.adj.get(path[i - 1])!.find((e) => e.b === path[i])!);
  path.forEach((n, i) => {
    const hanging = (tree.adj.get(n) ?? []).filter((e) => !visited.has(e.b));
    hanging.forEach((e, j) => {
      const angle = (i + j) % 2 === 0 ? -90 : 90;
      pos.set(e.b, step(pos.get(n)!, angle));
      placeInterior(pos, e);
      radial(tree, e.b, weighted, stretch, 90, pos, visited, angle, n);
    });
  });
}

/** The root a variant picks when the user has not: the tree's centre for arcs, the busier end of the longest path for left to right. */
export function defaultRoot(project: Project, topology: Topology, pieceEndpoints: Set<string>, variant: Variant, collapsePoints: boolean): string | undefined {
  const tree = logicalTree(topology, pieceEndpoints, collapsePoints);
  if (tree.nodes.length === 0) return undefined;
  const path = diameter(tree);
  if (variant === "A") return path[Math.floor((path.length - 1) / 2)];
  const ends = [path[0], path[path.length - 1]];
  const netsAt = new Map<string, number>();
  for (const { net } of allNets(project)) for (const c of net.connectors) netsAt.set(c, (netsAt.get(c) ?? 0) + 1);
  const busy = (id: string) => {
    const e = topology.endpoints.find((x) => x.id === id);
    return e?.kind === "connector" ? netsAt.get(e.connector) ?? 0 : 0;
  };
  return ends.sort((a, b) => busy(b) - busy(a) || (a < b ? -1 : 1))[0];
}

// Packing ---------------------------------------------------------------------

interface Box {
  ids: string[];
  pos: Pos;
  w: number;
  h: number;
}

function sizeOf(topology: Topology, id: string) {
  const e = topology.endpoints.find((x) => x.id === id) as Endpoint | undefined;
  return ENDPOINT_SIZE[e?.kind ?? "point"];
}

/** Rotate about the origin by quarter turns, then shift so the box starts at (0, 0) with room for a label on top. */
function box(topology: Topology, pos: Pos, turns: number): Box {
  const q = ((turns % 4) + 4) % 4;
  const rotated: Pos = new Map();
  for (const [id, p] of pos) {
    let { x, y } = p;
    for (let i = 0; i < q; i++) [x, y] = [-y, x];
    rotated.set(id, { x, y });
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [id, p] of rotated) {
    const s = sizeOf(topology, id);
    minX = Math.min(minX, p.x - s.w / 2);
    maxX = Math.max(maxX, p.x + s.w / 2);
    minY = Math.min(minY, p.y - s.h / 2);
    maxY = Math.max(maxY, p.y + s.h / 2);
  }
  const out: Pos = new Map();
  for (const [id, p] of rotated) out.set(id, { x: p.x - minX, y: p.y - minY + LABEL_ROOM });
  return { ids: [...out.keys()], pos: out, w: maxX - minX, h: maxY - minY + LABEL_ROOM };
}

/** Shelf packing: boxes in rows, in the order given, wrapping at a width that keeps the whole roughly square. */
function pack(boxes: Box[], into: Pos, startY: number): number {
  const area = boxes.reduce((s, b) => s + (b.w + GAP) * (b.h + GAP), 0);
  const rowWidth = Math.max(1400, Math.sqrt(area) * 1.5);
  let x = 0;
  let y = startY;
  let rowH = 0;
  for (const b of boxes) {
    if (x > 0 && x + b.w > rowWidth) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    for (const [id, p] of b.pos) into.set(id, { x: p.x + x, y: p.y + y });
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
  }
  return y + rowH + GAP;
}

/**
 * Lay out a whole topology. Returns the centre of every endpoint. Harnesses
 * come first in piece order, then purchased assemblies, then the connectors
 * that have nets but no segment yet, in a grid of their own.
 */
export function layout(project: Project, topology: Topology, o: LayoutOptions): Pos {
  const graph = buildGraph(topology);
  const all = pieces(graph);
  const ordered = [...all.filter((p) => p.built), ...all.filter((p) => !p.built)];
  const boxes: Box[] = [];
  for (const piece of ordered) {
    const tree = logicalTree(topology, piece.endpoints, o.collapsePoints);
    const pos: Pos = new Map();
    if (o.variant === "C") spine(tree, o.weighted, o.stretch, pos);
    else {
      const chosen = o.roots.get(piece.id);
      const root = chosen && tree.nodes.includes(chosen) ? chosen : defaultRoot(project, topology, piece.endpoints, o.variant, o.collapsePoints)!;
      pos.set(root, { x: 0, y: 0 });
      if (o.variant === "A") radial(tree, root, o.weighted, o.stretch, 180, pos, new Set());
      else layered(tree, root, pos);
    }
    // Anything the walk missed (a cycle, a dangling point) lands at the root so it is at least visible.
    for (const id of piece.endpoints) if (!pos.has(id)) pos.set(id, { x: 0, y: 0 });
    boxes.push(box(topology, pos, o.turns.get(piece.id) ?? 0));
  }
  const out: Pos = new Map();
  const bottom = pack(boxes, out, 0);

  // Connectors waiting for their first segment: a grid, grouped by component, so the ratsnest shows what joins what.
  const lone = topology.endpoints.filter((e) => degree(graph, e.id) === 0);
  const label = (e: Endpoint) => (e.kind === "connector" ? `${project.components.get(e.connector.split("/")[0])?.name ?? ""} ${e.connector}` : e.id);
  lone.sort((a, b) => (label(a) < label(b) ? -1 : 1));
  const perRow = Math.max(4, Math.ceil(Math.sqrt(lone.length * 2)));
  lone.forEach((e, i) => {
    const s = ENDPOINT_SIZE[e.kind];
    out.set(e.id, { x: (i % perRow) * (ENDPOINT_SIZE.connector.w + 40) + s.w / 2, y: bottom + LABEL_ROOM + Math.floor(i / perRow) * 56 + s.h / 2 });
  });
  return out;
}

/** Endpoint centres to the top-left positions React Flow nodes want. */
export function topLeft(topology: Topology, centres: Pos): Pos {
  const out: Pos = new Map();
  for (const [id, c] of centres) {
    const s = sizeOf(topology, id);
    out.set(id, { x: c.x - s.w / 2, y: c.y - s.h / 2 });
  }
  return out;
}
