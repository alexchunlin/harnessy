import { expect, test, type Locator } from "@playwright/test";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

/** Pins on the net (#48): set in the net inspector, one field per conductor on each connector row. */

const BUS_BAR = "cmp-22222p";
const NET = "net-22223y";
const MAIN = "cmp-22222k/MAIN";
const IN = "cmp-22222n/IN";

type Net = { id: string; pins?: Record<string, (number | null)[]> };
const values = (fields: Locator) => fields.evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value));
const pinsOf = (v: unknown) => (v as Net[]).find((n) => n.id === NET)?.pins;

test("pin fields take a whole number or empty, number in order fills a row, and each edit is one undo step", async ({ page }) => {
  const folder = await freshExample("pins");
  await openProject(page, folder);
  await canvasSettled(page);

  // The battery lead is a member of the 48 V rail: reach it through the bus bar's inspector.
  await page.locator(`.react-flow__node[data-id="${BUS_BAR}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await pane.locator(".bus-list li", { hasText: "48 V bus via Bus bar" }).click();
  await pane.locator(".bus-members li", { hasText: "MAIN to In-line switch" }).click();
  await expect(pane.locator("h3", { hasText: "Net" })).toBeVisible();

  const main = pane.locator(`.net-connector[data-address="${MAIN}"]`);
  const fields = main.getByRole("textbox");
  await expect(fields).toHaveCount(2);
  await expect(main.locator(".pin-field .muted")).toHaveText(["1", "2"]);
  await expect(main.locator(".pin-field .swatch").first()).toHaveCSS("background-color", "rgb(255, 0, 0)");

  // Letters never reach the field; zero is refused and reverts on blur.
  await fields.nth(0).pressSequentially("a0");
  await expect(fields.nth(0)).toHaveValue("0");
  await expect(fields.nth(0)).toHaveAttribute("aria-invalid", "true");
  await fields.nth(0).blur();
  await expect(fields.nth(0)).toHaveValue("");

  // A typed pin saves on the net when the field commits.
  await fields.nth(1).fill("12");
  await fields.nth(1).press("Enter");
  await waitForFile(folder, "nets/48v.json", (v) => JSON.stringify(pinsOf(v)) === JSON.stringify({ [MAIN]: [null, 12] }));

  // Number in order overwrites the row in one step.
  await main.getByRole("button", { name: "Number in order" }).click();
  await expect.poll(() => values(fields)).toEqual(["1", "2"]);
  await waitForFile(folder, "nets/48v.json", (v) => JSON.stringify(pinsOf(v)) === JSON.stringify({ [MAIN]: [1, 2] }));

  // The other connector's row is its own.
  const into = pane.locator(`.net-connector[data-address="${IN}"]`).getByRole("textbox");
  await expect.poll(() => values(into)).toEqual(["", ""]);

  // One undo takes back the whole numbering, a second the single pin.
  await page.getByTitle("Undo (Cmd/Ctrl+Z)").click();
  await expect.poll(() => values(fields)).toEqual(["", "12"]);
  await page.getByTitle("Undo (Cmd/Ctrl+Z)").click();
  await expect.poll(() => values(fields)).toEqual(["", ""]);
  await waitForFile(folder, "nets/48v.json", (v) => pinsOf(v) === undefined);
});
