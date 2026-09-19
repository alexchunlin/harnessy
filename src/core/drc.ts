import type { Topology } from "./schema";
import { allNets, componentConnectors, netSpec, resolveConnector, type Project } from "./project";
import { resolveRef } from "./library";
import { allRoutes, buildGraph, degree, harnesses, hasCycle, isContiguous, netsOnSegments, pieceOf, pieces, segmentLength } from "./derive";

export type Severity = "error" | "warning";

export interface Finding {
  check: CheckId;
  severity: Severity;
  /** The id of the thing to select: a net, endpoint, segment, sheath, tie point, component, or connector address. */
  target: string;
  /** Which canvas the target lives on. */
  view: "connectivity" | "topology";
  message: string;
  silenced?: boolean;
}

export type CheckId =
  | "net-too-few-connectors"
  | "net-unrouted"
  | "route-branch-without-splice"
  | "splice-net-not-through"
  | "endpoint-degree"
  | "topology-cycle"
  | "segment-no-length"
  | "assembly-ends-not-connectors"
  | "sheath-not-contiguous"
  | "sheath-spans-harnesses"
  | "harness-two-anchors"
  | "dangling-reference"
  | "connector-idle"
  | "component-idle"
  | "harness-unnamed"
  | "tie-beyond-segment"
  | "keep-apart"
  | "net-no-spec";

export const CHECK_SEVERITY: Record<CheckId, Severity> = {
  "net-too-few-connectors": "error",
  "net-unrouted": "error",
  "route-branch-without-splice": "error",
  "splice-net-not-through": "error",
  "endpoint-degree": "error",
  "topology-cycle": "error",
  "segment-no-length": "error",
  "assembly-ends-not-connectors": "error",
  "sheath-not-contiguous": "error",
  "sheath-spans-harnesses": "error",
  "harness-two-anchors": "error",
  "dangling-reference": "error",
  "connector-idle": "warning",
  "component-idle": "warning",
  "harness-unnamed": "warning",
  "tie-beyond-segment": "warning",
  "keep-apart": "warning",
  "net-no-spec": "warning",
};

export function assemblyLengthOf(project: Project): (ref: string) => number | undefined {
  return (ref) => resolveRef(project.library, ref, "assemblies")?.length_mm;
}

const silenceKey = (check: string, target: string) => `${check}|${target}`;

/**
 * Run every check over the project and the active topology. Silenced
 * warnings come back with `silenced: true` so a panel can grey them out.
 */
export function runChecks(project: Project, topology: Topology | undefined): Finding[] {
  const out: Finding[] = [];
  const add: Add = (check, target, view, message) => out.push({ check, severity: CHECK_SEVERITY[check], target, view, message });

  checkProject(project, add);
  if (topology) checkTopology(project, topology, add);

  const silenced = new Set(project.drc.silences.map((s) => silenceKey(s.check, s.target)));
  for (const f of out) if (f.severity === "warning" && silenced.has(silenceKey(f.check, f.target))) f.silenced = true;
  return out.sort(compareFindings);
}

function compareFindings(a: Finding, b: Finding): number {
  if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
  if (a.check !== b.check) return a.check < b.check ? -1 : 1;
  return a.target < b.target ? -1 : a.target > b.target ? 1 : 0;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

export function liveWarnings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "warning" && !f.silenced);
}

type Add = (check: CheckId, target: string, view: Finding["view"], message: string) => void;

