import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { buildGraph, harnesses, legsOf, routeOf } from "../../src/core/derive";
import { runChecks } from "../../src/core/drc";
import { findNet } from "../../src/core/project";
import { twoNetProject } from "./fixture";

const checks = (p: ReturnType<typeof twoNetProject>["project"], top: string, check?: string) =>
  runChecks(p, p.topologies.get(top)).filter((f) => !check || f.check === check);

describe("routes and harnesses", () => {
  it("a two-connector net routes itself over the unique path", () => {
    const { project, ids } = twoNetProject();
    const graph = buildGraph(project.topologies.get(ids.top)!);
    const { net } = findNet(project, ids.power)!;
    const route = routeOf(graph, net, "48v");
    expect([...route.segments]).toEqual([ids.seg]);
    expect(route.lengthMm).toBe(300);
    expect(route.unplaced).toEqual([]);
  });

  it("a net whose connector is not placed is unrouted", () => {
    const { project, ids } = twoNetProject();
    const f = checks(project, ids.top, "net-unrouted");
    expect(f.map((x) => x.target)).toEqual([ids.sig]);
  });

  it("a point that gains a third segment becomes a breakout, and drops back when one goes", () => {
    let { project: p, ids } = twoNetProject();
    const grow = ops.growSegment(p, ids.top, ids.mibEnd, { x: 400, y: 0 });
    p = grow.project;
    // mibEnd now has two segments: a connector with degree 2 is an error we do not care about here
    const grow2 = ops.growSegment(p, ids.top, grow.endpoint, { x: 500, y: 50 });
    p = grow2.project;
    const grow3 = ops.growSegment(p, ids.top, grow.endpoint, { x: 500, y: -50 });
    p = grow3.project;
    expect(p.topologies.get(ids.top)!.endpoints.find((e) => e.id === grow.endpoint)?.kind).toBe("breakout");
    p = ops.removeSegment(p, ids.top, grow3.segment);
    expect(p.topologies.get(ids.top)!.endpoints.find((e) => e.id === grow.endpoint)?.kind).toBe("point");
  });

  it("names a harness from an anchor and derives membership", () => {
    const { project, ids } = twoNetProject();
    const hs = harnesses(project, buildGraph(project.topologies.get(ids.top)!));
    expect(hs).toHaveLength(1);
    expect(hs[0].label).toBe("Power harness");
    expect(hs[0].partNumber).toBe("HRN-001");
  });

  it("a split leaves the piece without the anchor unnamed with a fallback label", () => {
    let { project: p, ids } = twoNetProject();
    // Route the sensor net as a separate piece with no anchor
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    p = s.project;
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    p = m.project;
    p = ops.addSegment(p, ids.top, s.id, m.id, 150).project;
    const hs = harnesses(p, buildGraph(p.topologies.get(ids.top)!));
    expect(hs.map((h) => h.label).sort()).toEqual(["MIB J1 to Sensor J1", "Power harness"]);
    expect(checks(p, ids.top, "harness-unnamed")).toHaveLength(1);
    expect(checks(p, ids.top, "net-unrouted")).toHaveLength(0);
  });

  it("joining two named pieces is an error until one anchor is dropped", () => {
    let { project: p, ids } = twoNetProject();
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    p = s.project;
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    p = m.project;
    const seg2 = ops.addSegment(p, ids.top, s.id, m.id, 150);
    p = seg2.project;
    p = ops.setHarnessAnchor(p, ids.top, seg2.id, { name: "Sensor harness" });
    // Join: replace the direct segments with a shared point: bat -> P -> mib, sensor -> P -> mibJ1 is a cycle-free tree if we insert a point on each
    p = ops.removeSegment(p, ids.top, ids.seg);
    p = ops.removeSegment(p, ids.top, seg2.id);
    const hub = ops.addEndpoint(p, ids.top, "breakout", { x: 50, y: 50 });
    p = hub.project;
    const a = ops.addSegment(p, ids.top, ids.batEnd, hub.id, 100);
    p = ops.setHarnessAnchor(a.project, ids.top, a.id, { name: "Power harness" });
    p = ops.addSegment(p, ids.top, hub.id, ids.mibEnd, 100).project;
    const c = ops.addSegment(p, ids.top, hub.id, s.id, 100);
    p = ops.setHarnessAnchor(c.project, ids.top, c.id, { name: "Sensor harness" });
    p = ops.addSegment(p, ids.top, hub.id, m.id, 100).project;
    expect(checks(p, ids.top, "harness-two-anchors")).toHaveLength(1);
    p = ops.setHarnessAnchor(p, ids.top, c.id, undefined);
    expect(checks(p, ids.top, "harness-two-anchors")).toHaveLength(0);
    expect(checks(p, ids.top, "harness-unnamed")).toHaveLength(0);
  });
});

