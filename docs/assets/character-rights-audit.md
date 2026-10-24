# Protagonist character: rights audit (P0, #339)

Status: **Lane E audit, 2026-10-24.** This covers the two outside sources that the director's #339 ruling 1 allows for the rigged protagonist. Nothing from either archive is committed by this PR. Each archive was downloaded once into an untracked folder of the Lane E worktree, and the Owner approved both downloads in chat on 2026-10-24. The verdicts below rest on the licence files **inside** the archives, not on web pages.

## 1. MPFB2 core base (MakeHuman community)

| Item | Value |
| --- | --- |
| Archive | `mpfb2-v2.0.18.tar.gz`, GitHub tag `v2.0.18` (published 2026-10-11), from `https://github.com/makehumancommunity/mpfb2/archive/refs/tags/v2.0.18.tar.gz` |
| Downloaded | 2026-10-24 00:33 JST |
| SHA-256 (archive) | `2909fdf3de140d7ba13b024f3316e8c9862b312d80b39469dfeaba25af30d1c8` |
| `LICENSE.md` | `5cefb60680cb9efd4550a2e65d719021cfbec9dad3658481d11d48ae863ce04d` |
| `LICENSE.ASSETS.md` | `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c`, the full CC0 1.0 Universal legal code |
| `src/mpfb/data/3dobjs/base.obj` | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` (the base mesh) |

What `LICENSE.md` says:

- **§B:** the add-on's source code (Python, scripts, configuration) is GPLv3.
- **§C:** the assets are CC0 1.0. That covers "the base mesh and proxies, targets and modifiers, textures, clothes, rigs, poses and expressions, JSON data with mesh information".
- **§D:** the MakeHuman team "makes no claim whatsoever" over output, such as exports, generated data and saved model files.

**Verdict: usable.** The base mesh and the targets are CC0, and so are any rig, pose or expression data we take from the add-on. Our edited mesh, clothes, hair, daypack, weights and morphs are original work under **CC-BY-4.0** (credit "GTEki contributors"). A CC0 input asks for no attribution, but NOTICE will still name MPFB2 as the source of the base topology, for provenance.

Two limits apply:

- **No MPFB2 code in the repo.** The add-on runs only inside the author's Blender as a tool. Nothing from `src/mpfb/**/*.py` is copied into GTEki, so GPLv3 does not apply to the repo.
- **System assets pack not taken.** The separate "MakeHuman system assets" pack (eyes, proxies, also CC0) was not downloaded. The face is our own simplified mesh (contract §5), so it isn't needed. If E1 does want it, it gets its own audit row first.

## 2. Quaternius Universal Animation Library (UAL), Standard (free) tier

| Item | Value |
| --- | --- |
| Archive | `Universal Animation Library[Standard].zip`, itch.io upload 17958403 (price $0, "No thanks, just take me to the downloads"), from `https://quaternius.itch.io/universal-animation-library` |
| Downloaded | 2026-10-24 00:35 JST |
| SHA-256 (archive) | `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724` (15 904 933 bytes) |
| Archive timestamps | Licence and readme 2026-06-17, so this copy predates the 2026-08-28 site licence |
| `License.txt` | `6d01f55c6e4c49a2c9963e147e561945ae2c83958c8ca667d90a6bffdbfac061`: "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication, https://creativecommons.org/publicdomain/zero/1.0/ … Models by @Quaternius" |
| `README.txt` | `ccd02718886b5a57f10f0a8911a38cfe10c36880e1d6dfa3445923fba32d2a72`: the same CC0 dedication, and notes that the `_RM` files bake root motion |
| `Unreal-Godot/UAL1_Standard.glb` | `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997` (in place) |
| `Unreal-Godot/UAL1_Standard_RM.glb` | `be684571ed655a1b892c2c07e6e2aeca053b606c442d34004adaf1d944090d01` (root motion) |

**Verdict: CC0 inside the archive, so it is usable as edited derivatives, as ruling 1 allows.** A CC0 dedication can't be withdrawn for the copy that carries it. The later site licence doesn't reach back to this hashed copy.

How we use it:

- Clips may be **retargeted and edited onto our own rig** as starting points: stride, contacts, loop and timing are reworked.
- The **unedited Quaternius files are never committed**: no mannequin mesh, no raw GLB or FBX. That keeps clear of the later site terms, which bar redistributing the assets themselves.
- Each derived clip records the archive hash and source clip name in its `provenance` (contract §7).
- Once the first derived clip lands, the repo gets `LICENSES/LicenseRef-Quaternius-UAL-CC0-archive.txt`. That file points to this audit, the archive hash and the in-archive dedication text. NOTICE gains an entry for it, and REUSE.toml maps the derived clip data to it.

We do not contact Quaternius (ruling 1). **The plan does not depend on it:** every clip in contract §6 can be authored from scratch on our rig.

What the Standard tier contains:

- **Skeleton:** one skin named `Armature`, 65 joints in UE mannequin naming (`root`, `pelvis`, `spine_01..03`, `neck_01`, `Head`, `clavicle_*`, `upperarm_*`, `lowerarm_*`, `hand_*`, full finger chains, `thigh_*`, `calf_*`, `foot_*`, `ball_*`).
- **Mesh:** one mesh, `Mannequin`. Exported by Blender glTF I/O 4.5.48.
- **43 clips.** The ones relevant to #339:
  - `Idle_Loop` → `idle`;
  - `Walk_Loop` → `walk`;
  - `Jog_Fwd_Loop` → `jog`;
  - `Sprint_Loop` → `run`, slowed toward 3.4 m/s.
- **Missing:** no clip for start, stop, turn-in-place, stairs or escalator stand. Lane E authors those itself in E3.

## 3. Sources ruled out (director ruling 1, for the record)

| Source | Status |
| --- | --- |
| Mixamo | Not used. Adobe General Terms §3.6 bar standalone distribution, and converting the format doesn't change that. |
| CMU mocap | Not used. Its custom terms don't fit the REUSE CC0 / CC BY layout. |
| VRoid | Not used. |

## 4. Where the archives live

They are in `.p0_rights/` at the root of the Lane E worktree. The folder is untracked and excluded through `.git/info/exclude`. The archives are kept so the hashes above can be checked again; they are never staged.
