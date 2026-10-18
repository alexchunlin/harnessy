import { expect, test, type Page } from "@playwright/test";
import { canvasSettled, freshExample, openProject } from "./helpers";

/** Pin checks (#49): the DRC panel reports a doubled pin, and an assembly-only net asks for no pins. */

const BUS_BAR = "cmp-22222p";
const ROBOCLAW_L = "cmp-222234";
const MAIN = "cmp-22222k/MAIN";

async function openNetOnBus(page: Page, component: string, bus: string, member: string) {
  await page.locator(`.react-flow__node[data-id="${component}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await pane.locator(".bus-list li", { hasText: bus }).click();
  await pane.locator(".bus-members li", { hasText: member }).click();
  await expect(pane.locator("h3", { hasText: "Net" })).toBeVisible();
  return pane;
}

test("two conductors on one pin show as an error in the DRC panel until a pin changes", async ({ page }) => {
  const folder = await freshExample("pin-checks-duplicate");
  await openProject(page, folder);
  await canvasSettled(page);

  const pane = await openNetOnBus(page, BUS_BAR, "48 V bus via Bus bar", "MAIN to In-line switch");
  const fields = pane.locator(`.net-connector[data-address="${MAIN}"]`).getByRole("textbox");
  await fields.nth(0).fill("1");
  await fields.nth(0).press("Enter");
  await fields.nth(1).fill("1");
  await fields.nth(1).press("Enter");

  await page.getByRole("button", { name: /DRC/ }).click();
  const panel = page.locator(".drc-panel");
  const duplicate = panel.locator(".drc-error", { hasText: "pin-duplicate" });
  await expect(duplicate).toHaveCount(1);
  await expect(duplicate).toContainText("MAIN pin 1 carries");
  await expect(duplicate).toContainText("conductor 1 and");
  await expect(duplicate).toContainText("conductor 2");

  await fields.nth(1).fill("2");
  await fields.nth(1).press("Enter");
  await expect(duplicate).toHaveCount(0);

  // A pin-missing row targets a net and connector, and clicking it opens the net.
  await panel.locator(".drc-warning", { hasText: "connector-idle" }).first().locator(".drc-jump").click();
  await expect(pane.locator("h3", { hasText: "Component" })).toBeVisible();
  await panel.locator(".drc-warning", { hasText: "pin-missing" }).first().locator(".drc-jump").click();
  await expect(pane.locator("h3", { hasText: "Net" })).toBeVisible();
  await expect(pane.locator(".pin-field").first()).toBeVisible();
});

test("a net routed only over a purchased assembly shows no pin fields and raises no pin-missing", async ({ page }) => {
  const folder = await freshExample("pin-checks-assembly");
  await openProject(page, folder);
  await canvasSettled(page);

  const pane = await openNetOnBus(page, ROBOCLAW_L, "CAN bus via RoboClaw L", "MIB CAN-A to RoboClaw L CAN-A");
  await expect(pane.locator(".net-connector")).toHaveCount(2);
  await expect(pane.locator(".pin-field")).toHaveCount(0);
  await expect(pane.getByRole("button", { name: "Number in order" })).toHaveCount(0);

  await page.getByRole("button", { name: /DRC/ }).click();
  const panel = page.locator(".drc-panel");
  // Built nets still ask for pins; the patch cable's does not.
  await expect(panel.locator(".drc-warning", { hasText: "pin-missing" }).first()).toBeVisible();
  await expect(panel.locator(".drc-warning", { hasText: "MIB CAN-A to RoboClaw L CAN-A" }).filter({ hasText: "pin-missing" })).toHaveCount(0);
});
