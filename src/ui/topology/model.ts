import type { Edge, Node } from "@xyflow/react";
import { allRoutes, assemblyLengthOf, buildGraph, connectorLabel, degree, harnesses, netsOnSegments, resolveRef, segmentLength, type Endpoint, type Harness, type Position, type Project, type Route, type Segment, type Sheath, type TiePoint, type Topology } from "../../core";

/** Derive React Flow nodes and edges for one topology. */

export interface EndpointNodeData { endpoint: Endpoint; label: string; /** the component name, for hover */ title: string; degree: number; onRoute: boolean; [key: string]: unknown }
export interface TieNodeData { tie: TiePoint; label: string; [key: string]: unknown }
export interface LabelNodeData { harness: Harness; [key: string]: unknown }
export interface SegmentEdgeData {
  segment: Segment;
  lengthMm: number | undefined;
  assemblyName: string | undefined;
  nets: { id: string; label: string; domain: string; color: string; conductors: number }[];
  /** domain colour when a selected net routes through this segment */
  routeColor: string | undefined;
  faded: boolean;
  sheaths: { id: string; color: string; index: number; count: number }[];
  [key: string]: unknown;
}

export type TopoNode = Node<EndpointNodeData, "endpoint"> | Node<TieNodeData, "tie"> | Node<LabelNodeData, "harness">;
export type TopoEdge = Edge<SegmentEdgeData>;

export const SHEATH_PALETTE = ["#7e57c2", "#26a69a", "#ef6c00", "#5c6bc0", "#8d6e63", "#43a047"];

export const ENDPOINT_SIZE: Record<Endpoint["kind"], { w: number; h: number }> = {
  connector: { w: 54, h: 22 },
  point: { w: 12, h: 12 },
  breakout: { w: 20, h: 20 },
  splice: { w: 22, h: 22 },
};

export function endpointCentre(kind: Endpoint["kind"], pos: Position): Position {
  const s = ENDPOINT_SIZE[kind];
  return { x: pos.x + s.w / 2, y: pos.y + s.h / 2 };
}

export interface TopologyModel {
  nodes: TopoNode[];
  edges: TopoEdge[];
  routes: Route[];
  harnesses: Harness[];
  positions: Map<string, Position>;
}

