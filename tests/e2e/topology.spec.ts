import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

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
