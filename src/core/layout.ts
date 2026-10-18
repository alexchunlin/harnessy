/**
 * The topology layout. Every endpoint's home is derived from the graph; the
 * canvas file holds only what the designer chose. No DOM, React or store
 * imports, so the topology view, the 3D view's sketch and the build sheet
 * can all draw from the same picture.
 */
import { buildGraph, degree, otherEnd, pieces, type Graph, type Piece } from "./derive";
import type { Project } from "./project";
import type { Endpoint, Position, Segment, Topology, TopologyCanvas } from "./schema";

/**
 * The drawn length of every logical edge, in canvas pixels. At this length,
 * children STEP_DEGREES apart sit about one SIBLING_PITCH apart, so connector
 * boxes on a fan do not overlap whichever way it faces. 350 is the least
 * that keeps the RAMMP example clear.
 */
export const UNIFORM_LENGTH = 400;
/** The least distance between two siblings on a crowded arc: a connector box and a little air. */
export const SIBLING_PITCH = 104;
/** The angle between neighbouring children of a node that has a parent. */
export const STEP_DEGREES = 15;
/** Clear space between packed pieces, with room above each for its harness label. */
export const PIECE_GAP = 80;
/** Space between endpoints waiting in the row under the pieces. */
const LONE_GAP = 40;

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
  /** Bounds of every endpoint box in the piece, after packing. */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * A faint arc through the children of one breakout or splice, so the fan
 * reads as one group. Angles are in degrees with screen y down, so the sweep
 * runs clockwise from `from` to `to`. A root's arc is the whole circle. A
 * trunk node between two roots has one arc for each side of the trunk.
 */
export interface FanArc {
  /** The breakout or splice the fan grows from. */
  node: string;
  centre: Position;
  radius: number;
  from: number;
  to: number;
}

export interface TopologyLayout {
  /** Every endpoint of the topology, by id. Centres, in canvas pixels. */
  endpoints: Map<string, EndpointLayout>;
  /** Where each segment's two ends land, in the order of `segment.ends`. */
  segments: Map<string, [Position, Position]>;
  /** Built harnesses first, then purchased cables, each in piece id order. */
  pieces: PieceLayout[];
  /** One per breakout or splice with children, through its children's homes. */
  arcs: FanArc[];
}

type Positions = Map<string, Position>;

/** Lay out one topology from the graph and its canvas file. */
export function layoutTopology(_project: Project, topology: Topology, canvas: TopologyCanvas): TopologyLayout {
  const graph = buildGraph(topology);
  const all = pieces(graph);
  const ordered = [...all.filter((p) => p.built), ...all.filter((p) => !p.built)];
  const roots = new Set(canvas.roots);
  const laid = ordered.map((piece) => {
    const { pos: local, arcs } = layoutPiece(graph, piece, roots);
    return { piece, local, arcs, rect: bounds(graph, local) };
  });
  const home: Positions = new Map();
  const out: PieceLayout[] = [];
  const arcs: FanArc[] = [];
  const bottom = pack(
    laid.map((l) => l.rect),
    (i, x, y) => {
      const { piece, local, rect } = laid[i];
      const move = (p: Position) => ({ x: p.x - rect.x + x, y: p.y - rect.y + y });
      for (const [id, p] of local) home.set(id, move(p));
      for (const a of laid[i].arcs) arcs.push({ ...a, centre: move(a.centre) });
      out.push({ id: piece.id, built: piece.built, rect: { x, y, w: rect.w, h: rect.h } });
    },
  );
  // Endpoints that end no segment wait in a plain row under the pieces, in the order they joined the topology.
  let x = 0;
  for (const e of topology.endpoints) {
    if (degree(graph, e.id) > 0) continue;
    const s = ENDPOINT_SIZE[e.kind];
    home.set(e.id, { x: x + s.w / 2, y: bottom + ENDPOINT_SIZE.connector.h / 2 });
    x += s.w + LONE_GAP;
  }

  const endpoints = new Map<string, EndpointLayout>();
  for (const [id, p] of home) endpoints.set(id, { home: p, drawn: p });
  const segments = new Map<string, [Position, Position]>();
  for (const s of topology.segments) {
    const a = endpoints.get(s.ends[0]);
    const b = endpoints.get(s.ends[1]);
    const [ka, kb] = s.ends.map((id) => graph.endpoints.get(id)?.kind);
    if (a && b && ka && kb) segments.set(s.id, [segmentEnd(ka, a.drawn, b.drawn), segmentEnd(kb, b.drawn, a.drawn)]);
  }
  return { endpoints, segments, pieces: out, arcs };
}

