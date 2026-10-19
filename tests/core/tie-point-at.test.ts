import { describe, expect, it } from "vitest";
import { lengthsOf } from "../../src/core/lengths";
import * as ops from "../../src/core/ops";
import { placementOf } from "../../src/core/placement";
import type { Project } from "../../src/core/project";
import type { Vec3 } from "../../src/core/schema";
import { twoNetProject } from "./fixture";

/** A tie point made in 3D: the tie point, its position and a typed distance where it was made, in one edit. */

const along = (x: number): Vec3 => [x, 0, 0];

function placedBench(): ReturnType<typeof twoNetProject> {
  const { project, ids } = twoNetProject();
  return { project: ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: along(0), [ids.mibEnd]: along(400) } }), ids };
}

describe("adding a tie point at a position", () => {
  it("saves the tie point, its position, and a typed distance equal to the derived one", () => {
    const { project, ids } = placedBench();
    const made = ops.addTiePointAt(project, ids.top, ids.seg, along(100));
    const tie = made.project.topologies.get(ids.top)!.ties.find((t) => t.id === made.id)!;
    expect(tie).toMatchObject({ segment: ids.seg, from: ids.batEnd, distance_mm: 100, spec: "ties/zip-tie" });
    expect(placementOf(made.project, ids.top).ties).toEqual({ [made.id]: along(100) });
    expect(lengthsOf(made.project, made.project.topologies.get(ids.top)!).ties.get(made.id)).toEqual({ mm: 100, source: "3d" });
  });

  it("uses the p-clip when the library has one", () => {
    const { project, ids } = placedBench();
    const ties = new Map(project.library.ties);
    ties.set("p-clip-10mm", { id: "p-clip-10mm", name: "P-clip 10 mm", kind: "p_clip", part_number: "PC10" } as never);
    const withClip: Project = { ...project, library: { ...project.library, ties } };
    const made = ops.addTiePointAt(withClip, ids.top, ids.seg, along(100));
    expect(made.project.topologies.get(ids.top)!.ties.find((t) => t.id === made.id)!.spec).toBe("ties/p-clip-10mm");
  });

  it("on a sketched segment, measures the distance along the curve the view draws", () => {
    const { project, ids } = twoNetProject();
    const drawn = { positions: { [ids.batEnd]: along(0), [ids.mibEnd]: along(250) } };
    const made = ops.addTiePointAt(project, ids.top, ids.seg, along(50), drawn);
    expect(made.project.topologies.get(ids.top)!.ties.find((t) => t.id === made.id)!.distance_mm).toBe(50);
    // The tie point's position is saved; the sketched ends are not.
    expect(placementOf(made.project, ids.top)).toEqual({ positions: {}, rotations: {}, ties: { [made.id]: along(50) } });
  });

  it("a locked move carries the saved tie point with the harness", () => {
    const { project, ids } = placedBench();
    const made = ops.addTiePointAt(project, ids.top, ids.seg, along(100));
    const moved = ops.moveHarness(made.project, ids.top, ids.batEnd, {}, { translate: [0, 50, 0] });
    expect(placementOf(moved, ids.top).ties).toEqual({ [made.id]: [100, 50, 0] });
    expect(lengthsOf(moved, moved.topologies.get(ids.top)!).ties.get(made.id)).toEqual({ mm: 100, source: "3d" });
  });
});
