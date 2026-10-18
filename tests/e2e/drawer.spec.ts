import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { freshExample, openProject, readJson, waitForFile } from "./helpers";

/** The connector drawer, #53: every connector's type in one table, set in bulk. */

const GAUGE = "Strain gauge with amplifier";
const PWM = "Absolute encoder, PWM output";

type Def = { connectors: { designator: string; connector: string }[] };

test("bulk-retypes two definition rows from the drawer into project copies, leaving the shared catalogue alone", async ({ page }) => {
  const shared = await fs.readFile(path.join(process.cwd(), "library", "components", "strain-gauge.json"), "utf8");
  const folder = await freshExample("drawer");
  await openProject(page, folder);
  await page.getByRole("button", { name: "Connector drawer" }).click();
  const drawer = page.getByRole("dialog", { name: "Connector drawer" });

  // Definition rows carry a sharing count; the filter is the inventory, zeros included.
  await expect(drawer.getByRole("rowgroup", { name: GAUGE })).toContainText("4 components");
  const filter = drawer.getByLabel("Filter by type");
  await expect(filter.locator("option", { hasText: /^JST-GH-6 \(\d+\)$/ })).toHaveCount(1);
  await expect(filter.locator("option", { hasText: /\(0\)$/ }).first()).toBeAttached();

  await filter.selectOption({ label: (await filter.locator("option", { hasText: /^JST-GH-4 / }).textContent())! });
  await drawer.getByLabel(`Select ${GAUGE} J1`).check();
  await drawer.getByLabel(`Select ${PWM} J1`).check();

  const picker = drawer.getByLabel("Type for selected");
  await expect(drawer.getByText("library skill")).toBeVisible();
  await picker.selectOption("connectors/jst-gh-6");
  await drawer.getByRole("button", { name: "Set type of 2 selected" }).click();

  await waitForFile(folder, "library/components/strain-gauge.json", (v) => (v as Def).connectors[0].connector === "connectors/jst-gh-6");
  await waitForFile(folder, "library/components/pwm-encoder.json", (v) => (v as Def).connectors[0].connector === "connectors/jst-gh-6");
  expect(await fs.readFile(path.join(process.cwd(), "library", "components", "strain-gauge.json"), "utf8")).toBe(shared);
  // No component was detached.
  const components = await fs.readdir(path.join(folder, "components"));
  for (const f of components) expect(((await readJson(folder, `components/${f}`)) as { connectors?: unknown }).connectors).toBeUndefined();

  // One undo step takes back both.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(drawer.getByLabel(`Connector type of ${GAUGE} J1`)).toHaveValue("connectors/jst-gh-4");
  await expect(drawer.getByLabel(`Connector type of ${PWM} J1`)).toHaveValue("connectors/jst-gh-4");
});
