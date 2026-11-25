// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// 2026-11-25 JST. Run via job-run and tachi-run --heavy --host.
import { createServer } from "../../../../apps/web/node_modules/vite/dist/node/index.js";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const [storeId, out, baseline] = process.argv.slice(2);
const git = (...args) => execFileSync("rtk", ["proxy", "git", "-C", repo, ...args], { encoding: "utf8" });
const head = git("rev-parse", "HEAD").trim(), base = git("rev-parse", baseline).trim();
const config = JSON.parse(readFileSync(join(repo, "stations/shinjuku/data/depato-rollout.json"))).stores.find(s => s.id === storeId);
const hasB1 = JSON.parse(readFileSync(join(repo, "stations/shinjuku/data/depato-floors.json")))
  .stores.find(s => s.id === storeId).floors.some(f => f.level === "B1");
const space = `depato-1540-${storeId}`;
const devices = [{ id: "desktop", width: 1440, height: 900, mobile: false }, { id: "phone", width: 390, height: 844, mobile: true }];
const golden = join(out, "flag-off");
const receiptPath = join(out, "receipt.json");
for (const side of ["base", "head"]) mkdirSync(join(golden, side), { recursive: true });
writeFileSync(receiptPath, JSON.stringify({ head, base, storeId, capturedAt: new Date().toISOString(), profiles: [], failures: [] }, null, 2));

process.chdir(join(repo, "apps/web"));
try {
  for (const isBase of [false, true]) {
    const source = isBase ? base : head;
    const originals = isBase ? new Map([
      "stations/shinjuku/gteki/scene.ts", "stations/shinjuku/scene/build.ts",
      "stations/shinjuku/scene/surface.ts", "stations/shinjuku/scene/surface-layout.ts",
    ].map(path => [join(repo, path), git("show", `${base}:${path}`)])) : new Map();
    const server = await createServer({
      define: { __BUILD_SHA__: JSON.stringify(source) },
      plugins: [{ name: "shinjuku-flag-off-baseline", enforce: "pre", load: id => originals.get(id) }],
      server: { host: "127.0.0.1", port: isBase ? 5415 : 5414, strictPort: true },
    });
    try {
      await server.listen();
      const inputs = { out, space, receiptPath, config, hasB1, devices, source, isBase, url: server.resolvedUrls.local[0] };
      const run = spawn("ego-browser", ["nodejs"], { stdio: ["pipe", "inherit", "inherit"] });
      run.stdin.end(`${browser.toString()}\nawait browser(${JSON.stringify(inputs)});`);
      const code = await new Promise((resolve, reject) => {
        run.on("error", reject);
        run.on("exit", resolve);
      });
      if (code !== 0) throw Error(`Ego-lite capture exited ${code}`);
    } finally {
      await server.close();
    }
  }
} finally {
  execFileSync("ego-browser", ["nodejs", "-e", `const s = (await listTaskSpaces()).find(s => s.name === ${JSON.stringify(space)}); if (s) await (await taskSpace(s.id)).finish({ keep: [] });`], { stdio: "inherit" });
}

const receipt = JSON.parse(readFileSync(receiptPath));
execFileSync(process.execPath, [join(repo, "tools/qa/golden-diff.mjs"), join(golden, "base"),
  join(golden, "head"), golden, "--cameras", join(repo, "tests/e2e/golden-cameras.json")], { stdio: "inherit" });
receipt.flagOffGolden = JSON.parse(readFileSync(join(golden, "diff.json")));
if (receipt.flagOffGolden.length !== devices.length || receipt.flagOffGolden.some(f => f.changed)) receipt.failures.push("Flag-off golden diff failed");
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ profiles: receipt.profiles.map(({ device, frames, legs }) => ({
  device: device.id, frames: frames.length, legsDone: legs.filter(l => l.done).length, legs: legs.length,
})), failures: receipt.failures }));
if (receipt.failures.length) process.exitCode = 1;

