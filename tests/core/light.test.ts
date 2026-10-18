import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { topologyLight } from "../../src/core/derive";
import { twoNetProject } from "./fixture";

/** A topology selection lights its counterparts on the connectivity canvas. */
describe("light from a topology selection", () => {
  it("lights a connector endpoint's component and every net ending on that connector", () => {
    const { project, ids } = twoNetProject();
    // MIB P1 ends the battery power net. MIB J1 ends the sensor net and stays dark.
    const light = topologyLight(project, project.topologies.get(ids.top)!, [ids.mibEnd]);
    expect([...light.components]).toEqual([ids.mib]);
    expect([...light.nets]).toEqual([ids.power]);
  });

  it("lights only the connector's own nets when it sits on a bus", () => {
    let { project: p, ids } = twoNetProject();
    const tb = ops.placeBlankComponent(p, "Terminal block", { x: 0, y: 0 }, [
      { designator: "T1", connector: "connectors/xt60" },
      { designator: "T2", connector: "connectors/xt60" },
    ]);
    p = ops.setInlineBridges(tb.project, tb.id, [["T1", "T2"]]);
    const a = ops.createNet(p, "48v", [`${ids.bat}/OUT`, `${tb.id}/T1`]);
    const b = ops.createNet(a.project, "48v", [`${tb.id}/T2`, `${ids.mib}/P1`]);
    const end = ops.placeConnector(b.project, ids.top, `${tb.id}/T1`, { x: 0, y: 200 });
    const light = topologyLight(end.project, end.project.topologies.get(ids.top)!, [end.id]);
    expect([...light.components]).toEqual([tb.id]);
    expect([...light.nets]).toEqual([a.id]);
  });

  it("still lights a net by itself and a segment by the nets routed through it", () => {
    const { project, ids } = twoNetProject();
    const top = project.topologies.get(ids.top)!;
    expect([...topologyLight(project, top, [ids.seg]).nets]).toEqual([ids.power]);
    expect([...topologyLight(project, top, [ids.sig]).nets]).toEqual([ids.sig]);
    expect(topologyLight(project, top, [ids.seg]).components.size).toBe(0);
  });
});
