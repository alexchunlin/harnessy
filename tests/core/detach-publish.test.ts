import { describe, expect, it } from "vitest";
import { addDefinitionConnector, detachComponent, publishDefinition } from "../../src/core/definitions";
import { runChecks } from "../../src/core/drc";
import { createNet, placeBlankComponent, placeComponent, setPin } from "../../src/core/ops";
import { componentBridges, componentConnectors, findNet, saveProject, type Project } from "../../src/core/project";
import { twoNetProject } from "./fixture";

/** Two switches from the shared `switch` definition, joined by a pinned trunk net. */
function switchProject() {
  const { project, ids } = twoNetProject();
  const a = placeComponent(project, "components/switch", { x: 0, y: 200 });
  const b = placeComponent(a.project, "components/switch", { x: 200, y: 200 });
  const net = createNet(b.project, "ethernet", [`${a.id}/P1`, `${b.id}/P1`], "switch trunk");
  const p = setPin(net.project, net.id, `${a.id}/P1`, 0, 3);
  return { project: p, ids: { ...ids, a: a.id, b: b.id, trunk: net.id } };
}

const designators = (p: Project, id: string) => componentConnectors(p, p.components.get(id)!)?.map((c) => c.designator);

describe("detaching a component from its definition", () => {
  it("keeps its connectors, nets and pins, and a later definition edit passes it by", () => {
    const { project, ids } = switchProject();
    let p = detachComponent(project, ids.a);
    const saved = JSON.parse(saveProject(p).get(`components/${ids.a}.json`)!);
    expect(saved.definition).toBeUndefined();
    expect(saved.connectors).toEqual([
      { designator: "P1", connector: "connectors/rj45" },
      { designator: "P2", connector: "connectors/rj45" },
    ]);
    expect(findNet(p, ids.trunk)?.net.connectors).toEqual([`${ids.a}/P1`, `${ids.b}/P1`]);
    expect(findNet(p, ids.trunk)?.net.pins?.[`${ids.a}/P1`]?.[0]).toBe(3);
    expect(runChecks(p, undefined).filter((f) => f.check === "dangling-reference")).toEqual([]);

    p = addDefinitionConnector(p, "switch", { designator: "P3", connector: "connectors/rj45" });
    expect(designators(p, ids.a)).toEqual(["P1", "P2"]);
    expect(designators(p, ids.b)).toEqual(["P1", "P2", "P3"]);
  });

  it("refuses a component that is already a one-off", () => {
    const { project, ids } = switchProject();
    const p = detachComponent(project, ids.a);
    expect(() => detachComponent(p, ids.a)).toThrow(/already a one-off/);
  });
});

/** A one-off with two connectors it joins inside itself, wired to the battery by a pinned net. */
function oneOff(name: string) {
  const { project, ids } = twoNetProject();
  const blank = placeBlankComponent(project, name, { x: 0, y: 300 }, [
    { designator: "IN", connector: "connectors/xt60" },
    { designator: "OUT", connector: "connectors/xt60" },
  ]);
  const components = new Map(blank.project.components);
  components.set(blank.id, { ...components.get(blank.id)!, bridges: [["IN", "OUT"]] });
  const net = createNet({ ...blank.project, components }, "48v", [`${ids.bat}/OUT`, `${blank.id}/IN`]);
  return { project: setPin(net.project, net.id, `${blank.id}/IN`, 0, 1), id: blank.id, net: net.id };
}

describe("publishing a one-off as a definition", () => {
  it("writes a project definition with its connectors and bridges, and points the component at it", () => {
    const { project, id, net } = oneOff("Brake board");
    const published = publishDefinition(project, id);
    expect(published.id).toBe("brake-board");
    const p = published.project;
    const files = saveProject(p);
    expect(JSON.parse(files.get("library/components/brake-board.json")!)).toEqual({
      id: "brake-board",
      name: "Brake board",
      connectors: [
        { designator: "IN", connector: "connectors/xt60" },
        { designator: "OUT", connector: "connectors/xt60" },
      ],
      bridges: [["IN", "OUT"]],
    });
    expect(JSON.parse(files.get(`components/${id}.json`)!)).toEqual({ id, name: "Brake board", definition: "components/brake-board" });
    expect(componentBridges(p, p.components.get(id)!)).toEqual([["IN", "OUT"]]);
    expect(findNet(p, net)?.net.pins?.[`${id}/IN`]?.[0]).toBe(1);
    expect(runChecks(p, undefined).filter((f) => f.check === "dangling-reference")).toEqual([]);

    const second = placeComponent(p, "components/brake-board", { x: 200, y: 300 });
    const q = addDefinitionConnector(second.project, "brake-board", { designator: "AUX", connector: "connectors/jst-gh-2" });
    for (const c of [id, second.id]) expect(designators(q, c)).toEqual(["IN", "OUT", "AUX"]);
  });

  it("takes a free id when the name collides, so no library entry is overwritten", () => {
    const { project, id } = oneOff("Switch");
    const first = publishDefinition(project, id);
    expect(first.id).toBe("switch-2");
    expect(first.project.library.components.get("switch")?.name).toBe("Ethernet switch");
    expect(saveProject(first.project).has("library/components/switch.json")).toBe(false);

    const again = placeBlankComponent(first.project, "Switch", { x: 0, y: 400 }, [{ designator: "J1", connector: "connectors/xt60" }]);
    expect(publishDefinition(again.project, again.id).id).toBe("switch-3");
  });

  it("refuses a component that already has a definition", () => {
    const { project, ids } = switchProject();
    expect(() => publishDefinition(project, ids.a)).toThrow(/takes its connectors from components\/switch/);
  });
});