async function browser({ out, space, receiptPath, config, hasB1, devices, source, isBase, url }) {
  const fs = await import("node:fs/promises");
  const entry = (await listTaskSpaces()).find(s => s.name === space);
  const task = await taskSpace(entry?.id ?? space), page = task.page("p1");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const { exitPoi, exitNode, waypoints } = config.streetApproach;
  const { point: [dx, dz], inward: [nx, nz], elevation: y } = config.entrance;
  const { aisleX: x, from, to } = config.circulation, b1 = y - 4.5;
  const pos = (x, y, z) => ({ x, y, z });
  const threshold = d => pos(dx + nx * d, y, dz + nz * d);
  const facing = p => Math.atan2(p.x - dx, p.z - dz);
  const open = async next => {
    await page.goto(url + "?station=shinjuku&open=search&qaTimeBand=morning" + (next ? "&next=1" : ""));
    await page.waitForFunction(() => window.__gteki?.phase() === "ready", undefined, { timeout: 120000 });
    await page.evaluate(async () => {
      const g = window.__gteki;
      await g.scanProbe().explorer.stationScene.settled?.();
      document.querySelector(".minimap-collapse:not([hidden])")?.click();
      g.holdFrames(true);
    });
  };
  for (const device of devices) {
    const profile = isBase ? receipt.profiles.find(p => p.device.id === device.id) : { device, frames: [], legs: [] };
    if (!isBase) receipt.profiles.push(profile);
    const frame = async (name, yaw, golden = false) => {
      const showOpening = name === "street-approach" || name === "outside-door";
      const checkCat = !golden && device.mobile && (showOpening || name === "inside-door");
      const distance = name.endsWith("-door") ? 3.1 : 2.25;
      const state = await page.evaluate(({ yaw, distance, showOpening, checkCat, entrance, buildingId }) => {
        const g = window.__gteki, e = g.scanProbe().explorer;
        g.setCamera({ yaw, pitch: 0.06, distance });
        g.goldenFrame(); g.goldenFrame();
        const loaded = [];
        e.stationScene.root.traverse(o => { if (o.name.startsWith("depato-interior:") && o.children.length) loaded.push(o.name); });
        const fits = (left, right, top, bottom) => e.freeRects().some(r =>
          left >= r.x + 4 && right <= r.x + r.w - 4 && top >= r.y + 4 && bottom <= r.y + r.h - 4);
        const catBox = checkCat ? e.catScreenBox() : null;
        let openingInView = null;
        if (showOpening) {
          const [x, z] = entrance.point, [nx, nz] = entrance.inward;
          const points = [-1.7, 1.7].flatMap(side => [0.25, 2.55].map(height => ({
            x: x - nz * side, y: -(z + nx * side), z: entrance.elevation + height,
          })));
          const projected = g.projectEnu(points);
          const facade = e.stationScene.root.getObjectByName("department-store:" + buildingId);
          const origin = e.camera.position;
          const target = origin.clone().set(x, entrance.elevation + 1.4, z);
          const ray = new e.ray.constructor(origin, target.clone().sub(origin).normalize(), 0, target.distanceTo(origin) + 0.35);
          openingInView = !projected.some(p => p.behind) && fits(Math.min(...projected.map(p => p.x)),
            Math.max(...projected.map(p => p.x)), Math.min(...projected.map(p => p.y)), Math.max(...projected.map(p => p.y))) &&
            ray.intersectObject(facade, true).length === 0;
        }
        return { avatar: g.avatar(), camera: g.camera(), loaded, minimapCollapsed: !!document.querySelector(".minimap-reopen:not([hidden])"),
          streetVisible: e.stationScene.root.getObjectByName("surface-render-only")?.visible, openingInView, catBox,
          catInView: checkCat ? !!catBox && fits(catBox.left, catBox.right, catBox.top, catBox.bottom) : null };
      }, { yaw, distance, showOpening, checkCat, entrance: config.entrance, buildingId: config.buildingId });
      const file = golden ? `flag-off/${isBase ? "base" : "head"}/${device.id}-exit-1.png` : `${device.id}-${name}.png`;
      await page.screenshot({ path: out + "/" + file });
      profile.frames.push({ name, file, source, ...state });
      if (!state.minimapCollapsed || state.loaded.length > 1) throw Error(`${name}: invalid minimap or active store count`);
      if (state.openingInView === false || state.catInView === false)
        throw Error(`${name}: opening in frame ${state.openingInView}, cat in frame ${state.catInView}`);
      return state;
    };
    const walk = async (name, ...points) => {
      for (const target of points) {
        const leg = await page.evaluate(point => {
          const g = window.__gteki;
          g.setCamera(null);
          return { ...g.walkPath([point], { dt: 1 / 30, maxSeconds: 75 }), avatar: g.avatar() };
        }, target);
        profile.legs.push({ name, target, ...leg });
        if (!leg.done) throw Error(`${name}: ${JSON.stringify(leg)}`);
      }
    };
    try {
      await page.cdp("Emulation.setDeviceMetricsOverride", {
        width: device.width, height: device.height, screenWidth: device.width, screenHeight: device.height,
        deviceScaleFactor: 1, mobile: device.mobile,
      });
      await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: device.mobile });
      if (!isBase) {
        await open(true);
        const start = await page.evaluate(({ exitPoi, exitNode, poiId }) => {
          const g = window.__gteki;
          g.setOrigin(exitPoi);
          g.setDestination(poiId);
          const route = g.route();
          if (!g.setView({ node: exitNode, headingDeg: 0 }).placed) throw Error("Exit placement failed");
          return { route, avatar: g.avatar() };
        }, { exitPoi, exitNode, poiId: config.poiId });
        profile.route = start.route;
        if (!start.route?.ok || start.route.nodeIds.at(-1) !== `depato-${config.id}-1F-door0`) throw Error("Route did not end at the store door");
        profile.doorwayClear = await page.evaluate(({ buildingId, entrance }) => {
          const e = window.__gteki.scanProbe().explorer;
          const facade = e.stationScene.root.getObjectByName("department-store:" + buildingId);
          const [x, z] = entrance.point, [nx, nz] = entrance.inward;
          const origin = e.camera.position.clone().set(x - nx, entrance.elevation + 1.4, z - nz);
          const ray = new e.ray.constructor(origin, origin.clone().set(nx, 0, nz).normalize(), 0, 2);
          return ray.intersectObject(facade, true).length === 0;
        }, config);
        if (!profile.doorwayClear) throw Error("Exterior facade blocks the opening");
        const approach = waypoints.map(p => pos(...p));
        await walk("exit-to-street", ...approach.slice(0, -1));
        if (!(await frame("street-approach", facing(approach.at(-2)))).streetVisible) throw Error("Street context hidden on approach");
        await walk("outside-door", approach.at(-1), threshold(-4.5));
        await frame("outside-door", facing(threshold(-4.5)));
        await walk("door-to-1F", threshold(0), threshold(4));
        await frame("inside-door", facing(threshold(4)));
        await walk("1F-aisle", pos(x - 4, y, threshold(4).z), pos(x - 4, y, from - 2));
        if (!(await frame("1F-aisle", Math.PI)).loaded.includes(`depato-interior:${config.id}`)) throw Error("Store detail missing in the 1F aisle");
        if (hasB1) {
          await walk("down-to-B1", pos(x, y, from - 2), pos(x + 0.95, y, from), pos(x + 0.95, b1, to + 0.6),
            pos(x, b1, to + 2), pos(x - 4, b1, to + 2));
          await frame("B1-aisle", 0);
          await walk("up-to-1F", pos(x - 4, b1, from - 2), pos(x, b1, from - 2), pos(x - 0.95, b1, from - 0.4),
            pos(x - 0.95, y, to + 0.6), pos(x, y, to + 2), pos(x - 4, y, to + 2));
        }
        await walk("back-out", pos(x - 4, y, threshold(4).z), threshold(4), threshold(0), ...approach.reverse(),
          pos(start.avatar.x, start.avatar.z, -start.avatar.y));
        profile.unloadedOnReturn = await page.evaluate(id =>
          window.__gteki.scanProbe().explorer.stationScene.root.getObjectByName("depato-interior:" + id).children.length === 0, config.id);
        if (!profile.unloadedOnReturn) throw Error("Store detail remained loaded at the exit");
      }
    } catch (error) {
      receipt.failures.push(device.id + " preview: " + error.message);
    }
    try {
      await open(false);
      await page.evaluate(node => {
        const g = window.__gteki;
        if (!g.setView({ node, headingDeg: 0 }).placed) throw Error("Flag-off exit placement failed");
      }, exitNode);
      await frame(isBase ? "flag-off-base" : "flag-off-head", 0, true);
    } catch (error) {
      receipt.failures.push(device.id + " flag-off: " + error.message);
    }
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  }
}
