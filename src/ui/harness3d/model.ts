/**
 * The 3D harness view's data: every harness of a topology as plain 3D data.
 * Endpoints carry positions in millimetres, segments a length and a bundle
 * diameter, and tie points a distance along their segment.
 */
import { allRoutes, buildGraph, connectorLabel, harnesses, netSpec, netsOnSegments, resolveConnector, resolveRef, resolveSpec, type Project, type Topology } from "../../core";

export type Vec3 = [number, number, number];

export interface Node3 {
  id: string;
  kind: "connector" | "point" | "breakout" | "splice" | "tie";
  label: string;
  /** For connectors: the connector type as manufacturing names it, with its pin count and mating part. */
  type?: { name: string; pins: number; mating: string };
}

export interface Seg3 {
  id: string;
  ends: [string, string];
  /** The segment's length_mm, or 200 where none is set yet. */
  lengthMm: number;
  odMm: number;
  color: string;
  nets: string[];
}

export interface Tie3 {
  id: string;
  segment: string;
  from: string;
  distanceMm: number;
  /** The tie spec id in the library, such as `p-clip-10mm`. */
  label: string;
}

export interface Harness3 {
  name: string;
  nodes: Node3[];
  segments: Seg3[];
  ties: Tie3[];
}

function harnessNames(project: Project, topology: Topology): string[] {
  return harnesses(project, buildGraph(topology))
    .map((h) => h.label)
    .sort();
}

/** Bundle OD from the conductors riding in a segment: root sum of squares with a 15 percent packing allowance. */
function bundleOd(project: Project, routes: ReturnType<typeof allRoutes>): number {
  let area = 0;
  for (const r of routes) {
    const { ref, conductors } = netSpec(project, r.net, r.domain);
    const spec = ref ? resolveSpec(project.library, ref) : undefined;
    if (!spec) area += 1.5 * 1.5 * conductors;
    else if (spec.kind === "wire") area += spec.spec.od_mm * spec.spec.od_mm * conductors;
    else area += spec.spec.od_mm * spec.spec.od_mm;
  }
  return Math.max(2, Math.sqrt(area) * 1.15);
}

function extractHarness(project: Project, topology: Topology, name: string): Harness3 | undefined {
  const graph = buildGraph(topology);
  const harness = harnesses(project, graph).find((h) => h.label === name);
  if (!harness) return undefined;
  const routes = allRoutes(project, graph);
  const onSeg = netsOnSegments(routes);
  const domainColor = new Map(project.file.domains.map((d) => [d.id, d.color]));

  const nodes: Node3[] = [...harness.piece.endpoints].sort().map((id) => {
    const e = graph.endpoints.get(id)!;
    if (e.kind === "connector") {
      const found = resolveConnector(project, e.connector);
      const type = "error" in found ? undefined : resolveRef(project.library, found.connector.connector, "connectors");
      return { id, kind: "connector", label: connectorLabel(project, e.connector), type: type && { name: type.short ?? type.name, pins: type.pins, mating: type.mating.part_number } };
    }
    return { id, kind: e.kind, label: e.kind };
  });

  const segments: Seg3[] = [...harness.piece.segments].sort().map((id) => {
    const s = graph.segments.get(id)!;
    const rs = onSeg.get(id) ?? [];
    // The domain carrying the most conductors colours the tube.
    const byDomain = new Map<string, number>();
    for (const r of rs) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + netSpec(project, r.net, r.domain).conductors);
    const top = [...byDomain.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      id,
      ends: s.ends,
      lengthMm: s.length_mm ?? 200,
      odMm: bundleOd(project, rs),
      color: (top && domainColor.get(top)) || "#888888",
      nets: rs.map((r) => r.net.name ?? r.net.id),
    };
  });

  const ties: Tie3[] = topology.ties.filter((t) => harness.piece.segments.has(t.segment)).map((t) => ({ id: t.id, segment: t.segment, from: t.from, distanceMm: t.distance_mm, label: t.spec.split("/")[1] }));
  return { name, nodes, segments, ties };
}

export const ALL = "All harnesses";

export interface World3 {
  /** Every harness in the topology as one piece of data. */
  all: Harness3;
  /** Where each endpoint starts before anyone places it: the topology canvas drawing stood up in 3D. */
  sketch: Record<string, Vec3>;
  members: Record<string, { nodes: Set<string>; segments: Set<string> }>;
  /** Harness names, sorted. */
  names: string[];
}

/**
 * Every harness of a topology at once, with a starting position for each endpoint. Each harness keeps the shape of its topology canvas drawing
 * at a scale that leaves a typical segment of its own slack, and the harnesses are spread
 * apart by the scale of the middle one so they sit roughly where the canvas
 * has them.
 */
export function extractAll(project: Project, topology: Topology): World3 {
  const parts = harnessNames(project, topology)
    .map((n) => extractHarness(project, topology, n))
    .filter((h): h is Harness3 => h !== undefined);
  const canvas = project.topologyCanvases.get(topology.id)?.endpoints ?? {};
  const p2 = (id: string) => canvas[id] ?? { x: 0, y: 0 };
  const centre = (ids: string[]) => ({ x: ids.reduce((t, id) => t + p2(id).x, 0) / Math.max(1, ids.length), y: ids.reduce((t, id) => t + p2(id).y, 0) / Math.max(1, ids.length) });
  const own = parts.map((h) => {
    // The middle ratio of segment length to drawn length: a typical segment starts a little slack, and a stub drawn long on the canvas does not shrink the whole harness.
    const ratios: number[] = [];
    for (const s of h.segments) {
      const a = p2(s.ends[0]);
      const b = p2(s.ends[1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) ratios.push((s.lengthMm * 0.8) / d);
    }
    ratios.sort((x, y) => x - y);
    return { k: ratios[Math.floor(ratios.length / 2)] ?? 1, c: centre(h.nodes.map((n) => n.id)) };
  });
  const spread = [...own.map((o) => o.k)].sort((a, b) => a - b)[Math.floor(own.length / 2)] ?? 1;
  const mid = centre(parts.flatMap((h) => h.nodes.map((n) => n.id)));
  const positions: Record<string, Vec3> = {};
  parts.forEach((h, i) => {
    const { k, c } = own[i];
    h.nodes.forEach((n, j) => {
      const p = p2(n.id);
      positions[n.id] = [(c.x - mid.x) * spread + (p.x - c.x) * k, -((c.y - mid.y) * spread + (p.y - c.y) * k), n.kind === "connector" ? (j % 2 ? 40 : -40) : 0];
    });
  });
  const floor = Math.min(0, ...Object.values(positions).map((v) => v[1]));
  for (const v of Object.values(positions)) v[1] -= floor;
  return {
    all: { name: ALL, nodes: parts.flatMap((h) => h.nodes), segments: parts.flatMap((h) => h.segments), ties: parts.flatMap((h) => h.ties) },
    sketch: positions,
    members: Object.fromEntries(parts.map((h) => [h.name, { nodes: new Set(h.nodes.map((n) => n.id)), segments: new Set(h.segments.map((x) => x.id)) }])),
    names: parts.map((h) => h.name),
  };
}

// Vectors ----------------------------------------------------------------------

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));

export const round = (n: number) => Math.round(n);
export const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