describe("splices and legs", () => {
  function threeWay() {
    let { project: p, ids } = twoNetProject();
    // Add a second sensor on the sensor power net, spliced at a point in the middle
    const s2 = ops.placeComponent(p, "components/sensor", { x: 600, y: 0 }, "Sensor 2");
    p = ops.addConnectorToNet(s2.project, ids.sig, `${s2.id}/J1`);
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 0, y: 100 });
    p = m.project;
    const mid = ops.addEndpoint(p, ids.top, "point", { x: 100, y: 100 });
    p = mid.project;
    const a = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 200, y: 50 });
    p = a.project;
    const b = ops.placeConnector(p, ids.top, `${s2.id}/J1`, { x: 200, y: 150 });
    p = b.project;
    p = ops.addSegment(p, ids.top, m.id, mid.id, 100).project;
    p = ops.addSegment(p, ids.top, mid.id, a.id, 200).project;
    p = ops.addSegment(p, ids.top, mid.id, b.id, 250).project;
    return { p, ids, mid: mid.id, m: m.id, a: a.id, b: b.id, s2: s2.id };
  }

  it("a branch without a splice for the net is an error; converting to a splice listing it clears it", () => {
    let { p, ids, mid } = threeWay();
    expect(checks(p, ids.top, "route-branch-without-splice").map((f) => f.target)).toEqual([mid]);
    // the point became a breakout automatically; a breakout is not a splice
    p = ops.setEndpointKind(p, ids.top, mid, "splice");
    expect(checks(p, ids.top, "route-branch-without-splice")).toHaveLength(1);
    p = ops.setSpliceNets(p, ids.top, mid, [ids.sig], "splices/solder-sleeve");
    expect(checks(p, ids.top, "route-branch-without-splice")).toHaveLength(0);
  });

  it("a splice listing a net whose route does not pass through it is an error", () => {
    let { p, ids, mid } = threeWay();
    p = ops.setEndpointKind(p, ids.top, mid, "splice");
    p = ops.setSpliceNets(p, ids.top, mid, [ids.sig, ids.power]);
    expect(checks(p, ids.top, "splice-net-not-through").map((f) => f.target)).toEqual([mid]);
  });

  it("legs run from each connector to the splice", () => {
    let { p, ids, mid, m, a, b } = threeWay();
    p = ops.setEndpointKind(p, ids.top, mid, "splice");
    p = ops.setSpliceNets(p, ids.top, mid, [ids.sig]);
    const graph = buildGraph(p.topologies.get(ids.top)!);
    const { net } = findNet(p, ids.sig)!;
    const legs = legsOf(graph, routeOf(graph, net, "24v"));
    const byFrom = Object.fromEntries(legs.map((l) => [l.from === mid ? l.to : l.from, l.lengthMm]));
    expect(byFrom).toEqual({ [m]: 100, [a]: 200, [b]: 250 });
  });
});

