import { describe, expect, it } from "vitest";
import { bundleCurves } from "../../src/core/curve";
import * as ops from "../../src/core/ops";
import { placementOf } from "../../src/core/placement";
import type { Project } from "../../src/core/project";
import type { Vec3 } from "../../src/core/schema";
import { findings, twoNetProject } from "./fixture";

/** Give library wires, cables or sheaths a minimum bend radius. */
function withRadius(p: Project, folder: "wires" | "cables" | "sheaths", radii: Record<string, number>): Project {
  const entries = new Map(p.library[folder] as Map<string, object>);
  for (const [id, mm] of Object.entries(radii)) entries.set(id, { ...entries.get(id)!, min_bend_radius_mm: mm });
  return { ...p, library: { ...p.library, [folder]: entries } };
}

/**
 * The battery segment placed with two tie points. `hairpin` folds it back
 * between the ties, 30 mm apart, round a turn near 9 mm in radius; otherwise
 * it runs a long gentle arc.
 */
function placed(hairpin: boolean) {
  const { project, ids } = twoNetProject();
  let p = project;
  const t1 = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 100);
  const t2 = ops.addTiePoint(t1.project, ids.top, ids.seg, "ties/zip-tie", 200);
  p = t2.project;
  const positions: Record<string, Vec3> = hairpin
    ? { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [0, 30, 0] }
    : { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [1000, 0, 0] };
  const ties: Record<string, Vec3> = hairpin
    ? { [t1.id]: [200, 0, 0], [t2.id]: [200, 30, 0] }
    : { [t1.id]: [300, 20, 0], [t2.id]: [700, 20, 0] };
  // In the hairpin both connectors exit along +X, so the only tight turn is the fold between the ties.
  const rotations: Record<string, Vec3> = hairpin ? { [ids.batEnd]: [0, 0, 90], [ids.mibEnd]: [0, 0, 90] } : {};
  p = ops.placeParts(p, ids.top, { positions, rotations, ties });
  return { project: p, ids };
}

const bends = async (p: Project, top: string) => (await findings(p, top)).filter((f) => f.check === "bend-radius");
const both = { "awg12-red": 25, "awg12-black": 25 };

