import type { Topology } from "./schema";
import { allNets, componentConnectors, connectorLabel, netSpec, type Project } from "./project";
import { resolveRef, resolveSpec } from "./library";
import { parseAddress } from "./refs";
import { assemblyLengthOf, hasErrors, liveWarnings, runChecks, type Finding } from "./drc";
import { buildGraph, harnesses, harnessLabelOf, isBuilt, legsOf, routeOf, PURCHASED, segmentLength, type Graph } from "./derive";

export const CUT_LIST_COLUMNS = ["harness", "row", "ref", "part_number", "description", "color", "qty", "length_mm", "from", "to", "net", "domain", "notes"] as const;
export type CutListColumn = (typeof CUT_LIST_COLUMNS)[number];
export type RowKind = "housing" | "contacts" | "wire" | "cable" | "sheath" | "tie" | "splice" | "breakout" | "assembly";

export type Cell = string | number | undefined;
export type CutListRow = Record<CutListColumn, Cell> & { row: RowKind; harness: string };

export const SUMMARY_COLUMNS = ["harness", "row", "ref", "part_number", "description", "qty", "length_mm"] as const;
export type SummaryRow = Record<(typeof SUMMARY_COLUMNS)[number], Cell> & { row: RowKind; harness: string };

export interface Bom {
  cutList: CutListRow[];
  summary: SummaryRow[];
  warnings: Finding[];
}

export class BomBlocked extends Error {
  constructor(public readonly errors: Finding[]) {
    super(`export refused: ${errors.length} design rule error${errors.length === 1 ? "" : "s"}`);
  }
}

/** Build the BOM for one topology. Throws BomBlocked while the topology has design rule errors. */
export function buildBom(project: Project, topology: Topology): Bom {
  const findings = runChecks(project, topology);
  if (hasErrors(findings)) throw new BomBlocked(findings.filter((f) => f.severity === "error"));
  return { ...buildRows(project, topology), warnings: liveWarnings(findings) };
}

function endpointName(project: Project, graph: Graph, id: string): string {
  const e = graph.endpoints.get(id);
  if (!e) return id;
  if (e.kind === "connector") return connectorLabel(project, e.connector);
  return `${e.kind} ${e.id}`;
}

