import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, readJson, waitForFile } from "./helpers";

/** The component inspector detaches a component from its definition and publishes a one-off as a definition (#66). */

const GAUGE = "cmp-22223k";
const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

type Cmp = { name: string; definition?: string; connectors?: { designator: string; connector: string }[] };
type Def = { id: string; name: string; connectors: { designator: string; connector: string }[] };

test("detaching a component gives it its own connectors, and one undo puts the definition back", async ({ page }) => {
  const folder = await freshExample("detach");
  await openProject(page, folder);
  await canvasSettled(page);
  await page.locator(`.react-flow__node[data-id="${GAUGE}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await expect(pane).toContainText("4 components share the definition");

  page.once("dialog", (d) => d.accept());
  await pane.getByRole("button", { name: "Detach from the definition" }).click();
  await waitForFile(folder, `components/${GAUGE}.json`, (v) => (v as Cmp).definition === undefined && (v as Cmp).connectors?.length === 1);
  await expect(pane).toContainText("one-off");
  await expect(pane.getByRole("button", { name: "Detach from the definition" })).toHaveCount(0);

  await page.keyboard.press(undo);
  await waitForFile(folder, `components/${GAUGE}.json`, (v) => (v as Cmp).definition === "components/strain-gauge" && (v as Cmp).connectors === undefined);
  await expect(pane).toContainText("4 components share the definition");
});

test("publishing a one-off writes a project definition under a free id and points the component at it", async ({ page }) => {
  const folder = await freshExample("publish");
  await openProject(page, folder);
  await canvasSettled(page);
  page.once("dialog", (d) => d.accept("Strain gauge"));
  await page.getByRole("button", { name: "New blank component" }).click();
  const pane = page.locator(".pane-right");
  await expect(pane.locator("input").first()).toHaveValue("Strain gauge");
  await pane.getByLabel("New connector type").selectOption("connectors/jst-gh-6");
  await pane.getByRole("button", { name: "Add connector" }).click();

  await pane.getByRole("button", { name: "Publish as a definition" }).click();
  // "strain-gauge" is a shared entry already, so the new definition takes the next free id.
  const file = "library/components/strain-gauge-2.json";
  await waitForFile(folder, file, (v) => (v as Def).connectors.length === 1);
  expect(await readJson(folder, file)).toEqual({ id: "strain-gauge-2", name: "Strain gauge", connectors: [{ designator: "J1", connector: "connectors/jst-gh-6" }] });
  await expect(pane).toContainText("Only this component uses the definition.");
  await expect(fs.access(path.join(folder, "library/components/strain-gauge.json"))).rejects.toThrow();

  const published = async () => {
    for (const f of await fs.readdir(path.join(folder, "components"))) {
      const c = (await readJson(folder, `components/${f}`)) as Cmp;
      if (c.name === "Strain gauge") return c;
    }
  };
  await expect.poll(async () => (await published())?.definition).toBe("components/strain-gauge-2");
  expect((await published())?.connectors).toBeUndefined();
});
