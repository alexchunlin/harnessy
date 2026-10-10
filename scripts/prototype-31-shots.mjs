import { chromium } from "@playwright/test";
const folder = process.env.HOME + "/code-stuff/rammp-example-prototype-31";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto("http://localhost:5231/");
await page.evaluate(() => localStorage.clear());
await page.goto("http://localhost:5231/?variant=A");
await page.getByPlaceholder("Go to path").fill(folder);
await page.getByRole("button", { name: "Go" }).click();
await page.getByRole("button", { name: "Open this project" }).click();
await page.getByRole("button", { name: "Topology" }).click();
await page.getByTestId("topology-canvas").waitFor();
await page.waitForTimeout(1200);
const shot = (n) => page.screenshot({ path: `docs/prototypes/31-derived-layout/${n}.png` });
const net = page.locator(".netlist li", { hasText: "Strain gauge front" });
for (const v of ["A", "B", "C"]) {
  await shot(v);
  await net.click();
  await page.waitForTimeout(700);
  await shot(`${v}-zoom`);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(900);
}
await browser.close();
