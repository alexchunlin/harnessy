import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { buildBom } from "../../src/core/bom";
import { deletedPaths, saveProject } from "../../src/core/project";
import { twoNetProject } from "./fixture";

/** The bench topology with a second harness: sensor to MIB, 150 mm, with a tie point on each harness. */
function twoHarnesses() {
  const { project, ids } = twoNetProject();
  const s = ops.placeConnector(project, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
  const m = ops.placeConnector(s.project, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
  const seg = ops.addSegment(m.project, ids.top, s.id, m.id, 150);
  const sensorTie = ops.addTiePoint(seg.project, ids.top, seg.id, "ties/zip-tie", 50, s.id);
  const powerTie = ops.addTiePoint(sensorTie.project, ids.top, ids.seg, "ties/zip-tie", 100, ids.batEnd);
  return { project: powerTie.project, ids: { ...ids, sensorEnd: s.id, mibJ1: m.id, sensorSeg: seg.id, sensorTie: sensorTie.id, powerTie: powerTie.id } };
}

describe("clear placement", () => {
  it("removes every position and rotation of that harness and keeps the other harness placed", () => {
    const { project, ids } = twoHarnesses();
    const placed = ops.placeParts(project, ids.top, {
      positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [400, 0, 0], [ids.sensorEnd]: [0, 100, 0], [ids.mibJ1]: [200, 100, 0] },
      rotations: { [ids.mibEnd]: [0, 0, 90], [ids.sensorEnd]: [90, 0, 0] },
      ties: { [ids.powerTie]: [150, 0, 0], [ids.sensorTie]: [80, 100, 0] },
    });
    const cleared = ops.clearPlacement(placed, ids.top, ids.mibEnd);
    expect(cleared.placements.get(ids.top)).toEqual({
      positions: { [ids.sensorEnd]: [0, 100, 0], [ids.mibJ1]: [200, 100, 0] },
      rotations: { [ids.sensorEnd]: [90, 0, 0] },
      ties: { [ids.sensorTie]: [80, 100, 0] },
    });
    // Any member names the harness: a segment or a tie point clears the same entries.
    expect(ops.clearPlacement(placed, ids.top, ids.seg)).toEqual(cleared);
    expect(ops.clearPlacement(placed, ids.top, ids.powerTie)).toEqual(cleared);
    expect(placed.placements.get(ids.top)?.positions[ids.mibEnd]).toEqual([400, 0, 0]);
  });

  it("clearing the last placed harness drops the placement file", () => {
    const { project, ids } = twoHarnesses();
    const placed = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.sensorEnd]: [0, 100, 0] }, ties: { [ids.sensorTie]: [80, 100, 0] } });
    const once = ops.clearPlacement(placed, ids.top, ids.sensorSeg);
    expect(deletedPaths(saveProject(placed), saveProject(once))).toEqual([]);
    const twice = ops.clearPlacement(once, ids.top, ids.batEnd);
    expect(deletedPaths(saveProject(once), saveProject(twice))).toEqual([`canvas/${ids.top}.3d.json`]);
  });

  it("on a harness with nothing placed is no edit at all", () => {
    const { project, ids } = twoHarnesses();
    const placed = ops.placeParts(project, ids.top, { positions: { [ids.sensorEnd]: [0, 100, 0] } });
    expect(ops.clearPlacement(project, ids.top, ids.batEnd)).toBe(project);
    expect(ops.clearPlacement(placed, ids.top, ids.batEnd)).toBe(placed);
  });

  it("leaves the BOM rows on the typed lengths and the tie points on their typed distances", () => {
    const { project, ids } = twoHarnesses();
    const named = ops.setHarnessAnchor(project, ids.top, ids.sensorSeg, { name: "Sensor harness" });
    const typed = buildBom(named, named.topologies.get(ids.top)!);
    // Placed 400 mm apart where 300 mm is typed, with the tie 150 mm along where 100 mm is typed.
    const placed = ops.placeParts(named, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [400, 0, 0] }, ties: { [ids.powerTie]: [150, 0, 0] } });
    const cleared = ops.clearPlacement(placed, ids.top, ids.batEnd);
    const bom = buildBom(cleared, cleared.topologies.get(ids.top)!);
    expect(bom.cutList.filter((r) => r.row === "wire" && r.harness === "Power harness").map((r) => r.length_mm)).toEqual([300, 300]);
    expect(bom).toEqual(typed);
    expect(cleared.topologies.get(ids.top)!.ties.find((t) => t.id === ids.powerTie)!.distance_mm).toBe(100);
  });
});
