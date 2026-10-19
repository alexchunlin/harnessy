import type { Component, Endpoint, Net, Position, Segment, TiePoint, Topology } from "./schema";
import { resolveRef } from "./library";
import { parseAddress } from "./refs";
import { allNets, componentBridges, componentConnectors, connectorLabel, netLabel, type Project } from "./project";
/**
 * Derivations over one topology. Nothing here is stored; every result is
 * recomputed from the graph on demand.
 */

export interface Graph {
  topology: Topology;
  endpoints: Map<string, Endpoint>;
  segments: Map<string, Segment>;
  /** endpoint id to the segments that end there */
  incident: Map<string, Segment[]>;
  /** connector address to endpoint id */
  connectorEndpoint: Map<string, string>;
}

export function buildGraph(topology: Topology): Graph {
  const endpoints = new Map(topology.endpoints.map((e) => [e.id, e]));
  const segments = new Map(topology.segments.map((s) => [s.id, s]));
  const incident = new Map<string, Segment[]>();
  for (const e of topology.endpoints) incident.set(e.id, []);
  for (const s of topology.segments) {
    for (const end of s.ends) {
      if (!incident.has(end)) incident.set(end, []);
      incident.get(end)!.push(s);
    }
  }
  const connectorEndpoint = new Map<string, string>();
  for (const e of topology.endpoints) if (e.kind === "connector") connectorEndpoint.set(e.connector, e.id);
  return { topology, endpoints, segments, incident, connectorEndpoint };
}

export function otherEnd(segment: Segment, endpoint: string): string {
  return segment.ends[0] === endpoint ? segment.ends[1] : segment.ends[0];
}

export function degree(graph: Graph, endpoint: string): number {
  return graph.incident.get(endpoint)?.length ?? 0;
}

export function isBuilt(segment: Segment): boolean {
  return segment.assembly === undefined;
}

// Connected pieces ---------------------------------------------------------

export interface Piece {
  /** Stable id: the smallest segment id in the piece. */
  id: string;
  endpoints: Set<string>;
  segments: Set<string>;
  /** false when every segment is a purchased assembly */
  built: boolean;
}

