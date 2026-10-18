import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canvasSettled, fanArcsOf, freshExample, openProject, pointOnAnEdge, viewportTransform, waitForFile } from "./helpers";

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
  // The net has no name of its own: it reads as its bus, then its ends.
  expect(await lines.first().locator("title").textContent()).toBe("48 V bus via Bus bar: 48 V battery + BMS MAIN to In-line switch / fuse IN");

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
  await page.locator(".netlist li", { hasText: "48 V battery + BMS MAIN to In-line switch / fuse IN" }).click();
  await page.waitForTimeout(500);
  // A segment starts on the ring just outside an endpoint; the endpoint itself drags to move it.
  const from = page.locator(`.react-flow__node[data-id="${BATTERY_ENDS[0]}"]`);
  const a = (await from.boundingBox())!;
  const ring = (await from.locator(".ep-handle").boundingBox())!;
  const b = (await page.locator(`.react-flow__node[data-id="${BATTERY_ENDS[1]}"]`).boundingBox())!;
  const viewport = await viewportTransform(page);
  await page.mouse.move(a.x + a.width / 2, ring.y + 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(lines).toHaveCount(0);
  await waitForFile(folder, TOPOLOGY, (v) => (v as { segments: unknown[] }).segments.length === SEGMENT_COUNT);
  await expect(page.locator(".netlist .mark.unrouted")).toHaveCount(0);
  // The two connectors leave the row under the pieces for a home in their new piece, and the viewport stays where it was.
  await page.waitForTimeout(600);
  expect(await viewportTransform(page)).toBe(viewport);
  const moved = (await from.boundingBox())!;
  expect(Math.hypot(moved.x - a.x, moved.y - a.y)).toBeGreaterThan(1);
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

  // A dimmed endpoint cannot be moved or selected.
  const switchPort = page.locator('.react-flow__node[data-id="end-22226c"]');
  await expect(switchPort).toHaveClass(/out-of-layer/);
  const b = (await switchPort.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(b.x + b.width / 2 + i * 15, b.y + b.height / 2 + i * 10);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
  const a = (await switchPort.boundingBox())!;
  expect([a.x, a.y]).toEqual([b.x, b.y]);

  await page.getByLabel("Layer").selectOption("all");
  await expect(dimmed).toHaveCount(0);
  await expect(lines).toHaveCount(1);
});

