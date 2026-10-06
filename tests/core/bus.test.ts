import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { bridgeProblems, buses, busesThrough, busOf, netLabeller } from "../../src/core/derive";
import { runChecks } from "../../src/core/drc";
import { buildBom } from "../../src/core/bom";
import { componentBridges, findNet, loadProject, netLabel, saveProject, type Project } from "../../src/core/project";
import { ComponentSchema, ComponentDefinitionSchema, NetsFileSchema } from "../../src/core/schema";
import { serialize } from "../../src/core/serialize";
import { loadExample, testLibrary, twoNetProject } from "./fixture";

/**
 * A terminal block bridging T1 to T2, with one 48 V net on each side.
 * The battery and the MIB each carry a net of the bus as well as the
 * fixture's own power net, which shares their connectors without joining.
 */
function bridged() {
  let { project: p, ids } = twoNetProject();
  const tb = ops.placeBlankComponent(p, "Terminal block", { x: 0, y: 0 }, [
    { designator: "T1", connector: "connectors/xt60" },
    { designator: "T2", connector: "connectors/xt60" },
    { designator: "T3", connector: "connectors/xt60" },
  ]);
  p = ops.setInlineBridges(tb.project, tb.id, [["T1", "T2"]]);
  const a = ops.createNet(p, "48v", [`${ids.bat}/OUT`, `${tb.id}/T1`]);
  const b = ops.createNet(a.project, "48v", [`${tb.id}/T2`, `${ids.mib}/P1`]);
  return { p: b.project, ids: { ...ids, tb: tb.id, a: a.id, b: b.id } };
}

const check = (p: Project, id: string) => runChecks(p, undefined).filter((f) => f.check === id);

describe("buses", () => {
  it("joins nets through a bridge and leaves a shared connector alone", () => {
    const { p, ids } = bridged();
    const all = buses(p);
    expect(all).toHaveLength(1);
    expect(all[0].nets.map((n) => n.id).sort()).toEqual([ids.a, ids.b].sort());
    expect(all[0].bridges).toEqual([{ component: ids.tb, designators: ["T1", "T2"] }]);
    expect(all[0].label).toBe("48 V bus via Terminal block");
    expect(busOf(all, ids.power)).toBeUndefined();
    expect(busesThrough(all, ids.tb)).toHaveLength(1);
    expect(busesThrough(all, ids.bat)).toHaveLength(0);
  });

  it("a bridge with one net on it makes no bus", () => {
    let { p, ids } = bridged();
    p = ops.removeNet(p, ids.b);
    expect(buses(p)).toEqual([]);
  });

  it("the name sits on one member net and moves when another is named", () => {
    let { p, ids } = bridged();
    p = ops.setBusName(p, ids.a, "Main rail");
    expect(buses(p)[0].label).toBe("Main rail");
    expect(findNet(p, ids.a)!.net.bus).toBe("Main rail");
    p = ops.setBusName(p, ids.b, "48 V rail");
    expect(findNet(p, ids.a)!.net.bus).toBeUndefined();
    expect(findNet(p, ids.b)!.net.bus).toBe("48 V rail");
    expect(buses(p)[0].name).toBe("48 V rail");
    p = ops.setBusName(p, ids.b, "");
    expect(buses(p)[0].label).toBe("48 V bus via Terminal block");
  });

  it("a one-off component declares bridges beside its connectors; a definition-backed one may not", () => {
    const { p, ids } = bridged();
    expect(componentBridges(p, p.components.get(ids.tb)!)).toEqual([["T1", "T2"]]);
    expect(componentBridges(p, p.components.get(ids.bat)!)).toEqual([]);
    expect(() => ops.setInlineBridges(p, ids.bat, [["OUT"]])).toThrow(/takes its bridges/);
    const parsed = ComponentSchema.safeParse({ id: "cmp-aaaaaa", name: "x", definition: "components/mib", bridges: [["A", "B"]] });
    expect(parsed.success).toBe(false);
  });
});

