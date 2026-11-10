import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { hooks, openStation, stationData } from "../lib/gteki.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });
const routes = [{ id: "exit-4", poi: "poi:exit:4" }, { id: "exit-3", poi: "poi:exit:3" }];
const destination = "poi:toilet:1";
const settle = async (page: Page) => { await page.waitForTimeout(700); };
const heading = async (page: Page) => page.evaluate(() => ((-(window as any).__gteki.camera().yaw * 180 / Math.PI) % 360 + 360) % 360);

async function turn(page: Page, target: number) {
  for (let i = 0; i < 4; i++) {
    const error = ((target - await heading(page) + 540) % 360) - 180;
    if (Math.abs(error) <= 3) break;
    const box = (await page.locator("canvas.gteki-canvas").boundingBox())!;
    const at = await page.evaluate(() => {
      const c = document.querySelector("canvas.gteki-canvas")!.getBoundingClientRect();
      for (const [x, y] of [[0.5, 0.45], [0.7, 0.35], [0.3, 0.35], [0.6, 0.6]]) {
        const px = c.left + c.width * x!, py = c.top + c.height * y!;
        const el = document.elementFromPoint(px, py);
        if (el?.classList.contains("gteki-canvas") || el?.classList.contains("gteki-labels")) return { x: px, y: py };
      }
      return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    });
    const dx = Math.round(error * Math.PI / 180 / 0.0042), chunkMax = Math.max(20, Math.floor(box.width * 0.3));
    let sent = 0;
    while (Math.abs(dx - sent) >= 1) {
      const chunk = Math.max(-chunkMax, Math.min(chunkMax, dx - sent));
      await page.mouse.move(at.x, at.y); await page.mouse.down();
      await page.mouse.move(at.x + chunk, at.y, { steps: 3 }); await page.mouse.up(); sent += chunk;
    }
    await settle(page);
  }
  return heading(page);
}

test("#221 route flight ends @phone", async ({ page }, info) => {
  test.setTimeout(1_800_000);
  const root = process.env.GTEKI_ROOT!;
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const project = info.project.name.startsWith("phone") ? "phone" : "desktop";
  const out = path.join(root, ".qa/221/route-recheck", sha.slice(0, 7), project);
  fs.mkdirSync(out, { recursive: true });
  const { graph, pois, station } = stationData("shinjuku");
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const edges = new Map(graph.edges.map(e => [e.id, e]));
  const floors = new Map((station.floors as { id: string; renderElevationM: number }[]).map(f => [f.id, f.renderElevationM]));
  const flights = new Map<string, { edge: (typeof graph.edges)[number]; routes: string[] }>();
  const routeResults: Record<string, unknown>[] = [];
  await openStation(page, "shinjuku");
  const quality = await hooks.quality(page);
  for (const route of routes) {
    const origin = pois.find(p => p.id === route.poi)?.connectorNodeIds[0];
    const dest = pois.find(p => p.id === destination)?.connectorNodeIds[0];
    if (!origin || !dest) throw new Error(`DECISION: endpoint missing for ${route.id}`);
    expect(await hooks.setOrigin(page, origin)).toBe(true);
    expect(await hooks.setDestination(page, dest)).toBe(true);
    const result = await hooks.route(page);
    if (!result?.ok) throw new Error(`DECISION: route ${route.id} failed: ${JSON.stringify(result)}`);
    const ids: string[] = [];
    for (const step of result.steps as { edgeId: string }[]) {
      const edge = edges.get(step.edgeId)!;
      const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
      if (!["stairs", "escalator", "elevator"].includes(edge.mode) && a.floorId === b.floorId) continue;
      ids.push(edge.id);
      const previous = flights.get(edge.id);
      if (previous) previous.routes.push(route.id); else flights.set(edge.id, { edge, routes: [route.id] });
    }
    routeResults.push({ route: route.id, origin, destination: dest, flights: ids });
  }
  const rows: Record<string, unknown>[] = [];
  const manifest = () => fs.writeFileSync(path.join(out, "views.json"), JSON.stringify({ sha, project: info.project.name, quality, routes: routeResults, flights: [...flights.values()], views: rows }, null, 2) + "\n");
  manifest();
  let first = true;
  for (const { edge, routes: memberRoutes } of flights.values()) {
    const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
    const height = (n: typeof a) => n.position.z ?? n.renderZ ?? floors.get(n.floorId) ?? 0;
    const ends = height(a) >= height(b) ? [a, b] : [b, a];
    for (const [endIndex, node] of ends.entries()) {
      const other = ends[1 - endIndex]!;
      expect(await hooks.walkFromNode(page, node.id), `walkFromNode(${node.id})`).toBe(true);
      await expect.poll(() => hooks.mode(page)).toBe("walk");
      if (first) { await page.getByRole("button", { name: /^(First person|一人称)$/ }).click(); first = false; }
      await settle(page);
      const into = ((Math.atan2(other.position.x - node.position.x, other.position.y - node.position.y) * 180 / Math.PI) + 360) % 360;
      for (const [direction, target] of [["into", into], ["reverse", (into + 180) % 360]] as const) {
        const measured = await turn(page, target);
        const missed = Math.abs(((measured - target + 540) % 360) - 180) > 5;
        const index = rows.length, file = `${String(index).padStart(3, "0")}.jpg`;
        await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 85, scale: "css" });
        if (project === "desktop") execFileSync("sips", ["--resampleWidth", "1024", "-s", "formatOptions", "85", path.join(out, file)], { stdio: "ignore" });
        rows.push({ index, project: info.project.name, quality, sha, edgeId: edge.id, routes: memberRoutes, end: endIndex === 0 ? "top" : "bottom", nodeId: node.id, floor: node.floorId, direction, requestedHeading: target, measuredHeading: measured, missed, position: await hooks.avatar(page), file });
        manifest();
      }
    }
  }
  // Compose labelled thumbnails in the browser; each original remains available separately.
  const images = rows.map(r => ({ index: r.index, data: fs.readFileSync(path.join(out, String(r.file))).toString("base64") }));
  const sheet = await page.evaluate(async (items) => {
    const w = 384, h = 250, cols = 4, canvas = document.createElement("canvas");
    canvas.width = w * cols; canvas.height = Math.max(1, Math.ceil(items.length / cols)) * h;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < items.length; i++) {
      const img = new Image(); img.src = `data:image/jpeg;base64,${items[i]!.data}`; await img.decode();
      const x = i % cols * w, y = Math.floor(i / cols) * h, scale = Math.min(w / img.width, (h - 25) / img.height);
      ctx.drawImage(img, x, y + 25, img.width * scale, img.height * scale);
      ctx.fillStyle = "#000"; ctx.font = "20px sans-serif"; ctx.fillText(String(items[i]!.index), x + 5, y + 20);
    }
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
  }, images);
  fs.writeFileSync(path.join(out, "contact-sheet.jpg"), Buffer.from(sheet, "base64"));
});
