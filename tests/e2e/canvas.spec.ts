import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { freshExample, openProject, readJson, waitForFile } from "./helpers";

async function netCount(folder: string, domain: string): Promise<number> {
  return ((await readJson(folder, `nets/${domain}.json`)) as unknown[]).length;
}

async function openCreatedProject(page: Page, folder: string) {
  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByPlaceholder("Go to path").fill(folder);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Use this folder" }).click();
  await page.getByLabel("Project name").fill("Canvas test");
  await page.getByRole("button", { name: "Create project here" }).click();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
}

test("place two components, draw a 48 V net, then route it on a topology", async ({ page }) => {
  const folder = path.join(process.env.HARNESSY_E2E_HOME ?? "/tmp/harnessy-e2e", "canvas");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCreatedProject(page, folder);
  const canvas = page.getByTestId("connectivity-canvas");
  const box = (await canvas.boundingBox())!;

  // Place a battery and a bus bar from the library panel.
  await page.getByLabel("Search components").fill("battery");
  await page.locator(".lib-entry").first().dragTo(canvas, { targetPosition: { x: 120, y: 150 } });
  await page.getByLabel("Search components").fill("bus bar");
  await page.locator(".lib-entry").first().dragTo(canvas, { targetPosition: { x: 520, y: 150 } });
  await expect(page.locator(".react-flow__node.react-flow__node-component")).toHaveCount(2);
  await waitForFile(folder, "canvas/connectivity.json", (v) => Object.keys((v as { components: object }).components).length === 2);
  expect(await fs.readdir(path.join(folder, "components"))).toHaveLength(2);

  // Drag from the battery's first handle to the bus bar's first handle.
  const nodes = page.locator(".react-flow__node-component");
  const from = nodes.nth(0).locator(".react-flow__handle").first();
  const to = nodes.nth(1).locator(".react-flow__handle").first();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 - 20, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("dialog", { name: "Choose a domain" }).getByRole("button", { name: "48 V", exact: true }).click();
  await waitForFile(folder, "nets/48v.json", (v) => (v as unknown[]).length === 1);
  const net = ((await readJson(folder, "nets/48v.json")) as { id: string; connectors: string[] }[])[0];
  expect(net.connectors).toHaveLength(2);
  expect(net.connectors[0].split("/")[0]).toMatch(/^cmp-/);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  expect(await netCount(folder, "24v")).toBe(0);
  void box;

  // Switch to a layer without 48 V: the edge greys out and both components dim.
  await page.getByLabel("Layer").selectOption("signals");
  await expect(page.locator(".react-flow__edge.inactive")).toHaveCount(1);
  await expect(page.locator(".cmp-node.dimmed")).toHaveCount(2);
  await page.getByLabel("Layer").selectOption("power");
  await expect(page.locator(".react-flow__edge.inactive")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Topology: create one, place both connectors from the tray, join them, type a length, name the harness.
  await page.getByRole("button", { name: "Topology" }).click();
  page.once("dialog", (d) => d.accept("Bench"));
  await page.getByRole("button", { name: "New topology" }).click();
  const topo = page.getByTestId("topology-canvas");
  const [c1, c2] = net.connectors.map((c) => c.split("/")[1]);
  await page.locator(".tray-item", { hasText: new RegExp(`^${c1}$`) }).first().dragTo(topo, { targetPosition: { x: 150, y: 200 } });
  await page.locator(".tray-item", { hasText: new RegExp(`^${c2}$`) }).first().dragTo(topo, { targetPosition: { x: 500, y: 200 } });
  await expect(page.locator(".ep-connector")).toHaveCount(2);
  const e1 = (await page.locator(".ep-connector").nth(0).boundingBox())!;
  const e2 = (await page.locator(".ep-connector").nth(1).boundingBox())!;
  await page.mouse.move(e1.x + e1.width / 2, e1.y + e1.height / 2);
  await page.mouse.down();
  await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByLabel("Segment length in mm").fill("420");
  await page.getByLabel("Segment length in mm").press("Enter");
  await page.getByPlaceholder("unnamed").fill("Battery leads");
  let topFiles: string[] = [];
  for (let i = 0; i < 50 && topFiles.length === 0; i++) {
    topFiles = await fs.readdir(path.join(folder, "topologies")).catch(() => [] as string[]);
    if (topFiles.length === 0) await page.waitForTimeout(100);
  }
  expect(topFiles).toHaveLength(1);
  await waitForFile(folder, `topologies/${topFiles[0]}`, (v) => (v as { segments: { length_mm?: number; harness?: { name: string } }[] }).segments[0]?.length_mm === 420 && (v as { segments: { harness?: { name: string } }[] }).segments[0]?.harness?.name === "Battery leads");
  await expect(page.locator(".netlist .mark.unrouted")).toHaveCount(0);

  // The topology has no errors now, so the BOM exports.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export BOM" }).click();
  const text = await fs.readFile((await (await download).path())!, "utf8");
  expect(text).toContain("Battery leads,wire,wires/awg12-red");
  expect(text.match(/,420,/g)?.length).toBe(2);
  expect(errors).toEqual([]);
});
