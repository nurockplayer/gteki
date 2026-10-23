# GTEki Character Contract — `gteki-character/0.1`

Status: **Proposed by Lane E for #339 (P0), 2026-10-24.** This is what the protagonist character GLB guarantees to the explorer (X1–X3) and to Shinjuku (S1). It is a **separate contract** from the station kit's `gteki-asset/0.1` ([asset-contract.md](asset-contract.md)). The kit exporter and `bundle_kit.py` are not changed: they keep rejecting skins, animations and morphs. Rights for every input are recorded in [character-rights-audit.md](character-rights-audit.md).

The scope is the hero player only. The Shinjuku crowd stays procedural.

## 1. Units, axes, origin

| Item | Rule |
| --- | --- |
| Units | 1 glTF unit = 1 m. The root scale is 1. |
| Up | +Y, as in the kit. |
| **Front** | The character faces **−Z** in glTF (it walks toward −Z). In Blender it is authored facing **+Y**, and the exporter's `export_yup` turns that into −Z. **This differs from the kit**, whose front faces +Z ([asset-contract.md §1](asset-contract.md)). The runtime yaw offset between the two is therefore π. |
| Origin | On the floor (`y = 0`), midway between the feet in the bind pose. |
| Height | The top of the head is 1.62–1.72 m (the current avatar test wants > 1.6 m). `extras.gteki_character.height_m` records it. |
| Bind pose | A-pose: arms about 45° down, palms facing down, legs straight, feet hip-width and parallel. |
| Transforms | Mesh transforms are applied, scales are positive, and the root node is at identity. |

## 2. File layout

Each tier is its own GLB: `assets/character/<id>/<id>.high.glb` and `<id>.mobile.glb`. The source `.blend` lives next to them, under `source/`. This is the versioned exception to the "no .blend in Git" convention that ruling 7 grants.

Node tree:

```
<id>                    root node (character id, e.g. gteki_char_commuter_a)
├── ARM_<id>            armature node; the skin's skeleton root
│   └── root …          joints (§3)
├── VIS_body            skinned: body, clothes, hair, daypack (one material, atlased)
└── VIS_head            skinned: face and eyes; carries the blink morphs (§5)
```

- **Draws:** at most 3 primitives per tier: body; head; and an optional separate eye material on the head.
- **Collision:** none. The walker owns collision.

## 3. Export skeleton

The skeleton is authored with Rigify and **baked to the export skeleton below**: Rigify's control, mechanism and helper bones are not exported. It has **38 joints**. Version 0.1 requires exactly these 38 names and no others. The 32–48 range and the 64 ceiling stay as guards for later contract versions, which may add optional joints.

Joint names follow UE mannequin naming, so the Quaternius UAL skeleton (65 joints, audit §2) maps across by name. Parents follow the UE mannequin chain, and a joint with a different parent fails validation:

- `root` → `pelvis` → `spine_01` → `spine_02` → `spine_03` → `neck_01` → `head`; `spine_03` → `daypack`.
- `spine_03` → `clavicle_*` → `upperarm_*` → `lowerarm_*` → `hand_*`; `upperarm_*` → `upperarm_twist_01_*`; `lowerarm_*` → `lowerarm_twist_01_*`.
- `hand_*` → `thumb_01_*` → `thumb_02_*`; `hand_*` → `fingers_01_*` → `fingers_02_*`.
- `pelvis` → `thigh_*` → `calf_*` → `foot_*` → `ball_*`; `thigh_*` → `thigh_twist_01_*`.

