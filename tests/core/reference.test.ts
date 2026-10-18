import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { deletedPaths, loadProject, saveProject } from "../../src/core/project";
import { testLibrary, twoNetProject } from "./fixture";

const MODEL = { path: "reference/rammp-frame.step", units: "mm" as const, position: [120, -40, 0] as [number, number, number], rotation: [-90, 0, 45] as [number, number, number] };

describe("the reference model entry", () => {
  it("round-trips through save and load unchanged and is never read as a topology canvas", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(ops.setReferenceModel(project, MODEL));
    expect(JSON.parse(files.get("canvas/reference.json")!)).toEqual({ model: MODEL });

    const { project: loaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    expect(loaded.reference.model).toEqual(MODEL);
    expect([...loaded.topologyCanvases.keys()]).toEqual([ids.top]);
    const again = saveProject(loaded);
    expect([...again.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, body] of files) expect(again.get(path), path).toBe(body);
  });

  it("a project with no model and no photos writes no reference.json, and clearing the model drops it", () => {
    const { project } = twoNetProject();
    expect(saveProject(project).has("canvas/reference.json")).toBe(false);
    const set = ops.setReferenceModel(project, MODEL);
    expect(deletedPaths(saveProject(set), saveProject(ops.clearReferenceModel(set)))).toEqual(["canvas/reference.json"]);
  });

  it("importing again replaces the entry, rounding to whole millimetres and degrees, and keeps the photos", () => {
    const { project } = twoNetProject();
    const withPhotos = { ...project, reference: { photos: [{ path: "reference/bulkhead.jpg" }] } };
    const first = ops.setReferenceModel(withPhotos, MODEL);
    const second = ops.setReferenceModel(first, { path: "reference/rammp-frame-2.glb", units: "m", position: [0.4, 0, -0.6], rotation: [0, 89.6, 0] });
    expect(second.reference).toEqual({ photos: [{ path: "reference/bulkhead.jpg" }], model: { path: "reference/rammp-frame-2.glb", units: "m", position: [0, 0, -1], rotation: [0, 90, 0] } });
    expect(ops.clearReferenceModel(second).reference).toEqual({ photos: [{ path: "reference/bulkhead.jpg" }] });
  });

  it("refuses a model path outside reference/", () => {
    const { project } = twoNetProject();
    expect(() => ops.setReferenceModel(project, { ...MODEL, path: "../frame.step" })).toThrow();
  });

  it("a malformed reference.json is a file problem and the rest of the project loads", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(project);
    files.set("canvas/reference.json", JSON.stringify({ model: { path: "reference/x.step", units: "furlongs", position: [0, 0, 0], rotation: [0, 0, 0] } }));
    const { project: loaded, problems } = loadProject(files, testLibrary());
    expect(problems.map((p) => p.path)).toEqual(["canvas/reference.json"]);
    expect(loaded.reference).toEqual({});
    expect(loaded.topologies.has(ids.top)).toBe(true);
  });
});
