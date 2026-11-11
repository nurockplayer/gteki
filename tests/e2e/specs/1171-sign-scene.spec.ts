import { test } from "@playwright/test";
import { openStation } from "../lib/gteki.ts";

test("inspect Shinjuku sign scene", async ({ page }) => {
  await openStation(page, "shinjuku");
  const result = await page.evaluate(() => {
    const ids = ["1ecbdf77f58f423fa3142d1b71e078bf", "2d2bc35b4043433da2914b2705ef69bb", "453ea111f1524cef8f3ac139bbf2e26b", "c2d390021c29442f86dda359e503febd", "e31954cbec9e4b1cac647326d5bcb4e4"];
    return [...ids.map(id => ({ name: `sign:n:${id}`, ...((window as any).__gteki.layer(`sign:n:${id}`)) })), ...["sign-faces:station:0", "sign-cases"].map(name => ({ name, ...((window as any).__gteki.layer(name)) }))];
  });
  console.log(`[sign-scene] ${JSON.stringify(result)}`);
});
