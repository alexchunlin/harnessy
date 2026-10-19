import { describe, expect, it } from "vitest";
import { stretches } from "../../src/ui/harness3d/model";

/** The red stretches of a tube: its drawn points cut to arc ranges measured from the first point. */

describe("tight stretches of a tube", () => {
  const line: [number, number, number][] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
  ];

  it("cuts each range out of the polyline, with ends where the range ends", () => {
    expect(stretches(line, [[20, 50]])).toEqual([
      [
        [20, 0, 0],
        [50, 0, 0],
      ],
    ]);
    // A range across a corner keeps the corner.
    expect(stretches(line, [[90, 130], [180, 250]])).toEqual([
      [
        [90, 0, 0],
        [100, 0, 0],
        [100, 30, 0],
      ],
      [
        [100, 80, 0],
        [100, 100, 0],
      ],
    ]);
  });

  it("gives nothing with no ranges", () => {
    expect(stretches(line, [])).toEqual([]);
  });
});
