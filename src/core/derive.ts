import type { Component, Endpoint, Net, Position, Segment, Topology } from "./schema";
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
  const placed = route.placedEndpoints.filter((e) => positions.has(e));
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

/** Nets whose route passes through an endpoint. */
export function netsThrough(routes: Route[], endpoint: string): Route[] {
  return routes.filter((r) => r.endpoints.has(endpoint));
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