describe("net labels", () => {
  it("a named net keeps its name; an unnamed one reads as its ends, prefixed with its bus", () => {
    const { p, ids } = bridged();
    const label = netLabeller(p);
    expect(label(findNet(p, ids.power)!.net)).toBe("battery power");
    expect(label(findNet(p, ids.a)!.net)).toBe("48 V bus via Terminal block: Battery OUT to Terminal block T1");
    const off = ops.createNet(p, "24v", [`${ids.mib}/J2`, `${ids.sensor}/J1`]);
    expect(netLabeller(off.project)(findNet(off.project, off.id)!.net)).toBe("MIB J2 to Sensor J1");
    const three = ops.addConnectorToNet(off.project, off.id, `${ids.tb}/T3`);
    expect(netLabel(three, findNet(three, off.id)!.net)).toBe("MIB J2, +2");
  });

  it("the BOM's net column carries the label", () => {
    const { project, ids } = twoNetProject();
    let p = ops.renameNet(project, ids.power, undefined);
    const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    const m = ops.placeConnector(s.project, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    const seg = ops.addSegment(m.project, ids.top, s.id, m.id, 150);
    p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    expect(bom.cutList.filter((r) => r.row === "wire").map((r) => r.net)).toEqual(["Battery OUT to MIB P1", "Battery OUT to MIB P1", "sensor power", "sensor power"]);
  });
});

describe("bridge and bus checks", () => {
  it("a bridge joining two domains is an error", () => {
    let { p, ids } = bridged();
    expect(check(p, "bridge-joins-domains")).toEqual([]);
    p = ops.moveNetToDomain(p, ids.b, "24v");
    const f = check(p, "bridge-joins-domains");
    expect(f.map((x) => x.target)).toEqual([ids.tb]);
    expect(f[0].message).toBe("Terminal block bridges T1, T2, which join nets from 24v and 48v");
  });

  it("a bridge naming a missing designator, or one designator twice, dangles", () => {
    let { p, ids } = bridged();
    p = ops.setInlineBridges(p, ids.tb, [["T1", "T9"], ["T2", "T1"]]);
    expect(bridgeProblems(p, p.components.get(ids.tb)!)).toEqual([
      { designator: "T9", why: "unknown" },
      { designator: "T1", why: "twice" },
    ]);
    const f = check(p, "dangling-reference").filter((x) => x.target === ids.tb);
    expect(f.map((x) => x.message)).toEqual(["Terminal block bridges T9, which it has no connector for", "Terminal block bridges T1, twice; a designator sits in at most one bridge"]);
  });

  it("two names on one bus is an error, as two anchors on one harness are", () => {
    let { p, ids } = bridged();
    p = ops.setBusName(p, ids.a, "Main rail");
    expect(check(p, "bus-two-names")).toEqual([]);
    // Written by hand into the file, bypassing the operation that keeps one anchor.
    const nets = new Map(p.nets);
    nets.set("48v", nets.get("48v")!.map((n) => (n.id === ids.b ? { ...n, bus: "Other rail" } : n)));
    p = { ...p, nets };
    const f = check(p, "bus-two-names");
    expect(f).toHaveLength(1);
    expect(f[0].target).toBe([ids.a, ids.b].sort()[0]);
    expect(f[0].message).toBe("one bus carries 2 names: Main rail, Other rail");
  });
});

describe("files", () => {
  it("bridges and the bus name survive the serializer and the schema generator", () => {
    const { p, ids } = bridged();
    const named = ops.setBusName(p, ids.a, "Main rail");
    const files = saveProject(named);
    const { project: back, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    expect(back.components.get(ids.tb)!.bridges).toEqual([["T1", "T2"]]);
    expect(findNet(back, ids.a)!.net.bus).toBe("Main rail");
    expect(serialize(ComponentDefinitionSchema, { id: "x", name: "X", connectors: [], bridges: [["A", "B"]] })).toContain('"bridges": [');
    expect(serialize(NetsFileSchema, [{ id: "net-aaaaaa", connectors: [], bus: "Main rail" }])).toContain('"bus": "Main rail"');
    for (const [file, path] of [
      ["schemas/library-components.schema.json", ["properties", "bridges"]],
      ["schemas/component.schema.json", ["properties", "bridges"]],
      ["schemas/nets.schema.json", ["items", "properties", "bus"]],
    ] as const) {
      let node: unknown = JSON.parse(readFileSync(file, "utf8"));
      for (const key of path) node = (node as Record<string, unknown>)[key];
      expect(node, file).toBeDefined();
    }
  });
});

describe("the RAMMP example", () => {
  const p = loadExample();
  const all = buses(p);
  const named = (label: string) => all.find((b) => b.label === label);

  it("has a 48 V bus of twelve nets that reaches the battery through the switch, and a CAN bus of three", () => {
    const rail = named("48 V bus via Bus bar")!;
    expect(rail.nets).toHaveLength(12);
    expect(rail.nets.some((n) => n.connectors.includes("cmp-22222k/MAIN"))).toBe(true);
    expect(rail.bridges.map((b) => b.designators.length).sort((a, b) => a - b)).toEqual([2, 11]);
    const can = all.find((b) => b.domain === "can")!;
    expect(can.nets).toHaveLength(3);
    expect(can.label).toBe("CAN bus via RoboClaw L");
    expect(all).toHaveLength(2);
    expect(all.every((b) => b.domain === "48v" || b.domain === "can")).toBe(true);
  });

  it("labels the rail's nets from their ends and reports no new errors", () => {
    const label = netLabeller(p);
    const charge = findNet(p, "net-222242")!.net;
    expect(label(charge)).toBe("Charge");
    expect(label(findNet(p, "net-22223y")!.net)).toBe("48 V bus via Bus bar: 48 V battery + BMS MAIN to In-line switch / fuse IN");
    const findings = runChecks(p, [...p.topologies.values()][0]);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });
});
