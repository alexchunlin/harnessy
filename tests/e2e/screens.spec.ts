import { expect, test } from "@playwright/test";
import { freshExample, openProject } from "./helpers";

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
  // Connector endpoints show only their designator; the component name is the hover title.
  const connector = page.locator(".ep-connector").first();
  expect(await connector.textContent()).toMatch(/^[A-Za-z0-9_-]+$/);
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
