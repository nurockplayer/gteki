# Shinjuku GPU texture memory: measurement and phone budget (#72 follow-up)

Status: **measured; §3 is a provisional warning line (director, 2026-10-23), not a merge gate.**

1. The §3 numbers are **GTEki's own choice, with no cited source** (see §2).
2. They must be **calibrated by the real-phone test (#46)**.
3. Going over them **only raises a warning**; it never blocks a merge.

A PR that raises the phone-tier texture total states the increase in MiB in its description, measured with `test/helpers/texture-memory.ts` or the same method.

## 1. Measurement

`stations/shinjuku/test/texture-memory.test.ts` builds the scene in Node through `buildScene`, at both qualities. It then walks every texture on every mesh material and counts each texture object once. The estimate per texture is width × height × bytes per pixel, × 4/3 when mipmaps are generated or sampled. Run it alone with `pnpm exec vitest run stations/shinjuku/test/texture-memory.test.ts --maxWorkers=1`; it prints the table.

Measured on main c94e4c7, branch head 208f08c:

| Category | Textures | MiB | Notes |
|---|---:|---:|---|
| signage | 6 | 111.2 | The two sign atlas pages (3120×3872 and 3120×2000) are about 93 MiB of this. |
| finish | 16 | 56.3 | Floor, wall, ceiling and tactile strip maps. |
| facade | 5 | 13.3 | Street building facades. |
| lighting | 1 | 8.0 | The light-pool aoMap atlas. |
| paving | 2 | 0.7 | Street paving. |
| kit | 0 | 0 | The kit swap is not on main yet (flag off). |
| **total** | **30** | **189.5** | **low (phone) = high (desktop)** |

Phone and desktop are identical: `quality` changes anisotropy and shadows only, not texture sizes.

What the estimate leaves out:
- Driver padding.
- Any CPU-side copy the browser keeps after the upload. Whether iOS keeps one is a GAP (DR-MW, #274).
- Compression. Every texture is an uncompressed RGBA8 canvas.

## 2. What is known about iPhone limits (data research R17, #274)

- Apple and WebKit publish no WebGL- or GPU-specific memory number, and no figure per RAM class: **GAP**.
- The only first-party statement: a WebKit engineer (2024-08-09, DR-MW-02) put the WebContent soft limit on iPhone at **about 1.5 GB for the whole page process**, lower on devices with less RAM, without a number. How GPU texture memory counts against it is unknown.
- Blog figures of about 100–450 MB for iPhone 11–14 (DR-MW-05/06) have no source and contradict DR-MW-02: **SECONDARY/UNVERIFIED**, not used here.
- Compressed textures: devices report ASTC and ETC support, but maintainers report iOS falling back to RGBA for KTX in some versions (DR-MW-12/14). This is unresolved, so the budget assumes uncompressed RGBA8.
- No engine or vendor (PlayCanvas, Babylon, three.js, Google, Unity, Apple) publishes a phone texture budget: **GAP**.

## 3. Phone (low tier) warning line: GTEki's choice, not sourced, warning only

Reasoning:
- The texture total has to share the page's roughly 1.5 GB with the JS heap (about 45 MB after GC), geometry buffers (about 13 MB), the browser itself, and possibly a second copy of every texture (GAP).
- Low-RAM iPhones get less than 1.5 GB, by an unknown amount.
- Keeping textures to roughly a tenth of the only cited ceiling leaves room for a CPU-side copy and for the lower limit on 3–4 GB phones.

| Category | Phone budget (MiB) | Today | Over? |
|---|---:|---:|---|
| signage | 40 | 111.2 | **yes** |
| finish | 40 | 56.3 | **yes** |
| facade | 12 | 13.3 | slightly |
| lighting | 8 | 8.0 | at the limit |
| kit (#94, mobile tier with AO) | 12 | 0 | — |
| **total** | **112** | **189.5** | **yes** |

For #94, the regenerated catalog's mobile kit texture estimate is about 3.1 MB + 2.5 MiB for the ten escalator dressings at `ao_res: 256`, or approximately 5.6 MiB. This is an estimate from the Lane E AO figures, not a device measurement; the `Today` value above remains the measured flag-off baseline.

Mobile additions and offsets (rule in docs/assets/texture-budget.md: until the mobile tier is back under its cap, each PR that adds mobile texture or geometry lists its saving here or says "no offset"):

| PR | Adds (mobile) | Offset |
|---|---|---|
| #94 kit catalog: 10 escalator dressings `ao_res` 128 → 256 | about +2.5 MiB GPU per tier (estimate, Lane E figures) | **No offset.** Reason: the escalator AO charts cannot fit at 128 px (Lane E slot 3 build of catalog 3f33f35: LightmapOverflow on all 10, both tiers), so 128 is not buildable. Stairs stay at 128. |

How to check it: run `texture-memory.test.ts`, or the same helper on another station's scene, and compare the low-tier rows with this table.

Ikebukuro #180's sign atlas, 53–64 MiB on the phone, is above the 40 MiB signage line. Per the director it is **not blocked** by this line; the Friday real-phone shots decide it.

## 4. Follow-ups

The root problem is that `quality` does not change texture sizes. A shared follow-up issue, #276, covers both stations.

1. **Low tier: halve the sign atlas resolution.** That is a quarter of the bytes, about 93 → 23 MiB. Readability must be rechecked on a phone (the #180 small-text concern).
2. **Low tier: halve the finish maps,** or share one set across materials that repeat them.
3. **Confirm on a real iPhone** (3–4 GB RAM class, #46) with Safari Web Inspector memory, before any limit becomes a test threshold.
4. **Once KTX2/ASTC is confirmed on iOS** (open, DR-MW-12/14), re-measure with compressed sizes.
