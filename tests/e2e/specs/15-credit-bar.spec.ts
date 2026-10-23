import { expect, test, type Page } from "@playwright/test";
import { chooseBySearch, hooks, PROBE_SCRIPT, save, shotPath, watch, type StationKey } from "../lib/gteki.ts";
test.use({ trace: "off" });

/**
 * #187's persistent credit line (`footer.credit-line`) at the narrowest phone width, 375 px, in English and Japanese:
 * idle explorer and guide playback (HUD up). Per state: the strip lies inside the viewport, takes at most two lines,
 * is not clipped (no horizontal overflow), does not overlap the panel, sheet or HUD, and its "Credits" button opens
 * the full list with no repeated entries. Screenshots per state; readability of the ja/en text is judged on them.
 */

const sizes = [{ width: 375, height: 667 }, { width: 375, height: 812 }];
const routes: Record<StationKey, { from: [string, RegExp]; to: [string, RegExp] }> = {
  ikebukuro: { from: ["中央2", /JR Central Gate 2/], to: ["35", /^Exit 35$/] },
  shinjuku: { from: ["north side", /street level, north side/], to: ["platform", /Oedo Line platform/] },
};

async function ready(page: Page) {
  await page.waitForFunction(() => typeof (window as any).__gteki?.phase === "function", null, { timeout: 30_000 });
  await page.waitForFunction(() => (window as any).__gteki.phase() === "ready", null, { timeout: 120_000 });
  await page.waitForTimeout(800);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const r = (e: Element | null) => (e && (e as HTMLElement).offsetParent !== null ? e.getBoundingClientRect() : null);
    const box = document.querySelector("footer.credit-line") as HTMLElement | null;
    const text = document.querySelector("footer.credit-line .credit-text") as HTMLElement | null;
    const b = r(box);
    const lh = text ? parseFloat(getComputedStyle(text).lineHeight) || parseFloat(getComputedStyle(text).fontSize) * 1.2 : 0;
    const overlap = (sel: string) =>
      [...document.querySelectorAll(sel)].map((e) => r(e)).filter((x): x is DOMRect => !!x && !!b)
        .map((x) => Math.max(0, Math.min(x.right, b!.right) - Math.max(x.left, b!.left)) * Math.max(0, Math.min(x.bottom, b!.bottom) - Math.max(x.top, b!.top)))
        .reduce((s, v) => s + v, 0);
    return {
      visible: !!b && !box!.hidden,
      rect: b && { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom },
      viewport: { w: innerWidth, h: innerHeight },
      text: text?.textContent ?? null,
      fontPx: text ? parseFloat(getComputedStyle(text).fontSize) : null,
      lines: text && lh ? Math.round(text.getBoundingClientRect().height / lh) : null,
      overflowX: box ? box.scrollWidth - box.clientWidth : null,
      textOverflowX: text ? text.scrollWidth - text.clientWidth : null,
      textOverflowStyle: text ? getComputedStyle(text).textOverflow : null,
      overlapPx: { panel: overlap(".panel"), sheet: overlap(".sheet"), hud: overlap(".hud"), hudInstruction: overlap(".hud-instruction") },
      mode: (window as any).__gteki?.mode?.() ?? null,
    };
  });
}

async function creditsList(page: Page) {
  await page.locator("footer.credit-line .credit-btn").click();
  const dlg = page.locator("dialog[open]");
  await expect(dlg).toBeVisible();
  const items = (await dlg.locator("ul li").allTextContents()).map((s) => s.trim()).filter(Boolean);
  const dup = items.filter((s, i) => items.indexOf(s) !== i);
  // Rights wording checks (#187 / #161): the list text and its links, for reading, plus raw enum values leaking to the UI.
  const text = (await dlg.textContent()) ?? "";
  const links = await dlg.locator("a").evaluateAll((as) => as.map((a) => ({ text: a.textContent?.trim() ?? "", href: (a as HTMLAnchorElement).href })));
  const rawEnums = [...new Set(text.match(/\b[A-Z]{3,}(?:_[A-Z0-9]+){1,}\b/g) ?? [])];
  return { dlg, count: items.length, duplicates: [...new Set(dup)], items, links, rawEnums };
}

