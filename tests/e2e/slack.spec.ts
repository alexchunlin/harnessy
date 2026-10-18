import { expect, test, type Page } from "@playwright/test";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

const TOPOLOGY = "topologies/top-222268.json";
/** Battery MAIN to the in-line switch IN: one built segment with no tie points. */
const BATTERY_SEGMENT = "seg-22228f";

async function selectBatteryLead(page: Page, folder: string) {
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  await page.locator(`.react-flow__edge[data-id="${BATTERY_SEGMENT}"] .react-flow__edge-interaction`).dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Segment", exact: true })).toBeVisible();
}

test("slack typed on a stretch saves to the segment and shows in the inspector after reload", async ({ page }) => {
  const folder = await freshExample("slack");
  await selectBatteryLead(page, folder);
  const stretches = page.getByTestId("stretches").locator("li");
  await expect(stretches).toHaveCount(1);
  const field = stretches.first().getByRole("spinbutton");
  // A negative value is refused and the field goes back to unset.
  await field.fill("-5");
  await field.press("Enter");
  await expect(field).toHaveValue("");
  await field.fill("25");
  await field.press("Enter");
  await waitForFile(folder, TOPOLOGY, (v) => (v as { segments: { id: string; slack_mm?: number }[] }).segments.find((s) => s.id === BATTERY_SEGMENT)?.slack_mm === 25);

  await page.reload();
  await selectBatteryLead(page, folder);
  await expect(page.getByTestId("stretches").locator("li").first().getByRole("spinbutton")).toHaveValue("25");
});