function checkProject(project: Project, add: Add): void {
  const nets = allNets(project);
  const usedConnectors = new Set<string>();
  const domainIds = new Set(project.file.domains.map((d) => d.id));

  for (const d of project.file.domains) {
    if (d.spec && !resolveRef(project.library, d.spec)) add("dangling-reference", d.id, "connectivity", `domain ${d.name} references ${d.spec}, which has no library file`);
  }
  for (const l of project.file.layers) {
    for (const d of l.domains) {
      if (!domainIds.has(d)) add("dangling-reference", l.id, "connectivity", `layer ${l.name} lists domain ${d}, which the project does not define`);
    }
  }

  for (const c of project.components.values()) {
    if (c.definition && !resolveRef(project.library, c.definition, "components")) {
      add("dangling-reference", c.id, "connectivity", `${c.name} references ${c.definition}, which has no library file`);
    }
    for (const con of componentConnectors(project, c) ?? []) {
      if (!resolveRef(project.library, con.connector, "connectors")) {
        add("dangling-reference", `${c.id}/${con.designator}`, "connectivity", `${c.name} ${con.designator} references ${con.connector}, which has no library file`);
      }
    }
  }

  for (const { net, domain } of nets) {
    const label = net.name ?? net.id;
    if (net.connectors.length < 2) {
      add("net-too-few-connectors", net.id, "connectivity", `net ${label} has ${net.connectors.length} connector${net.connectors.length === 1 ? "" : "s"}`);
    }
    for (const address of net.connectors) {
      usedConnectors.add(address);
      const r = resolveConnector(project, address);
      if ("error" in r) {
        const why = r.error === "no-component" ? "no such component" : r.error === "no-definition" ? "its component's definition is missing" : "its component has no such designator";
        add("dangling-reference", net.id, "connectivity", `net ${label} attaches to ${address}: ${why}`);
      }
    }
    const spec = netSpec(project, net, domain);
    if (!spec.ref) add("net-no-spec", net.id, "connectivity", `net ${label} has no spec: domain ${domain} names none and the net does not override`);
    else if (!resolveRef(project.library, spec.ref)) add("dangling-reference", net.id, "connectivity", `net ${label} references ${spec.ref}, which has no library file`);
  }

  for (const c of project.components.values()) {
    const connectors = componentConnectors(project, c) ?? [];
    const addresses = connectors.map((con) => `${c.id}/${con.designator}`);
    const used = addresses.filter((a) => usedConnectors.has(a));
    if (connectors.length > 0 && used.length === 0) {
      add("component-idle", c.id, "connectivity", `${c.name} has no nets`);
      continue;
    }
    for (const a of addresses) if (!usedConnectors.has(a)) add("connector-idle", a, "connectivity", `${c.name} ${a.split("/")[1]} has no nets`);
  }
}

const DEGREE_RULES = {
  connector: { min: 1, max: 1, want: "exactly one segment" },
  point: { min: 2, max: 2, want: "exactly two segments" },
  breakout: { min: 3, max: Infinity, want: "three or more segments" },
  splice: { min: 2, max: Infinity, want: "two or more segments" },
} as const;