/** Connected pieces with at least one segment. Lone endpoints are not pieces. */
export function pieces(graph: Graph): Piece[] {
  const seen = new Set<string>();
  const out: Piece[] = [];
  for (const start of graph.endpoints.keys()) {
    if (seen.has(start) || degree(graph, start) === 0) continue;
    const endpoints = new Set<string>();
    const segments = new Set<string>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const e = stack.pop()!;
      endpoints.add(e);
      for (const s of graph.incident.get(e) ?? []) {
        segments.add(s.id);
        const o = otherEnd(s, e);
        if (!seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    const built = [...segments].some((id) => isBuilt(graph.segments.get(id)!));
    out.push({ id: [...segments].sort()[0], endpoints, segments, built });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function pieceOf(all: Piece[], endpointOrSegment: string): Piece | undefined {
  return all.find((p) => p.endpoints.has(endpointOrSegment) || p.segments.has(endpointOrSegment));
}

/** True when some piece contains a cycle (segments >= endpoints within a connected piece). */
export function hasCycle(piece: Piece): boolean {
  return piece.segments.size >= piece.endpoints.size;
}

// Harnesses ------------------------------------------------------------------

export interface Harness {
  piece: Piece;
  /** Segments carrying a name anchor. Zero is a warning, two or more an error. */
  anchors: Segment[];
  /** The name shown: the anchor's name, or a fallback built from connector endpoints. */
  label: string;
  name?: string;
  partNumber?: string;
}

export const PURCHASED = "purchased";

export function harnesses(project: Project, graph: Graph): Harness[] {
  return pieces(graph)
    .filter((p) => p.built)
    .map((piece) => {
      const anchors = [...piece.segments]
        .map((id) => graph.segments.get(id)!)
        .filter((s) => s.harness !== undefined)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const anchor = anchors[0]?.harness;
      return {
        piece,
        anchors,
        name: anchor?.name,
        partNumber: anchor?.part_number,
        label: anchor?.name ?? fallbackLabel(project, graph, piece),
      };
    });
}

/** "MIB J4 to RoboClaw-L P1, +3" */
export function fallbackLabel(project: Project, graph: Graph, piece: Piece): string {
  const connectors = [...piece.endpoints]
    .map((id) => graph.endpoints.get(id))
    .filter((e): e is Extract<Endpoint, { kind: "connector" }> => e?.kind === "connector")
    .map((e) => connectorLabel(project, e.connector))
    .sort();
  if (connectors.length === 0) return "unnamed harness";
  if (connectors.length === 1) return connectors[0];
  const rest = connectors.length - 2;
  return `${connectors[0]} to ${connectors[1]}${rest > 0 ? `, +${rest}` : ""}`;
}

/** The harness a segment or endpoint belongs to, or PURCHASED when its piece is a lone assembly. */
export function harnessLabelOf(all: Harness[], id: string): string {
  const h = all.find((h) => h.piece.segments.has(id) || h.piece.endpoints.has(id));
  return h ? h.label : PURCHASED;
}

// Buses ------------------------------------------------------------------------

/** One bridge of one component, with the connectors of it that carry a member net. */
export interface BusBridge {
  component: string;
  designators: string[];
}

/**
 * The nets a device joins inside itself, found by walking nets and bridges.
 * Derived and never stored; a group of one net is not a bus.
 */
export interface Bus {
  /** Stable id: the smallest member net id. */
  id: string;
  /** The first member's domain. A bus across two domains is a design rule error. */
  domain: string;
  nets: Net[];
  bridges: BusBridge[];
  /** The name carried by a member net's `bus`, if any. */
  name?: string;
  /** The name, or "<domain> bus via <component>" from the bridging component with the most connectors on the bus. */
  label: string;
}

export function buses(project: Project): Bus[] {
  const nets = allNets(project);
  const netAt = new Map<string, { net: Net; domain: string }[]>();
  for (const n of nets) for (const a of n.net.connectors) {
    if (!netAt.has(a)) netAt.set(a, []);
    netAt.get(a)!.push(n);
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const n of nets) parent.set(n.net.id, n.net.id);
  // Each bridge that touches at least two nets joins them; remember which of its connectors carry one.
  const joins: { bridge: BusBridge; netIds: string[] }[] = [];
  for (const c of project.components.values()) {
    for (const bridge of componentBridges(project, c)) {
      const designators: string[] = [];
      const netIds: string[] = [];
      for (const d of bridge) {
        const here = netAt.get(`${c.id}/${d}`) ?? [];
        if (here.length === 0) continue;
        designators.push(d);
        for (const n of here) netIds.push(n.net.id);
      }
      const distinct = [...new Set(netIds)];
      if (distinct.length < 2) continue;
      for (const id of distinct.slice(1)) union(distinct[0], id);
      joins.push({ bridge: { component: c.id, designators }, netIds: distinct });
    }
  }
  const groups = new Map<string, Bus>();
  const domainOfNet = new Map(nets.map((n) => [n.net.id, n.domain]));
  for (const { net } of nets) {
    const root = find(net.id);
    if (!groups.has(root)) groups.set(root, { id: root, domain: "", nets: [], bridges: [], label: "" });
    groups.get(root)!.nets.push(net);
  }
  for (const j of joins) groups.get(find(j.netIds[0]))!.bridges.push(j.bridge);
  const domainName = (id: string) => project.file.domains.find((d) => d.id === id)?.name ?? id;
  const out: Bus[] = [];
  for (const b of groups.values()) {
    if (b.nets.length < 2) continue;
    b.nets.sort((x, y) => (x.id < y.id ? -1 : 1));
    b.domain = domainOfNet.get(b.nets[0].id)!;
    b.name = b.nets.find((n) => n.bus)?.bus;
    const via = b.bridges
      .map((br) => ({ name: project.components.get(br.component)?.name ?? br.component, count: br.designators.length }))
      .sort((x, y) => y.count - x.count || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))[0];
    b.label = b.name ?? `${domainName(b.domain)} bus via ${via.name}`;
    out.push(b);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function busOf(all: Bus[], netId: string): Bus | undefined {
  return all.find((b) => b.nets.some((n) => n.id === netId));
}

/** Buses that pass through a component's bridges. */
export function busesThrough(all: Bus[], componentId: string): Bus[] {
  return all.filter((b) => b.bridges.some((br) => br.component === componentId));
}

/** A net's display label with its bus prefix, for callers that label many nets at once. */
export function netLabeller(project: Project): (net: Net) => string {
  const all = buses(project);
  return (net) => netLabel(project, net, busOf(all, net.id)?.label);
}

/** The designators of a component's bridges that `designators` does not list, or lists twice. */
export function bridgeProblems(project: Project, component: Component): { designator: string; why: "unknown" | "twice" }[] {
  const known = new Set((componentConnectors(project, component) ?? []).map((c) => c.designator));
  const seen = new Set<string>();
  const out: { designator: string; why: "unknown" | "twice" }[] = [];
  for (const bridge of componentBridges(project, component)) {
    for (const d of bridge) {
      if (!known.has(d)) out.push({ designator: d, why: "unknown" });
      else if (seen.has(d)) out.push({ designator: d, why: "twice" });
      seen.add(d);
    }
  }
  return out;
}

// Routes ----------------------------------------------------------------------

export interface Route {
  net: Net;
  domain: string;
  /** connector addresses whose endpoints are missing from the topology */
  unplaced: string[];
  /** endpoint ids of the net's placed connectors, in the net's connector order */
  placedEndpoints: string[];
  /** true when the placed connectors sit in more than one piece */
  split: boolean;
  segments: Set<string>;
  endpoints: Set<string>;
  /** endpoints on the route with route-degree 3 or more */
  branchPoints: string[];
  lengthMm: number;
  /** true when some segment on the route has no length */
  missingLength: boolean;
}

function pathBetween(graph: Graph, from: string, to: string): Segment[] | undefined {
  const parent = new Map<string, Segment | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const e = queue.shift()!;
    if (e === to) break;
    for (const s of graph.incident.get(e) ?? []) {
      const o = otherEnd(s, e);
      if (!parent.has(o)) {
        parent.set(o, s);
        queue.push(o);
      }
    }
  }
  if (!parent.has(to)) return undefined;
  const path: Segment[] = [];
  let cur = to;
  while (cur !== from) {
    const s = parent.get(cur)!;
    path.push(s);
    cur = otherEnd(s, cur);
  }
  return path;
}

export function routeOf(graph: Graph, net: Net, domain: string): Route {
  const unplaced: string[] = [];
  const placed: string[] = [];
  for (const c of net.connectors) {
    const e = graph.connectorEndpoint.get(c);
    if (e === undefined) unplaced.push(c);
    else placed.push(e);
  }
  const segments = new Set<string>();
  const endpoints = new Set<string>(placed);
  let split = false;
  for (let i = 1; i < placed.length; i++) {
    const path = pathBetween(graph, placed[0], placed[i]);
    if (!path) {
      split = true;
      continue;
    }
    for (const s of path) {
      segments.add(s.id);
      endpoints.add(s.ends[0]);
      endpoints.add(s.ends[1]);
    }
  }
  const routeDegree = new Map<string, number>();
  for (const id of segments) for (const end of graph.segments.get(id)!.ends) routeDegree.set(end, (routeDegree.get(end) ?? 0) + 1);
  const branchPoints = [...routeDegree].filter(([, d]) => d >= 3).map(([e]) => e).sort();
  let lengthMm = 0;
  let missingLength = false;
  for (const id of segments) {
    const s = graph.segments.get(id)!;
    const len = segmentLength(graph, s);
    if (len === undefined) missingLength = true;
    else lengthMm += len;
  }
  return { net, domain, unplaced, placedEndpoints: placed, split, segments, endpoints, branchPoints, lengthMm, missingLength };
}

export function segmentLength(graph: Graph, segment: Segment, assemblyLength?: (ref: string) => number | undefined): number | undefined {
  void graph;
  if (segment.assembly && assemblyLength) return assemblyLength(segment.assembly);
  return segment.length_mm;
}

// Stretches and slack -------------------------------------------------------------

/** Who stores a stretch's slack: the tie point at its far end, or the segment for its last stretch. */
export type SlackOwner = { kind: "segment"; id: string } | { kind: "tie"; id: string };

export interface Stretch {
  /** Bound on the first-end side: an endpoint id or a tie point id. */
  from: string;
  /** Bound on the far side: a tie point id or the segment's second end. */
  to: string;
  /** Routed length between the bounds, undefined while a length or distance is unknown. */
  lengthMm: number | undefined;
  /** The stretch's own slack, undefined when unset. */
  slackMm: number | undefined;
  /** The slack the stretch takes when it has none of its own: its harness's default, else the project's, else zero. */
  inheritedSlackMm: number;
  /** The slack the cut list adds for this stretch. */
  effectiveSlackMm: number;
  owner: SlackOwner;
}

function libraryAssemblyLength(project: Project): (ref: string) => number | undefined {
  return (ref) => resolveRef(project.library, ref, "assemblies")?.length_mm;
}

/** A tie point's distance from its segment's first end. Undefined when it is measured from the far end of a segment with no known length. */
export function tieDistanceFromStart(graph: Graph, segment: Segment, tie: TiePoint, assemblyLength?: (ref: string) => number | undefined): number | undefined {
  if (tie.from === segment.ends[0]) return tie.distance_mm;
  const length = segmentLength(graph, segment, assemblyLength);
  return length === undefined ? undefined : length - tie.distance_mm;
}

/** A segment's stretches in order from `ends[0]`. Derived from its tie points, never stored. */
export function stretchesOf(project: Project, graph: Graph, segment: Segment): Stretch[] {
  const assemblyLength = libraryAssemblyLength(project);
  const built = isBuilt(segment);
  const ties = graph.topology.ties
    .filter((t) => t.segment === segment.id)
    .map((tie) => ({ tie, at: tieDistanceFromStart(graph, segment, tie, assemblyLength) }))
    .sort((a, b) => {
      // With no known length, ties measured from the far end sort after the rest, the one nearest the far end last.
      if (a.at !== undefined && b.at !== undefined) return a.at - b.at || (a.tie.id < b.tie.id ? -1 : 1);
      if (a.at !== undefined) return -1;
      if (b.at !== undefined) return 1;
      return b.tie.distance_mm - a.tie.distance_mm || (a.tie.id < b.tie.id ? -1 : 1);
    });
  const length = segmentLength(graph, segment, assemblyLength);
  const inherited = built ? defaultSlack(project, graph, segment) : 0;
  const bounds: { id: string; at: number | undefined; slack: number | undefined; owner: SlackOwner }[] = [
    { id: segment.ends[0], at: 0, slack: undefined, owner: { kind: "segment", id: segment.id } },
    ...ties.map(({ tie, at }) => ({ id: tie.id, at, slack: tie.slack_mm, owner: { kind: "tie" as const, id: tie.id } })),
    { id: segment.ends[1], at: length, slack: segment.slack_mm, owner: { kind: "segment" as const, id: segment.id } },
  ];
  const out: Stretch[] = [];
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1];
    const b = bounds[i];
    const slackMm = built ? b.slack : undefined;
    out.push({
      from: a.id,
      to: b.id,
      lengthMm: a.at === undefined || b.at === undefined ? undefined : b.at - a.at,
      slackMm,
      inheritedSlackMm: inherited,
      effectiveSlackMm: slackMm ?? inherited,
      owner: b.owner,
    });
  }
  return out;
}

/** The default slack for a segment's stretches: its harness anchor's, else the project's, else zero. */
export function defaultSlack(project: Project, graph: Graph, segment: Segment): number {
  const piece = pieceOf(pieces(graph), segment.id);
  const anchor = piece && [...piece.segments].sort().map((id) => graph.segments.get(id)!).find((s) => s.harness !== undefined)?.harness;
  return anchor?.slack_mm ?? project.file.slack_mm ?? 0;
}

/** The slack every conductor crossing this segment gains: the sum of its stretches' effective slack. A purchased assembly has none. */
export function segmentSlack(project: Project, graph: Graph, segment: Segment): number {
  return stretchesOf(project, graph, segment).reduce((sum, s) => sum + s.effectiveSlackMm, 0);
}

export function isRouted(route: Route): boolean {
  return route.unplaced.length === 0 && !route.split && route.net.connectors.length >= 2;
}

export function allRoutes(project: Project, graph: Graph): Route[] {
  return allNets(project).map(({ net, domain }) => routeOf(graph, net, domain));
}

/**
 * The ratsnest of an unrouted net: pairs of placed connector endpoints that
 * still have to be joined, as one chain through all of them rather than a
 * full mesh. The chain runs left to right, then top to bottom, so it holds
 * still while endpoints move. A routed net, or one with fewer than two
 * placed connectors, has no ratsnest.
 */
export function ratsnestPairs(route: Route, positions: Map<string, Position>): [string, string][] {
  if (isRouted(route)) return [];
  // A waiting connector with no endpoint record draws at its address, and the ratsnest reaches it there too.
  const placed = [...route.placedEndpoints, ...route.unplaced].filter((e) => positions.has(e));
  if (placed.length < 2) return [];
  const at = (e: string) => positions.get(e)!;
  const ordered = [...placed].sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y || (a < b ? -1 : 1));
  const pairs: [string, string][] = [];
  for (let i = 1; i < ordered.length; i++) pairs.push([ordered[i - 1], ordered[i]]);
  return pairs;
}

/** Nets whose route runs through each segment. */
export function netsOnSegments(routes: Route[]): Map<string, Route[]> {
  const out = new Map<string, Route[]>();
  for (const r of routes) for (const s of r.segments) {
    if (!out.has(s)) out.set(s, []);
    out.get(s)!.push(r);
  }
  return out;
}

/**
 * What a topology selection lights on the connectivity canvas, read-only.
 * A net lights itself and a segment lights the nets routed through it. A
 * connector endpoint lights its component and the nets that end on that
 * connector. On a bus that means its own nets, never the whole bus (ADR 0004).
 */
export function topologyLight(project: Project, topology: Topology, ids: string[]): { nets: Set<string>; components: Set<string> } {
  const nets = new Set<string>();
  const components = new Set<string>();
  if (ids.length === 0) return { nets, components };
  const graph = buildGraph(topology);
  const routes = allRoutes(project, graph);
  const onSegments = netsOnSegments(routes);
  const lightConnector = (address: string) => {
    components.add(parseAddress(address).component);
    for (const r of routes) if (r.net.connectors.includes(address)) nets.add(r.net.id);
  };
  for (const id of ids) {
    if (routes.some((r) => r.net.id === id)) nets.add(id);
    for (const r of onSegments.get(id) ?? []) nets.add(r.net.id);
    const end = graph.endpoints.get(id);
    if (end?.kind === "connector") lightConnector(end.connector);
    // A waiting connector with no endpoint record is selected by its address.
    else if (!end && project.components.has(id.split("/")[0])) lightConnector(id);
  }
  return { nets, components };
}

/** Nets whose route passes through an endpoint. */
export function netsThrough(routes: Route[], endpoint: string): Route[] {
  return routes.filter((r) => r.endpoints.has(endpoint));
}

// Conductors --------------------------------------------------------------------

/**
 * A conductor is addressed as `<net id>#<index>`, derived and never stored,
 * so a selection can name one wire of a net the way it names anything else.
 */
export function conductorAddress(netId: string, index: number): string {
  return `${netId}#${index}`;
}

export function parseConductor(address: string): { net: string; index: number } | undefined {
  const m = /^(net-[^#]+)#(\d+)$/.exec(address);
  return m ? { net: m[1], index: Number(m[2]) } : undefined;
}

export interface ConductorRoute {
  route: Route;
  index: number;
  /** The segments the conductor runs through: its net's route. */
  segments: Set<string>;
  /** The connector endpoints it reaches, in the net's connector order, placed ones only. */
  ends: string[];
}

/** Where one conductor goes: its net's route and the connector ends it reaches. Undefined when the address names no routed net. */
export function conductorRoute(routes: Route[], address: string): ConductorRoute | undefined {
  const c = parseConductor(address);
  if (!c) return undefined;
  const route = routes.find((r) => r.net.id === c.net);
  if (!route) return undefined;
  return { route, index: c.index, segments: route.segments, ends: route.placedEndpoints };
}

// Legs --------------------------------------------------------------------------

export interface Leg {
  from: string;
  to: string;
  segments: Segment[];
  lengthMm: number | undefined;
}

/**
 * Split a net's route into legs. A leg runs from a connector or a splice
 * listing the net to the next such node. A two-connector net is one leg.
 */
export function legsOf(graph: Graph, route: Route, assemblyLength?: (ref: string) => number | undefined): Leg[] {
  const stops = new Set<string>();
  for (const e of route.endpoints) {
    const ep = graph.endpoints.get(e);
    if (!ep) continue;
    if (ep.kind === "connector") stops.add(e);
    if (ep.kind === "splice" && ep.nets.includes(route.net.id)) stops.add(e);
  }
  const legs: Leg[] = [];
  const seen = new Set<string>();
  for (const start of [...stops].sort()) {
    for (const s of graph.incident.get(start) ?? []) {
      if (!route.segments.has(s.id) || seen.has(s.id)) continue;
      const segs: Segment[] = [s];
      seen.add(s.id);
      let cur = otherEnd(s, start);
      while (!stops.has(cur)) {
        const next = (graph.incident.get(cur) ?? []).find((n) => route.segments.has(n.id) && !seen.has(n.id));
        if (!next) break;
        segs.push(next);
        seen.add(next.id);
        cur = otherEnd(next, cur);
      }
      let lengthMm: number | undefined = 0;
      for (const seg of segs) {
        const len = segmentLength(graph, seg, assemblyLength);
        if (len === undefined) {
          lengthMm = undefined;
          break;
        }
        lengthMm += len;
      }
      legs.push({ from: start, to: cur, segments: segs, lengthMm });
    }
  }
  return legs;
}

// Sheaths ---------------------------------------------------------------------

/** True when the sheath's segments form one contiguous path in the given order. */
export function isContiguous(graph: Graph, segmentIds: string[]): boolean {
  if (segmentIds.length === 0) return false;
  const segs = segmentIds.map((id) => graph.segments.get(id));
  if (segs.some((s) => !s)) return false;
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1]!;
    const b = segs[i]!;
    if (!a.ends.some((e) => b.ends.includes(e))) return false;
  }
  return true;
}
