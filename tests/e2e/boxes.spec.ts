import { expect, test, type Page } from "@playwright/test";
import { canvasSettled, freshExample, harnessBoxes, openProject, readJson, viewportTransform, waitForFile } from "./helpers";

const TOPOLOGY_ID = "top-222268";
const TOPOLOGY_CANVAS = "canvas/top-222268.json";
type Canvas = { pieces: Record<string, { offset?: { x: number; y: number }; turns?: number }> };

const translate = (transform: string) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(transform)!;
  return { x: Number(m[1]), y: Number(m[2]) };
};

async function openTopology(page: Page) {
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
}

/** Two boxes' top-left corners on screen, as a difference in canvas pixels. */
async function screenGap(page: Page, a: string, b: string) {
  const scale = Number(/scale\(([\d.]+)\)/.exec(await viewportTransform(page))![1]);
  const ra = (await page.locator(`.react-flow__node[data-id="harness:${a}"]`).boundingBox())!;
  const rb = (await page.locator(`.react-flow__node[data-id="harness:${b}"]`).boundingBox())!;
  return { x: (rb.x - ra.x) / scale, y: (rb.y - ra.y) / scale };
}

test("each harness draws in a box with its label, and a purchased cable draws with none", async ({ page }) => {
  const folder = await freshExample("boxes-drawn");
  await openProject(page, folder);
  await openTopology(page);
  const layout = await harnessBoxes(folder, TOPOLOGY_ID);
  const built = layout.filter((p) => p.box);
  expect(built.length).toBeGreaterThan(1);
  expect(layout.some((p) => !p.box)).toBe(true);
  await expect(page.locator(".react-flow__node-harness")).toHaveCount(built.length);
  for (const p of built) await expect(page.locator(`.react-flow__node[data-id="harness:${p.id}"] .harness-box-title`)).toContainText(p.box!.label);
});

test("dragging a harness box writes its offset, the offset survives a reload, and Reset position drops it", async ({ page }) => {
  const folder = await freshExample("boxes-drag");
  await openProject(page, folder);
  await openTopology(page);
  const [moved, other] = (await harnessBoxes(folder, TOPOLOGY_ID)).filter((p) => p.box).map((p) => p.id);

  const title = page.locator(`.react-flow__node[data-id="harness:${moved}"] .harness-box-title`);
  const t = (await title.boundingBox())!;
  const viewport = await viewportTransform(page);
  const scale = Number(/scale\(([\d.]+)\)/.exec(viewport)![1]);
  await page.mouse.move(t.x + 10, t.y + t.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(t.x + 10 + i * 8, t.y + t.height / 2 + i * 5);
  await page.mouse.up();

  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[moved]?.offset !== undefined);
  const offset = ((await readJson(folder, TOPOLOGY_CANVAS)) as Canvas).pieces[moved].offset!;
  expect(offset.x).toBeGreaterThan(0);
  expect(offset.y).toBeGreaterThan(0);
  // The box stays where it was dropped, exactly its stored offset away. React Flow may pan a little while a box is dragged near the edge, so that pan is taken out.
  const panned = await viewportTransform(page);
  await page.waitForTimeout(600);
  expect(await viewportTransform(page)).toBe(panned);
  const dropped = (await title.boundingBox())!;
  const [before, after] = [translate(viewport), translate(panned)];
  expect((dropped.x - t.x - (after.x - before.x)) / scale).toBeCloseTo(offset.x, 0);
  expect((dropped.y - t.y - (after.y - before.y)) / scale).toBeCloseTo(offset.y, 0);

  // After a reload the box still sits where the layout, offset included, puts it.
  await page.reload();
  await openTopology(page);
  await page.waitForTimeout(600);
  const boxes = new Map((await harnessBoxes(folder, TOPOLOGY_ID)).flatMap((p) => (p.box ? [[p.id, p.box.rect] as const] : [])));
  const gap = await screenGap(page, moved, other);
  expect(gap.x).toBeCloseTo(boxes.get(other)!.x - boxes.get(moved)!.x, 0);
  expect(gap.y).toBeCloseTo(boxes.get(other)!.y - boxes.get(moved)!.y, 0);

  const again = (await title.boundingBox())!;
  await page.mouse.click(again.x + 10, again.y + again.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Reset position" }).click();
  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[moved] === undefined);
});
