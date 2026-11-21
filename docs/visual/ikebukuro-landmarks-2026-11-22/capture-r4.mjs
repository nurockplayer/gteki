// Ego-browser stdin script. Run through job-run; captured times are ISO UTC.
// Server: pnpm dev --port 5192 --strictPort
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const repo = '/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro';
const server = spawn('node', [repo + '/apps/web/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5192', '--strictPort'], {cwd: repo + '/apps/web', stdio: ['ignore', 'pipe', 'inherit']});
process.once('exit', () => server.kill());
await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => {if (chunk.toString().includes('Local:')) resolve();});
  server.once('error', reject);
  server.once('exit', code => reject(new Error('Capture server exited: ' + code)));
});
const root = '/Users/tachikoma/Developer/gteki-wt/depato-ikebukuro/docs/visual/ikebukuro-landmarks-2026-11-22/r4';
const task = await taskSpace(32);
const page = task.page('p1');
const stores = ['seibu', 'tobu', 'lumine', 'esola', 'parco', 'pparco', 'sunshine'];
const exits = ['x38', 'x18', 'x37', 'x15', 'x22', 'x22', 'x35'];
const frames = [], poses = {};
for (const [device, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  for (const flag of ['next', 'off']) {
    await page.goto(`http://localhost:5192/?station=ikebukuro&qaTimeBand=morning${flag === 'next' ? '&next=1' : ''}`);
    await page.waitForFunction(() => Boolean(window.__gteki?.scanProbe().explorer.stationScene), undefined, {timeout: 60000});
    await page.evaluate(() => window.__gteki.setView({node: 'x38', headingDeg: 90}));
    await page.waitForFunction(() => Boolean(window.__gteki.scanProbe().explorer.scene.getObjectByName('street-context')), undefined, {timeout: 60000});
    await page.evaluate(async () => {
      const e = window.__gteki.scanProbe().explorer;
      window.__gteki.holdFrames(true);
      const T = await import('/node_modules/.vite/deps/three.js');
      window.__depato = {e, T};
    });
    for (let i = 0; i < stores.length; i++) {
      const store = stores[i], exit = exits[i];
      for (const kind of ['walk', 'look', ...(store === 'sunshine' ? ['east-exit'] : [])]) {
        const key = `${device}-${store}-${kind}`;
        const result = await page.evaluate(async ({store, exit, kind, flag, pose}) => {
          const {e, T} = window.__depato;
          const layer = e.scene.getObjectByName('landmarks-next');
          const sign = layer?.getObjectByName(`landmark-sign:${store}`);
          const mesh = layer?.getObjectByName(`ctx_bldg_landmark_${store}`);
          const node = e.station.bundle.nodes.find(n => n.id === exit);
          const aim = pose ? new T.Vector3(...pose.aim) : sign.getWorldPosition(new T.Vector3());
          const normal = pose ? new T.Vector3(...pose.normal) : new T.Vector3(0, 0, 1).applyQuaternion(sign.quaternion);
          let chosen = pose;
          const visible = point => {
            const ray = new T.Raycaster(point, aim.clone().sub(point).normalize(), 0, point.distanceTo(aim) - 0.2);
            const blockers = [];
            e.scene.traverse(o => {let shown = true; for (let parent = o; parent; parent = parent.parent) shown &&= parent.visible;
            if (o.isMesh && shown && !o.name.startsWith('landmark-sign:') && !o.name.includes('avatar')) blockers.push(o);});
            return ray.intersectObjects(blockers, false).length === 0;
          };
          if (!pose && kind === 'look') {
            // Eye stays 1.6 m above the PLATEAU pavement datum. Turn along the
            // same facade to avoid a neighbouring building, without moving it.
            const options = [];
            for (const distance of [80, 100, 120, 150, 60]) for (const angle of [0, -0.3, 0.3, -0.6, 0.6]) {
              const direction = normal.clone().applyAxisAngle(new T.Vector3(0,1,0), angle);
              const eye = aim.clone().addScaledVector(direction, distance); eye.y = 34.1;
              options.push({eye, distance, clear: visible(eye)});
            }
            const c = options.find(o => o.clear);
            if (!c) throw new Error(`No unobstructed look camera in sampled facade sector: ${store}; see r4-diagnosis.json`);
            const target = aim.clone(); target.y = (aim.y + 32.5) / 2;
            const vertical = Math.abs(Math.atan2(aim.y - c.eye.y, c.distance) - Math.atan2(32.5 - c.eye.y, c.distance));
            chosen = {eye:c.eye.toArray(), target:target.toArray(), aim:aim.toArray(), normal:normal.toArray(), facadeDistanceM:c.distance, clearRay:c.clear, fov:Math.max(55, vertical * 180 / Math.PI + 16)};
          } else if (!pose) {
            const candidates = [];
            for (let dx = -6; dx <= 6; dx += 1) for (let dz = -6; dz <= 6; dz += 1) {
              if (kind === 'east-exit' && (dx || dz)) continue;
              const x = node.position.x + dx, z = -node.position.y + dz;
              const ground = e.groundAt(x, node.position.z + 1.5, z, 4);
              if (ground === null || ground < 31.2) continue;
              const eye = new T.Vector3(x, ground + 1.6, z);
              // A waist-high horizontal clearance excludes enclosed stair landings.
              const inside = [new T.Vector3(1,0,0),new T.Vector3(-1,0,0),new T.Vector3(0,0,1),new T.Vector3(0,0,-1)]
                .filter(d => new T.Raycaster(new T.Vector3(x,ground+0.8,z),d,0,0.7).intersectObjects(e.colliders,false).length).length;
              if (inside >= 2 && kind !== 'east-exit') continue;
              candidates.push({point:[x,ground,z], clear:visible(eye), distance:Math.hypot(x-aim.x,z-aim.z)});
            }
            candidates.sort((a,b) => Number(b.clear)-Number(a.clear) || a.distance-b.distance);
            const c = candidates[0];
            if (!c) throw new Error(`No pavement candidate at ${store}/${exit}`);
            const heading = -Math.atan2(c.point[0]-aim.x,c.point[2]-aim.z)*180/Math.PI;
            if (!e.walkFrom({x:c.point[0],y:-c.point[2],z:c.point[1]},heading)) throw new Error(`walkFrom failed: ${store}`);
            e.setCamera({yaw:Math.atan2(e.pos.x-aim.x,e.pos.z-aim.z), pitch:-Math.atan2(aim.y-e.pos.y-1.6,Math.hypot(e.pos.x-aim.x,e.pos.z-aim.z)), distance:2.25});
            e.goldenFrame();
            chosen = {eye:e.camera.position.toArray(),target:aim.toArray(),aim:aim.toArray(),normal:normal.toArray(),avatar:e.pos.toArray(),fov:e.camera.fov,clearRay:c.clear,candidates:candidates.length,exit};
          }
          e.camera.position.fromArray(chosen.eye); e.camera.fov = chosen.fov;
          e.camera.lookAt(new T.Vector3(...chosen.target)); e.camera.updateProjectionMatrix(); e.camera.updateMatrixWorld(true);
          if (chosen.avatar) {
            e.walkFrom({x:chosen.avatar[0],y:-chosen.avatar[2],z:chosen.avatar[1]},0);
            e.camera.position.fromArray(chosen.eye); e.camera.lookAt(new T.Vector3(...chosen.target)); e.camera.updateMatrixWorld(true);
          }
          e.stationScene.update?.(0,0,e.camera);
          const draws = {};
          if (layer) for (const o of layer.children) {
            const old = o.onBeforeRender;
            o.onBeforeRender = function(...args) {draws[o.name]=(draws[o.name]??0)+1;old.apply(this,args);};
          }
          e.render(0);
          const canvas = e.renderer.domElement, rect = canvas.getBoundingClientRect();
          const gl = e.renderer.getContext(), w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
          const pixels = new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          const luminance = rgb => rgb.map(v=>{v/=255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[0.2126,0.7152,0.0722][i],0);
          const sample = point => {
            const p=point.clone().project(e.camera);
            if (Math.abs(p.x)>1 || Math.abs(p.y)>1 || p.z>1) return null;
            const x=Math.min(w-1,Math.floor((p.x+1)*w/2)),y=Math.min(h-1,Math.floor((p.y+1)*h/2));
            const k=(y*w+x)*4;return luminance(Array.from(pixels.slice(k,k+3)));
          };
          let metrics = {jaCapPx:0, letterContrast:null, signMeanLuminance:null, projectedSignCorners:[]};
          if (sign) {
            const img=sign.material.map.image, data=img.getContext('2d').getImageData(0,0,img.width,img.height).data;
            const sw=sign.geometry.parameters.width,sh=sign.geometry.parameters.height;
            const local=(u,v)=>new T.Vector3((u/img.width-0.5)*sw,(0.5-v/img.height)*sh,0).applyMatrix4(sign.matrixWorld);
            let minY=img.height,maxY=0,letters=[],band=[],all=[];
            for(let v=0;v<img.height;v+=2) for(let u=0;u<img.width;u+=2) {
              const alpha=data[(v*img.width+u)*4+3];
              if(v<78&&alpha>240){minY=Math.min(minY,v);maxY=Math.max(maxY,v);}
              const value=sample(local(u,v));if(value===null)continue;all.push(value);
              if(alpha>240)letters.push(value);if(alpha<5)band.push(value);
            }
            const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
            const top=local(img.width/2,minY).project(e.camera),bottom=local(img.width/2,maxY).project(e.camera);
            metrics={jaCapPx:Math.hypot((top.x-bottom.x)*rect.width/2,(top.y-bottom.y)*rect.height/2),letterContrast:letters.length&&band.length?(avg(letters)+0.05)/(avg(band)+0.05):null,signMeanLuminance:avg(all),projectedSignCorners:[[0,0],[img.width,0],[img.width,img.height],[0,img.height]].map(([u,v])=>{const p=local(u,v).project(e.camera);return [(p.x+1)*rect.width/2,(1-p.y)*rect.height/2,p.z]})};
          }
          return {pose:chosen,metrics,draws,viewport:[innerWidth,innerHeight],canvas:[w,h],flag,store,kind,capturedAtUTC:new Date().toISOString(),landmarkCount:layer?.children.length??0};
        }, {store,exit,kind,flag,pose:flag==='off'?poses[key]:null});
        if(flag==='next') poses[key]=result.pose;
        const file=`${key}-${flag}.png`;
        await page.screenshot({path:`${root}/${file}`});
        frames.push({file,...result});
        await fs.writeFile(`${root}/frames.json`, JSON.stringify(frames,null,2)+'\n');
        console.log(`${file}: facade draws=${result.draws[`ctx_bldg_landmark_${store}`]??0}, sign draws=${result.draws[`landmark-sign:${store}`]??0}, ja=${result.metrics.jaCapPx.toFixed(2)} px`);
      }
    }
  }
}
console.log(`Captured ${frames.length} frames; timestamps labelled UTC in frames.json`);
