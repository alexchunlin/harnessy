import { describe, expect, it } from "vitest";
import { buildBom } from "../../src/core/bom";
import * as ops from "../../src/core/ops";
import type { Project } from "../../src/core/project";
import { findings, twoNetProject } from "./fixture";

/** The fixture with every net routed, plus a 500 mm patch cable from the MIB to a switch, unplaced. */
function withPatch() {
  let { project: p, ids } = twoNetProject();
  const sensor = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
  const mib = ops.placeConnector(sensor.project, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
  const sensorSeg = ops.addSegment(mib.project, ids.top, sensor.id, mib.id, 150);
  p = ops.setHarnessAnchor(sensorSeg.project, ids.top, sensorSeg.id, { name: "Sensor harness" });
  const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
  p = ops.createNet(sw.project, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`]).project;
  const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
  const e2 = ops.placeConnector(e1.project, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
  const s = ops.addSegment(e2.project, ids.top, e1.id, e2.id);
  p = ops.setSegmentAssembly(s.project, ids.top, s.id, "assemblies/rj45-patch-500");
  return { project: p, top: ids.top, seg: s.id, ends: [e1.id, e2.id] as const };
}

/** Place the patch cable's two ends `mm` apart in a straight line. */
function stretched(mm: number) {
  const patch = withPatch();
  const project = ops.placeParts(patch.project, patch.top, { positions: { [patch.ends[0]]: [0, 0, 0], [patch.ends[1]]: [0, 0, mm] } });
  return { ...patch, project };
}

const tooShort = async (p: Project, top: string) => (await findings(p, top)).filter((f) => f.check === "assembly-too-short");

describe("purchased assembly path longer than the cable", () => {
  it("a placed path longer than the cable gives one warning on the segment with both numbers", async () => {
    const { project, top, seg } = stretched(640);
    const found = await tooShort(project, top);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ target: seg, severity: "warning", view: "3d" });
    expect(found[0].message).toMatch(/path 640 mm, cable 500 mm$/);
  });

  it("a shorter path and an unplaced assembly give none", async () => {
    const short = stretched(420);
    expect(await tooShort(short.project, short.top)).toEqual([]);
    const unplaced = withPatch();
    expect(await tooShort(unplaced.project, unplaced.top)).toEqual([]);
  });

  it("silencing works per segment", async () => {
    const { project, top, seg } = stretched(640);
    const found = await tooShort(ops.silence(project, "assembly-too-short", seg), top);
    expect(found).toHaveLength(1);
    expect(found[0].silenced).toBe(true);
    const other = await tooShort(ops.silence(project, "assembly-too-short", "seg-other"), top);
    expect(other[0].silenced).toBeUndefined();
  });

  it("the assembly's BOM row keeps the library length whether placed or not", () => {
    for (const { project, top } of [withPatch(), stretched(640)]) {
      const rows = buildBom(project, project.topologies.get(top)!).cutList.filter((r) => r.row === "assembly");
      expect(rows.map((r) => r.length_mm)).toEqual([500]);
    }
  });
});
