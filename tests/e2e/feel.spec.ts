import { expect, test } from "@playwright/test";
import { freshExample, openProject, readJson, waitForFile } from "./helpers";

/** Canvas feel: the behaviours from the "canvas feel, round one" spec. */

test("dragging a component saves its position and repaints no other component", async ({ page }) => {
  const folder = await freshExample("feel-drag");
  await openProject(page, folder);
  const boxes = page.locator(".cmp-node");
  await expect(boxes.first()).toBeVisible();
  const count = await boxes.count();
  expect(count).toBeGreaterThan(3);

  // Let React Flow settle its measurements before counting renders.
  await page.waitForTimeout(300);
  const renderCounts = () => boxes.evaluateAll((els) => els.map((e) => [e.closest(".react-flow__node")!.getAttribute("data-id")!, e.getAttribute("data-renders")!] as [string, string]));
  const before = new Map(await renderCounts());

  const target = page.locator(".react-flow__node-component").first();
  const id = (await target.getAttribute("data-id"))!;
  const start = ((await readJson(folder, "canvas/connectivity.json")) as { components: Record<string, { x: number; y: number }> }).components[id];
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2 + i * 12, b.y + 10 + i * 6);
  await page.mouse.up();

  for (const [nodeId, renders] of await renderCounts()) {
    if (nodeId === id) continue;
    expect(renders, `component ${nodeId} re-rendered during the drag`).toBe(before.get(nodeId));
  }

  await waitForFile(folder, "canvas/connectivity.json", (v) => {
    const pos = (v as { components: Record<string, { x: number; y: number }> }).components[id];
    return pos.x !== start.x || pos.y !== start.y;
  });
});

test("the canvas is dark by default and the light choice survives a reload", async ({ page }) => {
  const folder = await freshExample("feel-theme");
  await openProject(page, folder);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".react-flow")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".react-flow")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
