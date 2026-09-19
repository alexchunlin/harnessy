import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, readJson, waitForFile } from "./helpers";

/** Canvas feel: the behaviours from the "canvas feel, round one" spec. */

test("dragging a component saves its position and repaints no other component", async ({ page }) => {
  const folder = await freshExample("feel-drag");
  await openProject(page, folder);
  await canvasSettled(page);
  const boxes = page.locator(".cmp-node");
  const count = await boxes.count();
  expect(count).toBeGreaterThan(3);

  type El = { closest(sel: string): El | null; getAttribute(name: string): string | null };
  const renderCounts = () => boxes.evaluateAll((els) => (els as unknown as El[]).map((e) => [e.closest(".react-flow__node")!.getAttribute("data-id")!, e.getAttribute("data-renders")!] as [string, string]));
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
  await canvasSettled(page);
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
  await canvasSettled(page);
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

/** A screen point halfway along a visible, uncovered net edge, plus its net id. */
async function pointOnAnEdge(page: import("@playwright/test").Page): Promise<{ x: number; y: number; netId: string }> {
  // Runs in the browser; the e2e tsconfig has no DOM lib, so the DOM is typed loosely here.
  return page.evaluate(() => {
    type Path = { getTotalLength(): number; getPointAtLength(n: number): { x: number; y: number }; getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } };
    type El = { closest(sel: string): El | null; querySelector(sel: string): (El & Path) | null; getAttribute(name: string): string | null };
    const doc = (globalThis as unknown as { document: { querySelectorAll(sel: string): Iterable<El>; elementFromPoint(x: number, y: number): El | null } }).document;
    for (const g of doc.querySelectorAll(".react-flow__edge:not(.inactive)")) {
      const path = g.querySelector("path.net-edge");
      if (!path) continue;
      const total = path.getTotalLength();
      for (const f of [0.5, 0.35, 0.65]) {
        const m = path.getPointAtLength(total * f);
        const c = path.getScreenCTM()!;
        const x = m.x * c.a + m.y * c.c + c.e;
        const y = m.x * c.b + m.y * c.d + c.f;
        if (doc.elementFromPoint(x, y)?.closest(".react-flow__edge") === g) return { x, y, netId: g.getAttribute("data-id")!.split(":")[0] };
      }
    }
    throw new Error("no uncovered edge");
  });
}

test("a net is steered: double-click adds a corner, dragging a run shifts it, reset forgets the bends", async ({ page }) => {
  const folder = await freshExample("feel-steer");
  await openProject(page, folder);
  await canvasSettled(page);
  const bendsFile = () => readJson(folder, "canvas/connectivity.json") as Promise<{ bends: Record<string, { x: number; y: number }[]> }>;
  expect((await bendsFile()).bends).toEqual({});

  const at = await pointOnAnEdge(page);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  const edgeId = (await page.locator(".react-flow__edge.selected").getAttribute("data-id"))!;
  expect(edgeId.startsWith(at.netId)).toBe(true);
  const gripsBefore = await page.locator(".edge-grip.corner").count();

  // Double-click the run: a corner is stored under the canvas file.
  await page.mouse.dblclick(at.x, at.y);
  await waitForFile(folder, "canvas/connectivity.json", (v) => Object.keys((v as { bends: object }).bends).length === 1);
  const key = Object.keys((await bendsFile()).bends)[0];
  expect(key).toBe(edgeId);
  await expect(page.locator(".edge-grip.corner")).toHaveCount(gripsBefore + 1);

  // Drag a run grip along its normal: the bends change and the line stays orthogonal.
  const grip = page.locator(".edge-grip.run").first();
  const dir = (await grip.getAttribute("class"))!.includes("ns") ? "y" : "x";
  const g = (await grip.boundingBox())!;
  const before = (await bendsFile()).bends[key];
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(g.x + g.width / 2 + (dir === "x" ? i * 8 : 0), g.y + g.height / 2 + (dir === "y" ? i * 8 : 0));
  await page.mouse.up();
  await waitForFile(folder, "canvas/connectivity.json", (v) => JSON.stringify((v as { bends: Record<string, unknown> }).bends[key]) !== JSON.stringify(before));
  // The coordinates the drag produced sit on the 6 px grid.
  const after = (await bendsFile()).bends[key];
  const was = new Set(before.map((p) => p[dir]));
  const moved = after.map((p) => p[dir]).filter((v) => !was.has(v));
  expect(moved.length).toBeGreaterThan(0);
  for (const v of moved) expect(v % 6).toBe(0);

  // Reset: the entry goes and the line routes itself again.
  await page.getByRole("button", { name: "Reset bends" }).click();
  await waitForFile(folder, "canvas/connectivity.json", (v) => Object.keys((v as { bends: object }).bends).length === 0);
});

test("flipping a component and dragging a pin label rewrite the pin arrangement under the canvas", async ({ page }) => {
  const folder = await freshExample("feel-pins");
  await openProject(page, folder);
  await canvasSettled(page);
  const original = (await readJson(folder, "canvas/connectivity.json")) as { pins: Record<string, unknown> };
  expect(original.pins).toEqual({});

  // The DC/DC converter's definition puts IN on the left and OUT1..4 on the right.
  const dcdc = page.locator(".react-flow__node-component", { hasText: "24 V DC/DC" }).first();
  const id = (await dcdc.getAttribute("data-id"))!;
  await expect(dcdc.locator(".cmp-connector.left")).toHaveCount(1);
  await expect(dcdc.locator(".cmp-connector.right")).toHaveCount(4);
  await dcdc.locator(".cmp-title").click();
  await page.getByRole("button", { name: "Flip horizontal" }).click();
  await waitForFile(folder, "canvas/connectivity.json", (v) => (v as { pins: Record<string, { right?: string[] }> }).pins[id]?.right?.join() === "IN");
  await expect(dcdc.locator(".cmp-connector.left")).toHaveCount(4);
  const flipped = (await readJson(folder, "canvas/connectivity.json")) as { pins: Record<string, { left: string[]; right: string[]; top: string[]; bottom: string[] }> };
  expect(flipped.pins[id]).toEqual({ left: ["OUT1", "OUT2", "OUT3", "OUT4"], right: ["IN"], top: [], bottom: [] });
  // The component file did not change.
  expect(await readJson(folder, `components/${id}.json`)).toEqual(await readJson(`${process.cwd()}/examples/rammp-gen1.5`, `components/${id}.json`));

  // Zoom in on the box so its pin labels show, then drag OUT4's label to the top edge: it moves to the top side.
  const centre = (await dcdc.boundingBox())!;
  await page.mouse.move(centre.x + centre.width / 2, centre.y + centre.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
  await expect(dcdc.locator(".cmp-node")).not.toHaveClass(/labels-hidden/);
  const label = dcdc.locator(".cmp-designator", { hasText: /^OUT4$/ });
  const l = (await label.boundingBox())!;
  const box = (await dcdc.boundingBox())!;
  await page.mouse.move(l.x + l.width / 2, l.y + l.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(l.x + l.width / 2 + ((box.x + box.width / 2 - l.x - l.width / 2) * i) / 8, l.y + l.height / 2 + ((box.y - l.y - l.height / 2) * i) / 8);
  await expect(dcdc.locator(".pin-slot")).toHaveCount(1);
  await page.mouse.up();
  await waitForFile(folder, "canvas/connectivity.json", (v) => (v as { pins: Record<string, { top?: string[] }> }).pins[id]?.top?.join() === "OUT4");
  await expect(dcdc.locator(".cmp-connector.top")).toHaveCount(1);
  await expect(dcdc.locator(".cmp-connector.left")).toHaveCount(3);

  // The inspector moves pins too.
  await page.getByRole("button", { name: "Move OUT2 down" }).click();
  await waitForFile(folder, "canvas/connectivity.json", (v) => (v as { pins: Record<string, { left?: string[] }> }).pins[id]?.left?.join() === "OUT1,OUT3,OUT2");
  await page.getByLabel("Side of IN").selectOption("bottom");
  await waitForFile(folder, "canvas/connectivity.json", (v) => (v as { pins: Record<string, { bottom?: string[] }> }).pins[id]?.bottom?.join() === "IN");
  await expect(dcdc.locator(".cmp-connector.bottom")).toHaveCount(1);
});

test("boxes snap to the grid, size to their labels, and arrange in a row one pitch apart", async ({ page }) => {
  const folder = await freshExample("feel-grid");
  await openProject(page, folder);
  await canvasSettled(page);
  const positions = () => readJson(folder, "canvas/connectivity.json") as Promise<{ components: Record<string, { x: number; y: number }> }>;

  // A short-named, one-pin box is narrower than a long-named, many-pin one.
  const camera = page.locator(".react-flow__node-component", { hasText: "Fisheye camera 1" }).first();
  const mib = page.locator(".react-flow__node-component", { hasText: "MIB" }).first();
  const cameraWidth = (await camera.boundingBox())!.width;
  const mibWidth = (await mib.boundingBox())!.width;
  expect(mibWidth).toBeGreaterThan(cameraWidth);

  // Drag the camera by an odd amount: it lands on the 6 px grid.
  const id = (await camera.getAttribute("data-id"))!;
  const b = (await camera.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 6);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width / 2 + i * 7, b.y + 6 + i * 5);
  await page.mouse.up();
  const start = (await positions()).components[id];
  await waitForFile(folder, "canvas/connectivity.json", (v) => {
    const c = (v as { components: Record<string, { x: number; y: number }> }).components[id];
    return c.x !== start.x || c.y !== start.y;
  });
  const moved = (await positions()).components[id];
  expect(moved.x % 6).toBe(0);
  expect(moved.y % 6).toBe(0);

  // Select two cameras and arrange them in a row.
  const camera2 = page.locator(".react-flow__node-component", { hasText: "Fisheye camera 2" }).first();
  const id2 = (await camera2.getAttribute("data-id"))!;
  await camera.locator(".cmp-title").click();
  await camera2.locator(".cmp-title").click({ modifiers: ["Shift"] });
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  await page.getByRole("button", { name: "Arrange in row" }).click();
  await waitForFile(folder, "canvas/connectivity.json", (v) => {
    const c = (v as { components: Record<string, { x: number; y: number }> }).components;
    return c[id].y === c[id2].y;
  });
  const after = (await positions()).components;
  const boxWidth = await camera.evaluate((el) => (el as unknown as { querySelector(sel: string): { offsetWidth: number } }).querySelector(".cmp-node").offsetWidth);
  expect(Math.abs(after[id2].x - after[id].x)).toBe(boxWidth + 24);
});

test("reloading the page reopens the last project, and Close returns to the folder browser for good", async ({ page }) => {
  const folder = await freshExample("feel-reload");
  await openProject(page, folder);
  await page.reload();
  await expect(page.getByRole("button", { name: "Connectivity" })).toBeVisible();
  await expect(page.locator(".toolbar-title")).toHaveText("RAMMP Gen 1.5");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByPlaceholder("Go to path")).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("Go to path")).toBeVisible();
});
