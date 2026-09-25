import { describe, expect, it } from "vitest";
import { arrangeComponents, distributeComponents, placeBlankComponent } from "../../src/core/ops";
import { freshProject } from "./fixture";

function three() {
  let p = freshProject();
  const a = placeBlankComponent(p, "A", { x: 100, y: 50 });
  p = a.project;
  const b = placeBlankComponent(p, "B", { x: 400, y: 200 });
  p = b.project;
  const c = placeBlankComponent(p, "C", { x: 250, y: 20 });
  p = c.project;
  const sizes = { [a.id]: { w: 120, h: 60 }, [b.id]: { w: 180, h: 60 }, [c.id]: { w: 150, h: 90 } };
  return { p, ids: [a.id, b.id, c.id], sizes };
}

describe("arrange", () => {
  it("in a row: left to right in current order, tops aligned to the topmost, one pitch apart", () => {
    const { p, ids, sizes } = three();
    const out = arrangeComponents(p, ids, "row", sizes).connectivityCanvas.components;
    expect(out[ids[0]]).toEqual({ x: 102, y: 18 });
    expect(out[ids[2]]).toEqual({ x: 102 + 120 + 24, y: 18 });
    expect(out[ids[1]]).toEqual({ x: 102 + 120 + 24 + 150 + 24, y: 18 });
  });

  it("in a column: top to bottom in current order, lefts aligned to the leftmost", () => {
    const { p, ids, sizes } = three();
    const out = arrangeComponents(p, ids, "column", sizes).connectivityCanvas.components;
    expect(out[ids[2]]).toEqual({ x: 102, y: 18 });
    expect(out[ids[0]]).toEqual({ x: 102, y: 18 + 90 + 24 });
    expect(out[ids[1]]).toEqual({ x: 102, y: 18 + 90 + 24 + 60 + 24 });
  });

  it("distributes the inner boxes evenly between the outermost, which stay put", () => {
    const { p, ids, sizes } = three();
    const out = distributeComponents(p, ids, sizes).connectivityCanvas.components;
    expect(out[ids[0]]).toEqual({ x: 100, y: 50 });
    expect(out[ids[1]]).toEqual({ x: 400, y: 200 });
    // Span between A's right edge (220) and B's left edge (400) is 180; C is 150 wide, so the gaps are 15 each, snapped.
    expect(out[ids[2]].x).toBe(234);
    expect(out[ids[2]].y).toBe(20);
  });

  it("does nothing with fewer than two, or three for distribute", () => {
    const { p, ids, sizes } = three();
    expect(arrangeComponents(p, [ids[0]], "row", sizes)).toBe(p);
    expect(distributeComponents(p, ids.slice(0, 2), sizes)).toBe(p);
  });
});
