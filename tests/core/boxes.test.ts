import { describe, expect, it } from "vitest";
import * as ops from "../../src/core/ops";
import { layoutTopology } from "../../src/core/layout";
import type { TopologyCanvas } from "../../src/core/schema";
import { saveProject, type Project } from "../../src/core/project";
import { freshProject } from "./fixture";

const EMPTY: TopologyCanvas = { offsets: {}, pieces: {}, roots: [] };

/** A topology to grow by hand, with connectors from MIB components made as needed. */
function bench() {
  let p: Project = freshProject();
  const t = ops.createTopology(p, "Bench");
  p = t.project;
  const top = t.id;
  const free: string[] = [];
  const b = {
    get project() {
      return p;
    },
    set project(next: Project) {
      p = next;
    },
    top,
    connector(): string {
      if (free.length === 0) {
        const c = ops.placeComponent(p, "components/mib", { x: 0, y: 0 });
        p = c.project;
        free.push(...["P1", "J1", "J2", "ETH"].map((d) => `${c.id}/${d}`));
      }
      const r = ops.placeConnector(p, top, free.shift()!);
      p = r.project;
      return r.id;
    },
    point(): string {
      const r = ops.addEndpoint(p, top, "point");
      p = r.project;
      return r.id;
    },
    join(a: string, z: string): string {
      const r = ops.addSegment(p, top, a, z, 100);
      p = r.project;
      return r.id;
    },
    /** A hub with `n` connectors around it. Returns the hub, its connectors and the first segment. */
    star(n: number) {
      const hub = b.point();
      const ends = [hub];
      const segs: string[] = [];
      for (let i = 0; i < n; i++) {
        const c = b.connector();
        ends.push(c);
        segs.push(b.join(hub, c));
      }
      return { hub, ends, segs };
    },
    canvas(): TopologyCanvas {
      return p.topologyCanvases.get(top)!;
    },
    layout(canvas: TopologyCanvas = b.canvas()) {
      return layoutTopology(p, p.topologies.get(top)!, canvas);
    },
  };
  return b;
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (r: Rect, s: Rect) => r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h;
const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

describe("harness boxes", () => {
  it("the box goes around each endpoint where it draws, offset included, not its home", () => {
    const b = bench();
    const { ends } = b.star(2);
    const far = ends[1];
    b.project = ops.setEndpointOffset(b.project, b.top, far, { x: 400, y: 300 });
    const layout = b.layout();
    const box = layout.pieces[0].box!.rect;
    const e = layout.endpoints.get(far)!;
    expect(inside(e.drawn, box)).toBe(true);
    expect(box.x + box.w).toBeGreaterThan(e.home.x + 400);
  });

  it("each harness gets a box around its endpoints with its label and part number; a purchased cable gets none", () => {
    const b = bench();
    const named = b.star(3);
    b.project = ops.setHarnessAnchor(b.project, b.top, named.segs[1], { name: "MIB sensor", part_number: "H-001" });
    const unnamed = b.star(2);
    const [x, y] = [b.connector(), b.connector()];
    const bought = b.join(x, y);
    b.project = ops.setSegmentAssembly(b.project, b.top, bought, "assemblies/rj45-patch-500");

    const out = b.layout();
    const boxOf = (id: string) => out.pieces.find((p) => p.id === id)!.box;
    expect(boxOf(named.segs[0])).toMatchObject({ label: "MIB sensor", partNumber: "H-001" });
    expect(boxOf(unnamed.segs[0])!.label).toMatch(/ to /);
    expect(boxOf(unnamed.segs[0])!.partNumber).toBeUndefined();
    expect(boxOf(bought)).toBeUndefined();
    for (const s of [named, unnamed]) {
      const box = boxOf(s.segs[0])!;
      for (const id of s.ends) expect(inside(out.endpoints.get(id)!.drawn, box.rect), id).toBe(true);
    }
  });

  it("packed boxes never overlap before offsets", () => {
    const b = bench();
    for (let n = 1; n <= 6; n++) b.star(n + 1);
    const boxes = b.layout().pieces.map((p) => p.box!);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i].rect, boxes[j].rect)).toBe(false);
  });

  it("a box offset moves every endpoint of its piece, and its box, by the same amount and leaves the others put", () => {
    const b = bench();
    const moved = b.star(4);
    const still = b.star(3);
    const before = b.layout();
    const after = b.layout({ ...EMPTY, pieces: { [moved.segs[0]]: { offset: { x: 120, y: -45 } } } });
    for (const id of moved.ends) {
      const [p, q] = [before.endpoints.get(id)!, after.endpoints.get(id)!];
      expect(q.drawn).toEqual({ x: p.drawn.x + 120, y: p.drawn.y - 45 });
      // The box moves the home too, so a box drag never reads as an endpoint pulled off its home.
      expect(q.home).toEqual({ x: p.home.x + 120, y: p.home.y - 45 });
    }
    for (const id of still.ends) expect(after.endpoints.get(id)!.drawn).toEqual(before.endpoints.get(id)!.drawn);
    const boxBefore = before.pieces.find((p) => p.id === moved.segs[0])!.box!;
    const boxAfter = after.pieces.find((p) => p.id === moved.segs[0])!.box!;
    expect(boxAfter.rect).toEqual({ ...boxBefore.rect, x: boxBefore.rect.x + 120, y: boxBefore.rect.y - 45 });
    expect(boxAfter.offset).toEqual({ x: 120, y: -45 });
  });
});

