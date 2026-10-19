import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { freshExample, openProject, readJson, waitForFile } from "./helpers";

/** The reference CAD model is copied into the project and comes back on reload where it was left. */

const REFERENCE = "canvas/reference.json";

/** A 100 mm cube as an OBJ file. */
const CUBE = [
  ...[
    [0, 0, 0],
    [100, 0, 0],
    [100, 100, 0],
    [0, 100, 0],
    [0, 0, 100],
    [100, 0, 100],
    [100, 100, 100],
    [0, 100, 100],
  ].map((v) => `v ${v.join(" ")}`),
  "f 1 2 3 4",
  "f 5 6 7 8",
  "f 1 2 6 5",
  "f 2 3 7 6",
  "f 3 4 8 7",
  "f 4 1 5 8",
].join("\n");

async function open3d(page: Page) {
  if (!(await page.locator(".h3d-workspace canvas").isVisible())) await page.getByRole("button", { name: "3D Harness" }).click();
  await page.locator(".h3d-workspace canvas").waitFor();
}

async function reload(page: Page) {
  await page.reload();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
  await open3d(page);
}

const model = async (folder: string) => ((await readJson(folder, REFERENCE)) as { model: { path: string; units: string; position: number[]; rotation: number[] } }).model;
const panel = (page: Page) => page.locator(".h3d-reference");

test("a reference model imported once is saved in the project and comes back on reload", async ({ page }) => {
  const folder = await freshExample("reference-model");
  await openProject(page, folder);
  await open3d(page);

  // Importing copies the file into reference/ and sets the entry.
  await panel(page).locator("input[type=file]").setInputFiles({ name: "RAMMP Frame.obj", mimeType: "model/obj", buffer: Buffer.from(CUBE) });
  await waitForFile(folder, REFERENCE, (v) => (v as { model?: { path: string } }).model?.path === "reference/rammp-frame.obj");
  expect(await fs.readFile(path.join(folder, "reference/rammp-frame.obj"), "utf8")).toBe(CUBE);
  expect(await model(folder)).toEqual({ path: "reference/rammp-frame.obj", units: "mm", position: [0, 0, 0], rotation: [0, 0, 0] });
  await expect(panel(page)).toContainText("100 × 100 × 100 mm");

  // Changing units is one undo step.
  await panel(page).getByLabel("File units").selectOption("cm");
  await waitForFile(folder, REFERENCE, (v) => (v as { model: { units: string } }).model.units === "cm");
  await expect(panel(page)).toContainText("1000 × 1000 × 1000 mm");
  await page.getByRole("button", { name: "Undo" }).click();
  await waitForFile(folder, REFERENCE, (v) => (v as { model: { units: string } }).model.units === "mm");

  // Centring is one undo step too.
  await panel(page).getByRole("button", { name: "Centre on harness" }).click();
  await waitForFile(folder, REFERENCE, (v) => JSON.stringify((v as { model: { position: number[] } }).model.position) !== "[0,0,0]");
  const centred = await model(folder);
  await page.getByRole("button", { name: "Undo" }).click();
  await waitForFile(folder, REFERENCE, (v) => JSON.stringify((v as { model: { position: number[] } }).model.position) === "[0,0,0]");
  await page.getByRole("button", { name: "Redo" }).click();
  await waitForFile(folder, REFERENCE, (v) => JSON.stringify((v as { model: unknown }).model) === JSON.stringify(centred));

  // Dimness is a browser preference: it survives a reload and leaves the project alone.
  const saved = await fs.readFile(path.join(folder, REFERENCE), "utf8");
  await panel(page).getByLabel("Dimness").fill("0.8");
  await reload(page);
  await expect(panel(page)).toContainText("reference/rammp-frame.obj");
  await expect(panel(page)).toContainText("100 × 100 × 100 mm");
  await expect(panel(page).getByLabel("Dimness")).toHaveValue("0.8");
  await expect(panel(page).getByLabel("File units")).toHaveValue("mm");
  expect(await fs.readFile(path.join(folder, REFERENCE), "utf8")).toBe(saved);

  // The model is shared by every topology: it shows whichever one is active, and Remove clears the entry but keeps the file.
  await panel(page).getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => fs.access(path.join(folder, REFERENCE)).then(() => true, () => false)).toBe(false);
  await fs.access(path.join(folder, "reference/rammp-frame.obj"));
  await page.getByRole("button", { name: "Undo" }).click();
  await waitForFile(folder, REFERENCE, (v) => JSON.stringify((v as { model: unknown }).model) === JSON.stringify(centred));
});

test("a reference model whose file is missing shows a notice naming the path and offers to import again", async ({ page }) => {
  const folder = await freshExample("reference-missing");
  await fs.writeFile(path.join(folder, REFERENCE), JSON.stringify({ model: { path: "reference/gone.step", units: "mm", position: [10, 20, 30], rotation: [-90, 0, 0] } }));
  await openProject(page, folder);
  await open3d(page);
  await expect(panel(page).locator(".error")).toContainText("reference/gone.step");
  await panel(page).locator("input[type=file]").setInputFiles({ name: "frame.obj", mimeType: "model/obj", buffer: Buffer.from(CUBE) });
  // Importing again replaces the entry.
  await waitForFile(folder, REFERENCE, (v) => (v as { model?: { path: string } }).model?.path === "reference/frame.obj");
  await expect(panel(page).locator(".error")).toHaveCount(0);
  await expect(panel(page)).toContainText("100 × 100 × 100 mm");
});
