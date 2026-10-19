import { describe, expect, it } from "vitest";
import { tubeLabel } from "../../src/ui/harness3d/model";

/** What the 3D view prints beside each tube: the routed length the topology inspector shows. */

describe("tube label", () => {
  it("shows a placed segment's routed length", () => {
    expect(tubeLabel({ mm: 412, source: "3d" }, 412.4)).toBe("412 mm");
  });

  it("shows an unplaced segment's typed length, not the length of its sketch", () => {
    expect(tubeLabel({ mm: 300, source: "typed" }, 187)).toBe("300 mm");
  });

  it("says so when an unplaced segment has no length typed", () => {
    expect(tubeLabel({ mm: undefined, source: "typed" }, 187)).toBe("no length");
  });

  it("shows a purchased assembly's library length beside its drawn path", () => {
    expect(tubeLabel({ mm: 500, source: "library", pathMm: 640 }, 640.3)).toBe("cable 500 mm, path 640 mm");
    expect(tubeLabel({ mm: 500, source: "library" }, 212.6)).toBe("cable 500 mm, path 213 mm");
  });

  it("follows the drawn curve of a placed segment while a drag is held", () => {
    expect(tubeLabel({ mm: 412, source: "3d" }, 455.6, true)).toBe("456 mm");
  });
});
