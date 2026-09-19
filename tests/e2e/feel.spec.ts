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

test("in a layer, inactive components and nets are greyed and cannot be dragged or selected", async ({ page }) => {
  const folder = await freshExample("feel-layer");
  await openProject(page, folder);
  await expect(page.locator(".cmp-node").first()).toBeVisible();
  await expect(page.locator(".react-flow__edge.inactive")).toHaveCount(0);
  await page.getByLabel("Layer").selectOption("power");
  await expect(page.getByTestId("connectivity-canvas")).toHaveClass(/in-layer/);
  const inactiveEdges = await page.locator(".react-flow__edge.inactive").count();
  const activeEdges = await page.locator(".react-flow__edge:not(.inactive)").count();
  expect(inactiveEdges).toBeGreaterThan(0);
  expect(activeEdges).toBeGreaterThan(0);

  const dimmed = page.locator(".react-flow__node-component", { has: page.locator(".cmp-node.dimmed") }).first();
  const id = (await dimmed.getAttribute("data-id"))!;
  const before = await dimmed.evaluate((e) => (e as { style: { transform: string } }).style.transform);
  const b = (await dimmed.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + 10 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(600);
  expect(await dimmed.evaluate((e) => (e as { style: { transform: string } }).style.transform)).toBe(before);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  const saved = (await readJson(folder, "canvas/connectivity.json")) as { components: Record<string, { x: number; y: number }> };
  const original = (await readJson(`${process.cwd()}/examples/rammp-gen1.5`, "canvas/connectivity.json")) as { components: Record<string, { x: number; y: number }> };
  expect(saved.components[id]).toEqual(original.components[id]);

  await page.getByLabel("Layer").selectOption("all");
  await expect(page.locator(".react-flow__edge.inactive")).toHaveCount(0);
  await expect(page.locator(".cmp-node.dimmed")).toHaveCount(0);
});

test("hovering an inspector row or an edge glows the net's edges and pins", async ({ page }) => {
  const folder = await freshExample("feel-glow");
  await openProject(page, folder);
  await expect(page.locator(".cmp-node").first()).toBeVisible();
  await expect(page.locator(".net-halo")).toHaveCount(0);

  // Hover an edge on the canvas: its halo appears and the pins at both ends light up.
  const edge = page.locator(".react-flow__edge:not(.inactive)").first();
  await edge.locator("path").first().hover({ force: true });
  await expect(page.locator(".net-halo").first()).toBeVisible();
  expect(await page.locator(".cmp-connector.lit").count()).toBeGreaterThanOrEqual(2);
  await page.mouse.move(5, 300);
  await expect(page.locator(".net-halo")).toHaveCount(0);
  await expect(page.locator(".cmp-connector.lit")).toHaveCount(0);

  // Select a component that carries nets; hovering a connector row in the inspector glows those nets.
  const withNets = page.locator(".react-flow__node-component", { has: page.locator(".cmp-dots") }).first();
  await withNets.locator(".cmp-title").click();
  await expect(page.locator(".pane-right")).toContainText("Connectors");
  await page.locator(".insp-connector", { has: page.locator(".chip") }).first().hover();
  expect(await page.locator(".net-halo").count()).toBeGreaterThanOrEqual(1);
  expect(await page.locator(".cmp-connector.lit").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".cmp-node.selected")).toHaveCount(1);
});
