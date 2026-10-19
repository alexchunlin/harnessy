import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { buildBom } from "../../src/core/bom";
import { buildGraph, stretchesOf } from "../../src/core/derive";
import { loadProject, saveProject, type Project } from "../../src/core/project";
import { testLibrary, twoNetProject } from "./fixture";

/** The cut length of the Power harness wires, and the slack each one carries. */
function powerWires(p: Project, top: string) {
  return buildBom(p, p.topologies.get(top)!)
    .cutList.filter((r) => r.harness === "Power harness" && r.row === "wire")
    .map((r) => [r.length_mm, r.slack_mm]);
}

/** Both nets routed: Power harness on a 300 mm segment, Sensor harness on a 150 mm one. */
function complete() {
  let { project: p, ids } = twoNetProject();
  const s = ops.placeConnector(p, ids.top, `${ids.sensor}/J1`);
  p = s.project;
  const m = ops.placeConnector(p, ids.top, `${ids.mib}/J1`);
  p = m.project;
  const seg = ops.addSegment(p, ids.top, s.id, m.id, 150);
  p = ops.setHarnessAnchor(seg.project, ids.top, seg.id, { name: "Sensor harness" });
  return { p, ids, sensorSeg: seg.id };
}

describe("slack defaults on the cut list", () => {
  it("a stretch with no slack of its own takes its harness's default", () => {
    let { p, ids } = complete();
    p = ops.setHarnessAnchor(p, ids.top, ids.seg, { name: "Power harness", slack_mm: 25 });
    expect(powerWires(p, ids.top)).toEqual([
      [325, 25],
      [325, 25],
    ]);
  });

  it("a harness with no default takes the project's, and a harness default wins over it", () => {
    let { p, ids, sensorSeg } = complete();
    p = ops.setProjectSlack(p, 40);
    p = ops.setHarnessAnchor(p, ids.top, sensorSeg, { name: "Sensor harness", slack_mm: 5 });
    expect(powerWires(p, ids.top)).toEqual([
      [340, 40],
      [340, 40],
    ]);
    const sensor = buildBom(p, p.topologies.get(ids.top)!).cutList.filter((r) => r.harness === "Sensor harness" && r.row === "wire");
    expect(sensor.length).toBeGreaterThan(0);
    for (const r of sensor) expect([r.length_mm, r.slack_mm]).toEqual([155, 5]);
  });

  it("a stretch's own slack wins over both defaults, even when it is zero", () => {
    let { p, ids } = complete();
    p = ops.setProjectSlack(p, 40);
    p = ops.setHarnessAnchor(p, ids.top, ids.seg, { name: "Power harness", slack_mm: 25 });
    const t = ops.addTiePoint(p, ids.top, ids.seg, "ties/zip-tie", 100);
    p = ops.setStretchSlack(t.project, ids.top, { kind: "tie", id: t.id }, 0);
    // 0 on the first stretch, the harness's 25 on the second.
    expect(powerWires(p, ids.top)).toEqual([
      [325, 25],
      [325, 25],
    ]);
    const graph = buildGraph(p.topologies.get(ids.top)!);
    const stretches = stretchesOf(p, graph, graph.segments.get(ids.seg)!);
    expect(stretches.map((s) => [s.slackMm, s.inheritedSlackMm])).toEqual([
      [0, 25],
      [undefined, 25],
    ]);
  });

  it("refuses a negative default", () => {
    const { p, ids } = complete();
    expect(() => ops.setProjectSlack(p, -1)).toThrow(/negative/);
    expect(() => ops.setHarnessAnchor(p, ids.top, ids.seg, { name: "Power harness", slack_mm: -1 })).toThrow(/negative/);
  });
});

describe("slack defaults in the files", () => {
  it("save on the anchor and in the project file, and load back unchanged", () => {
    let { p, ids } = complete();
    p = ops.setProjectSlack(p, 40);
    p = ops.setHarnessAnchor(p, ids.top, ids.seg, { name: "Power harness", part_number: "PH-1", slack_mm: 25 });
    const files = saveProject(p);
    expect(JSON.parse(files.get("project.json")!).slack_mm).toBe(40);
    const seg = JSON.parse(files.get(`topologies/${ids.top}.json`)!).segments.find((s: { id: string }) => s.id === ids.seg);
    expect(seg.harness).toEqual({ name: "Power harness", part_number: "PH-1", slack_mm: 25 });
    const { project: reloaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    for (const [path, text] of saveProject(reloaded)) expect(text, path).toBe(files.get(path));
    expect(powerWires(reloaded, ids.top)).toEqual([
      [325, 25],
      [325, 25],
    ]);
  });

  it("a file saved before defaults existed loads, saves and cuts to the same lengths", () => {
    const { p, ids } = complete();
    const files = saveProject(p);
    for (const text of files.values()) expect(text).not.toContain("slack_mm");
    const { project: reloaded } = loadProject(files, testLibrary());
    for (const [path, text] of saveProject(reloaded)) expect(text, path).toBe(files.get(path));
    expect(powerWires(reloaded, ids.top)).toEqual([
      [300, 0],
      [300, 0],
    ]);
  });

  it("a project default set back to zero leaves the project file as it was", () => {
    const { p } = complete();
    const before = saveProject(p).get("project.json");
    expect(saveProject(ops.setProjectSlack(ops.setProjectSlack(p, 40), 0)).get("project.json")).toBe(before);
  });

  it("refuses a negative default in a file", () => {
    const { p } = complete();
    const files = saveProject(p);
    const file = JSON.parse(files.get("project.json")!);
    files.set("project.json", JSON.stringify({ ...file, slack_mm: -5 }));
    expect(() => loadProject(files, testLibrary())).toThrow(/slack_mm/);
  });
});
