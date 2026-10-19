import { expect, test, type Page } from "@playwright/test";
import { canvasSettled, freshExample, openProject, readJson, topologyPieces, waitForFile } from "./helpers";

const TOPOLOGY_ID = "top-222268";
const TOPOLOGY_CANVAS = "canvas/top-222268.json";
type Canvas = { pieces: Record<string, { offset?: { x: number; y: number }; turns?: number }> };

async function openTopology(page: Page) {
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
}

const turnsIn = async (folder: string, piece: string) => ((await readJson(folder, TOPOLOGY_CANVAS)) as Canvas).pieces[piece]?.turns;

test("R with an endpoint selected turns its harness, survives a reload, and R typed into a field turns nothing", async ({ page }) => {
  const folder = await freshExample("turn-endpoint");
  await openProject(page, folder);
  await openTopology(page);
  // A breakout is a small box with no label over it, so a click lands on it.
  const piece = (await topologyPieces(folder, TOPOLOGY_ID)).find((p) => p.built && [...p.kinds.values()].includes("breakout"))!;
  const breakout = [...piece.kinds].find(([, k]) => k === "breakout")![0];
  const node = page.locator(`.react-flow__node[data-id="${breakout}"]`);

  await node.click();
  const kind = page.locator(".pane-right select").first();
  await expect(kind).toHaveValue("breakout");
  await kind.focus();
  await page.keyboard.press("r");
  await page.waitForTimeout(400);
  expect(await turnsIn(folder, piece.id)).toBeUndefined();

  // The breakout is still selected. Leave the field and R turns its harness.
  await kind.evaluate((el) => (el as unknown as { blur(): void }).blur());
  await page.keyboard.press("r");
  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[piece.id]?.turns === 1);
  // Only positions turn. The endpoint and the box title stay upright.
  await page.waitForTimeout(600);
  expect(await node.evaluate((el) => (globalThis as unknown as { getComputedStyle(e: unknown): { transform: string } }).getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, )/);
  expect(await page.locator(`.react-flow__node[data-id="harness:${piece.id}"] .harness-box-title`).evaluate((el) => (globalThis as unknown as { getComputedStyle(e: unknown): { transform: string } }).getComputedStyle(el).transform)).toBe("none");

  // After a reload the app holds the turn: one more press makes two.
  await page.reload();
  await openTopology(page);
  await page.waitForTimeout(600);
  await node.click();
  await page.keyboard.press("r");
  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[piece.id]?.turns === 2);
});

test("R with a harness box selected turns that harness, and one undo takes the turn back", async ({ page }) => {
  const folder = await freshExample("turn-box");
  await openProject(page, folder);
  await openTopology(page);
  const piece = (await topologyPieces(folder, TOPOLOGY_ID)).find((p) => p.built)!;
  const title = page.locator(`.react-flow__node[data-id="harness:${piece.id}"] .harness-box-title`);
  await title.click();
  await expect(page.locator(`.react-flow__node[data-id="harness:${piece.id}"]`)).toHaveClass(/box-selected/);
  await page.keyboard.press("r");
  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[piece.id]?.turns === 1);
  await page.keyboard.press("ControlOrMeta+z");
  await waitForFile(folder, TOPOLOGY_CANVAS, (v) => (v as Canvas).pieces[piece.id] === undefined);
});
