import { expect, test, type Locator, type Page } from "@playwright/test";
import { canvasSettled, freshExample, openProject } from "./helpers";

/** Colour through the bundle, #20: fanned bundle ends, click a strand to follow one conductor end to end. */

/** The battery lead: battery MAIN to the in-line switch IN, one segment carrying the 48 V pair, red then black. */
const NET = "net-22223y";
const NET_LABEL = "48 V bus via Bus bar: 48 V battery + BMS MAIN to In-line switch / fuse IN";
const RED = `${NET}#0`;
const BLACK = `${NET}#1`;

/** A screen point just under halfway along a strand's hit path. */
async function pointOnStrand(strand: Locator): Promise<{ x: number; y: number }> {
  return strand.locator("path.strand-hit").evaluate((el) => {
    type Path = { getTotalLength(): number; getPointAtLength(n: number): { x: number; y: number }; getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } };
    const path = el as unknown as Path;
    const m = path.getPointAtLength(path.getTotalLength() * 0.45);
    const c = path.getScreenCTM();
    return { x: m.x * c.a + m.y * c.c + c.e, y: m.x * c.b + m.y * c.d + c.f };
  });
}

async function openTopologyOnTheBatteryLead(page: Page): Promise<void> {
  const folder = await freshExample("conductors");
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  // Picking the net in the list zooms to its route, so the strands are big enough to hit.
  await page.locator(".netlist li", { hasText: NET_LABEL }).click();
  await page.waitForTimeout(500);
}

test("a segment carrying the 48 V pair fans into a red and a black strand at each end", async ({ page }) => {
  await openTopologyOnTheBatteryLead(page);
  const red = page.locator(`.strand[data-conductor="${RED}"]`);
  const black = page.locator(`.strand[data-conductor="${BLACK}"]`);
  await expect(red).toHaveCount(2);
  await expect(black).toHaveCount(2);
  for (const s of await red.locator(".strand-line").all()) await expect(s).toHaveAttribute("stroke", "red");
  for (const s of await black.locator(".strand-line").all()) await expect(s).toHaveAttribute("stroke", "black");
  expect(await red.first().locator("title").textContent()).toBe(`${NET_LABEL}: conductor 1 of 2, red`);
  // A purchased patch cable is one dashed line with its name, never a fan.
  await expect(page.locator('.react-flow__edge[data-id="seg-22226b"] .strand')).toHaveCount(0);
});

test("clicking the black strand lights it at the far end, dims the red one, and names it in the inspector", async ({ page }) => {
  await openTopologyOnTheBatteryLead(page);
  const black = page.locator(`.strand[data-conductor="${BLACK}"]`);
  const red = page.locator(`.strand[data-conductor="${RED}"]`);
  const at = await pointOnStrand(black.first());
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(0, 0);
  // Both ends of the black conductor are lit; both red strands are dimmed.
  for (const s of await black.all()) await expect(s).toHaveClass(/lit/);
  for (const s of await red.all()) await expect(s).toHaveClass(/dim/);
  // The route is lit as the net's would be, and the segment is not what got selected.
  await expect(page.locator('.react-flow__edge[data-id="seg-22228f"]')).toHaveClass(/on-route/);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  const inspector = page.getByTestId("conductor-inspector");
  await expect(inspector).toContainText(NET_LABEL);
  await expect(inspector).toContainText("2 of 2");
  await expect(inspector).toContainText("black, 8 AWG silicone, black");
  await expect(inspector.locator("ul li")).toHaveText(["48 V battery + BMS MAIN", "In-line switch / fuse IN"]);
});

test("hovering a strand previews its highlight without changing the selection", async ({ page }) => {
  await openTopologyOnTheBatteryLead(page);
  const black = page.locator(`.strand[data-conductor="${BLACK}"]`);
  const red = page.locator(`.strand[data-conductor="${RED}"]`);
  const onBlack = await pointOnStrand(black.first());
  await page.mouse.click(onBlack.x, onBlack.y);
  await page.mouse.move(0, 0);
  await expect(page.getByTestId("conductor-inspector")).toContainText("2 of 2");

  // Over the red strand both light up: the red one as a preview, the black one as the selection.
  const onRed = await pointOnStrand(red.first());
  await page.mouse.move(onRed.x, onRed.y);
  for (const s of await red.all()) await expect(s).toHaveClass(/lit/);
  for (const s of await black.all()) await expect(s).toHaveClass(/lit/);
  await expect(page.getByTestId("conductor-inspector")).toContainText("2 of 2");

  // Leaving puts the red strand back to dimmed; the selection never moved.
  await page.mouse.move(0, 0);
  for (const s of await red.all()) await expect(s).toHaveClass(/dim/);
  await expect(page.getByTestId("conductor-inspector")).toContainText("2 of 2");

  // Escape clears it like any topology selection.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("conductor-inspector")).toHaveCount(0);
  for (const s of await red.all()) await expect(s).not.toHaveClass(/dim/);
});
