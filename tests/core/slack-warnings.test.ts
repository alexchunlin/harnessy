import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { runChecks } from "../../src/core/drc";
import type { Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

const checks = (p: Project, top: string, check: string) => runChecks(p, p.topologies.get(top)).filter((f) => f.check === check);

/** A patch cable between MIB ETH and a switch, as a purchased assembly segment. */
function withAssembly() {
  let { project: p, ids } = twoNetProject();
  const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
  p = ops.createNet(sw.project, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`], "uplink").project;
  const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
  const e2 = ops.placeConnector(e1.project, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
  const s = ops.addSegment(e2.project, ids.top, e1.id, e2.id);
  return { p: s.project, ids, patch: s.id };
}

describe("slack-on-assembly", () => {
  it("warns when a purchased assembly segment carries slack", () => {
    let { p, ids, patch } = withAssembly();
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: patch }, 40);
    p = ops.setSegmentAssembly(p, ids.top, patch, "assemblies/rj45-patch-500");
    const found = checks(p, ids.top, "slack-on-assembly");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "warning", target: patch, view: "topology" });
    expect(found[0].message).toContain("40 mm");
  });

  it("warns when a tie point on a purchased assembly carries slack", () => {
    let { p, ids, patch } = withAssembly();
    const tie = ops.addTiePoint(p, ids.top, patch, "ties/zip-tie", 100);
    p = ops.setStretchSlack(tie.project, ids.top, { kind: "tie", id: tie.id }, 15);
    p = ops.setSegmentAssembly(p, ids.top, patch, "assemblies/rj45-patch-500");
    expect(checks(p, ids.top, "slack-on-assembly").map((f) => f.target)).toEqual([tie.id]);
  });

  it("stays quiet for slack on a built segment, and once silenced", () => {
    let { p, ids, patch } = withAssembly();
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: patch }, 40);
    p = ops.setSegmentLength(p, ids.top, patch, 400);
    expect(checks(p, ids.top, "slack-on-assembly")).toEqual([]);
    p = ops.setSegmentAssembly(p, ids.top, patch, "assemblies/rj45-patch-500");
    p = ops.silence(p, "slack-on-assembly", patch);
    expect(checks(p, ids.top, "slack-on-assembly")[0].silenced).toBe(true);
  });
});

describe("slack-exceeds-stretch", () => {
  it("warns when a stretch's slack is more than its routed length, naming the stretch's owner", () => {
    let { project: p, ids } = twoNetProject();
    // 300 mm segment, a clip at 200 mm: stretches of 200 and 100 mm.
    const tie = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 200);
    p = ops.setStretchSlack(tie.project, ids.top, { kind: "tie", id: tie.id }, 200);
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: ids.seg }, 300);
    const found = checks(p, ids.top, "slack-exceeds-stretch");
    expect(found.map((f) => f.target)).toEqual([ids.seg]);
    expect(found[0]).toMatchObject({ severity: "warning", view: "topology" });
    expect(found[0].message).toContain("300 mm");
    expect(found[0].message).toContain("100 mm");
  });

  it("stays quiet for a stretch with no known length", () => {
    let { project: p, ids } = twoNetProject();
    const tie = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 50, ids.mibEnd);
    p = ops.setStretchSlack(tie.project, ids.top, { kind: "tie", id: tie.id }, 900);
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: ids.seg }, 900);
    p = ops.setSegmentLength(p, ids.top, ids.seg, undefined);
    expect(checks(p, ids.top, "slack-exceeds-stretch")).toEqual([]);
  });

  it("is tripped by a harness or project default as well as a stretch's own slack", () => {
    let { project: p, ids } = twoNetProject();
    // 300 mm segment, a clip at 200 mm: stretches of 200 and 100 mm, neither with slack of its own.
    p = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 200).project;
    p = ops.setProjectSlack(p, 150);
    expect(checks(p, ids.top, "slack-exceeds-stretch").map((f) => f.target)).toEqual([ids.seg]);
    const anchor = p.topologies.get(ids.top)!.segments.find((s) => s.id === ids.seg)!.harness!;
    p = ops.setHarnessAnchor(p, ids.top, ids.seg, { ...anchor, slack_mm: 250 });
    expect(checks(p, ids.top, "slack-exceeds-stretch")).toHaveLength(2);
  });

  it("can be silenced", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setStretchSlack(p, ids.top, { kind: "segment", id: ids.seg }, 301);
    p = ops.silence(p, "slack-exceeds-stretch", ids.seg);
    expect(checks(p, ids.top, "slack-exceeds-stretch").map((f) => f.silenced)).toEqual([true]);
  });
});
