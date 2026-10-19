import { describe, expect, it } from "vitest";
import { flipComponent, movePin, placeBlankComponent, removeComponent, setPinLayout, turnComponent } from "../../src/core/ops";
import { loadProject, pinLayout, saveProject, type Project } from "../../src/core/project";
import { ComponentDefinitionSchema, type Side } from "../../src/core/schema";
import { serialize } from "../../src/core/serialize";
import { freshProject, loadExample, testLibrary } from "./fixture";

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

describe("turning a component", () => {
  const dcdc = "cmp-22222e";
  // Stands in for the canvas's box geometry: left and right pins set the height, top and bottom pins the width.
  const sizeOf = (sides: Record<Side, string[]>) => ({
    w: Math.max(120, (Math.max(sides.top.length, sides.bottom.length) + 1) * 24),
    h: (sides.top.length ? 36 : 0) + 30 + Math.max(1, sides.left.length, sides.right.length) * 24 + (sides.bottom.length ? 36 : 6),
  });
  const centre = (project: Project) => {
    const pos = project.connectivityCanvas.components[dcdc];
    const size = sizeOf(pinLayout(project, project.components.get(dcdc)!));
    return { x: pos.x + size.w / 2, y: pos.y + size.h / 2 };
  };

  it("turns the DC/DC converter a quarter clockwise: IN on top, OUT4 to OUT1 along the bottom", () => {
    let project = loadExample();
    expect(pinLayout(project, project.components.get(dcdc)!)).toEqual({ left: ["IN"], right: ["OUT1", "OUT2", "OUT3", "OUT4"], top: [], bottom: [] });
    project = turnComponent(project, dcdc, sizeOf);
    expect(pinLayout(project, project.components.get(dcdc)!)).toEqual({ left: [], right: [], top: ["IN"], bottom: ["OUT4", "OUT3", "OUT2", "OUT1"] });
  });

  it("writes the turn under the canvas and leaves the component file alone", () => {
    const before = loadExample();
    const after = turnComponent(before, dcdc, sizeOf);
    expect(saveProject(after).get(`components/${dcdc}.json`)).toBe(saveProject(before).get(`components/${dcdc}.json`));
    expect(JSON.parse(saveProject(after).get("canvas/connectivity.json")!).pins[dcdc]).toEqual({ left: [], right: [], top: ["IN"], bottom: ["OUT4", "OUT3", "OUT2", "OUT1"] });
  });

  it("carries every side round as a rigid body: left to top reversed, top to right, right to bottom reversed, bottom to left", () => {
    let { project, id } = boardProject();
    project = setPinLayout(project, id, { left: ["PWR", "AUX"], top: ["CAM1"], right: ["ETH"], bottom: ["CAM2"] });
    project = turnComponent(project, id, sizeOf);
    expect(pinLayout(project, project.components.get(id)!)).toEqual({ left: ["CAM2"], top: ["AUX", "PWR"], right: ["CAM1"], bottom: ["ETH"] });
  });

  it("comes back to the start after four turns, its centre on the same grid point all the way round", () => {
    const start = loadExample();
    const grid = (v: { x: number; y: number }) => ({ x: Math.round(v.x / 6) * 6, y: Math.round(v.y / 6) * 6 });
    const home = grid(centre(start));
    let project = start;
    for (let i = 0; i < 4; i++) {
      project = turnComponent(project, dcdc, sizeOf);
      expect(grid(centre(project))).toEqual(home);
    }
    expect(pinLayout(project, project.components.get(dcdc)!)).toEqual(pinLayout(start, start.components.get(dcdc)!));
    expect(project.connectivityCanvas.components[dcdc]).toEqual(start.connectivityCanvas.components[dcdc]);
  });
});