describe("bend radius on the bundle curve", () => {
  it("a placed bend tighter than the bundle's minimum gives one warning on the segment with both numbers", async () => {
    const { project, ids } = placed(true);
    const found = await bends(withRadius(project, "wires", both), ids.top);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ target: ids.seg, severity: "warning", view: "3d" });
    expect(found[0].message).toMatch(/R \d+ mm, min 25 mm$/);
    const r = Number(found[0].message.match(/R (\d+) mm/)![1]);
    expect(r).toBeGreaterThan(5);
    expect(r).toBeLessThan(25);
  });

  it("a gentle curve, an unplaced segment and a bundle with no declared radius give none", async () => {
    const gentle = placed(false);
    expect(await bends(withRadius(gentle.project, "wires", both), gentle.ids.top)).toEqual([]);

    const { project, ids } = twoNetProject();
    expect(await bends(withRadius(project, "wires", both), ids.top)).toEqual([]);

    const tight = placed(true);
    expect(await bends(tight.project, tight.ids.top)).toEqual([]);
  });

  it("the bundle's minimum follows the stiffest conductor or sheath", async () => {
    const { project, ids } = placed(true);
    const soft = withRadius(project, "wires", { "awg12-red": 5, "awg12-black": 5 });
    expect(await bends(soft, ids.top)).toEqual([]);

    const stiffWire = withRadius(project, "wires", { "awg12-red": 5, "awg12-black": 40 });
    expect((await bends(stiffWire, ids.top))[0].message).toMatch(/min 40 mm$/);

    const sleeved = withRadius(ops.applySheath(soft, ids.top, [ids.seg], "sheaths/braid-10").project, "sheaths", { "braid-10": 60 });
    expect((await bends(sleeved, ids.top))[0].message).toMatch(/min 60 mm$/);
  });

  it("a bend inside a strain relief stub raises nothing", async () => {
    const { project, ids } = twoNetProject();
    const connectors = new Map(project.library.connectors);
    connectors.set("xt60", { ...connectors.get("xt60")!, strain_relief_mm: 30 });
    // The battery exits 30 degrees off the line to the far connector, so the bundle turns where its stub ends.
    const lib = { ...project, library: { ...project.library, connectors } };
    const at = (x: number) =>
      ops.placeParts(lib, ids.top, {
        positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [x, 0, 0] },
        rotations: { [ids.batEnd]: [0, 0, 120] },
      });
    expect(await bends(withRadius(at(1000), "wires", both), ids.top)).toEqual([]);

    // Over a 100 mm run the turn is too tight for a stiff bundle, and every tight run starts past the stub.
    const p = at(100);
    const top = p.topologies.get(ids.top)!;
    const curve = bundleCurves(p, top, placementOf(p, ids.top), new Map([[ids.seg, 40]])).get(ids.seg)!;
    expect(curve.tight.length).toBeGreaterThan(0);
    for (const [from, to] of curve.tight) {
      expect(from).toBeGreaterThanOrEqual(30);
      expect(to).toBeLessThanOrEqual(curve.lengthMm - 30);
    }
    expect(await bends(withRadius(p, "wires", { "awg12-red": 40 }), ids.top)).toHaveLength(1);
  });

  it("a stub that exits sideways into a long run turns gently, and a short run still turns tight", async () => {
    const { project, ids } = twoNetProject();
    const connectors = new Map(project.library.connectors);
    connectors.set("xt60", { ...connectors.get("xt60")!, strain_relief_mm: 20 });
    const lib = { ...project, library: { ...project.library, connectors } };
    // The battery exits along -Y; the far connector sits 300 mm to the side, level with the battery's stub end.
    const at = (sideways: number) =>
      ops.placeParts(lib, ids.top, {
        positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [sideways, -20, 0] },
        rotations: { [ids.batEnd]: [0, 0, 0] },
      });
    const long = at(300);
    expect(await bends(withRadius(long, "wires", both), ids.top)).toEqual([]);
    const curve = bundleCurves(long, long.topologies.get(ids.top)!, placementOf(long, ids.top), new Map([[ids.seg, 25]])).get(ids.seg)!;
    expect(curve.minRadiusMm).toBeGreaterThan(25);

    // The same turn made in 40 mm is tight.
    expect(await bends(withRadius(at(40), "wires", both), ids.top)).toHaveLength(1);
  });

  it("the curve reports the tight runs from the segment's first end, whichever way it runs", () => {
    const { project, ids } = placed(true);
    const top = project.topologies.get(ids.top)!;
    const forward = bundleCurves(project, top, placementOf(project, ids.top), new Map([[ids.seg, 25]])).get(ids.seg)!;
    const flipped = { ...top, segments: top.segments.map((s) => (s.id === ids.seg ? { ...s, ends: [s.ends[1], s.ends[0]] as [string, string] } : s)) };
    const back = bundleCurves(project, flipped, placementOf(project, ids.top), new Map([[ids.seg, 25]])).get(ids.seg)!;
    expect(forward.tight.length).toBeGreaterThan(0);
    expect(back.tight.length).toBe(forward.tight.length);
    back.tight.forEach(([from, to], i) => {
      const [a, b] = forward.tight[forward.tight.length - 1 - i];
      expect(from).toBeCloseTo(forward.lengthMm - b, 0);
      expect(to).toBeCloseTo(forward.lengthMm - a, 0);
    });
    // The fold sits between the ties, about halfway along.
    expect(forward.tight[0][0]).toBeGreaterThan(forward.lengthMm / 4);
    expect(forward.tight[forward.tight.length - 1][1]).toBeLessThan((forward.lengthMm * 3) / 4);
    expect(forward.minRadiusMm).toBeLessThan(25);
  });

  it("silencing works per segment", async () => {
    const { project, ids } = placed(true);
    const p = ops.silence(withRadius(project, "wires", both), "bend-radius", ids.seg);
    const found = await bends(p, ids.top);
    expect(found).toHaveLength(1);
    expect(found[0].silenced).toBe(true);
  });
});
