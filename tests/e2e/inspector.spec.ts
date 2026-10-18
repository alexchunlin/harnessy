import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, readJson, waitForFile } from "./helpers";

/** The component inspector adds and retypes connectors (#54), on a shared definition and on a one-off. */

const GAUGE = "cmp-22223k";
const COPY = "library/components/strain-gauge.json";
const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

type Def = { connectors: { designator: string; connector: string }[] };
const exists = (file: string) => fs.access(file).then(() => true, () => false);

test("adding a connector to a shared definition takes a project copy, marks it shadowed, and gives it back", async ({ page }) => {
  const folder = await freshExample("inspector-shared");
  await openProject(page, folder);
  await canvasSettled(page);
  await page.locator(`.react-flow__node[data-id="${GAUGE}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await expect(pane).toContainText("4 components share the definition");
  await expect(pane.locator(".shadow-mark")).toHaveCount(0);
  const entry = page.locator(".lib-entry", { hasText: "Strain gauge with amplifier" });
  await expect(entry.locator(".shadow-mark")).toHaveCount(0);

  // A taken designator is refused.
  await pane.getByLabel("New connector designator").fill("J1");
  page.once("dialog", (d) => d.accept());
  await pane.getByRole("button", { name: "Add connector" }).click();
  await expect(pane.locator(".insp-connector")).toHaveCount(1);

  await pane.getByLabel("New connector designator").fill("J9");
  await pane.getByLabel("New connector type").selectOption("connectors/jst-gh-6");
  await pane.getByRole("button", { name: "Add connector" }).click();
  await waitForFile(folder, COPY, (v) => (v as Def).connectors.some((c) => c.designator === "J9" && c.connector === "connectors/jst-gh-6"));
  await expect(pane.locator(".shadow-mark")).toBeVisible();
  await expect(entry.locator(".shadow-mark")).toBeVisible();

  // Retype from the inspector; each edit is one undo step.
  await pane.getByLabel("Connector type of Strain gauge front J1").selectOption("connectors/jst-gh-2");
  await waitForFile(folder, COPY, (v) => (v as Def).connectors[0].connector === "connectors/jst-gh-2");
  await page.keyboard.press(undo);
  await waitForFile(folder, COPY, (v) => (v as Def).connectors[0].connector === "connectors/jst-gh-4" && (v as Def).connectors.length === 2);

  // Giving the copy back deletes the file and the shared entry stands again.
  page.once("dialog", (d) => d.accept());
  await pane.getByRole("button", { name: "Give back to the shared entry" }).click();
  await expect(pane.locator(".insp-connector")).toHaveCount(1);
  await expect(entry.locator(".shadow-mark")).toHaveCount(0);
  await expect.poll(() => exists(path.join(folder, COPY))).toBe(false);
});

test("a one-off adds and retypes its own inline connectors, each one undo step", async ({ page }) => {
  const folder = await freshExample("inspector-oneoff");
  await openProject(page, folder);
  await canvasSettled(page);
  page.once("dialog", (d) => d.accept("Brake board"));
  await page.getByRole("button", { name: "New blank component" }).click();
  const pane = page.locator(".pane-right");
  await expect(pane.locator("input").first()).toHaveValue("Brake board");
  await expect(pane.getByLabel("New connector designator")).toHaveValue("J1");
  await pane.getByLabel("New connector type").selectOption("connectors/jst-gh-6");
  await pane.getByRole("button", { name: "Add connector" }).click();
  await pane.getByLabel("Connector type of Brake board J1").selectOption("connectors/jst-gh-4");

  const files = async () => {
    for (const f of await fs.readdir(path.join(folder, "components"))) {
      const c = (await readJson(folder, `components/${f}`)) as { name: string; connectors?: Def["connectors"] };
      if (c.name === "Brake board") return c.connectors;
    }
  };
  await expect.poll(files).toEqual([{ designator: "J1", connector: "connectors/jst-gh-4" }]);
  await page.keyboard.press(undo);
  await expect.poll(files).toEqual([{ designator: "J1", connector: "connectors/jst-gh-6" }]);
  await page.keyboard.press(undo);
  await expect.poll(files).toEqual([]);
  expect(await exists(path.join(folder, "library", "components"))).toBe(false);
});