test("side by side: a connector endpoint lights its component and its own nets, and the topology selection stays", async ({ page }) => {
  const folder = await freshExample("side-by-side-connector");
  await openProject(page, folder);
  await page.getByRole("button", { name: "Side by side" }).click();
  await canvasSettled(page);
  await page.waitForTimeout(400);
  const left = page.getByTestId("connectivity-canvas");
  const right = page.getByTestId("topology-canvas");
  const viewports = () => Promise.all([left, right].map((c) => c.locator(".react-flow__viewport").evaluate((e) => (e as { style: { transform: string } }).style.transform)));
  const before = await viewports();

  // The in-line switch IN sits on the 48 V bus: its bridge joins the battery net to the net out of OUT.
  const switchIn = right.locator('.react-flow__node[data-id="end-22228e"]');
  await switchIn.click();

  await expect(left.locator('.react-flow__node[data-id="cmp-22222n"] .cmp-node')).toHaveClass(/\blit\b/);
  await expect(left.locator('.react-flow__node[data-id="cmp-22222k"] .cmp-node')).not.toHaveClass(/\blit\b/);
  await expect(left.locator('.react-flow__edge[data-id="net-22223y"] .net-halo')).toHaveCount(1);
  await expect(left.locator('.react-flow__edge[data-id="net-22223z"] .net-halo')).toHaveCount(0);

  // The selection and the inspector stay on the endpoint, and neither viewport moved.
  await expect(switchIn).toHaveClass(/selected/);
  await expect(left.locator(".react-flow__node.selected")).toHaveCount(0);
  // Side by side hides the inspectors, but the topology one still holds the endpoint.
  await expect(page.locator(".side-pane-right .pane-right h3").first()).toHaveText("connector");
  await page.waitForTimeout(400);
  expect(await viewports()).toEqual(before);
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
  await page.locator(".netlist li", { hasText: "48 V battery + BMS MAIN to In-line switch / fuse IN" }).click();
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

test("segments meet connector boxes at their edges, and each fan draws its faint arc", async ({ page }) => {
  const folder = await freshExample("fan-arcs");
  await openTopology(page, folder);
  await page.waitForTimeout(600);

  // Both ends of the battery lead sit on the edge of their connector box, not inside it and not at its top centre.
  const ends = await page.evaluate((id) => {
    type Path = { getAttribute(n: string): string | null; getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } };
    const doc = (globalThis as unknown as { document: { querySelector(sel: string): Path | null } }).document;
    const path = doc.querySelector(`.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`)!;
    const n = path.getAttribute("d")!.match(/-?[\d.]+(e-?\d+)?/g)!.map(Number);
    const c = path.getScreenCTM()!;
    const screen = (x: number, y: number) => ({ x: x * c.a + y * c.c + c.e, y: x * c.b + y * c.d + c.f });
    return [screen(n[0], n[1]), screen(n[2], n[3])];
  }, BATTERY_SEGMENT);
  for (const [i, end] of BATTERY_ENDS.entries()) {
    const box = (await page.locator(`.react-flow__node[data-id="${end}"]`).boundingBox())!;
    const p = ends[i];
    const tol = 1.5;
    expect(p.x).toBeGreaterThanOrEqual(box.x - tol);
    expect(p.x).toBeLessThanOrEqual(box.x + box.width + tol);
    expect(p.y).toBeGreaterThanOrEqual(box.y - tol);
    expect(p.y).toBeLessThanOrEqual(box.y + box.height + tol);
    const fromEdge = Math.min(Math.abs(p.x - box.x), Math.abs(p.x - box.x - box.width), Math.abs(p.y - box.y), Math.abs(p.y - box.y - box.height));
    expect(fromEdge).toBeLessThan(tol);
    expect(Math.hypot(p.x - (box.x + box.width / 2), p.y - box.y)).toBeGreaterThan(tol);
  }

  const arcs = await fanArcsOf(folder, "top-222268");
  expect(arcs.length).toBeGreaterThan(0);
  await expect(page.locator(".fan-arcs path")).toHaveCount(arcs.length);
});

test("the Root toggle marks and unmarks an endpoint in one undo step each, and survives a reload", async ({ page }) => {
  const folder = await freshExample("roots");
  await openTopology(page, folder);
  const id = BATTERY_ENDS[0];
  const canvas = "canvas/top-222268.json";
  const roots = (want: string[]) => (v: unknown) => JSON.stringify((v as { roots: string[] }).roots) === JSON.stringify(want);
  // Undo keys skip a focused field, so each undo clicks the inspector heading first.
  const undo = async () => {
    await page.locator(".pane-right h3").first().click();
    await page.keyboard.press("ControlOrMeta+z");
  };

  await page.locator(`.react-flow__node[data-id="${id}"]`).click();
  const toggle = page.getByRole("checkbox", { name: "Root" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await waitForFile(folder, canvas, roots([id]));
  await undo();
  await waitForFile(folder, canvas, roots([]));
  await expect(toggle).not.toBeChecked();

  await toggle.check();
  await waitForFile(folder, canvas, roots([id]));
  await toggle.uncheck();
  await waitForFile(folder, canvas, roots([]));
  await undo();
  await waitForFile(folder, canvas, roots([id]));

  await page.reload();
  await canvasSettled(page);
  await page.locator(`.react-flow__node[data-id="${id}"]`).click();
  await expect(page.getByRole("checkbox", { name: "Root" })).toBeChecked();
});
