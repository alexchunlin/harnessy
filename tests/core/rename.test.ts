import { describe, expect, it } from "vitest";
import { buildBom, cutListCsv } from "../../src/core/bom";
import { updateDefinitionConnector, updateInlineConnector } from "../../src/core/definitions";
import { addConnectorToNet, addSegment, bendsKey, createNet, movePin, placeBlankComponent, placeComponent, placeConnector, setBends, setHarnessAnchor, setInlineBridges, setPin, silence } from "../../src/core/ops";
import { componentBridges, componentConnectors, findNet, loadProject, pinLayout, saveProject, type Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

/** Two switches from the shared `switch` definition, wired P1 to P1, plus the two-net fixture. */
function switchProject() {
  const { project, ids } = twoNetProject();
  const a = placeComponent(project, "components/switch", { x: 0, y: 200 });
  const b = placeComponent(a.project, "components/switch", { x: 200, y: 200 });
  const net = createNet(b.project, "ethernet", [`${a.id}/P1`, `${b.id}/P1`], "switch trunk");
  return { project: net.project, ids: { ...ids, a: a.id, b: b.id, trunk: net.id } };
}

const net = (p: Project, id: string) => findNet(p, id)!.net;

describe("renaming a connector on a shared definition", () => {
  it("carries the net and its pins on every component sharing the definition", () => {
    const { project, ids } = switchProject();
    let p = setPin(project, ids.trunk, `${ids.a}/P1`, 0, 1);
    p = setPin(p, ids.trunk, `${ids.b}/P1`, 0, 4);
    p = updateDefinitionConnector(p, "switch", "P1", { designator: "UPLINK" });
    expect(net(p, ids.trunk).connectors).toEqual([`${ids.a}/UPLINK`, `${ids.b}/UPLINK`]);
    expect(Object.keys(net(p, ids.trunk).pins!).sort()).toEqual([`${ids.a}/UPLINK`, `${ids.b}/UPLINK`].sort());
    expect(net(p, ids.trunk).pins![`${ids.a}/UPLINK`][0]).toBe(1);
    expect(net(p, ids.trunk).pins![`${ids.b}/UPLINK`][0]).toBe(4);
  });

  it("carries the topology endpoints of every sharing component", () => {
    const { project, ids } = switchProject();
    const a = placeConnector(project, ids.top, `${ids.a}/P1`, { x: 0, y: 200 });
    const b = placeConnector(a.project, ids.top, `${ids.b}/P1`, { x: 300, y: 200 });
    const p = updateDefinitionConnector(addSegment(b.project, ids.top, a.id, b.id, 500).project, "switch", "P1", { designator: "UPLINK" });
    const endpoints = p.topologies.get(ids.top)!.endpoints;
    const at = (id: string) => endpoints.find((e) => e.id === id);
    expect(at(a.id)).toMatchObject({ kind: "connector", connector: `${ids.a}/UPLINK` });
    expect(at(b.id)).toMatchObject({ kind: "connector", connector: `${ids.b}/UPLINK` });
  });

  it("carries the drawn pin order and a star net's hand-placed bends", () => {
    const { project, ids } = switchProject();
    let p = movePin(project, ids.a, "P1", "top", 0);
    p = addConnectorToNet(p, ids.trunk, `${ids.a}/P2`);
    p = setBends(p, bendsKey(ids.trunk, `${ids.a}/P1`), [{ x: 12, y: 24 }]);
    p = updateDefinitionConnector(p, "switch", "P1", { designator: "UPLINK" });
    expect(pinLayout(p, p.components.get(ids.a)!).top).toEqual(["UPLINK"]);
    expect(p.connectivityCanvas.bends[bendsKey(ids.trunk, `${ids.a}/UPLINK`)]).toEqual([{ x: 12, y: 24 }]);
    expect(p.connectivityCanvas.bends[bendsKey(ids.trunk, `${ids.a}/P1`)]).toBeUndefined();
  });
});

describe("refusing a rename", () => {
  it("refuses a designator the definition already has, and one that is not a name", () => {
    const { project } = switchProject();
    expect(() => updateDefinitionConnector(project, "switch", "P1", { designator: "P2" })).toThrow(/already has a connector P2/);
    expect(() => updateDefinitionConnector(project, "switch", "P1", { designator: "P 3" })).toThrow(/letters, digits/);
  });

  it("refuses the same on a one-off", () => {
    const { project } = twoNetProject();
    const board = placeBlankComponent(project, "Brake board", { x: 0, y: 300 }, [
      { designator: "J1", connector: "connectors/jst-gh-2" },
      { designator: "J2", connector: "connectors/jst-gh-2" },
    ]);
    expect(() => updateInlineConnector(board.project, board.id, "J1", { designator: "J2" })).toThrow(/already has a connector J2/);
  });
});

describe("renaming a one-off's connector", () => {
  it("carries that component's wiring and bridges, and leaves the library alone", () => {
    const { project, ids } = twoNetProject();
    const board = placeBlankComponent(project, "Terminal block", { x: 0, y: 300 }, [
      { designator: "T1", connector: "connectors/jst-gh-2" },
      { designator: "T2", connector: "connectors/jst-gh-2" },
    ]);
    let p = setInlineBridges(board.project, board.id, [["T1", "T2"]]);
    p = addConnectorToNet(p, ids.sig, `${board.id}/T1`);
    p = updateInlineConnector(p, board.id, "T1", { designator: "IN" });
    const c = p.components.get(board.id)!;
    expect(componentConnectors(p, c)?.map((x) => x.designator)).toEqual(["IN", "T2"]);
    expect(componentBridges(p, c)).toEqual([["IN", "T2"]]);
    expect(findNet(p, ids.sig)!.net.connectors).toContain(`${board.id}/IN`);
    expect(p.projectLibrary.components.size).toBe(0);
  });
});

describe("renaming a connector named in a definition's bridges", () => {
  it("rewrites the bridge on the definition", () => {
    const { project: base } = twoNetProject();
    const files = saveProject(base);
    files.set("library/components/terminal.json", JSON.stringify({ id: "terminal", name: "Terminal", connectors: [{ designator: "T1", connector: "connectors/xt60" }, { designator: "T2", connector: "connectors/xt60" }], bridges: [["T1", "T2"]] }));
    const placed = placeComponent(loadProject(files, base.repoLibrary).project, "components/terminal", { x: 0, y: 300 });
    const p = updateDefinitionConnector(placed.project, "terminal", "T2", { designator: "OUT" });
    expect(componentBridges(p, p.components.get(placed.id)!)).toEqual([["T1", "OUT"]]);
  });
});

describe("a rename and what reads it", () => {
  it("leaves the cut list as it was but for the designator", () => {
    let { project: p, ids } = twoNetProject();
    const s = placeConnector(p, ids.top, `${ids.sensor}/J1`, { x: 0, y: 100 });
    const m = placeConnector(s.project, ids.top, `${ids.mib}/J1`, { x: 100, y: 100 });
    const seg = addSegment(m.project, ids.top, s.id, m.id, 150);
    p = setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
    const before = cutListCsv(buildBom(p, p.topologies.get(ids.top)!));
    const renamed = updateDefinitionConnector(p, "mib", "J1", { designator: "SENSE" });
    const after = cutListCsv(buildBom(renamed, renamed.topologies.get(ids.top)!));
    expect(before).toContain("MIB J1");
    expect(after).toBe(before.replaceAll("MIB J1", "MIB SENSE"));
  });

  it("keeps a silence on the connector", () => {
    const { project, ids } = switchProject();
    const p = updateDefinitionConnector(silence(project, "connector-idle", `${ids.a}/P2`), "switch", "P2", { designator: "SPARE" });
    expect(p.drc.silences).toEqual([{ check: "connector-idle", target: `${ids.a}/SPARE` }]);
  });
});
