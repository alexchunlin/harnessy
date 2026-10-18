import { expect, test, type Page } from "@playwright/test";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

const TOPOLOGY = "topologies/top-222268.json";
/** Battery MAIN to the in-line switch IN: the Battery lead's anchor segment, no tie points. */
const BATTERY_SEGMENT = "seg-22228f";

async function selectBatteryLead(page: Page) {
  await page.getByRole("button", { name: "Topology", exact: true }).click();
  await canvasSettled(page);
  await page.locator(`.react-flow__edge[data-id="${BATTERY_SEGMENT}"] .react-flow__edge-interaction`).dispatchEvent("click");
  await expect(page.getByRole("heading", { name: "Segment", exact: true })).toBeVisible();
}

const stretchField = (page: Page) => page.getByTestId("stretches").locator("li").first().getByRole("spinbutton");

test("a project default shows as the placeholder of an empty stretch, and a harness default overrides it", async ({ page }) => {
  const folder = await freshExample("slack-defaults");
  await openProject(page, folder);
  await selectBatteryLead(page);
  await expect(stretchField(page)).toHaveAttribute("placeholder", "0");

  await page.getByRole("button", { name: "Settings" }).click();
  const projectField = page.getByLabel("Project default slack (mm)");
  await expect(projectField).toHaveValue("0");
  await projectField.fill("-3");
  await projectField.press("Enter");
  await expect(projectField).toHaveValue("0");
  await projectField.fill("15");
  await projectField.press("Enter");
  await waitForFile(folder, "project.json", (v) => (v as { slack_mm?: number }).slack_mm === 15);
  await page.locator(".dialog").getByRole("button", { name: "Close" }).click();

  await expect(stretchField(page)).toHaveValue("");
  await expect(stretchField(page)).toHaveAttribute("placeholder", "15");

  const harnessField = page.getByLabel("Harness default slack (mm)");
  await expect(harnessField).toHaveAttribute("placeholder", "15");
  await harnessField.fill("-1");
  await harnessField.press("Enter");
  await expect(harnessField).toHaveValue("");
  await harnessField.fill("30");
  await harnessField.press("Enter");
  await expect(stretchField(page)).toHaveAttribute("placeholder", "30");
  // Editing the harness name keeps its default.
  await page.getByLabel("Harness name").fill("Battery lead, main");
  await waitForFile(folder, TOPOLOGY, (v) => {
    const seg = (v as { segments: { id: string; harness?: { name: string; slack_mm?: number } }[] }).segments.find((s) => s.id === BATTERY_SEGMENT);
    return seg?.harness?.name === "Battery lead, main" && seg.harness.slack_mm === 30;
  });

  await page.reload();
  await selectBatteryLead(page);
  await expect(page.getByLabel("Harness default slack (mm)")).toHaveValue("30");
  await expect(stretchField(page)).toHaveAttribute("placeholder", "30");
});
