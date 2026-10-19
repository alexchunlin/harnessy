/**
 * The topology layout. Every endpoint's home is derived from the graph; the
 * canvas file holds only what the designer chose. No DOM, React or store
 * imports, so the topology view, the 3D view's sketch and the build sheet
 * can all draw from the same picture.
 */
import { buildGraph, degree, harnesses, otherEnd, pieces, type Graph, type Piece } from "./derive";
import { allNets, type Project } from "./project";
import { parseAddress } from "./refs";
import type { Endpoint, Position, Segment, Topology, TopologyCanvas } from "./schema";

/**
 * The drawn length of every logical edge, in canvas pixels. At 400,
 * children STEP_DEGREES apart sit about one SIBLING_PITCH apart
 * (2 x 400 x sin 7.5 degrees is 104), so connector boxes on a fan do not
 * overlap whichever way it faces.
 */
export const UNIFORM_LENGTH = 400;
/** The least distance between two siblings on a crowded arc: a connector box and a little air. */
export const SIBLING_PITCH = 104;
/** The angle between neighbouring children of a node that has a parent. */
export const STEP_DEGREES = 15;
/** Clear space between packed pieces, with room above each for its harness label. */
export const PIECE_GAP = 80;
/** How far an endpoint can move off its home before its segments stop following it and a call-out line takes over. */
export const CALLOUT_DISTANCE = 24;
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
  /** Quarter turns of its harness. The stored offset is in the harness's frame and turns with it. */
  turns: number;
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
  /** One per endpoint moved past the call-out distance, in endpoint id order. */
  callouts: Callout[];
  /** Connectors with nets and no segment, under the pieces, by component name. */
  waiting: WaitingGroup[];
}

