import type { Endpoint, Net, Segment, Topology } from "./schema";
import { allNets, connectorLabel, type Project } from "./project";

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

// Routes ----------------------------------------------------------------------

export interface Route {
  net: Net;
  domain: string;
  /** connector addresses whose endpoints are missing from the topology */
  unplaced: string[];
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
  return { net, domain, unplaced, split, segments, endpoints, branchPoints, lengthMm, missingLength };
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