function checkTopology(project: Project, topology: Topology, add: Add): void {
  const graph = buildGraph(topology);
  const assemblyLength = assemblyLengthOf(project);
  const routes = allRoutes(project, graph);
  const allPieces = pieces(graph);
  const allHarnesses = harnesses(project, graph);

  for (const e of topology.endpoints) {
    const d = degree(graph, e.id);
    const rule = DEGREE_RULES[e.kind];
    if (d < rule.min || d > rule.max) {
      add("endpoint-degree", e.id, "topology", `${e.kind} ${e.id} has ${d} segment${d === 1 ? "" : "s"}, wants ${rule.want}`);
    }
    if (e.kind === "connector" && "error" in resolveConnector(project, e.connector)) {
      add("dangling-reference", e.id, "topology", `endpoint ${e.id} is connector ${e.connector}, which no component has`);
    }
    if (e.kind === "breakout" && e.spec && !resolveRef(project.library, e.spec, "breakouts")) {
      add("dangling-reference", e.id, "topology", `breakout ${e.id} references ${e.spec}, which has no library file`);
    }
    if (e.kind === "splice") {
      if (e.spec && !resolveRef(project.library, e.spec, "splices")) add("dangling-reference", e.id, "topology", `splice ${e.id} references ${e.spec}, which has no library file`);
      for (const netId of e.nets) {
        const r = routes.find((r) => r.net.id === netId);
        if (!r) add("dangling-reference", e.id, "topology", `splice ${e.id} lists net ${netId}, which the project does not have`);
        else if (!r.endpoints.has(e.id)) add("splice-net-not-through", e.id, "topology", `splice ${e.id} lists net ${r.net.name ?? netId}, whose route does not pass through it`);
      }
    }
  }

  for (const p of allPieces) if (hasCycle(p)) add("topology-cycle", p.id, "topology", `the piece containing segment ${p.id} has a cycle`);

  for (const s of topology.segments) {
    if (s.assembly) {
      if (!resolveRef(project.library, s.assembly, "assemblies")) add("dangling-reference", s.id, "topology", `segment ${s.id} references ${s.assembly}, which has no library file`);
      const ends = s.ends.map((e) => graph.endpoints.get(e)?.kind);
      if (!ends.every((k) => k === "connector")) add("assembly-ends-not-connectors", s.id, "topology", `purchased assembly ${s.id} must run connector to connector`);
    } else if (segmentLength(graph, s) === undefined) {
      add("segment-no-length", s.id, "topology", `segment ${s.id} has no length`);
    }
    for (const e of s.ends) if (!graph.endpoints.has(e)) add("dangling-reference", s.id, "topology", `segment ${s.id} ends at ${e}, which is not an endpoint`);
  }

  for (const r of routes) {
    const label = r.net.name ?? r.net.id;
    if (r.net.connectors.length < 2) continue;
    if (r.unplaced.length > 0) add("net-unrouted", r.net.id, "topology", `net ${label}: ${r.unplaced.join(", ")} not placed in this topology`);
    else if (r.split) add("net-unrouted", r.net.id, "topology", `net ${label}: its connectors sit in different pieces of the topology`);
    for (const b of r.branchPoints) {
      const e = graph.endpoints.get(b);
      if (!(e?.kind === "splice" && e.nets.includes(r.net.id))) add("route-branch-without-splice", b, "topology", `net ${label} branches at ${b}, which is not a splice listing it`);
    }
  }

  for (const sh of topology.sheaths) {
    if (!resolveRef(project.library, sh.spec, "sheaths")) add("dangling-reference", sh.id, "topology", `sheath ${sh.id} references ${sh.spec}, which has no library file`);
    if (!isContiguous(graph, sh.segments)) add("sheath-not-contiguous", sh.id, "topology", `sheath ${sh.id} does not cover one contiguous path`);
    const owners = new Set(sh.segments.map((s) => pieceOf(allPieces, s)?.id));
    if (owners.size > 1) add("sheath-spans-harnesses", sh.id, "topology", `sheath ${sh.id} spans two harnesses`);
  }

  for (const t of topology.ties) {
    if (!resolveRef(project.library, t.spec, "ties")) add("dangling-reference", t.id, "topology", `tie point ${t.id} references ${t.spec}, which has no library file`);
    const seg = graph.segments.get(t.segment);
    if (!seg) {
      add("dangling-reference", t.id, "topology", `tie point ${t.id} sits on ${t.segment}, which is not a segment`);
      continue;
    }
    if (!seg.ends.includes(t.from)) add("dangling-reference", t.id, "topology", `tie point ${t.id} measures from ${t.from}, which is not an end of ${seg.id}`);
    const len = segmentLength(graph, seg, assemblyLength);
    if (len !== undefined && t.distance_mm > len) add("tie-beyond-segment", t.id, "topology", `tie point ${t.id} is ${t.distance_mm} mm along a ${len} mm segment`);
  }

  for (const h of allHarnesses) {
    if (h.anchors.length === 0) add("harness-unnamed", h.piece.id, "topology", `harness ${h.label} has no name`);
    if (h.anchors.length > 1) add("harness-two-anchors", h.piece.id, "topology", `one piece carries ${h.anchors.length} harness names: ${h.anchors.map((a) => a.harness!.name).join(", ")}`);
  }

  const keepApart = project.file.keep_apart ?? [];
  if (keepApart.length > 0) {
    for (const [segId, rs] of netsOnSegments(routes)) {
      const domains = new Set(rs.map((r) => r.domain));
      for (const [a, b] of keepApart) {
        if (domains.has(a) && domains.has(b)) add("keep-apart", segId, "topology", `segment ${segId} carries both ${a} and ${b}, which the project keeps apart`);
      }
    }
  }
}
