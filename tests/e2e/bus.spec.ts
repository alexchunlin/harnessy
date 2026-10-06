import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

/** Buses (#22): the 48 V rail is twelve nets that read, glow and are named as one. */

const BUS_BAR = "cmp-22222p";
const ROBOCLAW_L = "cmp-222234";

test("hovering one 48 V net glows the whole rail and its bridges; the bus is named once and lights every route in the topology", async ({ page }) => {
  const folder = await freshExample("bus");
  await openProject(page, folder);
  await canvasSettled(page);

  // Every bridge draws inside its box: the bus bar, the switch, the MIB and three RoboClaws.
  await expect(page.locator(".cmp-bridge")).toHaveCount(6);
  await expect(page.locator(`.react-flow__node[data-id="${ROBOCLAW_L}"] .cmp-bridge`)).toHaveCount(1);
  await expect(page.locator(".net-halo")).toHaveCount(0);

  // Hover a lug on the bus bar: its net glows at full weight, the other eleven lighter, and both bridges on the rail light up.
  const lug = page.locator(`.react-flow__node[data-id="${BUS_BAR}"] .cmp-connector`, { hasText: /L1$/ });
  await lug.hover();
  await expect(page.locator(".net-halo")).toHaveCount(12);
  await expect(page.locator(".net-halo:not(.bus)")).toHaveCount(1);
  await expect(page.locator(".cmp-bridge.lit")).toHaveCount(2);
  await page.mouse.move(5, 300);
  await expect(page.locator(".net-halo")).toHaveCount(0);

  // The bus bar's inspector lists the bus through it; picking it selects all twelve nets and opens the bus inspector.
  await page.locator(`.react-flow__node[data-id="${BUS_BAR}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await expect(pane).toContainText("Buses through here");
  await pane.locator(".bus-list li", { hasText: "48 V bus via Bus bar" }).click();
  await expect(pane.locator("h3", { hasText: "Bus" })).toBeVisible();
  await expect(pane).toContainText("12 nets joined through");
  await expect(pane.locator(".bus-members li")).toHaveCount(12);

  // Name it once. The name lands on one net's file and every member reads it.
  await page.getByLabel("Bus name").fill("Main rail");
  await waitForFile(folder, "nets/48v.json", (v) => (v as { bus?: string }[]).filter((n) => n.bus === "Main rail").length === 1);
  await expect(pane.locator(".bus-label")).toHaveText("Main rail");
  await pane.locator(".bus-members li").last().click();
  await expect(pane.locator("h3", { hasText: "Net" })).toBeVisible();
  await expect(pane.locator(".bus-label")).toHaveText("Main rail");
  await expect(page.getByPlaceholder(/^Main rail: /)).toBeVisible();

  // Pick the bus again and look at the topology: every member's route is lit, across the battery leads and both power harnesses.
  await pane.locator(".bus-label").click();
  await expect(pane.locator(".bus-members li")).toHaveCount(12);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  expect(await page.locator(".react-flow__edge.on-route").count()).toBeGreaterThanOrEqual(12);
});
