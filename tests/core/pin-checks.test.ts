import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { runChecks } from "../../src/core/drc";
import { buildBom } from "../../src/core/bom";
import type { Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

const checks = (p: Project, top?: string) => runChecks(p, top ? p.topologies.get(top) : undefined);
const of = (p: Project, check: string, top?: string) => checks(p, top).filter((f) => f.check === check);

/** A second net, battery 2 to MIB P1, so P1 terminates two nets. */
function sharedConnector() {
  const { project, ids } = twoNetProject();
  const bat2 = ops.placeComponent(project, "components/battery", { x: 0, y: 100 });
  const second = ops.createNet(bat2.project, "24v", [`${bat2.id}/OUT`, `${ids.mib}/P1`], "backup power");
  return { p: second.project, ids: { ...ids, bat2: bat2.id, backup: second.id } };
}

describe("pin-duplicate", () => {
  it("fires across two nets on one connector and names the connector, the pin and both conductors", () => {
    let { p, ids } = sharedConnector();
    const p1 = `${ids.mib}/P1`;
    p = ops.setPin(p, ids.power, p1, 1, 2);
    p = ops.setPin(p, ids.backup, p1, 0, 2);
    const found = of(p, "pin-duplicate");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", target: p1, view: "connectivity" });
    expect(found[0].message).toBe("MIB P1 pin 2 carries battery power conductor 2 and backup power conductor 1");
  });

  it("stays quiet when every conductor has its own pin", () => {
    let { p, ids } = sharedConnector();
    const p1 = `${ids.mib}/P1`;
    p = ops.setPin(p, ids.power, p1, 0, 1);
    p = ops.setPin(p, ids.backup, p1, 0, 2);
    expect(of(p, "pin-duplicate")).toEqual([]);
  });
});

/** A one-off board with a four-pin header, wired to the sensor on 24 V. */
function oneOff() {
  const { project, ids } = twoNetProject();
  const board = ops.placeBlankComponent(project, "Board", { x: 0, y: 200 }, [{ designator: "J9", connector: "connectors/jst-gh-4" }]);
  const net = ops.createNet(board.project, "24v", [`${board.id}/J9`, `${ids.sensor}/J1`], "board sensor");
  return { p: net.project, ids: { ...ids, board: board.id, boardNet: net.id } };
}

describe("pin-out-of-range", () => {
  it("fires for a pin above the connector type's count, once a type change shrinks it", () => {
    let { p, ids } = oneOff();
    const j9 = `${ids.board}/J9`;
    p = ops.setPin(p, ids.boardNet, j9, 0, 4);
    p = ops.setPin(p, ids.boardNet, j9, 1, 1);
    expect(of(p, "pin-out-of-range")).toEqual([]);
    p = ops.setInlineConnectors(p, ids.board, [{ designator: "J9", connector: "connectors/jst-gh-2" }]);
    const found = of(p, "pin-out-of-range");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", target: `${ids.boardNet}:${j9}`, view: "connectivity" });
    expect(found[0].message).toBe("board sensor at Board J9: pin 4 (conductor 1) is above the 2 pins of JST GH 2-pin");
  });

  it("stays quiet when the connector type does not resolve", () => {
    let { p, ids } = oneOff();
    const j9 = `${ids.board}/J9`;
    p = ops.setPin(p, ids.boardNet, j9, 0, 4);
    p = ops.setInlineConnectors(p, ids.board, [{ designator: "J9", connector: "connectors/no-such-type" }]);
    expect(of(p, "pin-out-of-range")).toEqual([]);
    expect(of(p, "dangling-reference").map((f) => f.target)).toContain(j9);
  });
});

/** Route the sensor net too, so the topology has no errors and the BOM exports. */
function complete() {
  let { project: p, ids } = twoNetProject();
  const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`);
  const m = ops.placeConnector(s.project, ids.top, `${ids.mib}/J1`);
  const seg = ops.addSegment(m.project, ids.top, s.id, m.id, 150);
  p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
  return { p, ids };
}

describe("pin-missing", () => {
  it("fires once per connector row with open conductors and lists them", () => {
    let { p, ids } = complete();
    const out = `${ids.bat}/OUT`;
    p = ops.setPin(p, ids.power, out, 0, 1);
    p = ops.numberPinsInOrder(p, ids.power, `${ids.mib}/P1`);
    const found = of(p, "pin-missing", ids.top).filter((f) => f.target.startsWith(`${ids.power}:`));
    expect(found).toEqual([
      { check: "pin-missing", severity: "warning", target: `${ids.power}:${out}`, view: "connectivity", message: "battery power at Battery OUT: conductor 2 has no pin" },
    ]);
    const sensorRows = of(p, "pin-missing", ids.top).filter((f) => f.target.startsWith(`${ids.sig}:`));
    expect(sensorRows.map((f) => f.message)).toEqual(["sensor power at MIB J1: conductors 1, 2 have no pin", "sensor power at Sensor J1: conductors 1, 2 have no pin"]);
  });

  it("fires without a topology too", () => {
    const { p } = complete();
    expect(of(p, "pin-missing")).toHaveLength(4);
  });

  it("one silence covers a row, and a pinless project with the warnings silenced exports clean", () => {
    let { p, ids } = complete();
    const top = p.topologies.get(ids.top)!;
    expect(() => buildBom(p, top)).not.toThrow();
    const rows = of(p, "pin-missing", ids.top);
    expect(rows).toHaveLength(4);
    for (const f of rows) p = ops.silence(p, f.check, f.target);
    expect(of(p, "pin-missing", ids.top).every((f) => f.silenced)).toBe(true);
    const bom = buildBom(p, p.topologies.get(ids.top)!);
    expect(bom.warnings.filter((w) => w.check === "pin-missing")).toEqual([]);
    expect(bom.cutList.some((r) => r.row === "wire")).toBe(true);
  });

  it("stays quiet for a net routed only over purchased assemblies, while duplicates still fire", () => {
    let { p, ids } = complete();
    const sw = ops.placeComponent(p, "components/switch", { x: 300, y: 300 });
    const eth = ops.createNet(sw.project, "ethernet", [`${ids.mib}/ETH`, `${sw.id}/P1`], "uplink");
    const a = ops.placeConnector(eth.project, ids.top, `${ids.mib}/ETH`);
    const b = ops.placeConnector(a.project, ids.top, `${sw.id}/P1`);
    const seg = ops.addSegment(b.project, ids.top, a.id, b.id);
    p = ops.setSegmentAssembly(seg.project, ids.top, seg.id, "assemblies/rj45-patch-500");
    const uplink = (check: string) => of(p, check, ids.top).filter((f) => f.target.startsWith(`${eth.id}:`) || f.target.includes(sw.id) || f.target.includes(`${ids.mib}/ETH`));
    expect(uplink("pin-missing")).toEqual([]);
    p = ops.setPin(p, eth.id, `${sw.id}/P1`, 0, 1);
    p = ops.setPin(p, eth.id, `${sw.id}/P1`, 1, 1);
    expect(uplink("pin-duplicate")).toHaveLength(1);
    // The same net routed over a built segment asks for pins again.
    p = ops.setSegmentAssembly(p, ids.top, seg.id, undefined);
    expect(uplink("pin-missing").map((f) => f.target)).toEqual([`${eth.id}:${ids.mib}/ETH`, `${eth.id}:${sw.id}/P1`]);
  });
});
