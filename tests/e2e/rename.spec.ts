import { promises as fs } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, readJson, waitForFile } from "./helpers";

/** The component inspector renames a connector and carries its wiring (#56). */

const DCDC = "cmp-22222e";
const COPY = "library/components/dcdc-48-24.json";
const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

type Def = { connectors: { designator: string; connector: string }[] };

/** Every connector address the nets and topology files mention. */
async function addresses(folder: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of ["nets", "topologies"]) {
    for (const name of await fs.readdir(path.join(folder, dir))) {
      const text = await fs.readFile(path.join(folder, dir, name), "utf8");
      for (const m of text.matchAll(/cmp-[a-z0-9]{6}\/[A-Za-z0-9_-]+/g)) out.push(m[0]);
    }
  }
  return out;
}

test("renaming a connector on a shared definition commits on blur, keeps its net, and undoes in one step", async ({ page }) => {
  const shared = await fs.readFile(path.join(process.cwd(), COPY), "utf8");
  const folder = await freshExample("rename-shared");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openProject(page, folder);
  await canvasSettled(page);
  const edges = await page.locator(".react-flow__edge").count();
  await page.locator(`.react-flow__node[data-id="${DCDC}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");

  // Typing alone writes nothing; the rename lands on blur.
  const field = pane.getByLabel("Designator IN", { exact: true });
  await field.fill("PWRIN");
  await page.waitForTimeout(600);
  expect(await fs.access(path.join(folder, COPY)).then(() => true, () => false)).toBe(false);
  await field.blur();

  await waitForFile(folder, COPY, (v) => (v as Def).connectors[0].designator === "PWRIN");
  expect(await fs.readFile(path.join(process.cwd(), COPY), "utf8")).toBe(shared);
  await expect.poll(async () => (await addresses(folder)).filter((a) => a === `${DCDC}/PWRIN`).length).toBe(2);
  expect(await addresses(folder)).not.toContain(`${DCDC}/IN`);

  // The renamed row still lists its net, and the canvas still draws it.
  const row = pane.locator(".insp-connector").first();
  await expect(row.getByLabel("Designator PWRIN", { exact: true })).toHaveValue("PWRIN");
  await expect(row.locator(".insp-nets .chip")).toHaveCount(1);
  await expect(page.locator(`.react-flow__node[data-id="${DCDC}"] .cmp-designator`, { hasText: /(^| )PWRIN$/ })).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(edges);

  await page.keyboard.press(undo);
  await expect(pane.getByLabel("Designator IN", { exact: true })).toHaveValue("IN");
  await expect.poll(async () => (await addresses(folder)).filter((a) => a === `${DCDC}/IN`).length).toBe(2);
  expect(errors).toEqual([]);
});

test("a duplicate designator is refused and the field goes back", async ({ page }) => {
  const folder = await freshExample("rename-duplicate");
  await openProject(page, folder);
  await canvasSettled(page);
  await page.locator(`.react-flow__node[data-id="${DCDC}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  let said = "";
  page.once("dialog", (d) => {
    said = d.message();
    void d.accept();
  });
  await pane.getByLabel("Designator IN", { exact: true }).fill("OUT1");
  await pane.getByLabel("Designator IN", { exact: true }).press("Enter");
  await expect.poll(() => said).toMatch(/already has a connector OUT1/);
  await expect(pane.getByLabel("Designator IN", { exact: true })).toHaveValue("IN");
});

test("a one-off renames its own inline connector", async ({ page }) => {
  const folder = await freshExample("rename-oneoff");
  await openProject(page, folder);
  await canvasSettled(page);
  page.once("dialog", (d) => d.accept("Brake board"));
  await page.getByRole("button", { name: "New blank component" }).click();
  const pane = page.locator(".pane-right");
  await expect(pane.locator("input").first()).toHaveValue("Brake board");
  await pane.getByRole("button", { name: "Add connector" }).click();
  await pane.getByLabel("Designator J1", { exact: true }).fill("BRAKE");
  await pane.getByLabel("Designator J1", { exact: true }).press("Enter");

  const files = async () => {
    for (const f of await fs.readdir(path.join(folder, "components"))) {
      const c = (await readJson(folder, `components/${f}`)) as { name: string; connectors?: Def["connectors"] };
      if (c.name === "Brake board") return c.connectors?.map((x) => x.designator);
    }
  };
  await expect.poll(files).toEqual(["BRAKE"]);
});
