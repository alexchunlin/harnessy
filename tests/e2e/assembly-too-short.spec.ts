import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canvasSettled, freshExample, openProject } from "./helpers";

/** A 500 mm patch cable placed 800 mm end to end: the design rule panel warns, and the finding opens the 3D view on the segment. */

const PATCH_SEGMENT = "seg-22226q";
const PATCH_ENDS = ["end-22226n", "end-22226p"];

test("a purchased assembly path longer than its cable warns, and the finding opens the 3D view on the segment", async ({ page }) => {
  const folder = await freshExample("assembly-too-short");
  await fs.writeFile(
    path.join(folder, "canvas", "top-222268.3d.json"),
    JSON.stringify({ positions: { [PATCH_ENDS[0]]: [0, 0, 0], [PATCH_ENDS[1]]: [800, 0, 0] }, rotations: {}, ties: {} }) + "\n",
  );
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  await page.getByRole("button", { name: /DRC/ }).click();

  const finding = page.locator(".drc-row", { hasText: "assembly-too-short" });
  await expect(finding).toHaveCount(1);
  await expect(finding).toContainText(`purchased assembly ${PATCH_SEGMENT}: path 800 mm, cable 500 mm`);

  await finding.locator(".drc-jump").click();
  await expect(page.getByRole("button", { name: "3D Harness" })).toHaveClass(/active/);
  await page.locator(".h3d-workspace canvas").waitFor();
  await expect(page.locator(".h3d-panel .h3d-row span").first()).toHaveText(`segment ${PATCH_SEGMENT}`);
  // The cable draws along its placed path with its library length beside it.
  const label = page.locator(`.h3d-label [data-segment="${PATCH_SEGMENT}"]`);
  await expect(label).toHaveAttribute("data-selected", "true");
  await expect(label).toHaveText("cable 500 mm, path 800 mm");
});
