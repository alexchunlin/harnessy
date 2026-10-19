import { describe, expect, it } from "vitest";
import { addConnector, removeConnector, revertDefinition } from "../../src/core/definitions";
import { runChecks } from "../../src/core/drc";
import { addConnectorToNet, addTiePoint, bendsKey, createNet, movePin, numberPinsInOrder, placeBlankComponent, placeComponent, removeConnectorFromNet, setBends, setInlineBridges, setStretchSlack, silence } from "../../src/core/ops";
import { componentConnectors, findNet, loadProject, saveProject, type Project } from "../../src/core/project";
import { savedJson, testLibrary, twoNetProject } from "./fixture";

/** Two switches from the shared `switch` definition, plus the two-net fixture. */
function switchProject() {
  const { project, ids } = twoNetProject();
  const a = placeComponent(project, "components/switch", { x: 0, y: 200 });
  const b = placeComponent(a.project, "components/switch", { x: 200, y: 200 });
  const net = createNet(b.project, "ethernet", [`${a.id}/P1`, `${b.id}/P1`], "switch trunk");
  return { project: net.project, ids: { ...ids, a: a.id, b: b.id, trunk: net.id } };
}

const designators = (p: Project, id: string) => componentConnectors(p, p.components.get(id)!)?.map((c) => c.designator);

describe("removing a connector from a shared definition", () => {
  it("takes it off every sharing component and removes a net left under two connectors", () => {
    const { project, ids } = switchProject();
    const p = removeConnector(project, { kind: "definition", id: "switch" }, "P1");
    expect(designators(p, ids.a)).toEqual(["P2"]);
    expect(designators(p, ids.b)).toEqual(["P2"]);
    // Giving the copy back shows the shared entry as it was.
    expect(designators(revertDefinition(p, "switch"), ids.a)).toEqual(["P1", "P2"]);
    expect(findNet(p, ids.trunk)).toBeUndefined();
  });
});

describe("removing a connector from a net of three", () => {
  it("keeps the net and the other connectors' pins, and drops the removed connector's pins", () => {
    const { project, ids } = switchProject();
    const c = placeComponent(project, "components/mib", { x: 400, y: 200 });
    let p = addConnectorToNet(c.project, ids.trunk, `${c.id}/ETH`);
    for (const end of [`${ids.a}/P1`, `${ids.b}/P1`, `${c.id}/ETH`]) p = numberPinsInOrder(p, ids.trunk, end);
    p = removeConnector(p, { kind: "definition", id: "mib" }, "ETH");
    const net = findNet(p, ids.trunk)!.net;
    expect(net.connectors).toEqual([`${ids.a}/P1`, `${ids.b}/P1`]);
    expect(Object.keys(net.pins ?? {}).sort()).toEqual([`${ids.a}/P1`, `${ids.b}/P1`].sort());
    expect(net.pins?.[`${ids.a}/P1`]?.[0]).toBe(1);
  });
});

describe("removing a connector that is placed in a topology", () => {
  it("takes its endpoints, their segments and the segments' ties and slack, and leaves no dangling reference", () => {
    const { project, ids } = twoNetProject();
    const tie = addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 100);
    let p = setStretchSlack(tie.project, ids.top, { kind: "segment", id: ids.seg }, 20);
    p = setStretchSlack(p, ids.top, { kind: "tie", id: tie.id }, 10);
    p = removeConnector(p, { kind: "definition", id: "battery" }, "OUT");
    const saved = savedJson(p, `topologies/${ids.top}.json`);
    expect(saved.endpoints.map((e: { id: string }) => e.id)).not.toContain(ids.batEnd);
    expect(saved.segments).toEqual([]);
    expect(saved.ties).toEqual([]);
    expect(findNet(p, ids.power)).toBeUndefined();
    expect(runChecks(p, p.topologies.get(ids.top)).filter((f) => f.check === "dangling-reference")).toEqual([]);
  });
});

/** A one-off with three connectors: J1 and J2 bridged, J1, J2 and J3 bridged on another pair of rails. */
function bridgedOneOff() {
  const { project, ids } = twoNetProject();
  const b = placeBlankComponent(project, "Power board", { x: 0, y: 300 }, [
    { designator: "J1", connector: "connectors/xt60" },
    { designator: "J2", connector: "connectors/xt60" },
    { designator: "J3", connector: "connectors/xt60" },
  ]);
  const p = setInlineBridges(b.project, b.id, [["J1", "J2"], ["J1", "J2", "J3"]]);
  return { project: p, ids: { ...ids, board: b.id } };
}

