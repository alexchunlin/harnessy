import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { buildGraph, segmentSlack, stretchesOf } from "../../src/core/derive";
import { buildBom, cutListCsv, sheathCut } from "../../src/core/bom";
import { loadProject, saveProject, type Project } from "../../src/core/project";
import { testLibrary, twoNetProject } from "./fixture";

function stretches(p: ReturnType<typeof twoNetProject>["project"], top: string, seg: string) {
  const graph = buildGraph(p.topologies.get(top)!);
  return stretchesOf(p, graph, graph.segments.get(seg)!);
}

describe("stretches", () => {
  it("a segment with no tie points is one stretch from end to end", () => {
    const { project: p, ids } = twoNetProject();
    const s = stretches(p, ids.top, ids.seg);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ from: ids.batEnd, to: ids.mibEnd, lengthMm: 300, slackMm: undefined, effectiveSlackMm: 0 });
  });

  it("orders tie points by distance from the first end, converting one measured from the far end", () => {
    let { project: p, ids } = twoNetProject();
    const near = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 200);
    p = near.project;
    // 50 mm from the far end is 250 mm from the first end, so it comes after the one at 200.
    const far = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 50, ids.mibEnd);
    p = far.project;
    const s = stretches(p, ids.top, ids.seg);
    expect(s.map((x) => [x.from, x.to, x.lengthMm])).toEqual([
      [ids.batEnd, near.id, 200],
      [near.id, far.id, 50],
      [far.id, ids.mibEnd, 50],
    ]);
  });
});

/** The map's Z-shaped run: two tie points on one segment, slack 10, 0 and 20 mm on its three stretches. */
function zRun(p: Project, top: string, seg: string) {
  const a = ops.addTiePoint(p, top, seg, "ties/zip-tie", 100);
  const b = ops.addTiePoint(a.project, top, seg, "ties/zip-tie", 100, a.project.topologies.get(top)!.segments.find((s) => s.id === seg)!.ends[1]);
  p = b.project;
  p = ops.setStretchSlack(p, top, { kind: "tie", id: a.id }, 10);
  p = ops.setStretchSlack(p, top, { kind: "tie", id: b.id }, 0);
  p = ops.setStretchSlack(p, top, { kind: "segment", id: seg }, 20);
  return { p, ties: [a.id, b.id] };
}

/** Both nets routed, the sensor net as a sheathed cable on a 150 mm segment. */
function complete() {
  let { project: p, ids } = twoNetProject();
  const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
  p = s.project;
  const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
  p = m.project;
  const seg = ops.addSegment(p, ids.top, s.id, m.id, 150);
  p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
  p = ops.setNetSpec(p, ids.sig, "cables/shielded-6c-24awg", undefined);
  p = ops.applySheath(p, ids.top, [seg.id], "sheaths/braid-10", 30).project;
  return { p, ids, sensorSeg: seg.id };
}

