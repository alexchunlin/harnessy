import { describe, expect, it } from "vitest";
import { turnSelection } from "../../src/ui/keys";

const canvas = { tagName: "DIV", isContentEditable: false };
const press = (key: string, target: object = canvas, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey", boolean>> = {}) =>
  ({ key, target, metaKey: false, ctrlKey: false, altKey: false, ...mods }) as unknown as KeyboardEvent;

describe("R turns the selection of the view it belongs to", () => {
  const picked = { view: "connectivity" as const, ids: ["cmp-a", "cmp-b"] };

  it("hands back every selected id when R is pressed on the canvas", () => {
    expect(turnSelection(press("r"), picked, "connectivity")).toEqual(["cmp-a", "cmp-b"]);
    expect(turnSelection(press("R"), picked, "connectivity")).toEqual(["cmp-a", "cmp-b"]);
  });

  it("turns nothing when R is typed into a field", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(turnSelection(press("r", { tagName, isContentEditable: false }), picked, "connectivity")).toEqual([]);
    expect(turnSelection(press("r", { tagName: "DIV", isContentEditable: true }), picked, "connectivity")).toEqual([]);
  });

  it("turns nothing when the selection belongs to the other view", () => {
    expect(turnSelection(press("r"), picked, "topology")).toEqual([]);
  });

  it("leaves other keys and R with a modifier alone, so Cmd R still reloads", () => {
    expect(turnSelection(press("t"), picked, "connectivity")).toEqual([]);
    expect(turnSelection(press("r", canvas, { metaKey: true }), picked, "connectivity")).toEqual([]);
    expect(turnSelection(press("r", canvas, { ctrlKey: true }), picked, "connectivity")).toEqual([]);
    expect(turnSelection(press("r", canvas, { altKey: true }), picked, "connectivity")).toEqual([]);
  });
});
