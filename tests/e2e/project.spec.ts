import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { E2E_HOME, freshExample, openProject, readJson, waitForFile } from "./helpers";

test("opens the RAMMP example and exports both CSV files", async ({ page }) => {
  const folder = await freshExample("export");
  await openProject(page, folder);
  await page.getByRole("button", { name: "Topology" }).click();
  const downloads: string[] = [];
  page.on("download", (d) => {
    downloads.push(d.suggestedFilename());
  });
  const first = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export BOM" }).click();
  const d1 = await first;
  const d2 = await page.waitForEvent("download");
  const texts = await Promise.all([d1, d2].map(async (d) => fs.readFile((await d.path())!, "utf8")));
  const cut = texts[[d1, d2].findIndex((d) => d.suggestedFilename().endsWith("cut-list.csv"))];
  const summary = texts[[d1, d2].findIndex((d) => d.suggestedFilename().endsWith("summary.csv"))];
  expect(cut.split("\n")[0]).toBe("harness,row,ref,part_number,description,color,qty,length_mm,from,to,net,domain,notes");
  expect(cut.split("\n").length).toBeGreaterThan(10);
  expect(summary).toContain("harness,row,ref,part_number,description,qty,length_mm");
  expect(downloads).toHaveLength(2);
});

test("switching layers is remembered per project and never touches the project folder", async ({ page }) => {
  const folder = await freshExample("layers");
  const before = await fs.readdir(path.join(folder, "canvas"));
  await openProject(page, folder);
  await page.getByLabel("Layer").selectOption("power");
  await page.waitForTimeout(200);
  await page.reload();
  await page.getByRole("button", { name: folder }).click();
  await expect(page.getByLabel("Layer")).toHaveValue("power");
  expect(await fs.readdir(path.join(folder, "canvas"))).toEqual(before);
});

test("renaming the project saves only project.json", async ({ page }) => {
  const folder = await freshExample("rename");
  await openProject(page, folder);
  const stamps = new Map<string, number>();
  for (const f of ["project.json", "canvas/connectivity.json", "drc.json"]) stamps.set(f, (await fs.stat(path.join(folder, f))).mtimeMs);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Project name").fill("RAMMP renamed");
  await page.locator(".dialog").getByRole("button", { name: "Close" }).click();
  await waitForFile(folder, "project.json", (v) => (v as { name: string }).name === "RAMMP renamed");
  expect((await readJson(folder, "project.json") as { schema: number }).schema).toBe(1);
  for (const f of ["canvas/connectivity.json", "drc.json"]) expect((await fs.stat(path.join(folder, f))).mtimeMs).toBe(stamps.get(f));
});

test("a folder without project.json offers to create one", async ({ page }) => {
  const folder = path.join(E2E_HOME, "empty-folder");
  await fs.rm(folder, { recursive: true, force: true });
  await fs.mkdir(folder, { recursive: true });
  await page.goto("/");
  await page.getByPlaceholder("Go to path").fill(folder);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Use this folder" }).click();
  await page.getByLabel("Project name").fill("Fresh");
  await page.getByRole("button", { name: "Create project here" }).click();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
  const project = (await readJson(folder, "project.json")) as { name: string; domains: unknown[]; layers: unknown[] };
  expect(project.name).toBe("Fresh");
  expect(project.domains).toHaveLength(13);
  expect(project.layers).toHaveLength(3);
  expect(await fs.readdir(path.join(folder, "nets"))).toHaveLength(13);
});
