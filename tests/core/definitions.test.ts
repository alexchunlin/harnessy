import { describe, expect, it } from "vitest";
import { addDefinitionConnector, addInlineConnector, revertDefinition, updateDefinitionConnector, updateInlineConnector } from "../../src/core/definitions";
import { runChecks } from "../../src/core/drc";
import { createNet, placeBlankComponent, placeComponent, setPin } from "../../src/core/ops";
import { componentConnectors, deletedPaths, findNet, loadProject, saveProject, type Project } from "../../src/core/project";
import { savedJson, savedLibraryFiles, twoNetProject } from "./fixture";

/** Two switches from the shared `switch` definition, plus the two-net fixture. */
function switchProject() {
  const { project, ids } = twoNetProject();
  const a = placeComponent(project, "components/switch", { x: 0, y: 200 });
  const b = placeComponent(a.project, "components/switch", { x: 200, y: 200 });
  const net = createNet(b.project, "ethernet", [`${a.id}/P1`, `${b.id}/P1`], "switch trunk");
  return { project: net.project, ids: { ...ids, a: a.id, b: b.id, trunk: net.id } };
}

const designators = (p: Project, id: string) => componentConnectors(p, p.components.get(id)!)?.map((c) => c.designator);

describe("adding a connector to a definition", () => {
  it("reaches every component sharing it, through a project copy that leaves the shared library alone", () => {
    const { project, ids } = switchProject();
    const p = addDefinitionConnector(project, "switch", { designator: "P3", connector: "connectors/jst-gh-4" });
    expect(designators(p, ids.a)).toEqual(["P1", "P2", "P3"]);
    expect(designators(p, ids.b)).toEqual(["P1", "P2", "P3"]);
    const saved = savedJson(p, "library/components/switch.json");
    expect(saved.connectors.map((c: { designator: string }) => c.designator)).toEqual(["P1", "P2", "P3"]);
    // Giving the copy back shows the shared entry as it was.
    expect(designators(revertDefinition(p, "switch"), ids.a)).toEqual(["P1", "P2"]);
  });
});

/** A one-off board with one inline connector, beside the two-net fixture. */
function oneOff() {
  const { project } = twoNetProject();
  return placeBlankComponent(project, "Brake board", { x: 0, y: 300 }, [{ designator: "J1", connector: "connectors/jst-gh-2" }]);
}

describe("refusing a duplicate designator", () => {
  it("refuses a new connector whose designator the definition already has", () => {
    const { project } = switchProject();
    expect(() => addDefinitionConnector(project, "switch", { designator: "P2", connector: "connectors/rj45" })).toThrow(/already has a connector P2/);
  });

  it("refuses the same on a one-off, and refuses a designator that is not a name", () => {
    const { project, id } = oneOff();
    expect(() => addInlineConnector(project, id, { designator: "J1", connector: "connectors/xt60" })).toThrow(/already has a connector J1/);
    expect(() => addInlineConnector(project, id, { designator: "J 2", connector: "connectors/xt60" })).toThrow(/letters, digits/);
  });

  it("refuses a type the library does not have", () => {
    const { project } = switchProject();
    expect(() => addDefinitionConnector(project, "switch", { designator: "P3", connector: "connectors/nope" })).toThrow(/no connector type/);
  });
});

describe("adding a connector to a one-off", () => {
  it("adds to that component's inline connectors only", () => {
    const { project, id } = oneOff();
    const p = addInlineConnector(project, id, { designator: "PWR", connector: "connectors/xt60" });
    expect(componentConnectors(p, p.components.get(id)!)).toEqual([
      { designator: "J1", connector: "connectors/jst-gh-2" },
      { designator: "PWR", connector: "connectors/xt60" },
    ]);
    expect(savedLibraryFiles(p)).toEqual([]);
  });
});

describe("retyping a connector", () => {
  it("keeps its pins and reports the ones above a smaller type's count", () => {
    const { project, ids } = switchProject();
    const end = `${ids.a}/P1`;
    let p = setPin(project, ids.trunk, end, 0, 6);
    p = setPin(p, ids.trunk, end, 1, 2);
    expect(runChecks(p, undefined).filter((f) => f.check === "pin-out-of-range")).toEqual([]);
    p = updateDefinitionConnector(p, "switch", "P1", { connector: "connectors/jst-gh-4" });
    expect(findNet(p, ids.trunk)?.net.pins?.[end]?.slice(0, 2)).toEqual([6, 2]);
    const found = runChecks(p, undefined).filter((f) => f.check === "pin-out-of-range");
    expect(found.map((f) => [f.target, f.message])).toEqual([[`${ids.trunk}:${end}`, "switch trunk at Ethernet switch P1: pin 6 (conductor 1) is above the 4 pins of JST GH 4-pin"]]);
  });

  it("retypes a one-off's inline connector", () => {
    const { project, id } = oneOff();
    const p = updateInlineConnector(project, id, "J1", { connector: "connectors/xt60" });
    expect(componentConnectors(p, p.components.get(id)!)).toEqual([{ designator: "J1", connector: "connectors/xt60" }]);
  });
});

describe("giving a project copy back", () => {
  it("restores the shared entry and deletes the project file on save", () => {
    const { project, ids } = switchProject();
    const before = saveProject(project);
    const edited = addDefinitionConnector(project, "switch", { designator: "P3", connector: "connectors/rj45" });
    const p = revertDefinition(edited, "switch");
    expect(designators(p, ids.a)).toEqual(["P1", "P2"]);
    expect(savedLibraryFiles(p)).toEqual([]);
    const after = saveProject(p);
    expect(deletedPaths(saveProject(edited), after)).toEqual(["library/components/switch.json"]);
    expect(after).toEqual(before);
  });

  it("refuses when the project has no copy to give back", () => {
    const { project } = switchProject();
    expect(() => revertDefinition(project, "switch")).toThrow(/no project copy/);
  });

  it("refuses to give back a definition the project authored while components use it", () => {
    const { project: base } = twoNetProject();
    const files = saveProject(base);
    files.set("library/components/brake-board.json", JSON.stringify({ id: "brake-board", name: "Brake board", connectors: [{ designator: "J1", connector: "connectors/xt60" }] }));
    const loaded = loadProject(files, base.repoLibrary).project;
    const placed = placeComponent(loaded, "components/brake-board", { x: 0, y: 300 });
    expect(() => revertDefinition(placed.project, "brake-board")).toThrow(/1 component uses it/);
    const p = revertDefinition(loaded, "brake-board");
    expect(savedLibraryFiles(p)).toEqual([]);
  });
});
