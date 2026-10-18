import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { placementOf } from "../../src/core/placement";
import type { Vec3 } from "../../src/core/schema";
import { twoNetProject } from "./fixture";

/**
 * A power harness of two connectors with a tie point, a branch to a point,
 * and a second harness beside it that nobody moves.
 */
function benchWithTwoHarnesses() {
  const { project, ids } = twoNetProject();
  const tie = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 100, ids.batEnd);
  const branch = ops.growSegment(tie.project, ids.top, ids.mibEnd, { x: 300, y: 200 });
  const a = ops.placeConnector(branch.project, ids.top, `${ids.mib}/J1`, { x: 600, y: 0 });
  const b = ops.placeConnector(a.project, ids.top, `${ids.sensor}/J1`, { x: 900, y: 0 });
  const other = ops.addSegment(b.project, ids.top, a.id, b.id, 300);
  return { project: other.project, ids: { ...ids, tie: tie.id, point: branch.endpoint, branch: branch.segment, otherA: a.id, otherB: b.id } };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Every distance between two placed parts of the harness: a rigid move keeps all of them, and so every length along it. */
function distances(positions: Record<string, Vec3>, ids: string[]): number[] {
  return ids.flatMap((a, i) => ids.slice(i + 1).map((b) => dist(positions[a], positions[b])));
}

describe("move a harness rigidly", () => {
  it("places every part of the harness at its moved position and keeps every length", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const pose = {
      positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 0, 0], [ids.point]: [300, 200, 0] } as Record<string, Vec3>,
      rotations: { [ids.batEnd]: [0, 0, 90], [ids.mibEnd]: [0, 0, -90] } as Record<string, Vec3>,
      ties: { [ids.tie]: [100, 0, 0] } as Record<string, Vec3>,
    };
    const moved = ops.moveHarness(project, ids.top, ids.mibEnd, pose, { translate: [50, -20, 400] });
    const p = placementOf(moved, ids.top);
    expect(p.positions).toEqual({ [ids.batEnd]: [50, -20, 400], [ids.mibEnd]: [350, -20, 400], [ids.point]: [350, 180, 400] });
    expect(p.rotations).toEqual({ [ids.batEnd]: [0, 0, 90], [ids.mibEnd]: [0, 0, -90] });
    expect(p.ties).toEqual({ [ids.tie]: [150, -20, 400] });
    const all = { ...p.positions, ...p.ties };
    const parts = [ids.batEnd, ids.mibEnd, ids.point, ids.tie];
    expect(distances(all, parts)).toEqual(distances({ ...pose.positions, ...pose.ties }, parts));
  });

  it("turns the harness about a connector: the connector stays put, every length holds, and every connector turns with it", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const pose = {
      positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 0, 0], [ids.point]: [300, 200, 0] } as Record<string, Vec3>,
      rotations: { [ids.batEnd]: [0, 0, 90], [ids.mibEnd]: [0, 0, -90] } as Record<string, Vec3>,
      ties: { [ids.tie]: [100, 0, 0] } as Record<string, Vec3>,
    };
    // A quarter turn about +Z at the battery connector.
    const s = Math.SQRT1_2;
    const moved = ops.moveHarness(project, ids.top, ids.batEnd, pose, { translate: [0, 0, 0], turn: { pivot: [0, 0, 0], quaternion: [0, 0, s, s] } });
    const p = placementOf(moved, ids.top);
    expect(p.positions).toEqual({ [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [0, 300, 0], [ids.point]: [-200, 300, 0] });
    expect(p.ties).toEqual({ [ids.tie]: [0, 100, 0] });
    expect(p.rotations).toEqual({ [ids.batEnd]: [0, 0, 180], [ids.mibEnd]: [0, 0, 0] });
    const parts = [ids.batEnd, ids.mibEnd, ids.point, ids.tie];
    expect(distances({ ...p.positions, ...p.ties }, parts)).toEqual(distances({ ...pose.positions, ...pose.ties }, parts));
  });

  it("places parts nobody placed from the pose they were drawn at, and keeps saved parts the pose leaves out", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const saved = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [10, 10, 10] }, rotations: { [ids.batEnd]: [0, 0, 90] } });
    // The view draws the rest from the sketch; the battery connector it leaves out comes from the file.
    const drawn = { positions: { [ids.mibEnd]: [300, 0, 0], [ids.point]: [300, 200, 0] } as Record<string, Vec3>, rotations: { [ids.mibEnd]: [0, 0, -90] } as Record<string, Vec3>, ties: { [ids.tie]: [100, 0, 0] } as Record<string, Vec3> };
    const moved = ops.moveHarness(saved, ids.top, ids.tie, drawn, { translate: [5, 0, 0] });
    const p = placementOf(moved, ids.top);
    expect(p.positions).toEqual({ [ids.batEnd]: [15, 10, 10], [ids.mibEnd]: [305, 0, 0], [ids.point]: [305, 200, 0] });
    expect(p.rotations).toEqual({ [ids.batEnd]: [0, 0, 90], [ids.mibEnd]: [0, 0, -90] });
    expect(p.ties).toEqual({ [ids.tie]: [105, 0, 0] });
  });

  it("leaves other harnesses untouched, even when the pose draws them too", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const before = ops.placeParts(project, ids.top, { positions: { [ids.otherA]: [600, 0, 0] } });
    const pose = { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 0, 0], [ids.point]: [300, 200, 0], [ids.otherA]: [600, 0, 0], [ids.otherB]: [900, 0, 0] } as Record<string, Vec3> };
    const p = placementOf(ops.moveHarness(before, ids.top, ids.seg, pose, { translate: [0, 0, 100] }), ids.top);
    expect(p.positions[ids.otherA]).toEqual([600, 0, 0]);
    expect(p.positions[ids.otherB]).toBeUndefined();
    expect(p.positions[ids.batEnd]).toEqual([0, 0, 100]);
  });

  it("moves a purchased cable the same way", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const other = project.topologies.get(ids.top)!.segments.find((s) => s.ends.includes(ids.otherA))!;
    const bought = ops.setSegmentAssembly(project, ids.top, other.id, "assemblies/rj45-patch-500");
    const pose = { positions: { [ids.otherA]: [600, 0, 0], [ids.otherB]: [900, 0, 0] } as Record<string, Vec3> };
    const p = placementOf(ops.moveHarness(bought, ids.top, ids.otherB, pose, { translate: [0, 50, 0] }), ids.top);
    expect(p.positions).toEqual({ [ids.otherA]: [600, 50, 0], [ids.otherB]: [900, 50, 0] });
  });
});

describe("stretch", () => {
  it("placing one part changes only the segments at it", () => {
    const { project, ids } = benchWithTwoHarnesses();
    const pose = { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 0, 0], [ids.point]: [300, 200, 0] } as Record<string, Vec3> };
    const placed = ops.moveHarness(project, ids.top, ids.seg, pose, { translate: [0, 0, 0] });
    const stretched = placementOf(ops.placeParts(placed, ids.top, { positions: { [ids.point]: [300, 260, 0] } }), ids.top).positions;
    // The branch to the point grows; the power segment between the connectors keeps its ends.
    expect(dist(stretched[ids.mibEnd], stretched[ids.point])).toBe(260);
    expect(dist(stretched[ids.batEnd], stretched[ids.mibEnd])).toBe(300);
  });
});
