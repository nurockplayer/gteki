import type { Page } from "@playwright/test";
import { flatRatio } from "./golden.ts";

export async function screenshotGolden(page: Page, path: string): Promise<Buffer> {
  // Playwright fast-forwards finite CSS transitions (HUD/minimap opacity included)
  // to their settled state before capturing, without a wall-clock delay.
  return page.screenshot({ path, timeout: 60_000, animations: "disabled" });
}

export async function screenshotFlatRatio(page: Page, png: Buffer): Promise<{ value: number; ms: number }> {
  const decoded = await page.evaluate(async (b64) => {
    const started = performance.now();
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let binary = "";
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return { rgba: btoa(binary), ms: performance.now() - started };
  }, png.toString("base64"));
  return { value: flatRatio(Buffer.from(decoded.rgba, "base64")), ms: decoded.ms };
}