describe("saving box offsets", () => {
  it("a saved file drops pieces entries for pieces that no longer exist", () => {
    const b = bench();
    const s = b.star(2);
    const canvas = { ...EMPTY, pieces: { [s.segs[0]]: { offset: { x: 4, y: 4 } }, "seg-gone00": { offset: { x: 9, y: 9 }, turns: 2 } } };
    b.project = { ...b.project, topologyCanvases: new Map([[b.top, canvas]]) };
    const saved = JSON.parse(saveProject(b.project).get(`canvas/${b.top}.json`)!);
    expect(saved.pieces).toEqual({ [s.segs[0]]: { offset: { x: 4, y: 4 } } });
  });
});

describe("box offset ops", () => {
  it("setting a box offset stores it rounded under the piece id, and reset drops the entry", () => {
    const b = bench();
    const s = b.star(2);
    const piece = s.segs[0];
    b.project = ops.setBoxOffset(b.project, b.top, piece, { x: 30.4, y: -12.6 });
    expect(b.canvas().pieces).toEqual({ [piece]: { offset: { x: 30, y: -13 } } });
    b.project = ops.resetBoxOffset(b.project, b.top, piece);
    expect(b.canvas().pieces).toEqual({});
  });

  it("reset keeps a piece's turn", () => {
    const b = bench();
    const piece = b.star(2).segs[0];
    b.project = { ...b.project, topologyCanvases: new Map([[b.top, { ...EMPTY, pieces: { [piece]: { offset: { x: 5, y: 5 }, turns: 1 } } }]]) };
    b.project = ops.resetBoxOffset(b.project, b.top, piece);
    expect(b.canvas().pieces).toEqual({ [piece]: { turns: 1 } });
  });

  it("joining two pieces keeps the larger piece's entry, with its offset", () => {
    const b = bench();
    const big = b.star(4);
    const small = b.star(2);
    b.project = ops.setBoxOffset(b.project, b.top, small.segs[0], { x: 1, y: 1 });
    b.project = ops.setBoxOffset(b.project, b.top, big.segs[0], { x: 200, y: 40 });
    // The big piece's segments sort first, so the joined piece takes its id.
    b.join(small.ends[1], big.hub);
    expect(b.canvas().pieces).toEqual({ [big.segs[0]]: { offset: { x: 200, y: 40 } } });
  });

  it("joining keeps the larger piece's entry even when the smaller one gives the joined piece its id", () => {
    const b = bench();
    const small = b.star(2);
    const big = b.star(4);
    b.project = ops.setBoxOffset(b.project, b.top, small.segs[0], { x: 1, y: 1 });
    b.project = ops.setBoxOffset(b.project, b.top, big.segs[0], { x: 200, y: 40 });
    b.join(small.ends[1], big.hub);
    expect(b.canvas().pieces).toEqual({ [small.segs[0]]: { offset: { x: 200, y: 40 } } });
  });

  it("splitting gives the entry to the part holding the most endpoints", () => {
    const b = bench();
    // A chain: a small star of two connectors, a bridge segment, then a big star of four.
    const small = b.star(2);
    const big = b.star(4);
    const bridge = b.join(small.hub, big.hub);
    b.project = ops.setBoxOffset(b.project, b.top, small.segs[0], { x: 70, y: 0 });
    b.project = ops.removeSegment(b.project, b.top, bridge);
    expect(b.canvas().pieces).toEqual({ [big.segs[0]]: { offset: { x: 70, y: 0 } } });
  });

  it("removing a piece's smallest segment moves its entry to the new piece id", () => {
    const b = bench();
    const s = b.star(3);
    b.project = ops.setBoxOffset(b.project, b.top, s.segs[0], { x: -20, y: 15 });
    b.project = ops.removeSegment(b.project, b.top, s.segs[0]);
    expect(b.canvas().pieces).toEqual({ [s.segs[1]]: { offset: { x: -20, y: 15 } } });
  });

  it("removing an endpoint carries the entry the same way", () => {
    const b = bench();
    const s = b.star(3);
    b.project = ops.setBoxOffset(b.project, b.top, s.segs[0], { x: 9, y: 9 });
    b.project = ops.removeEndpoint(b.project, b.top, s.ends[1]);
    expect(b.canvas().pieces).toEqual({ [s.segs[1]]: { offset: { x: 9, y: 9 } } });
  });
});