/** The rows alone, without the design rule gate. The panel uses this for a live preview. */
export function buildRows(project: Project, topology: Topology): { cutList: CutListRow[]; summary: SummaryRow[] } {
  const graph = buildGraph(topology);
  const lib = project.library;
  const assemblyLength = assemblyLengthOf(project);
  const allHarnesses = harnesses(project, graph);
  const harnessOf = (id: string) => harnessLabelOf(allHarnesses, id);
  const name = (id: string) => endpointName(project, graph, id);
  const rows: CutListRow[] = [];
  const row = (r: Partial<CutListRow> & { row: RowKind; harness: string }) => rows.push({ ...emptyRow(), ...r });

  const contactsAt = new Map<string, number>();

  for (const { net, domain } of allNets(project)) {
    const route = routeOf(graph, net, domain);
    const spec = netSpec(project, net, domain);
    const resolved = spec.ref ? resolveSpec(lib, spec.ref) : undefined;
    const netLabel = net.name ?? net.id;
    for (const c of net.connectors) {
      const e = graph.connectorEndpoint.get(c);
      if (e) contactsAt.set(e, (contactsAt.get(e) ?? 0) + spec.conductors);
    }
    if (route.segments.size === 0) continue;
    const onAssembly = [...route.segments].every((s) => !isBuilt(graph.segments.get(s)!));
    if (onAssembly) continue;
    if (resolved?.kind === "cable") {
      const ends = net.connectors.map((c) => graph.connectorEndpoint.get(c)).filter((e): e is string => e !== undefined);
      row({
        harness: harnessOf([...route.segments][0]),
        row: "cable",
        ref: spec.ref,
        part_number: resolved.spec.part_number,
        description: resolved.spec.name,
        qty: 1,
        length_mm: routeTotal(graph, route.segments, assemblyLength),
        from: ends[0] ? name(ends[0]) : undefined,
        to: ends[1] ? name(ends[1]) : undefined,
        net: netLabel,
        domain,
      });
    } else {
      for (const leg of legsOf(graph, route, assemblyLength)) {
        for (let i = 0; i < spec.conductors; i++) {
          row({
            harness: harnessOf(leg.segments[0].id),
            row: "wire",
            ref: spec.ref,
            part_number: resolved?.spec.part_number,
            description: resolved?.spec.name,
            color: resolved?.kind === "wire" ? resolved.spec.color : undefined,
            qty: 1,
            length_mm: leg.lengthMm,
            from: name(leg.from),
            to: name(leg.to),
            net: netLabel,
            domain,
            notes: spec.conductors > 1 ? `conductor ${i + 1} of ${spec.conductors}` : undefined,
          });
        }
      }
    }
  }

  for (const e of topology.endpoints) {
    if (e.kind === "connector") {
      const seg = graph.incident.get(e.id)?.[0];
      if (!seg || !isBuilt(seg)) continue;
      const r = resolveConnectorType(project, e.connector);
      const label = connectorLabel(project, e.connector);
      const h = harnessOf(e.id);
      row({ harness: h, row: "housing", ref: r?.ref, part_number: r?.type?.mating.part_number, description: r?.type ? `${r.type.name} housing` : undefined, qty: 1, from: label, to: label });
      const qty = contactsAt.get(e.id) ?? 0;
      if (qty > 0) {
        row({ harness: h, row: "contacts", ref: r?.ref, part_number: r?.type?.mating.contacts_part_number, description: r?.type ? `${r.type.name} contacts` : undefined, qty, from: label, to: label });
      }
    }
    if (e.kind === "breakout" && e.spec) {
      const spec = resolveRef(lib, e.spec, "breakouts");
      row({ harness: harnessOf(e.id), row: "breakout", ref: e.spec, part_number: spec?.part_number, description: spec?.name, qty: 1, from: name(e.id), to: name(e.id) });
    }
    if (e.kind === "splice") {
      const spec = e.spec ? resolveRef(lib, e.spec, "splices") : undefined;
      for (const netId of e.nets) {
        const found = allNets(project).find((n) => n.net.id === netId);
        if (!found) continue;
        const s = netSpec(project, found.net, found.domain);
        row({ harness: harnessOf(e.id), row: "splice", ref: e.spec, part_number: spec?.part_number, description: spec?.name ?? "splice", qty: s.conductors, from: name(e.id), to: name(e.id), net: found.net.name ?? netId, domain: found.domain });
      }
    }
  }

  for (const sh of topology.sheaths) {
    const spec = resolveRef(lib, sh.spec, "sheaths");
    let length: number | undefined = sh.overlap_mm;
    for (const id of sh.segments) {
      const seg = graph.segments.get(id);
      const l = seg ? segmentLength(graph, seg, assemblyLength) : undefined;
      if (l === undefined) {
        length = undefined;
        break;
      }
      length += l;
    }
    const ends = chainEnds(graph, sh.segments);
    row({
      harness: sh.segments[0] ? harnessOf(sh.segments[0]) : PURCHASED,
      row: "sheath",
      ref: sh.spec,
      part_number: spec?.part_number,
      description: spec?.name,
      qty: 1,
      length_mm: length,
      from: ends ? name(ends[0]) : undefined,
      to: ends ? name(ends[1]) : undefined,
      notes: sh.overlap_mm ? `includes ${sh.overlap_mm} mm overlap` : undefined,
    });
  }

  const ties = [...topology.ties].sort((x, y) => (x.segment === y.segment ? x.distance_mm - y.distance_mm : x.segment < y.segment ? -1 : 1));
  for (const t of ties) {
    const spec = resolveRef(lib, t.spec, "ties");
    row({ harness: harnessOf(t.segment), row: "tie", ref: t.spec, part_number: spec?.part_number, description: spec?.name, qty: 1, from: name(t.from), to: `segment ${t.segment}`, notes: `${t.distance_mm} mm from ${name(t.from)}` });
  }

  for (const s of topology.segments) {
    if (!s.assembly) continue;
    const a = resolveRef(lib, s.assembly, "assemblies");
    row({ harness: harnessOf(s.id), row: "assembly", ref: s.assembly, part_number: a?.part_number, description: a?.name, qty: 1, length_mm: a?.length_mm, from: name(s.ends[0]), to: name(s.ends[1]) });
  }

  rows.sort(compareRows);
  return { cutList: rows, summary: summarize(rows) };
}

