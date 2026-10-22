# DR-mobile-webgl-memory

Tracking: #165 item R17. Requested by: sjk-visual-b8. As of: 2026-10-23.
Purpose: facts for a mobile GPU texture-memory budget (#72 follow-up); sanity check of a 53-64 MiB Ikebukuro sign atlas on phones.
Method: WebSearch + WebFetch only. PAGE_READ = fetched via WebFetch (a small model summarised the page, so wording was not read verbatim); SUMMARY_ONLY = search snippet only. No WebKit source file was read directly.

## Q1. iOS per-tab / WebContent memory limits

- GAP: no Apple- or WebKit-published limit specific to WebGL/GPU memory, and no jetsam threshold split by RAM class (3-4 GB vs 6-8 GB). No public API to query the budget was found.
- WebKit engineer statement (Simon Fraser, 2024-08-09, bug filed on iOS 17.5.1): WebContent processes on iPhone have a "soft" limit of about 1.5 GB, somewhat lower on iPhones with less RAM. No RAM figures given. [DR-MW-02, PAGE_READ]
- Single user kernel log (Apr 2026, iPhone 17 Pro 12 GB, iOS 26.3-26.4.1): WebContent killed at "ActiveHard 2048 MB"; same page worked on iPads; an Apple Frameworks Engineer confirmed iPhones have stricter jetsam limits than iPads (no number). [DR-MW-01, PAGE_READ]
- WebKit bug 253172 (2023-03-01, iOS 16.4 betas, iPhone 12 Pro): WebContent jetsammed during WebGL pan/zoom; GPU process memory grew to several GB in simulator; turning off "WebGL via Metal" stopped it; marked duplicate of 252237, improved in 16.4 beta 3. Shows GPU-process memory is involved; no limit number. [DR-MW-03, PAGE_READ]
- Older figure: a 2017 WebKit bug mentions a soft 840 MB WebContent limit (also a 2018 proposal to compute jetsam limit via SPI). [DR-MW-04, SUMMARY_ONLY]
- SECONDARY / UNVERIFIED: Catch Metrics blog (2026-01-05, no named author, no sources) gives approximate "heap limits": iPhone 11/12 ~350-400 MB, 13/14 ~400-450 MB, 15+ ~1 GB+, and cites WebKit files AvailableMemory.cpp etc. for a min(3 GB, min(RAM, jetsam)) formula; it contradicts DR-MW-02 / DR-MW-01 scale. [DR-MW-05, PAGE_READ]
- SECONDARY / UNVERIFIED: abratabia.com (updated June 2026, no author, no sources) says iOS tabs 100-200 MB, 100-150 MB on 3-4 GB devices. [DR-MW-06, PAGE_READ]
- Developer reports of crashes at texture load (Babylon.js, 2022): see Q3 (DR-MW-12).

## Q2. WebGL2 on iOS

- MAX_TEXTURE_SIZE: web3dsurvey iOS data shows >=8192 for 100% and >=16383 for 99% of reports; no date or sample size on page. [DR-MW-07, PAGE_READ] Not verified against gpuinfo.org, WebKit or caniuse (GAP).
- Compressed formats (web3dsurvey iOS share of reports, undated, user-reported): ASTC 99.99% [DR-MW-08]; ETC (ETC2) 99.99% [DR-MW-09]; PVRTC 98.44% [DR-MW-10]; S3TC 52.69% [DR-MW-11]. All PAGE_READ, SECONDARY. caniuse lists WEBGL_compressed_texture_astc as supported on iOS Safari 12 - 26.3 [DR-MW-13, SUMMARY_ONLY].
- Conflicting evidence on ETC/PVRTC: Babylon.js maintainer (bghgary, 2022-01-27) states Apple dropped ETC2/PVRTC support between iOS 14 and 15, causing a raw-RGBA fallback (one model attempted 1.914 GB of texture memory) [DR-MW-12, PAGE_READ]. three.js forum (2023-04-25, iPhone 13 Pro Max, iOS version not stated): device reported ASTC and ETC1 but KTX2Loader set etc1Supported false on WebGL2 and fell back to RGBA32; Mugen87 recommended ASTC for mobile with ETC fallback [DR-MW-14, PAGE_READ]. The survey percentages therefore do not settle ETC2/PVRTC; treat as unresolved.
- KTX2/Basis targets on iOS: Babylon thread says UASTC transcodes to ASTC on iOS 15; ETC1S gives ETC1 without alpha, RGBA with alpha [DR-MW-12]. three.js KTX2Loader docs say detectSupport(renderer) picks the transcode target [DR-MW-15, SUMMARY_ONLY].
- Extra CPU-side copy after RGBA8 upload (WebKit/ANGLE-Metal): GAP. Searches found no WebKit/ANGLE source or bug stating this either way. (Bug 235002 only discusses readPixels on Metal [SUMMARY_ONLY].)

## Q3. Published mobile texture-memory budgets with numbers

- GAP: no official number found from PlayCanvas, Babylon.js, three.js, Google web.dev/Chrome, Unity or Apple WWDC.
- Unity 6 WebGL memory manual (built 2026-10-22): gives no mobile budget or iOS Safari figure; says asset data is held uncompressed and memory varies by device/browser. [DR-MW-16, PAGE_READ]
- PlayCanvas forum (staff-type reply "Max", 2016-12-13): mobile VRAM is shared with RAM and not large; uncompressed 4096x4096 with mipmaps about 90 MB; compression saves at least 6x. [DR-MW-17, PAGE_READ] PlayCanvas forum (Leonidas, 2021-11-23): 1 GB of resources is "a lot" for mobile; iOS limits can be quite low; no number. [DR-MW-18, PAGE_READ]
- SECONDARY / UNVERIFIED: abratabia.com (June 2026): design to 150 MB total with 70-80 MB for GPU textures; formulas RGBA8 = w*h*4 (x1.33 mips), ASTC 4x4 = 1 byte/px, ASTC 8x8 = 0.5 byte/px. [DR-MW-06]
- Babylon forum user guess of ~1 GB common VRAM limit (SUMMARY_ONLY, undated) and Unity forum user 400 MiB mobile target (SUMMARY_ONLY, undated): not authoritative; URLs in DR-MW-19/20.

## Sources

| ID | Title | Publisher | URL | Date | Read | Licence |
|---|---|---|---|---|---|---|
| DR-MW-01 | WebKit.WebContent killed by jetsam (ActiveHard 2048 MB) iPhone 17 Pro | Apple Developer Forums (user + Apple staff) | https://developer.apple.com/forums/thread/823061 | Apr 2026 | PAGE_READ | facts only |
| DR-MW-02 | WebKit bug 277848 | WebKit Bugzilla (Simon Fraser) | https://bugs.webkit.org/show_bug.cgi?id=277848 | 2024-08-09 | PAGE_READ | facts only |
| DR-MW-03 | WebKit bug 253172 | WebKit Bugzilla | https://bugs.webkit.org/show_bug.cgi?id=253172 | 2023-03-01 | PAGE_READ | facts only |
| DR-MW-04 | WebKit bugs 256703 / 171944 / 188091 (840 MB mention) | WebKit Bugzilla | https://bugs.webkit.org/show_bug.cgi?id=188091 | 2017-2018 per summary | SUMMARY_ONLY | facts only |
| DR-MW-05 | Deep dive RAM internals WebKit | Catch Metrics (SECONDARY) | https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit | 2026-01-05 | PAGE_READ | facts only |
| DR-MW-06 | Mobile browser asset budgets | abratabia.com (SECONDARY) | https://abratabia.com/mobile-browser-performance/asset-budgets.php | updated Jun 2026 | PAGE_READ | facts only |
| DR-MW-07 | WebGL2 MAX_TEXTURE_SIZE | web3dsurvey.com (SECONDARY) | https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE | undated | PAGE_READ | facts only |
| DR-MW-08 | WEBGL_compressed_texture_astc | web3dsurvey.com | https://web3dsurvey.com/webgl2/extensions/WEBGL_compressed_texture_astc | undated | PAGE_READ | facts only |
| DR-MW-09 | WEBGL_compressed_texture_etc | web3dsurvey.com | https://web3dsurvey.com/webgl2/extensions/WEBGL_compressed_texture_etc | undated | PAGE_READ | facts only |
| DR-MW-10 | WEBGL_compressed_texture_pvrtc | web3dsurvey.com | https://web3dsurvey.com/webgl2/extensions/WEBGL_compressed_texture_pvrtc | undated | PAGE_READ | facts only |
| DR-MW-11 | WEBGL_compressed_texture_s3tc | web3dsurvey.com | https://web3dsurvey.com/webgl2/extensions/WEBGL_compressed_texture_s3tc | undated | PAGE_READ | facts only |
| DR-MW-12 | OpacityTexture not working on iOS 15 devices | Babylon.js forum (bghgary) | https://forum.babylonjs.com/t/opacitytexture-not-working-on-ios-15-devices/25102?page=2 | 2021-12-17 to 2022-01-28 | PAGE_READ | facts only |
| DR-MW-13 | caniuse WEBGL_compressed_texture_astc | caniuse | https://caniuse.com/wf-webgl-compressed-texture-astc | undated | SUMMARY_ONLY | facts only |
| DR-MW-14 | KTX ASTC ETC support | three.js discourse | https://discourse.threejs.org/t/ktx-astc-etc-support/50815 | 2023-04-25 (reply 2025-04-19) | PAGE_READ | facts only |
| DR-MW-15 | KTX2Loader docs | three.js | https://threejs.org/docs/pages/KTX2Loader.html | undated | SUMMARY_ONLY | facts only |
| DR-MW-16 | Unity 6 WebGL memory | Unity manual | https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-memory.html | built 2026-10-22 | PAGE_READ | facts only |
| DR-MW-17 | Safe maximum memory size for WebGL PlayCanvas builds | PlayCanvas forum | https://forum.playcanvas.com/t/what-is-a-safe-maximum-memory-size-for-webgl-playcanvas-builds/2987 | 2016-12-13 | PAGE_READ | facts only |
| DR-MW-18 | WebGL limitations | PlayCanvas forum | https://forum.playcanvas.com/t/webgl-limitations/22994 | 2021-11-23 | PAGE_READ | facts only |
| DR-MW-19 | Reducing memory consumption in BabylonJS apps | Babylon.js forum | https://forum.babylonjs.com/t/reducing-memory-consumption-in-babylonjs-apps/53242 | undated | SUMMARY_ONLY | facts only |
| DR-MW-20 | WebGL memory increment issue and crash on iOS | Unity discussions | https://discussions.unity.com/t/webgl-memory-increment-issue-and-crash-on-ios/894771 | undated | SUMMARY_ONLY | facts only |

## What this cannot tell you

- No authoritative per-device jetsam number for 3-4 GB iPhones; the only primary numbers are ~1.5 GB soft (iPhone, 2024, lower on less RAM) and 2048 MB hard on a 12 GB iPhone (2026). GPU texture memory counts toward which process/limit is not stated.
- Whether a 53-64 MiB atlas is safe is not answerable from these sources; none gives a texture budget from an official publisher. Secondary figures (100-200 MB tab, 70-80 MB textures) are unsourced.
- Whether an RGBA8 upload leaves a CPU copy: GAP.
- Survey percentages are user-reported and undated; they do not reveal per-device MAX_TEXTURE_SIZE or which iOS version supports ETC2/PVRTC (reports conflict).
- Fetched pages were summarised by a small model; verify numbers against the pages before relying on them.
