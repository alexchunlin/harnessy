import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { freshExample, openProject, waitForFile } from "./helpers";

/** The 3D view: a part dragged there is saved to the topology's placement file and comes back on reload. */

const PLACEMENT = "canvas/top-222268.3d.json";
type Vec3 = [number, number, number];
interface Shown {
  connectors: Record<string, { position: Vec3; rotation_deg: Vec3 }>;
  points: Record<string, Vec3>;
}

/** Every file in the project folder, by path. */
async function snapshot(folder: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of (await fs.readdir(folder, { recursive: true })) as string[]) {
    const full = path.join(folder, rel);
    if ((await fs.stat(full)).isFile()) out.set(rel, await fs.readFile(full, "utf8"));
  }
  return out;
}

async function open3d(page: Page) {
  await page.getByRole("button", { name: "3D Harness" }).click();
  await page.locator(".h3d-workspace canvas").waitFor();
}

/** Show the first harness that is one segment between two connectors, so the camera frames it close. */
async function showTwoConnectorHarness(page: Page): Promise<void> {
  const select = page.locator(".h3d-bar select");
  for (const name of await select.locator("option").allTextContents()) {
    await select.selectOption(name);
    if ((await page.locator(".h3d-bar .muted").textContent())?.startsWith("2 endpoints, 1 segments")) return;
  }
  throw new Error("no harness of two connectors");
}

/** What the panel's placement data says is drawn. */
async function shown(page: Page): Promise<Shown> {
  return JSON.parse((await page.locator(".h3d-panel details pre").textContent())!) as Shown;
}

/**
 * Where a point lands on screen. The view frames the shown endpoints the way
 * `Frame` in the 3D scene does: the camera looks at their middle from a fixed
 * direction, far enough back to fit them all.
 */
async function onScreen(page: Page, data: Shown, at: Vec3): Promise<{ x: number; y: number }> {
  const box = (await page.locator(".h3d-workspace canvas").boundingBox())!;
  const nodes = [...Object.values(data.connectors).map((c) => c.position), ...Object.entries(data.points).filter(([id]) => !id.startsWith("tie-")).map(([, p]) => p)];
  const middle = nodes.reduce((t, p) => t.add(new THREE.Vector3(...p)), new THREE.Vector3()).divideScalar(nodes.length);
  const reach = Math.max(100, ...nodes.map((p) => middle.distanceTo(new THREE.Vector3(...p))));
  const camera = new THREE.PerspectiveCamera(40, box.width / box.height, 5, 20000);
  const away = new THREE.Vector3(0.35, 0.3, 0.9).normalize().multiplyScalar(Math.max(400, (reach / Math.tan(THREE.MathUtils.degToRad(20))) * 1.25));
  camera.position.copy(middle).add(away);
  camera.lookAt(middle);
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(...at).project(camera);
  return { x: box.x + ((p.x + 1) / 2) * box.width, y: box.y + ((1 - p.y) / 2) * box.height };
}

/** Click a connector for its handles, then drag the handles' centre, which moves it in the view plane. */
async function dragConnector(page: Page, data: Shown, position: Vec3): Promise<void> {
  const at = await onScreen(page, data, position);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".h3d-panel .h3d-row span").first()).not.toHaveText("Nothing selected");
  await page.mouse.move(at.x + 1, at.y + 1);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 90, at.y - 60, { steps: 12 });
  await page.mouse.up();
}

