# EL4CTEO Blender skills source

- Upstream: https://github.com/EL4CTEO/blender-skills
- Pin: `11310568838d854fceff28e261e71854c2dab76b`
- Fetched: 2026-11-28 JST
- Source archive: https://codeload.github.com/EL4CTEO/blender-skills/tar.gz/11310568838d854fceff28e261e71854c2dab76b

## Included Markdown files

- `blender-core/SKILL.md`
- `blender-scene-setup/SKILL.md`
- `blender-texture-baking/SKILL.md`
- `blender-pbr-materials/SKILL.md`
- `blender-export-pipelines/SKILL.md`
- `blender-export-pipelines/references/godot-web.md`
- `blender-rendering/SKILL.md`

## Local changes

Commit `eb0afaf3` edited six skill files to mark omitted upstream helper
scripts and companion skills as unavailable. This prevents agents from fetching,
running, or importing those helpers. The Godot/web reference is unchanged.

| Path relative to the skills directory | Local status | Upstream SHA-256 at the pin |
| --- | --- | --- |
| `blender-core/SKILL.md` | Edited | `85c6161bf7a8e648735bd04957caba76f5e9c7b8506b38afd8496cc795563789` |
| `blender-scene-setup/SKILL.md` | Edited | `fbfc9b4fb42fd3434d4112700eeda86049908cd65e5f9d939f043e5358d69a25` |
| `blender-texture-baking/SKILL.md` | Edited | `bf94f8054b6a9483214d2ceb3e160e44d2593b51154c553defa190272431ccb4` |
| `blender-pbr-materials/SKILL.md` | Edited | `6c02bc13dc33e71d816dc6b498bf38312ed7e17aa2bfcc57446a45efc7c1f318` |
| `blender-export-pipelines/SKILL.md` | Edited | `300f2f9d0632744ea73ce68eccd2fbdb485febef0d1743a773b34d2f13080c16` |
| `blender-rendering/SKILL.md` | Edited | `0c1a3b2c9537868dda84d981f26060eeeb159d26769c6344f608641ac6fc1b6f` |
| `blender-export-pipelines/references/godot-web.md` | Unchanged | `67d2f57f75c40466039346d770ff8e622844c1f2d171d98fdef2ed300d2c2dfd` |

## Notes

1. The helper scripts these skills mention (`run_in_blender.py`, `bake_maps.py`, `build_pbr_material.py`, `export_asset.py`, `render_batch.py`, `scene_audit.py`, `qa_check.py`, and others) were left out on purpose and must not be fetched.
2. In this repository Blender runs only through the project wrapper, headless (`blender -b`). A GUI Blender window is allowed only while the Owner is away (owner-presence), per `CLAUDE.md` Host Resources.
3. Local Blender is 5.2.3, so the 5.3+ KTX2 export option does not apply.

## Upstream license

MIT License

Copyright (c) 2026 EL4CTEO

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
