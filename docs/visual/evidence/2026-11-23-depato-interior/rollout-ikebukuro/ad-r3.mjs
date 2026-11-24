// 2026-11-25 JST. Targeted PR #1541 art-direction recapture.
const fs = await import("node:fs/promises");
const base = worktree + "docs/visual/evidence/2026-11-23-depato-interior/rollout-ikebukuro/";
const config = JSON.parse(await fs.readFile(worktree + "stations/ikebukuro/data/depato-rollout.json", "utf8"));
const receipt = JSON.parse(await fs.readFile(base + "receipt.json", "utf8"));
const entry = (await listTaskSpaces()).find(s => s.name === "depato-rollout-ikebukuro");
const task = await taskSpace(entry?.id ?? "depato-rollout-ikebukuro");
const page = (await task.pages())[0] ?? await task.adopt((await task.tabs())[0].page);
receipt.adR3 = { sourceHead: runtimeHead, capturedAt: new Date().toISOString(), timeZone: "UTC" };
receipt.failures = [];

const load = async next => {
  await page.goto("http://127.0.0.1:5291/?station=ikebukuro" + (next ? "&next=1" : ""));
  await page.waitForFunction(() => window.__gteki?.phase() === "ready", undefined, { timeout: 120000 });
  await page.evaluate(async () => {
    const g = window.__gteki;
    await g.scanProbe().explorer.stationScene.settled?.();
    g.holdFrames(true);
  });
};

const shot = async (profile, name, approach) => {
  const state = await page.evaluate(() => {
    const g = window.__gteki, e = g.scanProbe().explorer;
    return {
      avatar: g.avatar(), camera: g.camera(), scene: g.sceneInfo(),
      streetContextVisible: e.scene.getObjectByName("street-context")?.visible ?? false,
      shaderErrors: e.renderer.info.programs.filter(p => p.diagnostics?.runnable === false)
        .map(p => p.diagnostics.fragmentShader.log),
    };
  });
  if (state.shaderErrors.length) throw Error(state.shaderErrors.join("\n"));
  const file = `${profile.device.name}-${profile.store}-${name}.png`;
  await page.screenshot({ path: base + file });
  const frame = { name, file, sourceHead: runtimeHead, ...state, ...(approach && { approach }) };
  const index = profile.frames.findIndex(f => f.name === name);
  if (index === -1) profile.frames.push(frame);
  else profile.frames[index] = frame;
};

for (const tobu of receipt.profiles.filter(p => p.store === "tobu-ikebukuro")) {
  const { device } = tobu;
  const parco = receipt.profiles.find(p => p.device.name === device.name && p.store === "ikebukuro-parco");
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: device.width, height: device.height, screenWidth: device.width, screenHeight: device.height,
    deviceScaleFactor: 1, mobile: device.mobile,
  });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: device.mobile });

  // Keep c_w as the stand point. Turn the narrower phone frame toward the near barrier.
  for (const next of [false, true]) {
    await load(next);
    await page.evaluate(mobile => {
      const g = window.__gteki;
      g.setView({ node: "c_w", headingDeg: 270 });
      g.setCamera({ yaw: Math.PI / 2 + (mobile ? 0.3 : 0) });
      for (let i = 0; i < 4; i++) g.goldenFrame();
    }, device.mobile);
    await shot(tobu, next ? "B1-tie-skipped" : "flag-off");
  }

  if (!device.mobile) {
    const previous = tobu.frames.find(f => f.name === "street-door-inside");
    await page.evaluate(({ avatar, camera }) => {
      const g = window.__gteki, e = g.scanProbe().explorer;
      g.setView({ node: "depato-tobu-ikebukuro-1F-inside0", headingDeg: 270 });
      e.pos.set(avatar.x, avatar.z, -avatar.y);
      e.teleported = true;
      g.setCamera({ yaw: camera.yaw });
      for (let i = 0; i < 4; i++) g.goldenFrame();
    }, { avatar: previous.avatar, camera: previous.camera });
    await shot(tobu, "street-door-inside");
  }

  const store = config.stores.find(s => s.id === parco.store);
  await load(true);
  await page.evaluate(({ point, height, poiId }) => {
    const g = window.__gteki, e = g.scanProbe().explorer;
    g.setCamera(null);
    g.setOrigin("jr-south-gate");
    g.setDestination(poiId);
    if (!g.route()?.ok) throw Error("PARCO guide route unavailable");
    g.startGuide();
    const door = e.pos.clone().set(point[0], height, point[1]);
    const i = e.guide.pts.findIndex(p => p.distanceTo(door) < 0.05);
    if (i < 0) throw Error("PARCO B1 door missing from guide path");
    g.seekGuide(e.guide.cum[i] - 20);
    g.goldenFrame();
  }, { point: store.entrances[0].point, height: store.elevations.B1, poiId: store.poiId });

  const pending = ["entrance-outside", "entrance-3m"];
  while (pending.length) {
    const frame = await page.evaluate(({ pending, point, height }) => {
      const e = window.__gteki.scanProbe().explorer;
      const door = e.pos.clone().set(point[0], height, point[1]);
      const ray = new e.ray.constructor();
      const meshes = [];
      e.stationScene.root.traverseVisible(o => {
        if (o.isMesh && o.material.visible && o.material.depthWrite) meshes.push(o);
      });
      const visible = target => {
        const p = target.clone().project(e.camera);
        if (Math.abs(p.x) >= 1 || Math.abs(p.y) >= 1 || Math.abs(p.z) >= 1) return false;
        const direction = target.clone().sub(e.camera.position);
        ray.far = direction.length() - 0.05;
        ray.set(e.camera.position, direction.normalize());
        return ray.intersectObjects(meshes, false).length === 0;
      };
      const opening = door.clone().add(e.pos.clone().set(0, 1.2, 0));
      const header = door.clone().add(e.pos.clone().set(0, 2.45, 0));
      const time = e.timer.getElapsed();
      const start = e.guide.s;
      for (let step = 0; e.guide.s - start < 21 && step < 750; step++) {
        e.step(1 / 30, time + step / 30);
        const distanceM = Math.hypot(e.pos.x - door.x, e.pos.z - door.z);
        const openingVisible = visible(opening);
        const names = pending.filter(name => name === "entrance-outside" ? openingVisible : distanceM <= 3);
        if (names.length) {
          e.render(1 / 30);
          return { names, distanceM, guideDistanceM: e.guide.s, openingVisible, headerVisible: visible(header) };
        }
      }
      throw Error("PARCO guide reached no remaining approach pose: " + pending.join(", "));
    }, { pending, point: store.entrances[0].point, height: store.elevations.B1 });
    for (const name of frame.names) {
      await shot(parco, name, frame);
      pending.splice(pending.indexOf(name), 1);
    }
  }
  console.log(JSON.stringify({ device: device.name, parcoApproach: parco.frames
    .filter(f => f.approach).map(f => ({ name: f.name, ...f.approach })) }));
}

await fs.writeFile(base + "receipt.json", JSON.stringify(receipt, null, 2) + "\n");
