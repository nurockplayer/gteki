// Throwaway runtime diagnosis, 2026-11-14 JST. Never merge.
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { openStation, stationData } from "../lib/gteki.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });
test("1270: golden escalator covering draws", async ({ page }) => {
  test.skip(process.env.GTEKI_GOLDEN_STATION === "ikebukuro", "Shinjuku only");
  test.setTimeout(240_000);
  const config = JSON.parse(fs.readFileSync(new URL("../golden-cameras.json", import.meta.url), "utf8"));
  const pose = config.cameras.find((c: any) => c.id === "sj-escalator-top");
  const { graph } = stationData("shinjuku");
  const runs = graph.edges.filter(e => /^e:(e1fa6530|2692fe08|fd3365c8)/.test(e.id)).map(e => {
    const nodes = [e.from, e.to].map(id => graph.nodes.find(n => n.id === id)! as any);
    nodes.sort((a, b) => b.renderZ - a.renderZ);
    return { id: e.id, hi: nodes[0].position, lo: nodes[1].position, zHi: nodes[0].renderZ, zLo: nodes[1].renderZ };
  });
  await openStation(page, "shinjuku");
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
    const placed = await page.evaluate(p => (window as any).__gteki.setView(p), pose);
    expect(placed.placed).toBe(true);
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const lines = await page.evaluate(({ pose, runs }) => {
      const g = (window as any).__gteki, e = g.scanProbe().explorer;
      const cam = e.camera, ray = e.ray, renderer = e.renderer, gl = renderer.getContext();
      const vec = (x = 0, y = 0, z = 0) => new cam.position.constructor(x, y, z);
      const axes = runs.map(r => {
        const origin = vec(r.hi.x, r.zHi, -r.hi.y), axis = vec(r.lo.x-r.hi.x, 0, -(r.lo.y-r.hi.y)).normalize();
        return { ...r, origin, axis, lateral: vec(-axis.z, 0, axis.x), slope: Math.atan2(r.zHi-r.zLo, Math.hypot(r.lo.x-r.hi.x, r.lo.y-r.hi.y))*180/Math.PI };
      });
      const out: string[] = [], fmt = (x: number) => x.toFixed(4);
      const emit = (label: string, data: any) => out.push(`1270: ${label} ${JSON.stringify(data)}`);
      const visible = (o: any) => { for (let p=o; p; p=p.parent) if (!p.visible) return false; return true; };
      const meshes: any[] = []; e.scene.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
      const material = (h: any) => Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      const hits = () => ray.intersectObjects(meshes.filter(visible), false).filter((h: any) => material(h)?.visible !== false);
      const direction = cam.getWorldDirection(vec()), position = cam.getWorldPosition(vec());
      emit("camera", { position: position.toArray(), pitchDeg: Math.asin(direction.y)*180/Math.PI, verticalFov: cam.fov, direction: direction.toArray(), bearingDeg: (Math.atan2(axes[0].axis.x, -axes[0].axis.z)*180/Math.PI+360)%360, runs: axes.map(r => ({ id:r.id, origin:r.origin.toArray(), axis:r.axis.toArray(), slopeDeg:r.slope })) });
      emit("golden-original", g.goldenProbe(false, pose.features));
      const floors = meshes.filter(o => o.name.startsWith("walkable") || (o.userData.portalInstanceCopy && (Array.isArray(o.material) ? o.material : [o.material]).some((m: any) => m.name === "mat.floor")));
      const states = floors.map(o => o.visible), captures: { w:number; h:number; pixels:Uint8Array }[] = [];
      const originalRead = gl.readPixels;
      let probe: any;
      try {
        floors.forEach(o => o.visible = false);
        gl.readPixels = function(...args: any[]) {
          originalRead.apply(this, args);
          captures.push({ w:args[2], h:args[3], pixels: new Uint8Array(args[6]) });
        };
        probe = g.goldenProbe(false, pose.features);
      } finally {
        gl.readPixels = originalRead;
        floors.forEach((o,i) => o.visible = states[i]);
      }
      if (captures.length !== 2) throw new Error(`Expected shown/hidden captures, got ${captures.length}`);
      renderer.render(e.scene, cam); e.scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);
      const [shown, hidden] = captures, pixels: number[] = [];
      for (let i=0; i<shown.pixels.length; i+=4) if ([0,1,2].some(c => Math.abs(shown.pixels[i+c]-hidden.pixels[i+c])>3)) pixels.push(i/4);
      emit("mask", { width:shown.w, height:shown.h, pixels:pixels.length, hiddenFloors:floors.length, golden:probe.features, samples:Math.ceil(pixels.length/4) });
      const groups = new Map<string, any>(), angles: number[] = [];
      let misses = 0;
      for (let i=0; i<pixels.length; i+=4) {
        const p=pixels[i], x=p%shown.w, y=Math.floor(p/shown.w);
        ray.setFromCamera({ x:(x+0.5)/shown.w*2-1, y:(y+0.5)/shown.h*2-1 }, cam);
        ray.near=0; ray.far=cam.far;
        const angle = Math.asin(-ray.ray.direction.y)*180/Math.PI; angles.push(angle);
        const h=hits()[0]; if (!h) { misses++; continue; }
        const matrix=h.object.matrixWorld.clone();
        if (h.instanceId !== undefined) { const m=matrix.clone().identity(); h.object.getMatrixAt(h.instanceId,m); matrix.multiply(m); }
        const normal=h.face.normal.clone().transformDirection(matrix.clone().invert().transpose());
        const delta=h.point.clone().sub(axes[0].origin), d=delta.dot(axes[0].axis), lateral=delta.dot(axes[0].lateral);
        const normalGroup=Math.abs(normal.y)>.9?"top":Math.abs(normal.y)<.1?"side":"slope";
        const key=`${h.object.name} | ${material(h)?.name} | ${!!h.object.userData.portalInstanceCopy} | ${normalGroup}`;
        const row=groups.get(key) ?? { count:0, d:[], lateral:[], y:[], normalY:[], angle:[], instanceIds:new Set(), metadata:h.object.userData };
        row.count++; row.d.push(d); row.lateral.push(lateral); row.y.push(h.point.y); row.normalY.push(normal.y); row.angle.push(angle);
        if (h.instanceId !== undefined) row.instanceIds.add(h.instanceId); groups.set(key,row);
      }
      const range = (a:number[]) => a.length ? `${fmt(Math.min(...a))}..${fmt(Math.max(...a))}` : "none";
      emit("ray-angles", { degreesDown:range(angles), misses });
      for (const [key,r] of groups) emit(`histogram ${key}`, { count:r.count, planM:range(r.d), lateralM:range(r.lateral), y:range(r.y), normalY:range(r.normalY), rayDeg:range(r.angle), instanceIds:[...r.instanceIds], metadata:r.metadata });
      for (const r of axes) for (const lateral of [0,-0.5,0.5]) {
        const values:string[]=[];
        for (let step=1; step<=20; step++) {
          const d=step/10, origin=r.origin.clone().addScaledVector(r.axis,d).addScaledVector(r.lateral,lateral); origin.y=-7;
          ray.set(origin,vec(0,-1,0)); ray.near=0; ray.far=100;
          const h=hits()[0]; values.push(`${d.toFixed(1)} ${h ? `${h.object.name}|${material(h)?.name}|${fmt(h.point.y)}` : "none"}`);
        }
        out.push(`1270: down ${r.id} lateral=${lateral} ${values.join(", ")}`);
      }
      return out;
    }, { pose, runs });
    for (const line of lines) console.log(line);
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
