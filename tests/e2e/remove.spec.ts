import { expect, test } from "@playwright/test";
import { canvasSettled, freshExample, openProject, waitForFile } from "./helpers";

/** The component inspector removes a connector and cleans up after it (#58). */

const GAUGE = "cmp-22223k";
const GAUGES = ["cmp-22223k", "cmp-22223p", "cmp-22223s", "cmp-22223v"];
const COPY = "library/components/strain-gauge.json";
const TOPOLOGY = "topologies/top-222268.json";
const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

type Net = { connectors: string[] };
type Topology = { endpoints: { id: string; kind: string; connector?: string }[]; segments: { ends: string[] }[] };

const onGauge = (a: string) => GAUGES.some((g) => a === `${g}/J1`);
const gaugeNets = (v: unknown) => (v as Net[]).filter((n) => n.connectors.some(onGauge)).length;
const gaugeEnds = (v: unknown) => (v as Topology).endpoints.filter((e) => e.kind === "connector" && onGauge(e.connector!)).length;

test("removing a connector from a shared definition takes its nets and endpoints on every gauge, keeps the DRC panel clean, and undoes in one step", async ({ page }) => {
  const folder = await freshExample("remove-shared");
  await openProject(page, folder);
  await canvasSettled(page);
  await page.getByRole("button", { name: /DRC/ }).click();
  const errors = page.locator(".drc-panel .drc-error");
  await expect(errors).toHaveCount(0);

  await page.locator(`.react-flow__node[data-id="${GAUGE}"] .cmp-title`).click();
  const pane = page.locator(".pane-right");
  await expect(pane.locator(".insp-connector")).toHaveCount(1);
  page.once("dialog", (d) => {
    expect(d.message()).toContain("all 4 components");
    void d.accept();
  });
  await pane.getByRole("button", { name: "Remove J1" }).click();
  await expect(pane.locator(".insp-connector")).toHaveCount(0);

  await waitForFile(folder, COPY, (v) => (v as { connectors: unknown[] }).connectors.length === 0);
  await waitForFile(folder, "nets/analog.json", (v) => gaugeNets(v) === 0);
  await waitForFile(folder, TOPOLOGY, (v) => gaugeEnds(v) === 0);
  await expect(errors).toHaveCount(0);
  await expect(page.locator(".drc-panel")).not.toContainText("dangling-reference");

  await page.keyboard.press(undo);
  await expect(pane.locator(".insp-connector")).toHaveCount(1);
  await waitForFile(folder, "nets/analog.json", (v) => gaugeNets(v) === 4);
  await waitForFile(folder, TOPOLOGY, (v) => gaugeEnds(v) === 4);
  await expect(errors).toHaveCount(0);
});

test("a one-off removes its own connector without asking when no net uses it", async ({ page }) => {
  const folder = await freshExample("remove-oneoff");
  await openProject(page, folder);
  await canvasSettled(page);
  page.once("dialog", (d) => d.accept("Brake board"));
  await page.getByRole("button", { name: "New blank component" }).click();
  const pane = page.locator(".pane-right");
  await pane.getByRole("button", { name: "Add connector" }).click();
  await expect(pane.locator(".insp-connector")).toHaveCount(1);
  await pane.getByRole("button", { name: "Remove J1" }).click();
  await expect(pane.locator(".insp-connector")).toHaveCount(0);
  await page.keyboard.press(undo);
  await expect(pane.locator(".insp-connector")).toHaveCount(1);
});
