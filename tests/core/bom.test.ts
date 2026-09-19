import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { BomBlocked, buildBom, cutListCsv, summaryCsv } from "../../src/core/bom";
import { twoNetProject } from "./fixture";

/** Route the sensor net too so the topology has no errors. */
function complete() {
  let { project: p, ids } = twoNetProject();
  const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
  p = s.project;
  const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
  p = m.project;
  const seg = ops.addSegment(p, ids.top, s.id, m.id, 150);
  p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
  return { p, ids, sensorSeg: seg.id };
}

describe("BOM", () => {
  it("is refused while the topology has design rule errors", () => {
    const { project, ids } = twoNetProject();
    expect(() => buildBom(project, project.topologies.get(ids.top)!)).toThrow(BomBlocked);
  });

  it("emits housing, contacts, and one wire row per conductor per leg, every row carrying its harness", () => {
    const { p, ids } = complete();
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const power = bom.cutList.filter((r) => r.harness === "Power harness");
    expect(power.map((r) => r.row)).toEqual(["housing", "housing", "contacts", "contacts", "wire", "wire"]);
    const wires = power.filter((r) => r.row === "wire");
    expect(wires.every((r) => r.length_mm === 300 && r.color === "red" && r.ref === "wires/awg12-red")).toBe(true);
    expect(wires.map((r) => r.notes)).toEqual(["conductor 1 of 2", "conductor 2 of 2"]);
    expect(wires[0].from).toBe("Battery OUT");
    expect(wires[0].to).toBe("MIB P1");
    const housing = power.find((r) => r.row === "housing" && r.from === "Battery OUT")!;
    expect(housing.part_number).toBe("XT60H-F");
    // XT60 has no contacts part number, so the contacts row has qty 2 and no part number
    const contacts = power.find((r) => r.row === "contacts" && r.from === "MIB P1")!;
    expect(contacts.qty).toBe(2);
    expect(contacts.part_number).toBeUndefined();
    expect(bom.cutList.every((r) => r.harness === "Power harness" || r.harness === "Sensor harness")).toBe(true);
  });

  it("puts a purchased assembly under purchased with no housing or contacts rows", () => {
    let { p, ids } = complete();
    const sw = ops.placeComponent(p, "components/switch", { x: 0, y: 0 });
    p = sw.project;
    const eth = ops.createNet(p, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`], "uplink");
    p = eth.project;
    const e1 = ops.placeConnector(p, ids.top, `${ids.mib}/ETH`, { x: 0, y: 0 });
    p = e1.project;
    const e2 = ops.placeConnector(p, ids.top, `${sw.id}/P1`, { x: 0, y: 0 });
    p = e2.project;
    const s = ops.addSegment(p, ids.top, e1.id, e2.id);
    p = ops.setSegmentAssembly(s.project, ids.top, s.id, "assemblies/rj45-patch-500");
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const purchased = bom.cutList.filter((r) => r.harness === "purchased");
    expect(purchased.map((r) => r.row)).toEqual(["assembly"]);
    expect(purchased[0].length_mm).toBe(500);
    expect(purchased[0].part_number).toBe("PATCH-05");
    expect(bom.cutList.some((r) => r.row === "cable" && r.net === "uplink")).toBe(false);
    expect(bom.cutList.at(-1)?.harness).toBe("purchased");
  });

  it("emits cable rows per net, sheath rows with overlap, tie rows, and the summary sums by reference", () => {
    let { p, ids, sensorSeg } = complete();
    p = ops.setNetSpec(p, ids.sig, "cables/shielded-6c-24awg", undefined);
    const sh = ops.applySheath(p, ids.top, [sensorSeg], "sheaths/braid-10", 30);
    p = sh.project;
    p = ops.addTiePoint(p, ids.top, sensorSeg, "ties/zip-tie", 75).project;
    p = ops.addTiePoint(p, ids.top, sensorSeg, "ties/zip-tie", 120).project;
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const sensor = bom.cutList.filter((r) => r.harness === "Sensor harness");
    expect(sensor.map((r) => r.row)).toEqual(["housing", "housing", "contacts", "contacts", "cable", "sheath", "tie", "tie"]);
    expect(sensor.find((r) => r.row === "cable")?.length_mm).toBe(150);
    expect(sensor.find((r) => r.row === "sheath")?.length_mm).toBe(180);
    expect(sensor.find((r) => r.row === "tie")?.notes).toBe("75 mm from Sensor J1");
    const ties = bom.summary.find((r) => r.harness === "Sensor harness" && r.row === "tie");
    expect(ties?.qty).toBe(2);
    const wire = bom.summary.find((r) => r.harness === "Power harness" && r.row === "wire");
    expect(wire?.qty).toBe(2);
    expect(wire?.length_mm).toBe(600);
  });

  it("emits splice rows per net joined with the conductor count", () => {
    let { p, ids } = complete();
    const s2 = ops.placeComponent(p, "components/sensor", { x: 600, y: 0 }, "Sensor 2");
    p = ops.addConnectorToNet(s2.project, ids.sig, `${s2.id}/J1`);
    const b = ops.placeConnector(p, ids.top, `${s2.id}/J1`, { x: 200, y: 150 });
    p = b.project;
    const sensorEnd = p.topologies.get(ids.top)!.endpoints.find((e) => e.kind === "connector" && e.connector === `${ids.sensor}/J1`)!.id;
    const mibEnd = p.topologies.get(ids.top)!.endpoints.find((e) => e.kind === "connector" && e.connector === `${ids.mib}/J1`)!.id;
    const seg = p.topologies.get(ids.top)!.segments.find((s) => s.ends.includes(sensorEnd))!;
    p = ops.removeSegment(p, ids.top, seg.id);
    const mid = ops.addEndpoint(p, ids.top, "splice", { x: 0, y: 0 });
    p = mid.project;
    const a1 = ops.addSegment(p, ids.top, mibEnd, mid.id, 100);
    p = ops.setHarnessAnchor(a1.project, ids.top, a1.id, { name: "Sensor harness" });
    p = ops.addSegment(p, ids.top, mid.id, sensorEnd, 200).project;
    p = ops.addSegment(p, ids.top, mid.id, b.id, 250).project;
    p = ops.setSpliceNets(p, ids.top, mid.id, [ids.sig], "splices/solder-sleeve");
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const splices = bom.cutList.filter((r) => r.row === "splice");
    expect(splices).toHaveLength(1);
    expect(splices[0].qty).toBe(2);
    expect(splices[0].part_number).toBe("SS1");
    const wires = bom.cutList.filter((r) => r.row === "wire" && r.harness === "Sensor harness");
    expect(wires).toHaveLength(6);
    expect(wires.map((r) => r.length_mm).sort()).toEqual([100, 100, 200, 200, 250, 250]);
  });

  it("writes CSV with a header, quoted cells, and warnings atop the summary", () => {
    let { p, ids } = complete();
    p = ops.renameNet(p, ids.power, 'battery, "main"');
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const csv = cutListCsv(bom);
    expect(csv.split("\n")[0]).toBe("harness,row,ref,part_number,description,color,qty,length_mm,from,to,net,domain,notes");
    expect(csv).toContain('"battery, ""main"""');
    const summary = summaryCsv(bom);
    expect(summary.startsWith("warning,connector-idle,")).toBe(true);
    expect(summary).toContain("\n\nharness,row,ref,part_number,description,qty,length_mm\n");
  });
});
