import { describe, expect, it } from "vitest";
import { flipComponent, movePin, placeBlankComponent, removeComponent, setPinLayout } from "../../src/core/ops";
import { loadProject, pinLayout, saveProject } from "../../src/core/project";
import { ComponentDefinitionSchema } from "../../src/core/schema";
import { serialize } from "../../src/core/serialize";
import { freshProject, testLibrary } from "./fixture";

function boardProject() {
  const p = freshProject();
  const r = placeBlankComponent(p, "Board", { x: 0, y: 0 }, [
    { designator: "PWR", connector: "connectors/xt60", side: "left" },
    { designator: "ETH", connector: "connectors/rj45", side: "right" },
    { designator: "CAM1", connector: "connectors/jst-gh-2", side: "bottom" },
    { designator: "CAM2", connector: "connectors/jst-gh-2", side: "bottom" },
    { designator: "AUX", connector: "connectors/jst-gh-4" },
  ]);
  return { project: r.project, id: r.id };
}

describe("pin layout", () => {
  it("alternates left and right when the definition says nothing", () => {
    const p = freshProject();
    const r = placeBlankComponent(p, "Blank", { x: 0, y: 0 }, [
      { designator: "A", connector: "connectors/xt60" },
      { designator: "B", connector: "connectors/xt60" },
      { designator: "C", connector: "connectors/xt60" },
    ]);
    expect(pinLayout(r.project, r.project.components.get(r.id)!)).toEqual({ left: ["A", "C"], right: ["B"], top: [], bottom: [] });
  });

  it("follows the definition's sides, in list order, with unsided pins alternating by position", () => {
    const { project, id } = boardProject();
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["PWR", "AUX"], right: ["ETH"], top: [], bottom: ["CAM1", "CAM2"] });
  });

  it("moves a pin to another side at an index, and up or down within a side", () => {
    let { project, id } = boardProject();
    project = movePin(project, id, "AUX", "right", 0);
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["PWR"], right: ["AUX", "ETH"], top: [], bottom: ["CAM1", "CAM2"] });
    project = movePin(project, id, "AUX", "right", 1);
    expect(pinLayout(project, project.components.get(id)!).right).toEqual(["ETH", "AUX"]);
    project = movePin(project, id, "CAM2", "top", 0);
    expect(pinLayout(project, project.components.get(id)!)).toMatchObject({ top: ["CAM2"], bottom: ["CAM1"] });
  });

  it("flips: horizontal swaps left and right and mirrors the top and bottom order; vertical the other way round", () => {
    let { project, id } = boardProject();
    project = flipComponent(project, id, "horizontal");
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["ETH"], right: ["PWR", "AUX"], top: [], bottom: ["CAM2", "CAM1"] });
    project = flipComponent(project, id, "vertical");
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["ETH"], right: ["AUX", "PWR"], top: ["CAM2", "CAM1"], bottom: [] });
  });

  it("keeps the arrangement as layout under the canvas, never in the component file", () => {
    let { project, id } = boardProject();
    project = flipComponent(project, id, "horizontal");
    const files = saveProject(project);
    expect(files.get(`components/${id}.json`)).not.toContain('"pins"');
    const canvas = JSON.parse(files.get("canvas/connectivity.json")!);
    expect(canvas.pins[id]).toEqual({ left: ["ETH"], right: ["PWR", "AUX"], top: [], bottom: ["CAM2", "CAM1"] });
    const { project: reloaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    expect(pinLayout(reloaded, reloaded.components.get(id)!)).toEqual(pinLayout(project, project.components.get(id)!));
    expect(saveProject(reloaded).get("canvas/connectivity.json")).toBe(files.get("canvas/connectivity.json"));
  });

  it("ignores designators the definition no longer has and appends new ones on their default side", () => {
    let { project, id } = boardProject();
    project = setPinLayout(project, id, { left: ["GONE", "ETH"], right: [], top: ["PWR"], bottom: [] });
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["ETH", "AUX"], right: [], top: ["PWR"], bottom: ["CAM1", "CAM2"] });
  });

  it("drops the arrangement with the component", () => {
    let { project, id } = boardProject();
    project = flipComponent(project, id, "vertical");
    project = removeComponent(project, id);
    expect(project.connectivityCanvas.pins[id]).toBeUndefined();
  });

  it("round-trips a definition connector's side through the library serializer", () => {
    const def = { id: "board", name: "Board", connectors: [{ designator: "PWR", connector: "connectors/xt60", side: "left" as const }] };
    const text = serialize(ComponentDefinitionSchema, def);
    expect(JSON.parse(text).connectors[0].side).toBe("left");
    expect(ComponentDefinitionSchema.parse(JSON.parse(text))).toEqual(def);
  });
});
