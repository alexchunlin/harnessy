import { emptyLibrary, type Library } from "../../src/core/library";
import { sequentialIdSource, setIdSource } from "../../src/core/ids";
import { starterProject } from "../../src/core/starter";
import * as ops from "../../src/core/ops";
import type { Project } from "../../src/core/project";

/** A small repo library that covers every spec the starter domains name plus what the tests use. */
export function testLibrary(): Library {
  const lib = emptyLibrary();
  lib.connectors.set("jst-gh-2", { id: "jst-gh-2", name: "JST GH 2-pin", pins: 2, mating: { part_number: "GHR-02V-S", contacts_part_number: "SSHL-002T-P0.2" } });
  lib.connectors.set("jst-gh-4", { id: "jst-gh-4", name: "JST GH 4-pin", pins: 4, mating: { part_number: "GHR-04V-S", contacts_part_number: "SSHL-002T-P0.2" } });
  lib.connectors.set("xt60", { id: "xt60", name: "XT60", pins: 2, mating: { part_number: "XT60H-F" } });
  lib.connectors.set("rj45", { id: "rj45", name: "RJ45", pins: 8, mating: { part_number: "RJ45-PLUG" } });
  lib.wires.set("awg12-red", { id: "awg12-red", name: "12 AWG red", awg: 12, od_mm: 3.5, ampacity_a: 30, color: "red", part_number: "W12R" });
  lib.wires.set("awg18-red", { id: "awg18-red", name: "18 AWG red", awg: 18, od_mm: 2.1, ampacity_a: 10, color: "red", part_number: "W18R" });
  lib.wires.set("awg22-white", { id: "awg22-white", name: "22 AWG white", awg: 22, od_mm: 1.6, ampacity_a: 5, color: "white" });
  lib.wires.set("awg14-black", { id: "awg14-black", name: "14 AWG black", awg: 14, od_mm: 3.0, ampacity_a: 20, color: "black" });
  lib.wires.set("awg26-yellow", { id: "awg26-yellow", name: "26 AWG yellow", awg: 26, od_mm: 1.2, ampacity_a: 2, color: "yellow" });
  lib.wires.set("awg24-blue", { id: "awg24-blue", name: "24 AWG blue", awg: 24, od_mm: 1.4, ampacity_a: 3, color: "blue" });
  lib.wires.set("awg24-green", { id: "awg24-green", name: "24 AWG green", awg: 24, od_mm: 1.4, ampacity_a: 3, color: "green" });
  lib.cables.set("can-twisted-pair-22awg", { id: "can-twisted-pair-22awg", name: "CAN twisted pair", conductors: 2, awg: 22, od_mm: 4, shielded: true, part_number: "CANTP22" });
  lib.cables.set("cat6-utp-24awg", { id: "cat6-utp-24awg", name: "Cat6 UTP", conductors: 8, awg: 24, od_mm: 6, shielded: false, part_number: "CAT6" });
  lib.cables.set("shielded-6c-24awg", { id: "shielded-6c-24awg", name: "6-core shielded", conductors: 6, awg: 24, od_mm: 5, shielded: true });
  lib.cables.set("usb-a-c-2m", { id: "usb-a-c-2m", name: "USB cable", conductors: 4, awg: 28, od_mm: 4, shielded: true });
  lib.cables.set("hdmi-2m", { id: "hdmi-2m", name: "HDMI cable", conductors: 19, awg: 30, od_mm: 6, shielded: true });
  lib.cables.set("fakra-coax", { id: "fakra-coax", name: "FAKRA coax", conductors: 1, awg: 26, od_mm: 3, shielded: true });
  lib.sheaths.set("braid-10", { id: "braid-10", name: "Braided sleeve 10 mm", kind: "braid", id_mm: 10, part_number: "BR10" });
  lib.breakouts.set("y-boot", { id: "y-boot", name: "Y boot", kind: "boot", part_number: "YB1", legs: 3 });
  lib.splices.set("solder-sleeve", { id: "solder-sleeve", name: "Solder sleeve", kind: "solder_sleeve", part_number: "SS1" });
  lib.ties.set("zip-tie", { id: "zip-tie", name: "Zip tie", kind: "zip_tie", part_number: "ZT100" });
  lib.assemblies.set("rj45-patch-500", { id: "rj45-patch-500", name: "Cat6 patch 0.5 m", part_number: "PATCH-05", length_mm: 500, ends: ["connectors/rj45", "connectors/rj45"], cable: "cables/cat6-utp-24awg" });
  lib.components.set("mib", { id: "mib", name: "MIB", connectors: [{ designator: "P1", connector: "connectors/xt60" }, { designator: "J1", connector: "connectors/jst-gh-2" }, { designator: "J2", connector: "connectors/jst-gh-2" }, { designator: "ETH", connector: "connectors/rj45" }] });
  lib.components.set("battery", { id: "battery", name: "Battery", connectors: [{ designator: "OUT", connector: "connectors/xt60" }] });
  lib.components.set("sensor", { id: "sensor", name: "Sensor", connectors: [{ designator: "J1", connector: "connectors/jst-gh-2" }] });
  lib.components.set("switch", { id: "switch", name: "Ethernet switch", connectors: [{ designator: "P1", connector: "connectors/rj45" }, { designator: "P2", connector: "connectors/rj45" }] });
  return lib;
}

export function freshProject(name = "Test"): Project {
  setIdSource(sequentialIdSource());
  return starterProject(name, testLibrary());
}

/**
 * Battery OUT to MIB P1 over 48 V, one segment, 300 mm, named harness.
 * MIB J1 to sensor J1 on 24 V, unrouted until the test places it.
 */
export function twoNetProject() {
  let p = freshProject();
  const bat = ops.placeComponent(p, "components/battery", { x: 0, y: 0 });
  p = bat.project;
  const mib = ops.placeComponent(p, "components/mib", { x: 200, y: 0 });
  p = mib.project;
  const sensor = ops.placeComponent(p, "components/sensor", { x: 400, y: 0 });
  p = sensor.project;
  const power = ops.createNet(p, "48v", [`${bat.id}/OUT`, `${mib.id}/P1`], "battery power");
  p = power.project;
  const sig = ops.createNet(p, "24v", [`${mib.id}/J1`, `${sensor.id}/J1`], "sensor power");
  p = sig.project;
  const top = ops.createTopology(p, "Bench");
  p = top.project;
  const a = ops.placeConnector(p, top.id, `${bat.id}/OUT`, { x: 0, y: 0 });
  p = a.project;
  const b = ops.placeConnector(p, top.id, `${mib.id}/P1`, { x: 300, y: 0 });
  p = b.project;
  const seg = ops.addSegment(p, top.id, a.id, b.id, 300);
  p = seg.project;
  p = ops.setHarnessAnchor(p, top.id, seg.id, { name: "Power harness", part_number: "HRN-001" });
  return { project: p, ids: { bat: bat.id, mib: mib.id, sensor: sensor.id, power: power.id, sig: sig.id, top: top.id, batEnd: a.id, mibEnd: b.id, seg: seg.id } };
}

export function findings(project: Project, topologyId: string) {
  return import("../../src/core/drc").then((m) => m.runChecks(project, project.topologies.get(topologyId)));
}
