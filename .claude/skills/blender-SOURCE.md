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
