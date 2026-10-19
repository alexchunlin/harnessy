import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canvasSettled, freshExample, openProject } from "./helpers";

/** A bundle placed in 3D tighter than its minimum bend radius: the design rule panel warns, and the finding opens the 3D view on the segment. */

const BATTERY_SEGMENT = "seg-22228f";
const BATTERY_ENDS = ["end-22228d", "end-22228e"];

/** Give every wire and cable a minimum bend radius, as project library entries that shadow the repo's. */
async function declareRadius(folder: string, mm: number): Promise<void> {
  for (const kind of ["wires", "cables"]) {
    await fs.mkdir(path.join(folder, "library", kind), { recursive: true });
    for (const name of await fs.readdir(path.join(process.cwd(), "library", kind))) {
      const entry = JSON.parse(await fs.readFile(path.join(process.cwd(), "library", kind, name), "utf8"));
      await fs.writeFile(path.join(folder, "library", kind, name), JSON.stringify({ ...entry, min_bend_radius_mm: mm }, null, 2) + "\n");
    }
  }
}

test("a bend tighter than the bundle allows warns, draws red, and the finding opens the 3D view on the segment", async ({ page }) => {
  const folder = await freshExample("bend-radius");
  await declareRadius(folder, 25);
  // The battery lead's two connectors sit 30 mm apart side by side, both exiting along +X, so the lead turns hard between them.
  await fs.writeFile(
    path.join(folder, "canvas", "top-222268.3d.json"),
    JSON.stringify({ positions: { [BATTERY_ENDS[0]]: [0, 0, 0], [BATTERY_ENDS[1]]: [0, 30, 0] }, rotations: { [BATTERY_ENDS[0]]: [0, 0, 90], [BATTERY_ENDS[1]]: [0, 0, 90] }, ties: {} }) + "\n",
  );
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  await page.getByRole("button", { name: /DRC/ }).click();

  const finding = page.locator(".drc-row", { hasText: "bend-radius" });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText(new RegExp(`segment ${BATTERY_SEGMENT} bends to R \\d+ mm, min 25 mm`));

  await finding.locator(".drc-jump").click();
  await expect(page.getByRole("button", { name: "3D Harness" })).toHaveClass(/active/);
  await page.locator(".h3d-workspace canvas").waitFor();
  // The segment is selected, and its tube carries a stretch drawn red.
  await expect(page.locator(".h3d-panel .h3d-row span").first()).toHaveText(`segment ${BATTERY_SEGMENT}`);
  const label = page.locator(`.h3d-label [data-segment="${BATTERY_SEGMENT}"]`);
  await expect(label).toHaveAttribute("data-tight", /^[1-9]\d*$/);
  await expect(label).toHaveAttribute("data-selected", "true");
  // Other segments draw no red.
  await expect(page.locator(".h3d-label [data-tight]")).toHaveCount(1);

  // Esc lets go of the segment.
  await page.keyboard.press("Escape");
  await expect(page.locator(".h3d-panel .h3d-row span").first()).toHaveText("Nothing selected");
});

test("with all harnesses shown, a segment selected from a finding can have its harness's placement cleared", async ({ page }) => {
  const folder = await freshExample("bend-radius-clear");
  await declareRadius(folder, 25);
  await fs.writeFile(
    path.join(folder, "canvas", "top-222268.3d.json"),
    JSON.stringify({ positions: { [BATTERY_ENDS[0]]: [0, 0, 0], [BATTERY_ENDS[1]]: [0, 30, 0] }, rotations: { [BATTERY_ENDS[0]]: [0, 0, 90], [BATTERY_ENDS[1]]: [0, 0, 90] }, ties: {} }) + "\n",
  );
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  await page.getByRole("button", { name: /DRC/ }).click();
  await page.locator(".drc-row", { hasText: "bend-radius" }).locator(".drc-jump").click();
  await page.locator(".h3d-workspace canvas").waitFor();
  await expect(page.locator(`.h3d-label [data-segment="${BATTERY_SEGMENT}"]`)).toHaveAttribute("data-selected", "true");

  const clear = page.getByRole("button", { name: "Clear placement" });
  await expect(clear).toBeEnabled();
  await clear.click();
  // With the placement gone the lead is a sketch again, so nothing is measured and nothing draws red.
  await expect(page.locator(".h3d-label [data-tight]")).toHaveCount(0);
});
