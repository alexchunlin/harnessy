import { describe, expect, it } from "vitest";
import { loadProject, saveProject } from "../../src/core/project";
import { loadLibrary } from "../../src/core/library";
import { runChecks } from "../../src/core/drc";
import { testLibrary, twoNetProject } from "./fixture";

describe("loading", () => {
  it("reports a malformed file by path and field and keeps loading", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(project);
    files.set(`components/${ids.sensor}.json`, JSON.stringify({ id: ids.sensor, name: 5, definition: "components/sensor" }));
    const { project: loaded, problems } = loadProject(files, testLibrary());
    expect(problems).toHaveLength(1);
    expect(problems[0].path).toBe(`components/${ids.sensor}.json`);
    expect(problems[0].message).toMatch(/^name:/);
    expect(loaded.components.has(ids.bat)).toBe(true);
    expect(loaded.components.has(ids.sensor)).toBe(false);
  });

  it("refuses a folder without project.json", () => {
    expect(() => loadProject(new Map())).toThrow(/not a project folder/);
  });

  it("loads a project whose definition is missing and lists it as a dangling reference", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(project);
    const lib = testLibrary();
    lib.components.delete("sensor");
    const { project: loaded, problems } = loadProject(files, lib);
    expect(problems).toEqual([]);
    const f = runChecks(loaded, loaded.topologies.get(ids.top));
    expect(f.filter((x) => x.check === "dangling-reference").map((x) => x.target)).toContain(ids.sensor);
  });

  it("a project library file shadows the repo entry whole", () => {
    const { project } = twoNetProject();
    const files = saveProject(project);
    files.set("library/wires/awg12-red.json", JSON.stringify({ id: "awg12-red", name: "Project red", awg: 12, od_mm: 3, ampacity_a: 25, color: "dark red" }));
    const { project: loaded } = loadProject(files, testLibrary());
    expect(loaded.library.wires.get("awg12-red")?.name).toBe("Project red");
    expect(loaded.library.wires.get("awg12-red")?.part_number).toBeUndefined();
    expect(saveProject(loaded).has("library/wires/awg12-red.json")).toBe(true);
  });
});

describe("library loading", () => {
  it("skips a file whose name does not match its id", () => {
    const files = new Map([["library/wires/red.json", JSON.stringify({ id: "awg12-red", name: "r", awg: 12, od_mm: 1, ampacity_a: 1, color: "red" })]]);
    const { library, problems } = loadLibrary(files);
    expect(library.wires.size).toBe(0);
    expect(problems[0].message).toMatch(/does not match id/);
  });
});
