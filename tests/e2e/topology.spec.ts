import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canvasSettled, freshExample, openProject, pointOnAnEdge, readJson, waitForFile } from "./helpers";

/** Topology round two: the ratsnest, layer filtering, and the side by side view. */

const TOPOLOGY = "topologies/top-222268.json";
/** Battery MAIN to the in-line switch IN: one built segment between two connectors, carrying one 48 V net. */
const BATTERY_SEGMENT = "seg-22228f";
const BATTERY_ENDS = ["end-22228d", "end-22228e"];
const SEGMENT_COUNT = 143;

/** A copy of the example with one segment taken out, so its net is unrouted. */
async function exampleWithoutSegment(name: string, segmentId: string): Promise<string> {
  const folder = await freshExample(name);
  const file = path.join(folder, TOPOLOGY);
  const top = JSON.parse(await fs.readFile(file, "utf8")) as { segments: { id: string }[] };
  top.segments = top.segments.filter((s) => s.id !== segmentId);
  await fs.writeFile(file, JSON.stringify(top, null, 2));
  return folder;
}

async function openTopology(page: import("@playwright/test").Page, folder: string) {
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
}

test("an unrouted net draws as a ratsnest line until its segment is drawn back, and the toggle survives a reload", async ({ page }) => {
  const folder = await exampleWithoutSegment("ratsnest", BATTERY_SEGMENT);
  await openTopology(page, folder);
  const lines = page.locator(".react-flow__edge.ratsnest");
  await expect(lines).toHaveCount(1);
  expect(await lines.first().locator("title").textContent()).toBe("Battery to switch: 48 V battery + BMS MAIN to In-line switch / fuse IN");

  // The toggle hides the ratsnest and is remembered in the browser.
  const toggle = page.getByRole("button", { name: "Ratsnest" });
  await toggle.click();
  await expect(lines).toHaveCount(0);
  await page.reload();
  await canvasSettled(page);
  await expect(page.getByRole("button", { name: "Ratsnest" })).toHaveAttribute("aria-pressed", "false");
  await expect(lines).toHaveCount(0);
  await page.getByRole("button", { name: "Ratsnest" }).click();
  await expect(lines).toHaveCount(1);

  // Selecting the net in the list brings its two connectors into view; joining them routes the net.
  await page.locator(".netlist li", { hasText: "Battery to switch" }).click();
  await page.waitForTimeout(500);
  // A segment starts on the ring just outside an endpoint; the endpoint itself drags to move it.
  const from = page.locator(`.react-flow__node[data-id="${BATTERY_ENDS[0]}"]`);
  const a = (await from.boundingBox())!;
  const ring = (await from.locator(".ep-handle").boundingBox())!;
  const b = (await page.locator(`.react-flow__node[data-id="${BATTERY_ENDS[1]}"]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, ring.y + 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(lines).toHaveCount(0);
  await waitForFile(folder, TOPOLOGY, (v) => (v as { segments: unknown[] }).segments.length === SEGMENT_COUNT);
  await expect(page.locator(".netlist .mark.unrouted")).toHaveCount(0);
});

test("the layer control dims topology segments outside the layer, keeps shared bundles active, and hides their ratsnest", async ({ page }) => {
  // The Jetson's Ethernet patch cable is taken out, so its net is unrouted and draws a ratsnest line in the All layer.
  const folder = await exampleWithoutSegment("topology-layers", "seg-22226b");
  await openTopology(page, folder);
  const dimmed = page.locator(".react-flow__edge.out-of-layer");
  const lines = page.locator(".react-flow__edge.ratsnest");
  await expect(lines).toHaveCount(1);
  await expect(dimmed).toHaveCount(0);

  await page.getByLabel("Layer").selectOption("power");
  await expect(page.getByTestId("topology-canvas")).toHaveClass(/in-layer/);
  // An Ethernet patch cable carries nothing from the Power layer; a motor run shared with an encoder cable stays active.
  await expect(page.locator('.react-flow__edge[data-id="seg-22226e"]')).toHaveClass(/out-of-layer/);
  await expect(page.locator('.react-flow__edge[data-id="seg-2222d3"]')).not.toHaveClass(/out-of-layer/);
  expect(await dimmed.count()).toBeGreaterThan(0);
  expect(await page.locator(".react-flow__edge:not(.out-of-layer):not(.ratsnest)").count()).toBeGreaterThan(0);
  await expect(lines).toHaveCount(0);

  // A dimmed endpoint cannot be dragged or selected.
  type Positions = { endpoints: Record<string, { x: number; y: number }> };
  const before = ((await readJson(folder, "canvas/top-222268.json")) as Positions).endpoints["end-22226c"];
  const switchPort = page.locator('.react-flow__node[data-id="end-22226c"]');
  await expect(switchPort).toHaveClass(/out-of-layer/);
  const b = (await switchPort.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + b.height / 2 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  const saved = (await readJson(folder, "canvas/top-222268.json")) as Positions;
  expect(saved.endpoints["end-22226c"]).toEqual(before);

  await page.getByLabel("Layer").selectOption("all");
  await expect(dimmed).toHaveCount(0);
  await expect(lines).toHaveCount(1);
});

test("side by side shows both canvases, a net picked on either side lights it on the other, and the divider is remembered", async ({ page }) => {
  const folder = await freshExample("side-by-side");
  await openProject(page, folder);
  await page.getByRole("button", { name: "Side by side" }).click();
  await expect(page.getByTestId("connectivity-canvas")).toBeVisible();
  await expect(page.getByTestId("topology-canvas")).toBeVisible();
  await canvasSettled(page);
  await page.waitForTimeout(400);

  // A net clicked on the left colours its route on the right.
  const onRoute = page.locator(".react-flow__edge.on-route");
  await expect(onRoute).toHaveCount(0);
  const at = await pointOnAnEdge(page);
  await page.mouse.click(at.x, at.y);
  expect(await onRoute.count()).toBeGreaterThan(0);

  // A net picked in the topology's net list glows on the left, and the net clicked before stops glowing as the selection moves.
  await page.locator(".netlist li", { hasText: "Battery to switch" }).click();
  await expect(page.locator('.react-flow__edge[data-id="net-22223y"] .net-halo')).toHaveCount(1);
  await expect(page.locator(".net-halo")).toHaveCount(1);
  await expect(onRoute).toHaveCount(1);

  // Dragging the divider shares the width, and the share survives a reload.
  const divider = page.getByRole("separator", { name: "Divider between connectivity and topology" });
  const d = (await divider.boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + 200);
  await page.mouse.down();
  await page.mouse.move(d.x - 150, d.y + 200, { steps: 6 });
  await page.mouse.up();
  const width = await page.locator(".side-pane-left").evaluate((e) => (e as { style: { width: string } }).style.width);
  expect(parseFloat(width)).toBeLessThan(45);
  expect(parseFloat(width)).toBeGreaterThanOrEqual(20);
  await page.reload();
  await expect(page.getByRole("button", { name: "Side by side" })).toHaveClass(/active/);
  expect(await page.locator(".side-pane-left").evaluate((e) => (e as { style: { width: string } }).style.width)).toBe(width);
});
