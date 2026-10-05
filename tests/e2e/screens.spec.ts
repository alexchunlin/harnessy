import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject } from "./helpers";

test("both canvases render the example", async ({ page }) => {
  const folder = await freshExample("screens");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openProject(page, folder);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/connectivity.png" });
  await page.getByRole("button", { name: "Topology" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/topology.png" });
  // Connector endpoints show their type and designator; the component name is the hover title.
  const connector = page.locator(".ep-connector").first();
  expect(await connector.textContent()).toMatch(/^\S+ [A-Za-z0-9_-]+$/);
  expect(await connector.getAttribute("title")).toMatch(/^.+ [A-Za-z0-9_-]+: connector, 1 segment$/);
  await page.getByRole("button", { name: /DRC/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/drc.png" });
  // Clicking a finding jumps to its canvas and selects the target.
  await page.locator(".drc-jump").first().click();
  await expect(page.getByRole("button", { name: "Connectivity" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".pane-right")).toContainText("Component");
  expect(errors.filter((e) => !e.includes("React DevTools"))).toEqual([]);
});

test("dragging an endpoint that moves a harness label raises no page error", async ({ page }) => {
  const folder = await freshExample("drag-label");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Vite's client reports a ResizeObserver loop as a window error, which Playwright does not surface as a pageerror.
  await page.addInitScript(() => {
    const w = globalThis as unknown as { __errors?: string[]; addEventListener(type: string, fn: (e: { message: string }) => void, capture: boolean): void };
    w.addEventListener("error", (e) => (w.__errors ??= []).push(e.message), true);
  });
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology" }).click();
  await canvasSettled(page);
  // The breakout at the head of the front power harness ends that harness's anchor segment, so its label follows the drag.
  const node = page.locator('.react-flow__node[data-id="end-22228q"]');
  const box = (await node.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 3, cy + i * 2);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const windowErrors = await page.evaluate(() => (globalThis as unknown as { __errors?: string[] }).__errors ?? []);
  expect([...errors, ...windowErrors]).toEqual([]);
});
