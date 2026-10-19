import { describe, expect, it } from "vitest";
import { bundleCurves } from "../../src/core/curve";
import * as ops from "../../src/core/ops";
import type { Project } from "../../src/core/project";
import type { Vec3 } from "../../src/core/schema";
import { twoNetProject } from "./fixture";

/** The points the 3D view draws each tube along, from the pose it draws. */

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(...a);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const near = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

function withStrainRelief(p: Project, mm: number): Project {
  const connectors = new Map(p.library.connectors);
  connectors.set("xt60", { ...connectors.get("xt60")!, strain_relief_mm: mm });
  return { ...p, library: { ...p.library, connectors } };
}

/** The points of a polyline within `mm` of its start, measured along it. */
function within(points: Vec3[], mm: number): Vec3[] {
  const out = [points[0]];
  let d = 0;
  for (let i = 1; i < points.length; i++) {
    d += Math.hypot(...sub(points[i], points[i - 1]));
    if (d > mm) break;
    out.push(points[i]);
  }
  return out;
}

describe("tubes drawn from the bundle curve", () => {
  it("a chain bent at a point endpoint meets there with no gap and no kink", () => {
    const { project, ids } = twoNetProject();
    const pt = ops.addEndpoint(ops.removeSegment(project, ids.top, ids.seg), ids.top, "point", { x: 100, y: 0 });
    const a = ops.addSegment(pt.project, ids.top, ids.batEnd, pt.id, 50);
    // The second segment runs from the far connector back to the point, so its points run the other way.
    const b = ops.addSegment(a.project, ids.top, ids.mibEnd, pt.id, 50);
    const pose = { positions: { [ids.batEnd]: [0, 0, 0] as Vec3, [pt.id]: [200, 0, 0] as Vec3, [ids.mibEnd]: [300, 200, 0] as Vec3 }, rotations: {}, ties: {} };
    const curves = bundleCurves(b.project, b.project.topologies.get(ids.top)!, pose);
    const first = curves.get(a.id)!.points;
    const second = [...curves.get(b.id)!.points].reverse();
    near(first[first.length - 1], [200, 0, 0]);
    near(second[0], [200, 0, 0]);
    const into = unit(sub(first[first.length - 1], first[first.length - 2]));
    const out = unit(sub(second[1], second[0]));
    expect(dot(into, out)).toBeGreaterThan(0.99);
  });

  it("a connector with strain relief draws a straight stub along its exit, and a type with none does not", () => {
    const { project, ids } = twoNetProject();
    const draw = (p: Project) => {
      // The battery's exit turns to +Y, away from the other connector along +X.
      const pose = { positions: { [ids.batEnd]: [0, 0, 0] as Vec3, [ids.mibEnd]: [400, 0, 0] as Vec3 }, rotations: { [ids.batEnd]: [180, 0, 0] as Vec3 }, ties: {} };
      return bundleCurves(p, p.topologies.get(ids.top)!, pose).get(ids.seg)!.points;
    };
    const offExit = (pts: Vec3[]) => Math.max(...pts.map((q) => Math.hypot(q[0], q[2])));
    const stub = within(draw(withStrainRelief(project, 30)), 30.001);
    expect(offExit(stub)).toBeLessThan(1e-6);
    expect(stub[stub.length - 1][1]).toBeCloseTo(30, 6);
    expect(offExit(within(draw(project), 30.001))).toBeGreaterThan(1);
  });
});
