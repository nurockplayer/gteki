# GTEki GLB web preview

This standalone Vite app reads `assets/library/manifest.json`, lists the kit assets, and renders the selected GLB with Three.js. The toolbar toggles the 1 m grid, reveals collision-only meshes as translucent wireframes, and shows axes at `SOCKET_*` nodes. Add `?asset=<id>` to select an asset or `?mode=gallery` to lay out the full manifest.

Run it from this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The development server serves the library at `/library/`. Set `GTEKI_LIBRARY_DIR` to a different library root when testing; that directory must contain `manifest.json` and the manifest-relative GLB files. For example:

```sh
GTEKI_LIBRARY_DIR=/path/to/library pnpm dev
GTEKI_LIBRARY_DIR=/path/to/library pnpm run load-test
```

`pnpm run build` creates the static app in `dist/`. The Node load test parses every `.glb` in `<library>/glb` through Three.js `GLTFLoader` and reports scene node counts and original collision node names. In Node it checks embedded PNG/JPEG signatures and dimensions through an image-decoder stub, and fails if Three.js reports a resource load error. It does not decode pixels or test GPU rendering. Use a browser for visual checks.

## Load-strategy bench

`/bench.html` loads a showcase layout (`tools/blender/showcase/<layout>.json`) the same way under three strategies:

- `per_instance`: one fetch and parse per placed item, as a loader without a URI cache would do.
- `per_asset`: each distinct GLB once, then `clone()`.
- `bundle`: one `bundle_kit.py` GLB, then `clone()`.

It reports requests, bytes, load and first-frame time, `renderer.info`, texture, material and geometry counts, an estimate of GPU texture memory, JS heap (Chromium only), and render+GPU frame time measured with a 1-pixel readback. The results go to `window.__bench` and an on-page panel.

```sh
python3 ../bundle_kit.py bundle --library ../../../assets/library --layout ../showcase/concourse_demo.json --out ../out/bundles/kit_concourse.glb
GTEKI_COMPARE_LIBRARY_DIR=/path/to/old/library pnpm dev
# /bench.html?layout=concourse_demo&strategy=bundle            (&lib=compare, &bundle=<file>, &frames=N, &ktx2=1)
```

`ktx2=1` registers `KTX2Loader` (with the transcoder from `three/examples/jsm/libs/basis`), so a KTX2 variant of a bundle can be measured. The kit does not ship KTX2.

## Verification

With the Blender-generated throwaway fixtures, the verified commands were:

```sh
GTEKI_LIBRARY_DIR=/private/tmp/.../scratchpad/codex/testglb pnpm run load-test
pnpm exec vite build
```

The two fixtures parsed as six scene nodes each. The Vite app served the fixture manifest and both GLBs over HTTP, and the browser check opened an individual asset, exercised the collision and socket toggles, and loaded gallery mode.

The browser smoke check predates the final improvements to original node-name
handling, grid controls, framing, load races, and resource cleanup. The final
code passed install/build/Node load checks, but has not had a second visual
browser check. The `/library/` middleware is development-only; a static host
must separately serve the library at that URL.