const ROW_ORDER: RowKind[] = ["housing", "contacts", "wire", "cable", "sheath", "tie", "splice", "breakout", "assembly"];

function compareRows(a: { harness: string; row: RowKind; net?: Cell; from?: Cell; to?: Cell; notes?: Cell; ref?: Cell }, b: typeof a): number {
  const ha = a.harness === PURCHASED ? 1 : 0;
  const hb = b.harness === PURCHASED ? 1 : 0;
  if (ha !== hb) return ha - hb;
  if (a.harness !== b.harness) return a.harness < b.harness ? -1 : 1;
  const ra = ROW_ORDER.indexOf(a.row);
  const rb = ROW_ORDER.indexOf(b.row);
  if (ra !== rb) return ra - rb;
  // Emission order settles ties in the key: conductor numbers and tie point distances stay in place.
  const ka = `${a.ref ?? ""}|${a.net ?? ""}|${a.from ?? ""}|${a.to ?? ""}`;
  const kb = `${b.ref ?? ""}|${b.net ?? ""}|${b.from ?? ""}|${b.to ?? ""}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

const LENGTH_ROWS = new Set<RowKind>(["wire", "cable", "sheath", "assembly"]);

function summarize(rows: CutListRow[]): SummaryRow[] {
  const groups = new Map<string, SummaryRow>();
  for (const r of rows) {
    const key = `${r.harness}|${r.row}|${r.ref ?? ""}`;
    const g = groups.get(key) ?? { harness: r.harness, row: r.row, ref: r.ref, part_number: r.part_number, description: r.description, qty: 0, length_mm: undefined };
    g.qty = (g.qty as number) + ((r.qty as number | undefined) ?? 0);
    if (LENGTH_ROWS.has(r.row) && typeof r.length_mm === "number") g.length_mm = ((g.length_mm as number | undefined) ?? 0) + r.length_mm;
    groups.set(key, g);
  }
  return [...groups.values()].sort(compareRows);
}

function routeTotal(graph: Graph, segments: Set<string>, assemblyLength: (ref: string) => number | undefined): number | undefined {
  let total = 0;
  for (const id of segments) {
    const l = segmentLength(graph, graph.segments.get(id)!, assemblyLength);
    if (l === undefined) return undefined;
    total += l;
  }
  return total;
}

function chainEnds(graph: Graph, segmentIds: string[]): [string, string] | undefined {
  if (segmentIds.length === 0) return undefined;
  const count = new Map<string, number>();
  for (const id of segmentIds) for (const e of graph.segments.get(id)?.ends ?? []) count.set(e, (count.get(e) ?? 0) + 1);
  const ends = [...count].filter(([, c]) => c === 1).map(([e]) => e);
  return ends.length === 2 ? [ends[0], ends[1]] : undefined;
}

function resolveConnectorType(project: Project, address: string) {
  const { component: cmpId, designator } = parseAddress(address);
  const component = project.components.get(cmpId);
  if (!component) return undefined;
  const con = componentConnectors(project, component)?.find((c) => c.designator === designator);
  if (!con) return undefined;
  return { ref: con.connector, type: resolveRef(project.library, con.connector, "connectors") };
}

function emptyRow(): CutListRow {
  return { harness: "", row: "wire", ref: undefined, part_number: undefined, description: undefined, color: undefined, qty: undefined, length_mm: undefined, from: undefined, to: undefined, net: undefined, domain: undefined, notes: undefined };
}

// CSV --------------------------------------------------------------------------

export function csvCell(v: Cell): string {
  if (v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function cutListCsv(bom: Bom): string {
  const lines = [CUT_LIST_COLUMNS.join(",")];
  for (const r of bom.cutList) lines.push(CUT_LIST_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Summary CSV. Live warnings sit at the top as `warning` rows, then a blank line, then the table. */
export function summaryCsv(bom: Bom): string {
  const lines: string[] = [];
  for (const w of bom.warnings) lines.push(["warning", w.check, w.target, csvCell(w.message)].join(","));
  if (bom.warnings.length) lines.push("");
  lines.push(SUMMARY_COLUMNS.join(","));
  for (const r of bom.summary) lines.push(SUMMARY_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n") + "\n";
}
