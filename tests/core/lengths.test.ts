import { describe, expect, it } from "vitest";
import { lengthsOf } from "../../src/core/lengths";
import * as ops from "../../src/core/ops";
import type { Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

/** The one length function: what a segment measures and where that number comes from. */

const lengths = (p: Project, top: string) => lengthsOf(p, p.topologies.get(top)!);

/** The project with every XT60 asking for this much strain relief. */
function withStrainRelief(p: Project, mm: number): Project {
  const connectors = new Map(p.library.connectors);
  connectors.set("xt60", { ...connectors.get("xt60")!, strain_relief_mm: mm });
  return { ...p, library: { ...p.library, connectors } };
}

describe("segment lengths", () => {
  it("a straight placed segment between two connectors with no strain relief is the distance between them", () => {
    const { project, ids } = twoNetProject();
    const p = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 400, 0] } });
    expect(lengths(p, ids.top).segments.get(ids.seg)).toEqual({ mm: 500, source: "3d" });
  });

  it("strain relief stubs count toward the length", () => {
    const { project, ids } = twoNetProject();
    const ends = { [ids.batEnd]: [0, 0, 0] as [number, number, number], [ids.mibEnd]: [500, 0, 0] as [number, number, number] };
    // With no saved rotation each connector exits toward the other, so the stubs lie on the line and add nothing.
    const facing = ops.placeParts(withStrainRelief(project, 30), ids.top, { positions: ends });
    expect(lengths(facing, ids.top).segments.get(ids.seg)).toEqual({ mm: 500, source: "3d" });
    // Turned so one exits along +Y and the other along -Y, each bundle runs 30 mm straight out before it turns.
    const sideways = { [ids.batEnd]: [180, 0, 0] as [number, number, number], [ids.mibEnd]: [0, 0, 0] as [number, number, number] };
    const stubbed = lengths(ops.placeParts(withStrainRelief(project, 30), ids.top, { positions: ends, rotations: sideways }), ids.top).segments.get(ids.seg)!.mm!;
    const bare = lengths(ops.placeParts(project, ids.top, { positions: ends, rotations: sideways }), ids.top).segments.get(ids.seg)!.mm!;
    expect(stubbed).toBeGreaterThanOrEqual(500 + 2 * 30);
    expect(stubbed).toBeGreaterThan(bare);
  });

  it("an unplaced segment keeps its typed length, and one placed end does not make it placed", () => {
    const { project, ids } = twoNetProject();
    expect(lengths(project, ids.top).segments.get(ids.seg)).toEqual({ mm: 300, source: "typed" });
    const half = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0] } });
    expect(lengths(half, ids.top).segments.get(ids.seg)).toEqual({ mm: 300, source: "typed" });
    const untyped = ops.setSegmentLength(project, ids.top, ids.seg, undefined);
    expect(lengths(untyped, ids.top).segments.get(ids.seg)).toEqual({ mm: undefined, source: "typed" });
  });

  it("a chain through a point endpoint runs as one curve, each segment measuring its own part", () => {
    const { project, ids } = twoNetProject();
    let p = ops.removeSegment(project, ids.top, ids.seg);
    const pt = ops.addEndpoint(p, ids.top, "point", { x: 100, y: 0 });
    const a = ops.addSegment(pt.project, ids.top, ids.batEnd, pt.id, 50);
    const b = ops.addSegment(a.project, ids.top, pt.id, ids.mibEnd, 50);
    p = ops.placeParts(b.project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [pt.id]: [100, 0, 0], [ids.mibEnd]: [300, 0, 0] } });
    const l = lengths(p, ids.top);
    expect(l.segments.get(a.id)).toEqual({ mm: 100, source: "3d" });
    expect(l.segments.get(b.id)).toEqual({ mm: 200, source: "3d" });
  });

  it("a purchased assembly keeps its library length and reports its drawn path beside it", () => {
    let { project: p, ids } = twoNetProject();
    const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
    p = ops.createNet(sw.project, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`]).project;
    const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
    const e2 = ops.placeConnector(e1.project, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
    const s = ops.addSegment(e2.project, ids.top, e1.id, e2.id);
    p = ops.setSegmentAssembly(s.project, ids.top, s.id, "assemblies/rj45-patch-500");
    expect(lengths(p, ids.top).segments.get(s.id)).toEqual({ mm: 500, source: "library" });
    p = ops.placeParts(p, ids.top, { positions: { [e1.id]: [0, 0, 0], [e2.id]: [0, 0, 640] } });
    expect(lengths(p, ids.top).segments.get(s.id)).toEqual({ mm: 500, source: "library", pathMm: 640 });
  });
});

describe("tie point distances", () => {
  it("an unplaced tie point keeps its typed distance", () => {
    const { project, ids } = twoNetProject();
    const t = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 120, ids.batEnd);
    expect(lengths(t.project, ids.top).ties.get(t.id)).toEqual({ mm: 120, source: "typed" });
  });

  it("a placed tie point measures the curve from its named end, and the other end gives the complement", () => {
    const { project, ids } = twoNetProject();
    const t = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 120, ids.batEnd);
    const p = ops.placeParts(t.project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [400, 0, 0] }, ties: { [t.id]: [100, 0, 0] } });
    expect(lengths(p, ids.top).ties.get(t.id)).toEqual({ mm: 100, source: "3d" });
    const flipped = ops.updateTiePoint(p, ids.top, t.id, { from: ids.mibEnd });
    expect(lengths(flipped, ids.top).ties.get(t.id)).toEqual({ mm: 300, source: "3d" });
  });

  it("a tie point with a position on an unplaced segment keeps its typed distance", () => {
    const { project, ids } = twoNetProject();
    const t = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 120, ids.batEnd);
    const p = ops.placeParts(t.project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0] }, ties: { [t.id]: [100, 0, 0] } });
    expect(lengths(p, ids.top).ties.get(t.id)).toEqual({ mm: 120, source: "typed" });
  });
});
