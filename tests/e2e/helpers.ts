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

/** Wait until React Flow has fitted the view, so every box has its on-screen position. */
export async function canvasSettled(page: Page): Promise<void> {
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForFunction(() => {
    const doc = (globalThis as unknown as { document: { querySelector(sel: string): { style: { transform: string } } | null } }).document;
    const t = doc.querySelector(".react-flow__viewport")?.style.transform;
    return !!t && t !== "translate(0px, 0px) scale(1)";
  });
  await page.waitForTimeout(150);
}

/** A screen point halfway along a visible, uncovered net edge, plus its net id. */
export async function pointOnAnEdge(page: Page): Promise<{ x: number; y: number; netId: string }> {
  // Runs in the browser; the e2e tsconfig has no DOM lib, so the DOM is typed loosely here.
  return page.evaluate(() => {
    type Path = { getTotalLength(): number; getPointAtLength(n: number): { x: number; y: number }; getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } };
    type El = { closest(sel: string): El | null; querySelector(sel: string): (El & Path) | null; getAttribute(name: string): string | null };
    const doc = (globalThis as unknown as { document: { querySelectorAll(sel: string): Iterable<El>; elementFromPoint(x: number, y: number): El | null } }).document;
    for (const g of doc.querySelectorAll(".react-flow__edge:not(.inactive)")) {
      const path = g.querySelector("path.net-edge");
      if (!path) continue;
      const total = path.getTotalLength();
      for (const f of [0.5, 0.35, 0.65]) {
        const m = path.getPointAtLength(total * f);
        const c = path.getScreenCTM()!;
        const x = m.x * c.a + m.y * c.c + c.e;
        const y = m.x * c.b + m.y * c.d + c.f;
        if (doc.elementFromPoint(x, y)?.closest(".react-flow__edge") === g) return { x, y, netId: g.getAttribute("data-id")!.split(":")[0] };
      }
    }
    throw new Error("no uncovered edge");
  });
}