| Group | Joints | Count |
| --- | --- | --- |
| Trunk | `root` (on the floor, under the pelvis; carries no motion in clips, §6), `pelvis`, `spine_01`, `spine_02`, `spine_03`, `neck_01`, `head` | 7 |
| Arms ×2 | `clavicle_l`, `upperarm_l`, `lowerarm_l`, `hand_l` (and `_r`) | 8 |
| Arm twist ×2 | `upperarm_twist_01_l`, `lowerarm_twist_01_l` (and `_r`) | 4 |
| Hands ×2 | `thumb_01_l`, `thumb_02_l`, `fingers_01_l`, `fingers_02_l` (and `_r`); the four fingers share one mitten chain | 8 |
| Legs ×2 | `thigh_l`, `calf_l`, `foot_l`, `ball_l` (and `_r`) | 8 |
| Leg twist ×2 | `thigh_twist_01_l` (and `_r`) | 2 |
| Prop | `daypack` (child of `spine_03`), for a small secondary sway | 1 |

From the UAL skeleton:

- `fingers_0n` takes `middle_0n`. The other finger chains are dropped.
- `Head` becomes `head`.
- The `*_leaf_*` joints are dropped.

**Skinning:**

- `JOINTS_0` and `WEIGHTS_0` only, so at most 4 influences per vertex.
- The weights for each vertex sum to 1 ± 1e-3, and none is negative.
- Every joint that carries weight is listed in the skin.

**Foot reference points.** These are the contact references for foot IK and the slide metrics:

- Heel: the `foot_*` origin, projected to the floor.
- Ball: the `ball_*` origin.

`extras.gteki_character.feet` records each one's offset from its joint, in the joint's space.

## 4. Mesh and materials

| | High | Mobile |
| --- | --- | --- |
| Triangles (all primitives) | ≤ 12 000 (target 10 000) | ≤ 5 000 (target 4 000) |
| Primitives | ≤ 3 | ≤ 3 |
| Textures | base colour + ORM: 1024² (body) and 512² (head) | base colour only: 512² (body) and 256² (head); ORM comes from material factors. **GPU ≤ 2 MiB** (ruling 2), estimated as w × h × 4 × 4/3 with mips: 1.67 MiB |
| Joints, weights | same skeleton on both tiers | same skeleton on both tiers |

**Materials:**

