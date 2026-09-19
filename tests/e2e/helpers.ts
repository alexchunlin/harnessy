import { promises as fs } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

export const E2E_HOME = process.env.HARNESSY_E2E_HOME ?? "/tmp/harnessy-e2e";
const REPO = process.cwd();

/** Copy the RAMMP example into the e2e home under a fresh name and return its path. */
export async function freshExample(name: string): Promise<string> {
  const dest = path.join(E2E_HOME, name);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(E2E_HOME, { recursive: true });
  await fs.cp(path.join(REPO, "examples", "rammp-gen1.5"), dest, { recursive: true });
  return dest;
}

export async function openProject(page: Page, folder: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByPlaceholder("Go to path").fill(folder);
  await page.getByRole("button", { name: "Go" }).click();
  await page.getByRole("button", { name: "Open this project" }).click();
  await page.getByRole("button", { name: "Connectivity" }).waitFor();
}

export async function readJson(folder: string, rel: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(folder, rel), "utf8"));
}

/** Wait until the app reports the document saved and the given file predicate holds. */
export async function waitForFile(folder: string, rel: string, predicate: (value: unknown) => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const value = await readJson(folder, rel);
      if (predicate(value)) return;
    } catch {
      // not written yet
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${rel}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
