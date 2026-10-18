import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { buildBom, cutListCsv } from "../../src/core/bom";
import { findNet, loadProject, saveProject } from "../../src/core/project";
import { loadExample, testLibrary, twoNetProject } from "./fixture";

function netIn(files: Map<string, string>, domain: string, id: string) {
  return JSON.parse(files.get(`nets/${domain}.json`)!).find((n: { id: string }) => n.id === id);
}

/** Route the sensor net too so the topology has no errors. */
function complete() {
  let { project: p, ids } = twoNetProject();
  const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
  p = s.project;
  const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
  p = m.project;
  const seg = ops.addSegment(p, ids.top, s.id, m.id, 150);
  p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
  return { p, ids, sensorEnd: s.id, mibEnd: m.id, sensorSeg: seg.id };
}

describe("pins on a net", () => {
  it("saves on the net in the nets file and loads back unchanged", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 1);
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 1, 2);
    p = ops.setPin(p, ids.power, `${ids.mib}/P1`, 1, 1);
    const files = saveProject(p);
    expect(netIn(files, "48v", ids.power).pins).toEqual({ [`${ids.bat}/OUT`]: [1, 2], [`${ids.mib}/P1`]: [null, 1] });
    const { project: back, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    const again = saveProject(back);
    for (const [path, text] of files) expect(again.get(path), path).toBe(text);
  });

  it("a net with no pin set saves no pins key, and clearing the last pin removes it", () => {
    let { project: p, ids } = twoNetProject();
    expect(netIn(saveProject(p), "48v", ids.power)).not.toHaveProperty("pins");
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 3);
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, undefined);
    expect(netIn(saveProject(p), "48v", ids.power)).not.toHaveProperty("pins");
  });

  it("the example's nets files, saved before pins existed, load and save byte for byte", () => {
    const p = loadExample();
    const files = saveProject(p);
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    for (const [path, text] of files) if (path.startsWith("nets/")) expect(text, path).toBe(readFileSync(`examples/rammp-gen1.5/${path}`, "utf8"));
  });

  it("refuses a pin that is not a whole number from one up", () => {
    const { project: p, ids } = twoNetProject();
    expect(() => ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 0)).toThrow();
    expect(() => ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 1.5)).toThrow();
    expect(() => ops.setPin(p, ids.power, `${ids.bat}/OUT`, 2, 1)).toThrow();
    expect(() => ops.setPin(p, ids.power, `${ids.sensor}/J1`, 0, 1)).toThrow();
  });

  it("number in order fills 1 to n on one row and overwrites what was there", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.setNetConductors(p, ids.power, ["wires/awg12-red", "wires/awg12-black", "wires/awg12-black"]);
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 7);
    p = ops.numberPinsInOrder(p, ids.power, `${ids.bat}/OUT`);
    expect(netIn(saveProject(p), "48v", ids.power).pins).toEqual({ [`${ids.bat}/OUT`]: [1, 2, 3] });
  });

  it("removing a connector from a net drops its pins", () => {
    let { project: p, ids } = twoNetProject();
    const s2 = ops.placeComponent(p, "components/battery", { x: 0, y: 0 });
    p = ops.addConnectorToNet(s2.project, ids.power, `${s2.id}/OUT`);
    p = ops.numberPinsInOrder(p, ids.power, `${s2.id}/OUT`);
    p = ops.numberPinsInOrder(p, ids.power, `${ids.mib}/P1`);
    const before = p;
    p = ops.removeConnectorFromNet(p, ids.power, `${s2.id}/OUT`);
    expect(Object.keys(netIn(saveProject(p), "48v", ids.power).pins)).toEqual([`${ids.mib}/P1`]);
    p = ops.removeComponent(before, s2.id);
    expect(Object.keys(netIn(saveProject(p), "48v", ids.power).pins)).toEqual([`${ids.mib}/P1`]);
  });

  it("shrinking the conductor count trims and growing it pads with empty", () => {
    let { project: p, ids } = twoNetProject();
    const at = `${ids.bat}/OUT`;
    p = ops.numberPinsInOrder(p, ids.power, at);
    p = ops.setNetSpec(p, ids.power, "wires/awg12-red", 1);
    expect(netIn(saveProject(p), "48v", ids.power).pins).toEqual({ [at]: [1] });
    p = ops.setNetSpec(p, ids.power, "wires/awg12-red", 3);
    expect(netIn(saveProject(p), "48v", ids.power).pins).toEqual({ [at]: [1, null, null] });
    p = ops.setNetConductors(p, ids.power, ["wires/awg12-red", "wires/awg12-black"]);
    expect(netIn(saveProject(p), "48v", ids.power).pins).toEqual({ [at]: [1, null] });
  });

  it("a domain change keeps the pins of conductors that still exist", () => {
    let { project: p, ids } = twoNetProject();
    const at = `${ids.bat}/OUT`;
    p = ops.numberPinsInOrder(p, ids.power, at);
    // Analog nets carry two white wires; digital I/O two green ones, SPI four.
    p = ops.moveNetToDomain(p, ids.power, "spi");
    expect(netIn(saveProject(p), "spi", ids.power).pins).toEqual({ [at]: [1, 2, null, null] });
    p = ops.moveNetToDomain(p, ids.power, "gmsl");
    expect(netIn(saveProject(p), "gmsl", ids.power).pins).toEqual({ [at]: [1] });
  });

  it("changing a domain's default count trims the nets that inherit it", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.numberPinsInOrder(p, ids.power, `${ids.bat}/OUT`);
    p = ops.setDomainConductors(p, "48v", ["wires/awg12-red"]);
    expect(netIn(saveProject(p), "48v", ids.power).pins).toEqual({ [`${ids.bat}/OUT`]: [1] });
  });

  it("a cable net's cores take one pin each", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.moveNetToDomain(p, ids.sig, "encoder-abz");
    p = ops.numberPinsInOrder(p, ids.sig, `${ids.sensor}/J1`);
    expect(netIn(saveProject(p), "encoder-abz", ids.sig).pins).toEqual({ [`${ids.sensor}/J1`]: [1, 2, 3, 4, 5, 6] });
    expect(findNet(p, ids.sig)?.net.pins?.[`${ids.sensor}/J1`]).toHaveLength(6);
  });

  it("removing a net takes its pins", () => {
    let { project: p, ids } = twoNetProject();
    p = ops.numberPinsInOrder(p, ids.power, `${ids.bat}/OUT`);
    p = ops.removeNet(p, ids.power);
    expect(saveProject(p).get("nets/48v.json")).not.toContain("pins");
  });
});

