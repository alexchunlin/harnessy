import { describe, expect, it } from "vitest";
import { insertCorner, moveCorner, pathFrom, polyline, shiftRun, simplify, steerableCorners, steerableRuns, type End, type Line } from "../../src/ui/connectivity/orthogonal";

const right: End = { x: 200, y: 42, side: "right" };
const left: End = { x: 400, y: 90, side: "left" };
const facing: Line = { a: right, b: left };

describe("automatic route", () => {
  it("leaves each pin on a stub perpendicular to its side, then a Z between facing pins", () => {
    expect(polyline(facing)).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 300, y: 42 },
      { x: 300, y: 90 },
      { x: 382, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("runs straight when facing pins share a row", () => {
    expect(polyline({ a: right, b: { x: 400, y: 42, side: "left" } })).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 382, y: 42 },
      { x: 400, y: 42 },
    ]);
  });

  it("goes out, across, and back in when pins do not face", () => {
    const a: End = { x: 100, y: 42, side: "left" };
    const b: End = { x: 400, y: 90, side: "right" };
    expect(polyline({ a, b })).toEqual([
      { x: 100, y: 42 },
      { x: 82, y: 42 },
      { x: 82, y: 66 },
      { x: 418, y: 66 },
      { x: 418, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("makes one corner between a horizontal and a vertical pin", () => {
    expect(polyline({ a: right, b: { x: 400, y: 200, side: "top" } })).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 400, y: 42 },
      { x: 400, y: 182 },
      { x: 400, y: 200 },
    ]);
  });

  it("ends at a hub with no stub", () => {
    expect(polyline({ a: { x: 100, y: 42, side: "left" }, b: { x: 300, y: 200 } })).toEqual([
      { x: 100, y: 42 },
      { x: 82, y: 42 },
      { x: 300, y: 42 },
      { x: 300, y: 200 },
    ]);
  });

  it("offsets siblings by the given amount on the middle run", () => {
    expect(polyline({ ...facing, offset: 6 })[2]).toEqual({ x: 306, y: 42 });
    expect(polyline({ ...facing, offset: -6 })[2]).toEqual({ x: 294, y: 42 });
  });
});

describe("hand-placed bends", () => {
  const bends = [
    { x: 300, y: 42 },
    { x: 300, y: 90 },
  ];

  it("stay where they are when a box moves; only the stub stretches", () => {
    const moved: Line = { a: { x: 200, y: 60, side: "right" }, b: left, bends };
    expect(polyline(moved)).toEqual([
      { x: 200, y: 60 },
      { x: 218, y: 60 },
      { x: 300, y: 60 },
      { x: 300, y: 90 },
      { x: 382, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("are joined by extra corners when a stored pair is diagonal", () => {
    const pts = polyline({ ...facing, bends: [{ x: 260, y: 30 }, { x: 330, y: 120 }] });
    for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `run ${i}`).toBe(true);
  });

  it("drop a corner in line with its neighbours, and go back to automatic when nothing else remains", () => {
    expect(simplify({ ...facing, bends: [{ x: 300, y: 42 }, { x: 300, y: 66 }, { x: 300, y: 90 }] })).toBeUndefined();
    const steered = simplify({ ...facing, bends: [{ x: 330, y: 42 }, { x: 330, y: 66 }, { x: 330, y: 90 }] });
    expect(steered).toEqual([{ x: 330, y: 90 }]);
    expect(polyline({ ...facing, bends: steered })).toEqual(polyline({ ...facing, bends: [{ x: 330, y: 42 }, { x: 330, y: 90 }] }));
  });

  it("keep the one corner that makes a detour, and drop a stored corner the automatic ones would place anyway", () => {
    const top: End = { x: 400, y: 200, side: "top" };
    expect(simplify({ a: right, b: top, bends: [{ x: 340, y: 42 }] })).toBeUndefined();
    expect(simplify({ a: right, b: top, bends: [{ x: 300, y: 42 }, { x: 300, y: 120 }] })).toEqual([{ x: 300, y: 120 }]);
  });

  it("a stored corner in line with its neighbours is drawn, so it can be steered, until clean-up", () => {
    const split: Line = { ...facing, bends: [{ x: 300, y: 42 }, { x: 300, y: 60 }, { x: 300, y: 90 }] };
    expect(polyline(split).map((p) => p.y)).toContain(60);
    expect(simplify(split)).toBeUndefined();
  });
});

describe("steering", () => {
  it("lists every run but the stubs, and every corner but pins and stub ends", () => {
    expect(steerableRuns(facing).map((r) => r.run)).toEqual([1, 2, 3]);
    expect(steerableCorners(facing)).toEqual([2, 3]);
    const toHub: Line = { a: { x: 100, y: 42, side: "left" }, b: { x: 300, y: 200 } };
    expect(steerableRuns(toHub).map((r) => r.run)).toEqual([1, 2]);
    expect(steerableCorners(toHub)).toEqual([2]);
  });

  it("shifts a vertical run sideways, snapped to the grid", () => {
    expect(shiftRun(facing, 2, { x: 13, y: 0 })).toEqual([
      { x: 312, y: 42 },
      { x: 312, y: 90 },
    ]);
  });

  it("shifting the run after a stub bends the line at the stub end", () => {
    const bends = shiftRun(facing, 1, { x: 0, y: 24 });
    expect(polyline({ ...facing, bends })).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 218, y: 66 },
      { x: 300, y: 66 },
      { x: 300, y: 90 },
      { x: 382, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("moves a corner and both adjacent runs follow", () => {
    const bends = moveCorner(facing, 2, { x: 331, y: 29 });
    expect(polyline({ ...facing, bends })).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 218, y: 30 },
      { x: 330, y: 30 },
      { x: 330, y: 90 },
      { x: 382, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("a corner dragged back into line disappears on clean-up", () => {
    const bends = moveCorner(facing, 2, { x: 300, y: 42 });
    expect(simplify({ ...facing, bends })).toBeUndefined();
  });

  it("inserts a corner on a run so half of it can be shifted", () => {
    const bends = insertCorner(facing, 2, { x: 999, y: 60 });
    expect(bends).toEqual([
      { x: 300, y: 42 },
      { x: 300, y: 60 },
      { x: 300, y: 90 },
    ]);
    const shifted = shiftRun({ ...facing, bends }, 3, { x: 30, y: 0 });
    expect(polyline({ ...facing, bends: shifted })).toEqual([
      { x: 200, y: 42 },
      { x: 218, y: 42 },
      { x: 300, y: 42 },
      { x: 300, y: 60 },
      { x: 330, y: 60 },
      { x: 330, y: 90 },
      { x: 382, y: 90 },
      { x: 400, y: 90 },
    ]);
  });

  it("refuses to steer a stub", () => {
    expect(shiftRun(facing, 0, { x: 0, y: 50 })).toEqual([
      { x: 300, y: 42 },
      { x: 300, y: 90 },
    ]);
    expect(moveCorner(facing, 1, { x: 0, y: 0 })).toEqual([
      { x: 300, y: 42 },
      { x: 300, y: 90 },
    ]);
  });
});

describe("path", () => {
  it("fillets corners with a radius clamped to half the shorter run", () => {
    const d = pathFrom([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 100 },
    ]);
    expect(d).toBe("M 0 0 L 5 0 Q 10 0 10 5 L 10 100");
  });
});