/**
 * Where a segment ends at an endpoint centred on `centre`, coming from
 * `other`. A connector box is met at the point on its edge nearest `other`,
 * so lines do not all converge on its middle. Every smaller box is met at its
 * centre.
 */
export function segmentEnd(kind: Endpoint["kind"], centre: Position, other: Position): Position {
  if (kind !== "connector") return centre;
  const hw = ENDPOINT_SIZE.connector.w / 2;
  const hh = ENDPOINT_SIZE.connector.h / 2;
  const x = Math.min(Math.max(other.x, centre.x - hw), centre.x + hw);
  const y = Math.min(Math.max(other.y, centre.y - hh), centre.y + hh);
  const inX = hw - Math.abs(x - centre.x);
  const inY = hh - Math.abs(y - centre.y);
  if (inX > 0 && inY > 0) {
    // `other` lies inside the box: push out to the nearer edge.
    if (inX < inY) return { x: x < centre.x ? centre.x - hw : centre.x + hw, y };
    return { x, y: y < centre.y ? centre.y - hh : centre.y + hh };
  }
  return { x, y };
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

/** Homes and fan arcs for one piece, relative to its root at the origin. */
function layoutPiece(graph: Graph, piece: Piece, roots: Set<string>): { pos: Positions; arcs: FanArc[] } {
  const tree = logicalTree(graph, piece, roots);
  const marked = tree.nodes.filter((n) => roots.has(n));
  const trunk = marked.length >= 2 ? longestPathBetween(tree, marked) : [marked[0] ?? middleOfLongestPath(tree)];
  const root = trunk[0];
  const pos: Positions = new Map([[root, { x: 0, y: 0 }]]);
  const visited = new Set<string>();
  const arcs: FanArc[] = [];
  /** Lay out a node's children, or only the ones in `only` when the trunk splits them between its two sides. */
  const grow = (node: string, parent: string | undefined, away: number, only?: LogicalEdge[]) => {
    visited.add(node);
    const kids = only ?? tree.edges.get(node)!.filter((e) => e.b !== parent && !visited.has(e.b));
    const { angles, length } = fan(kids.length, parent === undefined, away);
    const kind = graph.endpoints.get(node)?.kind;
    if (kids.length > 0 && (kind === "breakout" || kind === "splice")) {
      const [from, to] = parent === undefined ? [0, 360] : [angles[0], angles[angles.length - 1]];
      arcs.push({ node, centre: pos.get(node)!, radius: length, from, to });
    }
    kids.forEach((e, i) => {
      if (visited.has(e.b)) return;
      pos.set(e.b, step(pos.get(node)!, angles[i], length));
      spaceEvenly(pos, e);
      grow(e.b, node, angles[i]);
    });
  };
  if (trunk.length === 1) grow(root, undefined, 0);
  else layTrunk(tree, trunk, pos, visited, grow);
  // A cycle is a design rule error; anything the walk could not reach sits on the root so it stays visible.
  for (const id of piece.endpoints) if (!pos.has(id)) pos.set(id, { x: 0, y: 0 });
  return { pos, arcs };
}

/**
 * The angles of a node's children and the length of its segments to them. A
 * root spreads its children evenly over the whole circle; every other node
 * fans them STEP_DEGREES apart around the direction away from its parent.
 * A fan that would pass the half circle shrinks its step to fit it. A
 * crowded fan lengthens its segments until neighbours sit SIBLING_PITCH
 * apart; every other fan keeps the uniform length.
 */
function fan(k: number, isRoot: boolean, away: number): { angles: number[]; length: number } {
  const gaps = isRoot ? k : k - 1;
  const stepDegrees = isRoot ? 360 / k : Math.min(STEP_DEGREES, 180 / Math.max(gaps, 1));
  const angles = isRoot ? Array.from({ length: k }, (_, i) => i * stepDegrees) : Array.from({ length: k }, (_, i) => away + (i - (k - 1) / 2) * stepDegrees);
  const crowded = isRoot ? k > 1 : gaps * STEP_DEGREES > 180;
  // Neighbours on a circle of radius r, `step` apart, sit 2 r sin(step / 2) apart.
  const pitchLength = SIBLING_PITCH / (2 * Math.sin((stepDegrees * Math.PI) / 360));
  return { angles, length: crowded ? Math.max(UNIFORM_LENGTH, pitchLength) : UNIFORM_LENGTH };
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

function bounds(graph: Graph, pos: Positions): PieceLayout["rect"] {
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
