import { describe, expect, it } from "vitest";
import { removeConnector } from "../../src/core/definitions";
import { runChecks } from "../../src/core/drc";
import { addConnectorToNet, addTiePoint, createNet, movePin, numberPinsInOrder, placeBlankComponent, placeComponent, setInlineBridges, setStretchSlack } from "../../src/core/ops";
import { componentConnectors, findNet, type Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

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
    expect(p.repoLibrary.components.get("switch")?.connectors.map((c) => c.designator)).toEqual(["P1", "P2"]);
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
    const t = p.topologies.get(ids.top)!;
    expect(t.endpoints.map((e) => e.id)).not.toContain(ids.batEnd);
    expect(t.segments).toEqual([]);
    expect(t.ties).toEqual([]);
    expect(findNet(p, ids.power)).toBeUndefined();
    expect(runChecks(p, t).filter((f) => f.check === "dangling-reference")).toEqual([]);
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
    expect(p.components.get(ids.board)?.bridges).toEqual([["J1", "J3"]]);
    expect(runChecks(p, undefined).filter((f) => f.check === "dangling-reference")).toEqual([]);
  });

  it("drops the designator from a definition's bridges too", () => {
    const { project, ids } = bridgedOneOff();
    const lib = project.repoLibrary.components;
    const withBridges = { ...project, library: { ...project.library, components: new Map(project.library.components).set("mib", { ...lib.get("mib")!, bridges: [["J1", "J2"]] }) } };
    const p = removeConnector(withBridges, { kind: "definition", id: "mib" }, "J2");
    expect(p.library.components.get("mib")?.bridges).toBeUndefined();
    expect(designators(p, ids.mib)).toEqual(["P1", "J1", "ETH"]);
  });
});

describe("removing a connector the canvas has laid out", () => {
  it("drops it from the component's drawn pin order", () => {
    const { project, ids } = bridgedOneOff();
    let p = movePin(project, ids.board, "J3", "top", 0);
    p = removeConnector(p, { kind: "component", id: ids.board }, "J3");
    const layout = p.connectivityCanvas.pins[ids.board] ?? {};
    expect(Object.values(layout).flat()).not.toContain("J3");
  });
});