describe("slack on the cut list", () => {
  it("cuts the Z-shaped run to routed length plus 30 mm on every wire, cable and sheath row", () => {
    let { p, ids, sensorSeg } = complete();
    p = zRun(p, ids.top, ids.seg).p;
    p = zRun(p, ids.top, sensorSeg).p;
    const graph = buildGraph(p.topologies.get(ids.top)!);
    expect(stretches(p, ids.top, ids.seg).map((s) => s.effectiveSlackMm)).toEqual([10, 0, 20]);
    expect(segmentSlack(p, graph, graph.segments.get(ids.seg)!)).toBe(30);
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const pick = (row: string) => bom.cutList.filter((r) => r.row === row).map((r) => [r.length_mm, r.slack_mm]);
    expect(pick("wire")).toEqual([
      [330, 30],
      [330, 30],
    ]);
    expect(pick("cable")).toEqual([[180, 30]]);
    // 150 mm of segment, 30 mm overlap, 30 mm slack.
    expect(pick("sheath")).toEqual([[210, 30]]);
    const csv = cutListCsv(bom).split("\n");
    expect(csv[0]).toContain(",length_mm,slack_mm,");
    expect(bom.summary.find((r) => r.row === "cable")?.length_mm).toBe(180);
  });

  it("gives the sheath inspector the same cut length as the sheath row, slack included", () => {
    let { p, ids, sensorSeg } = complete();
    p = zRun(p, ids.top, sensorSeg).p;
    const topology = p.topologies.get(ids.top)!;
    expect(sheathCut(p, buildGraph(topology), topology.sheaths[0])).toEqual({ length_mm: 210, slack_mm: 30 });
  });

  it("gives a purchased assembly row no slack", () => {
    let { p, ids } = complete();
    const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
    p = sw.project;
    p = ops.createNet(p, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`], "uplink").project;
    const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
    const e2 = ops.placeConnector(e1.project, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
    const s = ops.addSegment(e2.project, ids.top, e1.id, e2.id);
    p = ops.setStretchSlack(s.project, ids.top, { kind: "segment", id: s.id }, 40);
    p = ops.setSegmentAssembly(p, ids.top, s.id, "assemblies/rj45-patch-500");
    const graph = buildGraph(p.topologies.get(ids.top)!);
    expect(segmentSlack(p, graph, graph.segments.get(s.id)!)).toBe(0);
    const row = buildBom(p, p.topologies.get(ids.top)!).cutList.find((r) => r.row === "assembly")!;
    expect(row.length_mm).toBe(500);
    expect(row.slack_mm).toBeUndefined();
  });

  it("refuses negative slack", () => {
    const { project: p, ids } = twoNetProject();
    expect(() => ops.setStretchSlack(p, ids.top, { kind: "segment", id: ids.seg }, -5)).toThrow(/negative/);
  });
});

describe("slack in the topology file", () => {
  it("saves on the segment and tie point and loads back unchanged", () => {
    const { p: base, ids } = complete();
    const { p, ties } = zRun(base, ids.top, ids.seg);
    const files = saveProject(p);
    const saved = JSON.parse(files.get(`topologies/${ids.top}.json`)!);
    expect(saved.segments.find((s: { id: string }) => s.id === ids.seg).slack_mm).toBe(20);
    expect(saved.ties.find((t: { id: string }) => t.id === ties[0]).slack_mm).toBe(10);
    expect(saved.ties.find((t: { id: string }) => t.id === ties[1]).slack_mm).toBe(0);
    const { project: reloaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    for (const [path, text] of saveProject(reloaded)) expect(text, path).toBe(files.get(path));
    expect(buildBom(reloaded, reloaded.topologies.get(ids.top)!).cutList.find((r) => r.row === "wire")!.length_mm).toBe(330);
  });

  it("a file saved before slack existed loads, saves and cuts to the same lengths", () => {
    const { p, ids } = complete();
    const files = saveProject(p);
    expect(files.get(`topologies/${ids.top}.json`)).not.toContain("slack_mm");
    const { project: reloaded } = loadProject(files, testLibrary());
    for (const [path, text] of saveProject(reloaded)) expect(text, path).toBe(files.get(path));
    const rows = buildBom(reloaded, reloaded.topologies.get(ids.top)!).cutList;
    expect(rows.filter((r) => r.row === "wire").map((r) => [r.length_mm, r.slack_mm])).toEqual([
      [300, 0],
      [300, 0],
    ]);
  });
});

describe("tie point edits and slack", () => {
  const wireLength = (p: Project, top: string) => buildBom(p, p.topologies.get(top)!).cutList.find((r) => r.harness === "Power harness" && r.row === "wire")!.length_mm;

  it("removing a tie point keeps the cut length", () => {
    let { p, ids } = complete();
    const z = zRun(p, ids.top, ids.seg);
    p = z.p;
    expect(wireLength(p, ids.top)).toBe(330);
    // The first tie point's 10 mm folds into the stretch beyond it, which had 0.
    p = ops.removeTiePoint(p, ids.top, z.ties[0]);
    expect(wireLength(p, ids.top)).toBe(330);
    expect(stretches(p, ids.top, ids.seg).map((s) => s.slackMm)).toEqual([10, 20]);
    p = ops.removeTiePoint(p, ids.top, z.ties[1]);
    expect(wireLength(p, ids.top)).toBe(330);
    expect(stretches(p, ids.top, ids.seg).map((s) => s.slackMm)).toEqual([30]);
  });

  it("adding a tie point leaves its slack unset", () => {
    let { p, ids } = complete();
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: ids.seg }, 20);
    const t = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 100);
    p = t.project;
    expect(p.topologies.get(ids.top)!.ties.find((x) => x.id === t.id)!.slack_mm).toBeUndefined();
    expect(wireLength(p, ids.top)).toBe(320);
  });

  it("moving a tie point or measuring it from the other end keeps its slack", () => {
    let { p, ids } = complete();
    const t = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 100);
    p = ops.setStretchSlack(t.project, ids.top, { kind: "tie", id: t.id }, 15);
    p = ops.updateTiePoint(p, ids.top, t.id, { distance_mm: 40, from: ids.mibEnd });
    expect(p.topologies.get(ids.top)!.ties[0].slack_mm).toBe(15);
    expect(wireLength(p, ids.top)).toBe(315);
  });
});
