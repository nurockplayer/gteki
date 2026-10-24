# GTEki sign font

Noto Sans JP variable TrueType, pinned to the official `notofonts/noto-cjk`
release tag [`Sans2.004`](https://github.com/notofonts/noto-cjk/tree/Sans2.004).
This tag matches the font release already recorded for GTEki's artwork pipeline.
The upstream language-specific JP variable TTF is further subset for runtime signs;
the full source TTF is never committed.

- Source: https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf
- Version from name ID 5: `Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603`
- SHA-256: `f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369`
- Licence: OFL-1.1; [`OFL.txt`](OFL.txt) is the verbatim upstream
  [LICENSE](https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/LICENSE).
  `LICENSES/OFL-1.1.txt` contains its standard licence body.
- Exact name ID 0: © 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.

The upstream LICENSE file contains no project-specific copyright/RFN statement;
the font's own name table supplies the notice and Reserved Font Name **Source**.
Our modified subset uses **GTEki Sign JP** for family/full/typographic family
names and FontFace registration, and **GTEkiSignJP** as its PostScript name.
Named-instance PostScript strings also use our prefix. Copyright, licence,
attribution and version records are retained. The complete verbatim OFL text is
also appended to name ID 13, so the deployed WOFF2 itself carries the licence
and name ID 0 copyright notice as readable machine metadata.

## Reproduce

Use the repo's pinned pnpm version and frozen lockfile. `subset-font@2.5.0`
uses HarfBuzz WASM and WOFF2; `fontkit@2.0.4` reads and verifies the original
and output metadata/cmaps. `@babel/parser@7.28.5` parses TypeScript literals
and nested template text without evaluating station code. No Python font
processing toolchain is required.

```sh
lockf -k /tmp/gteki-local-test.lock pnpm fonts:subset
lockf -k /tmp/gteki-local-test.lock pnpm fonts:subset --check
```

The generated WOFF2 lives at `apps/web/src/fonts/GTEkiSignJP-subset.woff2`,
inside the web app's publication boundary. The source and licence records and
glyph/byte reports remain here. Both font paths have an explicit OFL annotation.
The existing publication gate is unchanged.

The script downloads only the pinned font URL into ignored `.cache/fonts/`,
verifies source bytes/SHA-256 and the name-table version/copyright, and checks
the committed OFL file's SHA-256. A cached source is verified on every run.
`--check` regenerates sequentially and compares `glyphs.txt`, the WOFF2 and
`bytes.json` byte for byte, failing with `run pnpm fonts:subset` when stale.

The fixed base includes printable ASCII, assigned hiragana/katakana (including
the prolonged-sound mark), CJK symbols/punctuation, fullwidth ASCII/forms,
halfwidth kana and sign arrows/symbols. We add every JSON string value from
`stations/*/gteki/station.json` and `stations/*/scene/*.json`, and every string
literal/template segment from `stations/*/scene/*.ts` (including test files).
This deliberately includes metadata beyond displayed labels. Control/format
characters are excluded; no Unicode normalization changes the sign text.
Characters are sorted by code point. All **802** required characters have
upstream and subset cmap entries. Unsupported future characters fail generation.
The root Vitest coverage test catches new sign characters and tells CI to run
`pnpm fonts:subset`. Shinjuku sources are scanned read-only.

## Byte report

`bytes.json` is generated, including hashes and compression measurements.
Sizes are bytes, not KiB. Gzip uses level 9; Brotli uses Node's defaults.

| Candidate | Raw bytes | Gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Upstream JP variable TTF | 9,590,732 | — | — |
| Shipped WOFF2, wght 500–800 | 261,364 | 261,432 | 261,369 |
| Mobile alternative, static 700 | 150,372 | 150,409 | 150,377 |
| Mobile alternative, static 600 | 146,116 | 146,179 | 146,121 |
| Mobile alternative, static 800 | 149,904 | 149,972 | 149,909 |
| Mobile 600+800 pair | 296,020 | 296,151 | 296,030 |

**Both full and mobile tiers load the same 261,364-byte variable WOFF2.**
It is 97.3% smaller than the upstream TTF. Static 700 alone saves 42.5% against
the variable subset (crossing the 40% threshold), but collapses the current
500/600/700/800 weight distinctions. The 600+800 pair costs 13.3% more than
the variable file and still loses exact 500/700. We retain all four requested
weights; accepting a uniform 700 on mobile is a lead judgement call. Alternative
files are measured in memory, never shipped. WOFF2 is already compressed;
gzip/Brotli slightly increase transfer size here.

The shared web explorer awaits `loadSignFont()` before station `buildScene`,
independent of quality tier. The single cached FontFace load has a five-second
deadline; a failure logs once and uses the existing system stack. A late load
after timeout is not registered. Non-DOM callers do nothing. Ikebukuro opts into
the alias with its single FONT-line change. Shinjuku adoption remains Q1a;
font availability alone does not change its existing font stack.

Build size: the font asset costs **261,364 bytes**, plus the loader's JavaScript.
The source TTF, alternate measurements, separate licence records and font tooling
are not client imports. The single permitted `pnpm build` failed at the
publication gate because the initial output path was outside the web app.
The WOFF2 was then relocated inside the app boundary and a targeted test verifies
the gate accepts its actual final path while still refusing outside files.
No second production build was run under the worker's one-build budget; final
output size and the JavaScript delta remain unmeasured. CI/lead validation must
confirm the full production build. No browser/GPU rendering verification was run.