describe("removing a bridged connector", () => {
  it("drops it from its bridges and drops a bridge left under two", () => {
    const { project, ids } = bridgedOneOff();
    const p = removeConnector(project, { kind: "component", id: ids.board }, "J2");
    expect(savedJson(p, `components/${ids.board}.json`).bridges).toEqual([["J1", "J3"]]);
    expect(runChecks(p, undefined).filter((f) => f.check === "dangling-reference")).toEqual([]);
  });

  it("drops the designator from a definition's bridges too", () => {
    const { project, ids } = bridgedOneOff();
    const files = saveProject(project);
    const mib = { ...testLibrary().components.get("mib")!, bridges: [["J1", "J2"]] };
    files.set("library/components/mib.json", JSON.stringify(mib));
    const p = removeConnector(loadProject(files, testLibrary()).project, { kind: "definition", id: "mib" }, "J2");
    expect(savedJson(p, "library/components/mib.json")).not.toHaveProperty("bridges");
    expect(designators(p, ids.mib)).toEqual(["P1", "J1", "ETH"]);
  });
});

describe("removing a connector the canvas has laid out", () => {
  it("drops it from the component's drawn pin order", () => {
    const { project, ids } = bridgedOneOff();
    let p = movePin(project, ids.board, "J3", "top", 0);
    p = removeConnector(p, { kind: "component", id: ids.board }, "J3");
    const layout = savedJson(p, "canvas/connectivity.json").pins[ids.board] ?? {};
    expect(Object.values(layout).flat()).not.toContain("J3");
  });
});

/** The switch trunk grown to a star: two switches, the MIB's ETH and a third switch. */
function starTrunk() {
  const { project, ids } = switchProject();
  const c = placeComponent(project, "components/mib", { x: 400, y: 200 });
  const d = placeComponent(c.project, "components/switch", { x: 600, y: 200 });
  let p = addConnectorToNet(d.project, ids.trunk, `${c.id}/ETH`);
  p = addConnectorToNet(p, ids.trunk, `${d.id}/P1`);
  return { project: p, ids: { ...ids, c: c.id, d: d.id } };
}

describe("removing a connector that has a silenced finding", () => {
  it("forgets the silence, so a connector added back under the same name is checked afresh", () => {
    const { project, ids } = starTrunk();
    const eth = `${ids.c}/ETH`;
    const missing = (p: Project) => runChecks(p, undefined).find((f) => f.check === "pin-missing" && f.target === `${ids.trunk}:${eth}`);
    expect(missing(project)).toBeDefined();
    let p = silence(project, "pin-missing", `${ids.trunk}:${eth}`);
    expect(missing(p)?.silenced).toBe(true);
    p = removeConnector(p, { kind: "definition", id: "mib" }, "ETH");
    p = addConnector(p, { kind: "definition", id: "mib" }, { designator: "ETH", connector: "connectors/rj45" });
    p = addConnectorToNet(p, ids.trunk, eth);
    expect(missing(p)?.silenced).toBeFalsy();
  });
});

describe("removing a connector from a star net", () => {
  const spokes = (p: Project) => Object.keys(JSON.parse(saveProject(p).get("canvas/connectivity.json")!).bends).sort();

  it("keeps the bends on the surviving spokes and drops the removed spoke's", () => {
    const { project, ids } = starTrunk();
    let p = project;
    for (const end of [`${ids.a}/P1`, `${ids.b}/P1`, `${ids.c}/ETH`, `${ids.d}/P1`]) p = setBends(p, bendsKey(ids.trunk, end), [{ x: 10, y: 10 }]);
    p = removeConnector(p, { kind: "definition", id: "mib" }, "ETH");
    expect(spokes(p)).toEqual([`${ids.trunk}:${ids.a}/P1`, `${ids.trunk}:${ids.b}/P1`, `${ids.trunk}:${ids.d}/P1`].sort());
  });

  it("drops every spoke's bends once the net is down to one straight line", () => {
    const { project, ids } = starTrunk();
    let p = removeConnector(project, { kind: "definition", id: "mib" }, "ETH");
    for (const end of [`${ids.a}/P1`, `${ids.b}/P1`, `${ids.d}/P1`]) p = setBends(p, bendsKey(ids.trunk, end), [{ x: 10, y: 10 }]);
    p = removeConnectorFromNet(p, ids.trunk, `${ids.d}/P1`);
    expect(spokes(p)).toEqual([]);
  });
});