test("a connector dragged in 3D is saved and comes back where it was left after a reload", async ({ page }) => {
  const folder = await freshExample("place-3d");
  await openProject(page, folder);
  await page.waitForTimeout(1000);
  const opened = await snapshot(folder);
  await open3d(page);
  await showTwoConnectorHarness(page);
  // Opening the view and picking a harness changes nothing in the project.
  await page.waitForTimeout(1000);
  expect(await snapshot(folder)).toEqual(opened);

  // In Stretch the connector moves alone.
  await page.getByRole("button", { name: "Stretch" }).click();
  const before = await shown(page);
  const [id, connector] = Object.entries(before.connectors)[0];
  await dragConnector(page, before, connector.position);

  const after = await shown(page);
  const moved = after.connectors[id];
  expect(moved.position).not.toEqual(connector.position);
  // The connector saves the rotation it is drawn with, and the other connector stays unplaced.
  await waitForFile(folder, PLACEMENT, (v) => JSON.stringify((v as { positions: Record<string, Vec3> }).positions) === JSON.stringify({ [id]: moved.position }));
  const file = JSON.parse(await fs.readFile(path.join(folder, PLACEMENT), "utf8"));
  expect(file).toEqual({ positions: { [id]: moved.position }, rotations: { [id]: moved.rotation_deg }, ties: {} });
  // The drag was one undoable edit.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fs.access(path.join(folder, PLACEMENT)).then(() => true, () => false)).toBe(false);
  expect((await shown(page)).connectors[id]).toEqual(connector);
  await page.getByRole("button", { name: "Redo" }).click();
  await waitForFile(folder, PLACEMENT, (v) => JSON.stringify(v) === JSON.stringify(file));

  await page.reload();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
  if (!(await page.locator(".h3d-workspace canvas").isVisible())) await open3d(page);
  await showTwoConnectorHarness(page);
  expect((await shown(page)).connectors[id]).toEqual(moved);

  // Clearing the placement returns the connector to the sketch and drops the file; one undo brings both back.
  const clear = page.getByRole("button", { name: "Clear placement" });
  await clear.click();
  await expect.poll(() => fs.access(path.join(folder, PLACEMENT)).then(() => true, () => false)).toBe(false);
  expect((await shown(page)).connectors[id]).toEqual(connector);
  await page.getByRole("button", { name: "Undo" }).click();
  await waitForFile(folder, PLACEMENT, (v) => JSON.stringify(v) === JSON.stringify(file));
  expect((await shown(page)).connectors[id]).toEqual(moved);

  // With every harness shown, the button needs a selected part to name the harness.
  await page.locator(".h3d-bar select").selectOption("All harnesses");
  await page.keyboard.press("Escape");
  await expect(page.locator(".h3d-panel .h3d-row span").first()).toHaveText("Nothing selected");
  await expect(clear).toBeDisabled();
});

test("the view opens with lengths locked: a drag moves the whole harness as one undo step, and Stretch survives a reload", async ({ page }) => {
  const folder = await freshExample("lock-3d");
  await openProject(page, folder);
  await open3d(page);
  await showTwoConnectorHarness(page);
  await expect(page.getByRole("button", { name: "Lengths locked" })).toHaveAttribute("aria-pressed", "true");
  // Let the camera settle on the harness before aiming at it.
  await page.waitForTimeout(1000);

  const before = await shown(page);
  const [[a, first], [b, second]] = Object.entries(before.connectors);
  await dragConnector(page, before, first.position);

  // Both connectors move by the same amount, so the length between them holds, and both are placed.
  const after = await shown(page);
  const shift = after.connectors[a].position.map((v, i) => v - first.position[i]);
  expect(shift).not.toEqual([0, 0, 0]);
  for (const [i, v] of after.connectors[b].position.entries()) expect(Math.abs(v - second.position[i] - shift[i])).toBeLessThanOrEqual(1);
  await waitForFile(folder, PLACEMENT, (v) => Object.keys((v as { positions: Record<string, Vec3> }).positions).sort().join() === [a, b].sort().join());
  const file = JSON.parse(await fs.readFile(path.join(folder, PLACEMENT), "utf8"));
  expect(file.positions).toEqual({ [a]: after.connectors[a].position, [b]: after.connectors[b].position });

  // One undo puts the whole harness back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => fs.access(path.join(folder, PLACEMENT)).then(() => true, () => false)).toBe(false);
  expect((await shown(page)).connectors).toEqual(before.connectors);

  // Stretch is remembered by the browser, and choosing it touches nothing in the project.
  const opened = await snapshot(folder);
  await page.getByRole("button", { name: "Stretch" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
  if (!(await page.locator(".h3d-workspace canvas").isVisible())) await open3d(page);
  await expect(page.getByRole("button", { name: "Stretch" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lengths locked" })).toHaveAttribute("aria-pressed", "false");
  expect(await snapshot(folder)).toEqual(opened);
});