describe("degree, cycles, lengths, assemblies", () => {
  it("flags a connector with two segments and a cycle", () => {
    let { project: p, ids } = twoNetProject();
    const extra = ops.addSegment(p, ids.top, ids.batEnd, ids.mibEnd, 100);
    p = extra.project;
    const f = checks(p, ids.top);
    expect(f.filter((x) => x.check === "endpoint-degree")).toHaveLength(2);
    expect(f.filter((x) => x.check === "topology-cycle")).toHaveLength(1);
  });

  it("a segment with no length is an error; a purchased assembly takes its length from the library", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setSegmentLength(p, ids.top, ids.seg, undefined);
    expect(checks(p, ids.top, "segment-no-length")).toHaveLength(1);
    const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
    p = sw.project;
    const eth = ops.createNet(p, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`]);
    p = eth.project;
    const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
    p = e1.project;
    const e2 = ops.placeConnector(p, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
    p = e2.project;
    const s = ops.addSegment(p, ids.top, e1.id, e2.id);
    p = ops.setSegmentAssembly(s.project, ids.top, s.id, "assemblies/rj45-patch-500");
    expect(checks(p, ids.top, "segment-no-length").map((f) => f.target)).toEqual([ids.seg]);
    const graph = buildGraph(p.topologies.get(ids.top)!);
    expect(legsOf(graph, routeOf(graph, findNet(p, eth.id)!.net, "ethernet"), () => 500)[0].lengthMm).toBe(500);
    // a lone patch cable is not a harness
    expect(harnesses(p, graph).map((h) => h.label)).toEqual(["Power harness"]);
  });

  it("a purchased assembly must run connector to connector", () => {
    let { project: p, ids } = twoNetProject();
    const g = ops.growSegment(p, ids.top, ids.mibEnd, { x: 500, y: 0 });
    p = ops.setSegmentAssembly(g.project, ids.top, g.segment, "assemblies/rj45-patch-500");
    expect(checks(p, ids.top, "assembly-ends-not-connectors").map((f) => f.target)).toEqual([g.segment]);
  });
});

describe("sheaths, ties, silences, keep apart", () => {
  it("a sheath over a non-contiguous set is an error and its cut length includes overlap", () => {
    let { project: p, ids } = twoNetProject();
    const g = ops.growSegment(p, ids.top, ids.batEnd, { x: -100, y: 0 });
    p = ops.setSegmentLength(g.project, ids.top, g.segment, 50);
    const sh = ops.applySheath(p, ids.top, [g.segment, ids.seg], "sheaths/braid-10", 20);
    p = sh.project;
    expect(checks(p, ids.top, "sheath-not-contiguous")).toHaveLength(0);
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    p = s.project;
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    p = m.project;
    const far = ops.addSegment(p, ids.top, s.id, m.id, 10);
    p = ops.updateSheath(far.project, ids.top, sh.id, { segments: [ids.seg, far.id] });
    const f = checks(p, ids.top);
    expect(f.some((x) => x.check === "sheath-not-contiguous")).toBe(true);
    expect(f.some((x) => x.check === "sheath-spans-harnesses")).toBe(true);
  });

  it("a tie point past its segment is a warning that can be silenced, and the silence is saved", () => {
    let { project: p, ids } = twoNetProject();
    const t = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 400);
    p = t.project;
    expect(checks(p, ids.top, "tie-beyond-segment").map((f) => f.silenced)).toEqual([undefined]);
    p = ops.silence(p, "tie-beyond-segment", t.id);
    expect(checks(p, ids.top, "tie-beyond-segment").map((f) => f.silenced)).toEqual([true]);
    expect(p.drc.silences).toEqual([{ check: "tie-beyond-segment", target: t.id }]);
  });

  it("silencing an error has no effect", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.silence(p, "net-unrouted", ids.sig);
    expect(checks(p, ids.top, "net-unrouted").map((f) => f.silenced)).toEqual([undefined]);
  });

  it("keep_apart pairs sharing a segment warn", () => {
    let { project: p, ids } = twoNetProject();
    // put sensor power on the same segment as battery power by routing MIB J1 -> sensor through the power segment's endpoints
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    p = s.project;
    const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    p = m.project;
    p = ops.removeSegment(p, ids.top, ids.seg);
    const p1 = ops.addEndpoint(p, ids.top, "breakout", { x: 0, y: 0 });
    p = p1.project;
    const p2 = ops.addEndpoint(p, ids.top, "breakout", { x: 0, y: 0 });
    p = p2.project;
    p = ops.addSegment(p, ids.top, ids.batEnd, p1.id, 10).project;
    p = ops.addSegment(p, ids.top, s.id, p1.id, 10).project;
    const shared = ops.addSegment(p, ids.top, p1.id, p2.id, 100);
    p = shared.project;
    p = ops.addSegment(p, ids.top, p2.id, ids.mibEnd, 10).project;
    p = ops.addSegment(p, ids.top, p2.id, m.id, 10).project;
    expect(checks(p, ids.top, "keep-apart")).toHaveLength(0);
    p = ops.setKeepApart(p, [["48v", "24v"]]);
    expect(checks(p, ids.top, "keep-apart").map((f) => f.target)).toEqual([shared.id]);
  });
});

describe("connectivity checks", () => {
  it("idle connectors and components warn; a net with one connector errors", () => {
    let { project: p, ids } = twoNetProject();
    const f = checks(p, ids.top);
    expect(f.filter((x) => x.check === "connector-idle").map((x) => x.target).sort()).toEqual([`${ids.mib}/ETH`, `${ids.mib}/J2`]);
    const lonely = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
    p = lonely.project;
    expect(checks(p, ids.top, "component-idle").map((x) => x.target)).toEqual([lonely.id]);
    p = ops.removeConnectorFromNet(p, ids.sig, `${ids.sensor}/J1`);
    expect(checks(p, ids.top, "net-too-few-connectors").map((x) => x.target)).toEqual([ids.sig]);
  });

  it("removing a component drops nets left with one connector and its topology endpoints", () => {
    let { project: p, ids } = twoNetProject();
    expect(ops.netsOnlyOn(p, ids.bat).map((n) => n.id)).toEqual([ids.power]);
    p = ops.removeComponent(p, ids.bat);
    expect(findNet(p, ids.power)).toBeUndefined();
    expect(p.topologies.get(ids.top)!.endpoints.map((e) => e.id)).toEqual([ids.mibEnd]);
    expect(p.topologies.get(ids.top)!.segments).toEqual([]);
  });

  it("moving a net between domains moves it between files", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.moveNetToDomain(p, ids.sig, "analog");
    expect(findNet(p, ids.sig)?.domain).toBe("analog");
    expect(p.nets.get("24v")).toEqual([]);
  });

  it("the All layer is built in and cannot be deleted or shadowed", () => {
    const { project: p } = twoNetProject();
    expect(ops.visibleLayers(p).at(-1)?.id).toBe("all");
    expect(() => ops.removeLayer(p, "all")).toThrow();
    expect(() => ops.addLayer(p, { id: "all", name: "x", domains: [] })).toThrow();
  });
});