for (const key of ["ikebukuro", "shinjuku"] as StationKey[]) {
  for (const size of sizes) {
    test(`${key}: credit line at ${size.width}×${size.height}, en + ja, idle + guide @phone`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await page.setViewportSize(size);
      const diag = watch(page);
      await page.addInitScript(PROBE_SCRIPT);
      const tag = `${key}-${size.width}x${size.height}`;
      const states: Record<string, unknown> = {};
      const check = async (state: string) => {
        const m = await measure(page);
        await page.screenshot({ path: shotPath(testInfo, `credit-${tag}-${state}.png`) });
        states[state] = m;
        expect.soft(m.visible, `${state}: credit line shown`).toBe(true);
        if (!m.visible || !m.rect) return;
        expect.soft(m.rect.x, `${state}: inside the viewport (left)`).toBeGreaterThanOrEqual(0);
        expect.soft(m.rect.right, `${state}: inside the viewport (right)`).toBeLessThanOrEqual(m.viewport.w + 0.5);
        expect.soft(m.rect.bottom, `${state}: inside the viewport (bottom)`).toBeLessThanOrEqual(m.viewport.h + 0.5);
        expect.soft(m.lines ?? 99, `${state}: at most two lines`).toBeLessThanOrEqual(2);
        expect.soft(m.overflowX ?? 0, `${state}: strip not clipped horizontally`).toBeLessThanOrEqual(1);
        expect.soft(m.overlapPx.panel + m.overlapPx.sheet, `${state}: no overlap with panel/sheet (px²)`).toBeLessThanOrEqual(1);
        expect.soft(m.overlapPx.hud, `${state}: no overlap with the HUD (px²)`).toBeLessThanOrEqual(1);
      };

      await page.goto(`/?station=${key}&lang=en`);
      await ready(page);
      await check("en-idle");
      const en = await creditsList(page);
      await page.screenshot({ path: shotPath(testInfo, `credit-${tag}-en-list.png`) });
      await page.keyboard.press("Escape");

      const r = routes[key];
      await chooseBySearch(page, "from", r.from[0], r.from[1]);
      await chooseBySearch(page, "to", r.to[0], r.to[1]);
      await page.locator(".sheet .card.route button.primary").click();
      await expect.poll(() => hooks.mode(page)).toBe("guide");
      await page.waitForTimeout(1500);
      await check("en-guide");

      // Same route, Japanese: the deep link restores it.
      const jaUrl = page.url().replace(/([?&])lang=en\b/, "$1lang=ja");
      await page.goto(jaUrl.includes("lang=ja") ? jaUrl : `${jaUrl}&lang=ja`);
      await ready(page);
      await check("ja-restored");
      const ja = await creditsList(page);
      await page.screenshot({ path: shotPath(testInfo, `credit-${tag}-ja-list.png`) });
      await page.keyboard.press("Escape");
      const start = page.locator(".sheet .card.route button.primary");
      if (await start.count()) {
        await start.click();
        await expect.poll(() => hooks.mode(page)).toBe("guide");
        await page.waitForTimeout(1500);
        await check("ja-guide");
      }

      save(testInfo, `credit-${tag}.json`, { project: testInfo.project.name, size, states, list: { en: { count: en.count, duplicates: en.duplicates, rawEnums: en.rawEnums, items: en.items, links: en.links }, ja: { count: ja.count, duplicates: ja.duplicates, rawEnums: ja.rawEnums, items: ja.items, links: ja.links } }, diag });
      expect.soft(en.duplicates, "en credits list: no repeated entries").toEqual([]);
      expect.soft(ja.duplicates, "ja credits list: no repeated entries").toEqual([]);
      expect.soft([...en.rawEnums, ...ja.rawEnums], "no raw rights enum values shown to the user").toEqual([]);
      expect.soft(diag.pageErrors, "uncaught page errors").toEqual([]);
    });
  }
}