- Opaque metal-rough only: `alphaMode` `OPAQUE`. There are no hair cards and no blend or mask modes.
- Hair is a solid mesh.
- A navy accent comes from the house palette (style sheets, #339 ruling 6).
- No `KHR_materials_transmission`, no `KHR_materials_volume`, and no texture compression in the canonical file. A compressed web variant is a derived build, as it is for the kit.

**Size budget (ruling 2):** the mobile GLB is ≤ 1.5 MiB **including clips**, with a hard cap of 2 MiB. The high GLB is reported, not capped.

## 5. Face

- One consistent simplified detail level.
- Readable eyes with an **upper lid that overlaps the eye**.
- Separate brows. No mouth animation.
- `VIS_head` carries **exactly two morph targets**, `blinkLeft` and `blinkRight`, in that order. Their names are in `mesh.extras.targetNames`.
- Morph targets carry `POSITION`, and optionally `NORMAL`.
- `VIS_body` has no morphs.
- No visemes and no ARKit set.
- Blink timing belongs to the runtime (X2). Clips carry no morph-weight channels.

## 6. Clips

All clips are **in place**: the walker owns position and yaw (#339 runtime plan). The rules:

- **Joints:**
  - `root` carries no animation channel at all.
  - `pelvis` may translate vertically and sideways; its net forward translation over a cycle is 0 ± 1 cm.
  - Every other joint is rotation only.
- **No scale channels.**
- **Interpolation:** `LINEAR` (rotations slerp), sampled at **30 fps**.
- **Cycles:** cycle clips loop with no pop. The first and last frames are equal within 0.5° per joint.
- **Heel strikes:** the left heel strikes at `t = 0` and the right at `t = 0.5 · duration`.

| Clip name | Kind | Calibration speed (m/s) | Notes |
| --- | --- | --- | --- |
| `idle` | cycle | 0 | breathing and weight shift; feet planted throughout |
| `walk` | cycle | 1.45 | ×0.85–1.15 covers 1.23–1.67 m/s, including the 1.6 walk tier |
| `jog` | cycle | 2.30 | covers 1.96–2.65 m/s |
| `run` | cycle | 3.20 | covers 2.72–3.68 m/s, including the 3.4 run tier |
| `start_l`, `start_r` | one-shot | 1.45, with a `speed_profile` from 0 | first step with the left / right foot; ends in phase with `walk` |
| `stop_l`, `stop_r` | one-shot | 1.45, with a `speed_profile` down to 0 | last step with the left / right foot; ends in the `idle` pose |
| `turn90_l`, `turn90_r`, `turn180_l`, `turn180_r` | one-shot | 0 | turn in place; `yaw_deg` is recorded, positive for `_l` (counter-clockwise seen from +Y) and negative for `_r`; the runtime applies yaw, the clip carries none on `root` |
| `stairs_up` | cycle | 0.9 along the stair slope | riser 0.16 m and tread 0.30 m, the kit defaults ([vertical.py](../../tools/blender/gteki_assets/families/vertical.py)); one cycle = 2 steps |
| `stairs_down` | cycle | 0.9 along the stair slope | **authored separately, not ascent reversed** |
| `escalator_stand` | cycle | 0 relative to the step | standing, hand on the rail; the runtime adds the support's motion (`CONNECTOR_MPS.escalator` 0.75) |

**Not clips:**

- The **6.8 m/s fast tier** plays `run` as an explicit 2× time-lapse (ruling 4).
- Speeds between the bands come from the 1-D blend driven by one shared phase (X2).

## 7. Clip metadata

Root node `extras.gteki_character` holds:

```json
{
  "contract": "gteki-character/0.1",
  "id": "gteki_char_commuter_a",
  "tier": "high",
  "height_m": 1.66,
  "forward": "-Z",
  "feet": { "l": { "heel": [0, -0.07, 0.0], "ball": [0, 0.0, 0.0] }, "r": { "...": "..." } },
  "clips": {
    "walk": {
      "kind": "cycle",
      "duration_s": 1.10,
      "distance_per_cycle_m": 1.595,
      "calib_speed_mps": 1.45,
      "contacts": { "l": [[0.00, 0.62]], "r": [[0.50, 1.12]] },
      "provenance": {
        "author": "GTEki contributors",
        "licence": "CC-BY-4.0",
        "source": "original | derived",
        "derived_from": { "archive_sha256": "cc73fc4e…", "clip": "Walk_Loop" }
      }
    }
  }
}
```

- `contacts` lists the stance windows per foot as **normalised clip time**. A window may wrap past 1.0.
- A foot is in stance when its reference point is below 2 cm and its vertical speed is below 5 cm/s. This is the F0 definition, so the offline numbers and Lane F's numbers agree.
- `distance_per_cycle_m` is equal to `calib_speed_mps × duration_s`, within 1 %.
- `derived_from` is present only when `source` is `derived`. Its licence then points at `LicenseRef-Quaternius-UAL-CC0-archive` (audit §2).
- Turns add `yaw_deg`. Stairs add `riser_m`, `tread_m` and `steps_per_cycle`.
- Start and stop add `speed_profile`: `[[u, mps], …]` in normalised clip time, piecewise linear. A start begins at 0 and ends at `calib_speed_mps`; a stop does the reverse. The drift check integrates this profile for the ideal glide.
- The pelvis's 1 cm net forward limit (§6) applies to every clip, one-shots included, because every clip is in place.

## 8. New exporter and validator

The new path lives in `tools/blender/character/`. It does not import `gteki_assets.asset` and does not change it.

**`export_character.py`** runs inside Blender, from the versioned `.blend`:

1. Bake Rigify to the §3 export skeleton.
2. Bake each NLA action to its in-place clip at 30 fps.
3. Write each tier with `export_skins=True`, `export_animations=True`, `export_morph=True`, `export_yup=True`, `export_apply=True`, no Draco or meshopt, and the extras from §7.

For the mobile tier it uses the decimated mesh and the smaller atlases, with the same skeleton and clips. The output is reproducible: two builds of the same commit must give byte-identical GLBs, as the kit's must (tested in E1).

**`validate_character.py`** is Python stdlib only. It needs neither Blender nor three, so CI and stations can run it. It parses the GLB and **fails** on:

1. The node tree: not one root, no `ARM_<id>`, or a `VIS_*` name outside §2.
2. The skin: not exactly one; joint count outside 32–64; a §3 joint missing; or a joint name outside §3. A count above 48 is a warning.
3. Skin attributes: `JOINTS_1` or `WEIGHTS_1` present; a weight sum outside 1 ± 1e-3; a negative weight; or a vertex weighted to a joint not in the skin.
4. Morphs: `VIS_head` targets not exactly `[blinkLeft, blinkRight]`; any morph on another mesh; or a morph attribute other than `POSITION` or `NORMAL`.
5. Materials: a non-opaque `alphaMode` or a transmission or volume extension. Also any extension used beyond `KHR_materials_emissive_strength` and `KHR_texture_transform`.
6. Budgets: triangles, primitives or texture GPU bytes over the §4 limits for the tier; or the mobile file over 2 MiB. Over 1.5 MiB is a warning.
7. Clips:
   - a required §6 clip missing, or an unknown clip present;
   - a channel on `root`, a scale channel, or a morph-weight channel;
   - a translation channel on anything but `pelvis`;
   - pelvis net forward drift above 1 cm;
   - a sample rate other than 30 fps;
   - `STEP` or `CUBICSPLINE` interpolation;
   - a loop pop above 0.5°.
8. Metadata: the §7 extras missing or inconsistent (wrong contract string or forward, or a distance/speed/duration mismatch above 1 %); contact windows missing; for a cycle, the left contact not starting at 0 or the right not starting at 0.5 (± 1 frame); or provenance missing.
9. **Offline foot drift.** The validator runs forward kinematics on the skeleton (stdlib quaternions) at each 30 fps sample. For each stance window, it measures the foot reference's motion against the ideal backward glide at `calib_speed_mps`:

   | Clip | Limit |
   | --- | --- |
   | `walk`, `jog`, `run` | ≤ 2 cm per cycle |
   | stairs and turns | ≤ 3 cm |
   | start and stop | ≤ 5 cm |
   | `idle` and `escalator_stand` | ≤ 1 cm |

   These are ruling 3's gates applied before any runtime correction. They may be retuned after F0.

It writes a JSON report with every measured value, kept next to the build log. The P0 acceptance sample (a minimal skinned body with a blinking head and a 2-frame `idle`) must pass items 1–8 when run with `--clips idle --drift-advisory`. `--clips` names the §6 clips a partial build must carry (E2 uses `idle,walk,jog,run`), and the full set is the default. `--drift-advisory` reports item 9 as warnings. The sample is built only after #156 ends; item 9 gates from E2 on.

Tests: `python3 -I tools/blender/character/test_validate_character.py` from the repo root (stdlib `unittest`, no Blender).

## 9. Licensing and REUSE

- **Original character work** is `CC-BY-4.0`, credit "GTEki contributors": mesh, clothes, hair, daypack, textures, weights, morphs, authored clips and the `.blend`.
- **MPFB2 base topology (CC0)** is named in NOTICE for provenance.
- **Clips derived from Quaternius UAL** map to `LicenseRef-Quaternius-UAL-CC0-archive`, and a NOTICE entry is added when the first such clip lands (audit §2).
- **Raw third-party files** are never committed.

## 10. Style rule exception

[style.md](style.md)'s "geometry is always procedural" checklist item gets a documented protagonist exception (#339 ruling 7). The exception lands with E1, when the first character mesh ships, not in this contract PR.
