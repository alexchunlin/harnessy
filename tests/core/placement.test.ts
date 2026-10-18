import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { deletedPaths, loadProject, saveProject } from "../../src/core/project";
import { isEndpointPlaced, isSegmentPlaced, isTiePointPlaced } from "../../src/core/placement";
import { testLibrary, twoNetProject } from "./fixture";

describe("the placement file", () => {
  it("round-trips through save and load unchanged, in integers with a stable key order", () => {
    const { project, ids } = twoNetProject();
    const placed = ops.placeParts(project, ids.top, {
      positions: { [ids.mibEnd]: [300.4, 12.6, -40], [ids.batEnd]: [0, 0, 0] },
      rotations: { [ids.mibEnd]: [90.2, 0, -45] },
    });
    const files = saveProject(placed);
    const text = files.get(`canvas/${ids.top}.3d.json`);
    expect(text).toBeDefined();
    const json = JSON.parse(text!);
    expect(Object.keys(json)).toEqual(["positions", "rotations", "ties"]);
    expect(Object.keys(json.positions)).toEqual([ids.batEnd, ids.mibEnd].sort());
    expect(json.positions[ids.mibEnd]).toEqual([300, 13, -40]);
    expect(json.rotations[ids.mibEnd]).toEqual([90, 0, -45]);

    const { project: reloaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    const again = saveProject(reloaded);
    expect([...again.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, body] of files) expect(again.get(path), path).toBe(body);
  });

  it("never reads connectivity.json, reference.json or a placement file as a topology canvas", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [1, 2, 3] } }));
    files.set("canvas/reference.json", JSON.stringify({ photos: [] }));
    const { project: loaded, problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
    expect([...loaded.topologyCanvases.keys()]).toEqual([ids.top]);
    expect(loaded.placements.get(ids.top)?.positions[ids.batEnd]).toEqual([1, 2, 3]);
  });

  it("a topology with no placement writes no file, and an emptied placement drops it", () => {
    const { project, ids } = twoNetProject();
    expect(saveProject(project).has(`canvas/${ids.top}.3d.json`)).toBe(false);
    const placed = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [1, 2, 3] } });
    const emptied = { ...placed, placements: new Map([[ids.top, { positions: {}, rotations: {}, ties: {} }]]) };
    expect(deletedPaths(saveProject(placed), saveProject(emptied))).toEqual([`canvas/${ids.top}.3d.json`]);
  });

  it("a malformed placement file is a file problem and the rest of the project loads", () => {
    const { project, ids } = twoNetProject();
    const files = saveProject(project);
    files.set(`canvas/${ids.top}.3d.json`, JSON.stringify({ positions: { [ids.batEnd]: [1, 2] }, rotations: {}, ties: {} }));
    const { project: loaded, problems } = loadProject(files, testLibrary());
    expect(problems.map((p) => p.path)).toEqual([`canvas/${ids.top}.3d.json`]);
    expect(loaded.placements.size).toBe(0);
    expect(loaded.topologies.has(ids.top)).toBe(true);
  });

  it("a placement for a topology the project lacks loads without a problem", () => {
    const { project } = twoNetProject();
    const files = saveProject(project);
    files.set("canvas/top-zzzzzz.3d.json", JSON.stringify({ positions: { "end-zzzzzz": [1, 2, 3] }, rotations: {}, ties: {} }));
    const { problems } = loadProject(files, testLibrary());
    expect(problems).toEqual([]);
  });
});

describe("place parts", () => {
  it("breakouts, splices and points save a position and no rotation", () => {
    const { project, ids } = twoNetProject();
    const point = ops.growSegment(project, ids.top, ids.mibEnd, { x: 400, y: 0 });
    const breakout = ops.addEndpoint(point.project, ids.top, "breakout", { x: 500, y: 0 });
    const splice = ops.addEndpoint(breakout.project, ids.top, "splice", { x: 600, y: 0 });
    const all = [point.endpoint, breakout.id, splice.id];
    const p = ops.placeParts(splice.project, ids.top, {
      positions: Object.fromEntries(all.map((id) => [id, [1, 2, 3]])),
      rotations: Object.fromEntries([...all, ids.mibEnd].map((id) => [id, [0, 90, 0]])),
    });
    const json = JSON.parse(saveProject(p).get(`canvas/${ids.top}.3d.json`)!);
    expect(Object.keys(json.positions).sort()).toEqual([...all].sort());
    expect(json.rotations).toEqual({ [ids.mibEnd]: [0, 90, 0] });
  });

  it("is one edit: the project before it is untouched, and later calls keep earlier parts", () => {
    const { project, ids } = twoNetProject();
    const first = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [300, 0, 0] }, rotations: { [ids.mibEnd]: [0, 0, 90] } });
    const second = ops.placeParts(first, ids.top, { positions: { [ids.mibEnd]: [310, 5, 0] } });
    expect(project.placements.size).toBe(0);
    expect(first.placements.get(ids.top)?.positions[ids.mibEnd]).toEqual([300, 0, 0]);
    expect(second.placements.get(ids.top)).toEqual({ positions: { [ids.batEnd]: [0, 0, 0], [ids.mibEnd]: [310, 5, 0] }, rotations: { [ids.mibEnd]: [0, 0, 90] }, ties: {} });
  });
});

describe("placed", () => {
  it("an endpoint with a position is placed, and a rotation alone counts for nothing", () => {
    const { project, ids } = twoNetProject();
    expect(isEndpointPlaced(project, ids.top, ids.batEnd)).toBe(false);
    const turned = ops.placeParts(project, ids.top, { rotations: { [ids.batEnd]: [0, 90, 0] } });
    expect(isEndpointPlaced(turned, ids.top, ids.batEnd)).toBe(false);
    const p = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0] } });
    expect(isEndpointPlaced(p, ids.top, ids.batEnd)).toBe(true);
  });

  it("a segment with one placed end is not placed, and with both it is", () => {
    const { project, ids } = twoNetProject();
    const one = ops.placeParts(project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0] } });
    expect(isSegmentPlaced(one, ids.top, ids.seg)).toBe(false);
    const both = ops.placeParts(one, ids.top, { positions: { [ids.mibEnd]: [300, 0, 0] } });
    expect(isSegmentPlaced(both, ids.top, ids.seg)).toBe(true);
  });

  it("a tie point with a position on an unplaced segment is not placed", () => {
    const { project, ids } = twoNetProject();
    const tie = ops.addTiePoint(project, ids.top, ids.seg, "ties/zip-tie", 100, ids.batEnd);
    const p = ops.placeParts(tie.project, ids.top, { positions: { [ids.batEnd]: [0, 0, 0] }, ties: { [tie.id]: [100, 0, 0] } });
    expect(isTiePointPlaced(p, ids.top, tie.id)).toBe(false);
    const placed = ops.placeParts(p, ids.top, { positions: { [ids.mibEnd]: [300, 0, 0] } });
    expect(isTiePointPlaced(placed, ids.top, tie.id)).toBe(true);
  });
});
