import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { ARTIFACTS, openStation } from "../lib/gteki.ts";

// J10 evidence only: the art director judges these paired captures and patch measurements.
const cameras = JSON.parse(fs.readFileSync(new URL("../golden-cameras.json", import.meta.url), "utf8")).cameras
  .filter((c: { id: string }) => /^slice-(01|02|04|06|11)-/.test(c.id));
const out = path.join(ARTIFACTS, "golden", "j10-materials");

test("J10 material package A paired frames and patch measurements", async ({ browser }) => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(out, { recursive: true });
  const rows: any[] = [];
  for (const [device, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]] as const) {
    // Low tier on both sizes; software CI is evidence, never the GPU performance verdict.
    const context = await browser.newContext({ viewport: { width, height }, screen: { width: 640, height: 600 },
      deviceScaleFactor: 1, isMobile: device === "phone", hasTouch: device === "phone" });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    const captures: Record<string, { png: Buffer; metrics: any }> = {};
    for (const next of [false, true]) {
      await openStation(page, "shinjuku", `&qaCrowd=off&qaTimeBand=morning&qaEscalatorPhase=0${next ? "&next=1" : ""}`);
      await page.addStyleTag({ content: ".hud,.panel,.minimap,.label,.identity-label,.credit,.chips,.mascot,.walk-hud,.boot-card { visibility:hidden!important }" });
      for (const camera of cameras) {
        await page.evaluate(({ node, headingDeg }) => {
          const qa = (window as any).__gteki;
          qa.holdFrames(true); qa.setCamera({ pitch: 0 });
          const result = qa.setView({ node, headingDeg });
          if (!result.placed) throw new Error(`Cannot place ${node}`);
          qa.goldenFrame();
        }, camera);
        const name = `${device}-${camera.id}-${next ? "next" : "off"}`;
        const png = await page.screenshot({ path: path.join(out, `${name}.png`), animations: "disabled" });
        const figurePoints = camera.id.startsWith("slice-11") ? await page.evaluate(() =>
          (window as any).__gteki.projectEnu([{x:-24.2,y:113.7,z:-42.87},{x:-23.6,y:113.7,z:-41.1}])) : null;
        const metrics = await page.evaluate(async ({ b64, id, figurePoints }) => {
          const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
          const patch = (rect: number[]) => {
            const [x,y,w,h] = rect.map((v,i) => Math.round(v * (i % 2 ? canvas.height : canvas.width)));
            const data = ctx.getImageData(x,y,w,h).data, luma: number[] = [];
            let red=0,blue=0,clipped=0;
            for(let i=0;i<data.length;i+=4) {
              luma.push(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]); red+=data[i];blue+=data[i+2];
              if(Math.max(data[i],data[i+1],data[i+2])===255)clipped++;
            }
            luma.sort((a,b)=>a-b);
            const peak=luma[Math.floor(luma.length*.95)],gap=luma[Math.floor(luma.length*.05)];
            return { rect:[x,y,w,h], mean:luma.reduce((a,b)=>a+b,0)/luma.length, peak95:peak,gap05:gap,
              peakGap:peak/gap, clippedShare:clipped/luma.length, redBlue:red/blue };
          };
          const figureRect = figurePoints && figurePoints.every((p:any)=>!p.behind) ? [
            Math.min(figurePoints[0].x,figurePoints[1].x)/canvas.width,
            Math.min(figurePoints[0].y,figurePoints[1].y)/canvas.height,
            Math.abs(figurePoints[0].x-figurePoints[1].x)/canvas.width,
            Math.abs(figurePoints[0].y-figurePoints[1].y)/canvas.height] : null;
          const figure = figureRect && figureRect[0]>=0 && figureRect[1]>=0 && figureRect[0]+figureRect[2]<1 && figureRect[1]+figureRect[3]<1 ? patch(figureRect) : null;
          return { figure, floor:patch([.17,.64,.22,.20]), opening:id.startsWith("slice-01")?patch([.04,.12,.28,.32]):null,
            landing:id.startsWith("slice-11")?patch([.12,.51,.33,.23]):null };
        }, { b64: png.toString("base64"), id: camera.id, figurePoints });
        captures[`${camera.id}-${next}`] = { png, metrics };
        fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(metrics,null,2));
        await page.evaluate(() => (window as any).__gteki.holdFrames(false));
      }
    }
    for (const camera of cameras) {
      const off=captures[`${camera.id}-false`], next=captures[`${camera.id}-true`];
      rows.push({ device,camera:camera.id,off:off.metrics,next:next.metrics,
        floorMeanVsOff:next.metrics.floor.mean/off.metrics.floor.mean,
        figureVsLanding:next.metrics.figure ? next.metrics.figure.mean/next.metrics.landing.mean : null, errors:[...errors] });
      const paired = await page.evaluate(async ({ a,b }) => {
        const load=async (data:string) => { const i=new Image();i.src=`data:image/png;base64,${data}`;await i.decode();return i; };
        const [off,next]=await Promise.all([load(a),load(b)]), c=document.createElement("canvas");
        c.width=off.width*2;c.height=off.height;const x=c.getContext("2d")!;x.drawImage(off,0,0);x.drawImage(next,off.width,0);
        return c.toDataURL("image/png").split(",")[1];
      }, { a:off.png.toString("base64"),b:next.png.toString("base64") });
      fs.writeFileSync(path.join(out,`${device}-${camera.id}-paired.png`),Buffer.from(paired,"base64"));
    }
    await context.close();
    fs.writeFileSync(path.join(out,"metrics.json"),JSON.stringify({ capturedAt:new Date().toISOString(),
      method:"Display sRGB Rec.709 luma; floor/landing p95:p05 (not a fixture-isolated maximum); any RGB channel=255 is clipped. Rectangles are x,y,width,height pixels. Paired frames are off left, next right; existing flag-dependent camera framing is retained.",rows },null,2));
  }
  if (rows.some(r=>r.errors.length)) throw new Error(JSON.stringify(rows.flatMap(r=>r.errors)));
});