export function deriveTopology(project: Project, topology: Topology, selected: Set<string>, drafts: Map<string, Position>): TopologyModel {
  const graph = buildGraph(topology);
  const canvas = project.topologyCanvases.get(topology.id) ?? { endpoints: {} };
  const assemblyLength = assemblyLengthOf(project);
  const routes = allRoutes(project, graph);
  const onSegments = netsOnSegments(routes);
  const domains = new Map(project.file.domains.map((d) => [d.id, d]));
  const hs = harnesses(project, graph);

  const selectedRoutes = routes.filter((r) => selected.has(r.net.id));
  const routeSegments = new Map<string, string>();
  for (const r of selectedRoutes) for (const s of r.segments) routeSegments.set(s, domains.get(r.domain)?.color ?? "#888");
  const routeEndpoints = new Set(selectedRoutes.flatMap((r) => [...r.endpoints]));
  const selectedSheaths = topology.sheaths.filter((s) => selected.has(s.id));
  const highlightSegments = new Set(selectedSheaths.flatMap((s) => s.segments));

  const positions = new Map<string, Position>();
  for (const e of topology.endpoints) positions.set(e.id, drafts.get(e.id) ?? canvas.endpoints[e.id] ?? { x: 0, y: 0 });

  const nodes: TopoNode[] = [];
  for (const e of topology.endpoints) {
    // Connectors show only their designator; the component name is the hover title and in the inspector.
    const label = e.kind === "connector" ? e.connector.split("/")[1] : e.kind === "breakout" ? (e.spec ? resolveRef(project.library, e.spec, "breakouts")?.name ?? e.spec : "") : e.kind === "splice" ? `${e.nets.length}` : "";
    const title = e.kind === "connector" ? connectorLabel(project, e.connector) : "";
    nodes.push({ id: e.id, type: "endpoint", position: positions.get(e.id)!, data: { endpoint: e, label, title, degree: degree(graph, e.id), onRoute: routeEndpoints.has(e.id) }, selected: selected.has(e.id), zIndex: e.kind === "connector" ? 2 : 3, width: ENDPOINT_SIZE[e.kind].w, height: ENDPOINT_SIZE[e.kind].h });
  }

  const sheathIndex = new Map<string, { id: string; color: string; index: number; count: number }[]>();
  topology.sheaths.forEach((sh: Sheath, i) => {
    for (const seg of sh.segments) {
      if (!sheathIndex.has(seg)) sheathIndex.set(seg, []);
      sheathIndex.get(seg)!.push({ id: sh.id, color: SHEATH_PALETTE[i % SHEATH_PALETTE.length], index: 0, count: 0 });
    }
  });
  for (const list of sheathIndex.values()) list.forEach((x, i) => Object.assign(x, { index: i, count: list.length }));

  const anySelectedNet = selectedRoutes.length > 0;
  const edges: TopoEdge[] = [];
  for (const s of topology.segments) {
    if (!graph.endpoints.has(s.ends[0]) || !graph.endpoints.has(s.ends[1])) continue;
    const nets = (onSegments.get(s.id) ?? []).map((r) => ({ id: r.net.id, label: r.net.name ?? r.net.id, domain: r.domain, color: domains.get(r.domain)?.color ?? "#888", conductors: r.net.conductors ?? domains.get(r.domain)?.conductors ?? 1 }));
    const assembly = s.assembly ? resolveRef(project.library, s.assembly, "assemblies") : undefined;
    const routeColor = routeSegments.get(s.id);
    edges.push({
      id: s.id, type: "segment", source: s.ends[0], target: s.ends[1], sourceHandle: "h", targetHandle: "h",
      data: { segment: s, lengthMm: segmentLength(graph, s, assemblyLength), assemblyName: assembly?.name, nets, routeColor, faded: (anySelectedNet && !routeColor) || (highlightSegments.size > 0 && !highlightSegments.has(s.id)), sheaths: sheathIndex.get(s.id) ?? [] },
      selected: selected.has(s.id) || highlightSegments.has(s.id), zIndex: routeColor ? 4 : 1, interactionWidth: 16,
    });
  }

  for (const t of topology.ties) {
    const seg = graph.segments.get(t.segment);
    if (!seg) continue;
    const from = positions.get(t.from);
    const to = positions.get(seg.ends[0] === t.from ? seg.ends[1] : seg.ends[0]);
    if (!from || !to) continue;
    const a = endpointCentre(graph.endpoints.get(t.from)!.kind, from);
    const b = endpointCentre(graph.endpoints.get(seg.ends[0] === t.from ? seg.ends[1] : seg.ends[0])!.kind, to);
    const len = segmentLength(graph, seg, assemblyLength) ?? 0;
    const f = len > 0 ? Math.min(1, Math.max(0, t.distance_mm / len)) : 0.5;
    const pos = drafts.get(t.id) ?? { x: a.x + (b.x - a.x) * f - 6, y: a.y + (b.y - a.y) * f - 6 };
    const spec = resolveRef(project.library, t.spec, "ties");
    nodes.push({ id: t.id, type: "tie", position: pos, data: { tie: t, label: `${spec?.name ?? t.spec}, ${t.distance_mm} mm from ${endpointName(project, graph.endpoints.get(t.from))}` }, selected: selected.has(t.id), zIndex: 5, width: 12, height: 12 });
  }

  for (const h of hs) {
    const anchor = h.anchors[0] ?? graph.segments.get(h.piece.id);
    let at: Position;
    if (anchor) {
      const a = positions.get(anchor.ends[0]) ?? { x: 0, y: 0 };
      const b = positions.get(anchor.ends[1]) ?? { x: 0, y: 0 };
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 28 };
    } else at = { x: 0, y: 0 };
    nodes.push({ id: `harness:${h.piece.id}`, type: "harness", position: at, data: { harness: h }, selectable: false, draggable: false, zIndex: 6 });
  }

  return { nodes, edges, routes, harnesses: hs, positions };
}

export function endpointName(project: Project, e: Endpoint | undefined): string {
  if (!e) return "?";
  return e.kind === "connector" ? connectorLabel(project, e.connector) : `${e.kind} ${e.id}`;
}
