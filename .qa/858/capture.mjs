import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = process.cwd();
const { chromium } = createRequire(path.join(root, 'tests/e2e/package.json'))('@playwright/test');
const server = spawn('pnpm', ['--filter', '@gteki/web', 'dev', '--port', '5199', '--strictPort', '--host', '127.0.0.1'], { stdio: 'inherit' });
let browser;
try {
  const url = 'http://127.0.0.1:5199/qa/station-858.html';
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(r => setTimeout(r, 500)); }
  browser = await chromium.launch({headless:true, executablePath:'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', args:['--enable-gpu','--ignore-gpu-blocklist','--use-angle=metal','--enable-unsafe-webgpu']});
  for (const base of [1, 0]) for (const quality of ['low','high']) {
    const page = await browser.newPage({viewport:{width:1280,height:720}});
    page.on('pageerror', e => console.error(e));
    await page.goto(`${url}?base=${base}&quality=${quality}`);
    await page.waitForFunction(() => window.__stationGl, null, {timeout:180000});
    console.log(JSON.stringify({base, ...(await page.evaluate(() => window.__stationGl))}));
    if (!base && quality === 'high') await page.screenshot({path:'.qa/858/platform.png'});
    await page.close();
  }
} finally { if (browser) await browser.close(); server.kill(); }