describe("pins on the cut list", () => {
  it("a wire row carries the pin at each connector end", () => {
    let { p, ids } = complete();
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 0, 1);
    p = ops.setPin(p, ids.power, `${ids.bat}/OUT`, 1, 2);
    p = ops.setPin(p, ids.power, `${ids.mib}/P1`, 0, 2);
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    const wires = bom.cutList.filter((r) => r.row === "wire" && r.harness === "Power harness");
    expect(wires.map((r) => [r.from, r.from_pin, r.to, r.to_pin])).toEqual([
      ["Battery OUT", 1, "MIB P1", 2],
      ["Battery OUT", 2, "MIB P1", undefined],
    ]);
    const csv = cutListCsv(bom).split("\n");
    expect(csv[0]).toBe("harness,row,ref,part_number,description,color,qty,length_mm,slack_mm,from,from_pin,to,to_pin,net,domain,notes");
    expect(csv).toContain("Power harness,wire,wires/awg12-red,W12R,12 AWG red,red,1,300,0,Battery OUT,1,MIB P1,2,battery power,48v,conductor 1 of 2");
  });

  it("a project with no pins exports with blank pin columns", () => {
    const { p, ids } = complete();
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    expect(bom.cutList.every((r) => r.from_pin === undefined && r.to_pin === undefined)).toBe(true);
  });

  it("a splice end of a wire leg is blank", () => {
    let { p, ids, sensorEnd, mibEnd, sensorSeg } = complete();
    p = ops.removeSegment(p, ids.top, sensorSeg);
    const mid = ops.addEndpoint(p, ids.top, "splice", { x: 0, y: 0 });
    p = mid.project;
    const a1 = ops.addSegment(p, ids.top, mibEnd, mid.id, 100);
    p = ops.setHarnessAnchor(a1.project, ids.top, a1.id, { name: "Sensor harness" });
    p = ops.addSegment(p, ids.top, mid.id, sensorEnd, 200).project;
    p = ops.setSpliceNets(p, ids.top, mid.id, [ids.sig], "splices/solder-sleeve");
    p = ops.numberPinsInOrder(p, ids.sig, `${ids.mib}/J1`);
    p = ops.numberPinsInOrder(p, ids.sig, `${ids.sensor}/J1`);
    const wires = buildBom(p, p.topologies.get(ids.top)!).cutList.filter((r) => r.row === "wire" && r.harness === "Sensor harness");
    expect(wires.map((r) => [r.from, r.from_pin, r.to, r.to_pin, r.length_mm])).toEqual([
      ["MIB J1", 1, `splice ${mid.id}`, undefined, 100],
      ["MIB J1", 2, `splice ${mid.id}`, undefined, 100],
      ["Sensor J1", 1, `splice ${mid.id}`, undefined, 200],
      ["Sensor J1", 2, `splice ${mid.id}`, undefined, 200],
    ]);
  });

  it("a cable row leaves the pin columns blank and lists its core pairs in notes", () => {
    let { p, ids } = complete();
    p = ops.setNetSpec(p, ids.sig, "cables/shielded-6c-24awg", undefined);
    const cable = () => buildBom(p, p.topologies.get(ids.top)!).cutList.find((r) => r.row === "cable")!;
    expect(cable().notes).toBeUndefined();
    p = ops.numberPinsInOrder(p, ids.sig, `${ids.mib}/J1`);
    for (let i = 0; i < 5; i++) p = ops.setPin(p, ids.sig, `${ids.sensor}/J1`, i, 6 - i);
    const row = cable();
    expect([row.from, row.from_pin, row.to, row.to_pin]).toEqual(["MIB J1", undefined, "Sensor J1", undefined]);
    expect(row.notes).toBe("1→6, 2→5, 3→4, 4→3, 5→2, 6→?");
  });
});