/** One component's connectors in the waiting grid. */
export interface WaitingGroup {
  component: string;
  /** The component's name, drawn over its column. */
  name: string;
  /** The column, name included. */
  rect: Rect;
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

/** A thin line from an endpoint's home to its box, drawn when the box sits past the call-out distance. */
export interface Callout {
  endpoint: string;
  from: Position;
  to: Position;
}

type Positions = Map<string, Position>;

/** Lay out one topology from the graph and its canvas file. */
export function layoutTopology(project: Project, topology: Topology, canvas: TopologyCanvas): TopologyLayout {
  const graph = buildGraph(topology);
  const all = pieces(graph);
  const ordered = [...all.filter((p) => p.built), ...all.filter((p) => !p.built)];
  const roots = new Set(canvas.roots);
  const named = new Map(harnesses(project, graph).map((h) => [h.piece.id, h]));
  // Each piece in its own frame first, turned about its centre before the bounds are taken.
  const turnsOf = new Map<string, number>();
  const laid = ordered.map((piece) => {
    const turns = canvas.pieces[piece.id]?.turns ?? 0;
    for (const id of piece.endpoints) turnsOf.set(id, turns);
    const { pos: local, arcs } = turnAboutCentre(layoutPiece(graph, piece, roots), turns);
    return { piece, local, arcs, rect: bounds(graph, local) };
  });
  const home: Positions = new Map();
  const out: PieceLayout[] = [];
  const arcs: FanArc[] = [];
  const bottom = pack(
    laid.map((l) => l.rect),
    (i, x, y) => {
      const { piece, local, rect } = laid[i];
      // The box offset is added after packing and moves the homes, so a dragged box carries every endpoint with it.
      const offset = canvas.pieces[piece.id]?.offset ?? { x: 0, y: 0 };
      const placed = { x: x + offset.x, y: y + offset.y, w: rect.w, h: rect.h };
      const move = (p: Position) => ({ x: p.x - rect.x + placed.x, y: p.y - rect.y + placed.y });
      for (const [id, p] of local) home.set(id, move(p));
      for (const a of laid[i].arcs) arcs.push({ ...a, centre: move(a.centre) });
      out.push({ id: piece.id, built: piece.built, rect: placed });
    },
  );
  const width = Math.max(0, ...out.map((p) => p.rect.x + p.rect.w));
  const waiting = waitingGrid(project, graph, bottom, width);
  // A waiting connector with an endpoint record draws where the grid puts it. Other endpoints with no segment have no home.
  for (const g of waiting) for (const c of g.connectors) if (c.endpoint) home.set(c.endpoint, c.position);

  const { endpoints, anchor, callouts } = applyOffsets(graph, home, canvas.offsets, turnsOf);
  // The box goes around every drawn endpoint, so it waits for the offsets.
  out.forEach((p, i) => {
    const h = named.get(p.id);
    if (!h) return;
    const members = [...laid[i].piece.endpoints].map((id) => ({ at: endpoints.get(id)!.drawn, size: ENDPOINT_SIZE[graph.endpoints.get(id)!.kind] }));
    const offset = canvas.pieces[p.id]?.offset ?? { x: 0, y: 0 };
    p.box = { rect: harnessBoxRect(members), label: h.label, partNumber: h.partNumber, unnamed: h.anchors.length === 0, offset };
  });
  const calledOut = new Set(callouts.map((c) => c.endpoint));
  // A line meets the box where the box is. A called-out end stays at its home, where there is no box to meet.
  const endAt = (id: string, other: Position) => {
    const kind = graph.endpoints.get(id)!.kind;
    return calledOut.has(id) ? anchor.get(id)! : segmentEnd(kind, anchor.get(id)!, other);
  };
  const segments = new Map<string, [Position, Position]>();
  for (const s of topology.segments) {
    const a = anchor.get(s.ends[0]);
    const b = anchor.get(s.ends[1]);
    if (a && b) segments.set(s.id, [endAt(s.ends[0], b), endAt(s.ends[1], a)]);
  }
  return { endpoints, segments, pieces: out, arcs, waiting, callouts };
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

// Offsets -----------------------------------------------------------------------

/**
 * Add each designer offset to its endpoint's home. Children already laid
 * out from their parent's home, so an offset moves only its own endpoint.
 * Close by, the segments follow the box. Past the call-out distance they
 * stay true at home and a call-out line points to the box. A waiting
 * endpoint has no offset. `anchor` is where each endpoint's segments aim.
 */
function applyOffsets(graph: Graph, home: Positions, offsets: TopologyCanvas["offsets"], turnsOf: Map<string, number>) {
  const endpoints = new Map<string, EndpointLayout>();
  const anchor: Positions = new Map();
  const callouts: Callout[] = [];
  for (const [id, p] of home) {
    const turns = turnsOf.get(id) ?? 0;
    const stored = degree(graph, id) > 0 ? offsets[id] : undefined;
    if (!stored) {
      endpoints.set(id, { home: p, drawn: p, turns });
      anchor.set(id, p);
      continue;
    }
    // The offset is in its harness's frame, so it turns with the harness before it lands on the canvas.
    const offset = quarterTurns(stored, turns);
    const drawn = { x: p.x + offset.x, y: p.y + offset.y };
    endpoints.set(id, { home: p, drawn, turns });
    if (Math.hypot(offset.x, offset.y) > CALLOUT_DISTANCE) {
      callouts.push({ endpoint: id, from: p, to: drawn });
      anchor.set(id, p);
    } else anchor.set(id, drawn);
  }
  callouts.sort((a, b) => (a.endpoint < b.endpoint ? -1 : a.endpoint > b.endpoint ? 1 : 0));
  return { endpoints, anchor, callouts };
}

/**
 * The offset to store so an endpoint draws centred on `centre`. The drop is
 * on screen, so it turns back by the harness's turns into the harness's frame.
 * Undefined when the endpoint has no home.
 */
export function dropOffset(layout: TopologyLayout, id: string, centre: Position): Position | undefined {
  const e = layout.endpoints.get(id);
  if (!e) return undefined;
  return quarterTurns({ x: centre.x - e.home.x, y: centre.y - e.home.y }, (4 - (e.turns % 4)) % 4);
}

// Turns -------------------------------------------------------------------------

/** A vector turned a quarter clockwise `turns` times, on a screen where y points down. */
function quarterTurns(v: Position, turns: number): Position {
  let { x, y } = v;
  for (let i = 0; i < turns; i++) [x, y] = [-y, x];
  return { x, y };
}

/**
 * Turn a piece's homes and fan arcs about the centre of the homes' bounds.
 * Endpoint boxes and labels stay upright, so only centres and arc angles move.
 */
function turnAboutCentre(piece: { pos: Positions; arcs: FanArc[] }, turns: number): { pos: Positions; arcs: FanArc[] } {
  if (!turns || piece.pos.size === 0) return piece;
  const xs = [...piece.pos.values()].map((p) => p.x);
  const ys = [...piece.pos.values()].map((p) => p.y);
  const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const turn = (p: Position) => {
    const v = quarterTurns({ x: p.x - c.x, y: p.y - c.y }, turns);
    return { x: c.x + v.x, y: c.y + v.y };
  };
  const pos: Positions = new Map();
  for (const [id, p] of piece.pos) pos.set(id, turn(p));
  // Angles run clockwise with screen y down, so each quarter turn adds 90 degrees.
  const arcs = piece.arcs.map((a) => ({ ...a, centre: turn(a.centre), from: a.from + 90 * turns, to: a.to + 90 * turns }));
  return { pos, arcs };
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
      const { component } = parseAddress(address);
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
    const designator = (a: string) => parseAddress(a).designator;
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

/** A harness box: the endpoint bounds with air on every side and the title band on top. */
function boxAround(r: Rect): Rect {
  return { x: r.x - BOX_PAD, y: r.y - BOX_PAD - BOX_TITLE, w: r.w + 2 * BOX_PAD, h: r.h + 2 * BOX_PAD + BOX_TITLE };
}

/** The harness box around endpoint boxes wherever they are drawn, so a view can redraw it mid-glide or mid-drag. */
export function harnessBoxRect(endpoints: { at: Position; size: { w: number; h: number } }[]): Rect {
  return boxAround(boxBounds(endpoints));
}

/** The bounds of every endpoint box of a piece laid out at `pos`. */
function bounds(graph: Graph, pos: Positions): Rect {
  return boxBounds([...pos].map(([id, at]) => ({ at, size: ENDPOINT_SIZE[graph.endpoints.get(id)?.kind ?? "point"] })));
}

/** The smallest rect around boxes centred on their `at`. */
function boxBounds(boxes: { at: Position; size: { w: number; h: number } }[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { at, size } of boxes) {
    minX = Math.min(minX, at.x - size.w / 2);
    maxX = Math.max(maxX, at.x + size.w / 2);
    minY = Math.min(minY, at.y - size.h / 2);
    maxY = Math.max(maxY, at.y + size.h / 2);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
