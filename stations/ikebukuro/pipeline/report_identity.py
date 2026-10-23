"""Write the local #342 handoff from the latest allowed CPU-test receipt.

Run vitest stations/ikebukuro first; it writes /tmp/gteki-identity-evidence.json.
This report contains no claim of browser, GPU, human or independent review.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_identity import ROOT, read


def main():
    evidence = json.loads(Path('/tmp/gteki-identity-evidence.json').read_text())
    boards = read('scene/identity.json')['boards']
    signs = read('scene/signage.json')['signs']
    lines = ['# Station identity boards (#342 Q1b/Q3)', '',
             'Local implementation receipt, 2026-10-24. No commit or push. No web, browser, GPU or external LLM review.', '',
             '## Recognition proxy', '',
             'The requested CPU proxy uses the spawn eye at 1.62 m, the actual scene spawn headings, the Explorer first-person 60° vertical lens, default pitch -0.12, phone 390×844 and desktop 1280×720 CSS px. Cap height is conservatively estimated at 0.7 em, not measured glyph ink. Phone name bounds are inside the frustum; full panel sightlines include structural geometry, column sleeves and existing sign panels, with light fittings excluded as requested. Default third-person uses a 50° lens and collision-adjusted 3.45 m boom; that camera and perceived readability require rendered acceptance.', '',
             '| Spawn | Phone JP / EN px | Desktop JP / EN px | Phone JP texels / CSS px | Other equipment centres visible | Equipment result |',
             '| --- | ---: | ---: | ---: | ---: | --- |']
    equipment = {r['spawn']: r for r in evidence['equipment']}
    for r in evidence['recognitionProxy']:
        lines.append(f"| {r['spawn']} | {r['phone']} | {r['desktop']} | {r['jpTexelsPerCssPx']:.2f} | {equipment[r['spawn']]['count']} | {equipment[r['spawn']]['status']} |")
    lines += ['', 'Equipment counts exclude the identity boards themselves. This conservative report counts only existing scene LED housings and wayfinding panels using frustum and structural/panel ray occlusion; it does not enumerate every gate, stair mouth, kit piece or column. Round 2 removes all three authored utility fittings and their atlas swatch (42 fewer triangles, unchanged batches). No props are added to meet the equipment proxy. Counts below two are explicitly proxy not met (equipment); only c_mid, w_c and sw_h retain a >=2 regression assertion. Centre visibility remains a CPU proxy, not a perceived-size or lighting judgment.', '',
              '| Spawn | Existing visible equipment centres |', '| --- | --- |']
    for r in evidence['equipment']:
        lines.append(f"| {r['spawn']} | {', '.join(r['visibleEquipmentCentres']) or 'None'} |")
    lines += ['',
              '## Boards', '',
              '| ID | Anchor | Kind | Mount | Verification of text facts |',
              '| --- | --- | --- | --- | --- |']
    for b in boards:
        lines.append(f"| {b['id']} | {next(iter(b['anchor'].values()))} | {b['kind']} | {b.get('mount', 'ceiling')} | {b['textVerification']} |")
    lines += ['', 'Six station-name boards cover all spawn nodes. Additional main-passage junctions are c_e1, c_n and sp_m, each with verified degree ≥3. Positions remain in identity.json so approximate meeting-point text, identity metadata and transfer information stay separate from generated directional routing signs. All panel positions are GTEki-authored, not surveyed sign locations. Ceiling-mounted housings retain at least 2 m clearance; the near North Passage wall uses a wall panel. Existing sign text and route data are unchanged.', '',
              '## Atlas and asset delta', '',
              'CPU canvas width estimates use the existing CJK/Latin estimator. Memory is RGBA8 plus a full mip chain (4/3), in MiB; browser glyph widths may differ.', '',
              '| Tier | Round-0 shared pages = final shared pages | Separate identity texture | Round-0 MiB | Final shared MiB | Identity MiB | Final total MiB | Delta MiB |',
              '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |']
    pages = lambda ps: ' + '.join(f"{p['w']}×{p['h']}" for p in ps)
    for r in evidence['atlas']:
        lines.append(f"| {r['tier']} | {pages(r['before'])} | {pages(r['identity'])} | {r['beforeMiB']:.2f} | {r['sharedMiB']:.2f} | {r['identityMiB']:.3f} | {r['afterMiB']:.3f} | {r['identityMiB']:.3f} |")
    lines += ['', 'Round 3 replaces the Round 2 low-tier 53.33 → 64.00 MiB (+10.67 MiB) allocation. Direction/place faces return to exactly the round-0 page sizes. All ten identity boards share one tightly cropped, non-power-of-two canvas with mipmaps (WebGL2), one material and one merged face batch. The canvas contains three shelf-packed artworks: compact station name at 160 px/m low, wide station name at 280 px/m low, and meeting point at 140 px/m low; desktop doubles each density. Identical content reuses the same UV rectangle. The nearby wide panel uses a 0.8 name scale to retain phone frustum clearance.', '',
              'Each artwork is painted in physical coordinates at its own 3.4×0.54 aspect, then uniformly fitted inside each board width and height; solid margins fill the remaining panel area with quads in the same batch. There is no 0.42 m shelf-height stretch or horizontal fillText compression. Compact main names use a 1.12 scale and a small upward shift, preserving junction recognition and the transfer-row clearance; wide main names use 0.8. This reuse avoids allocating ten nearly identical canvases. Main-name cap height remains geometric; the texel ratios above use the actual tier canvas height and the correct artwork for each spawn.', '',
              f"Panels: {len(signs)} existing → {len(signs)+len(boards)} total. Identity proxies: 10, with no mesh, draw call, walkable or collider. Rendering now has one housing batch, one face batch per shared page, and one identity face batch: four draw calls on either tier, one more than round 0 / Round 2. Solid margins add 20 triangles versus Round 2. The new texture, material and geometry are disposed with the rest of the signs; regression tests observe disposal. The shared phone pages are exactly 4096×2048 + 4096×512. Shipped asset count remains 19; declared scene data files remain 8.", '',
              '## Transfer-row cap height', '',
              'Both exact transfer strings are unchanged, split into JR / Metro rows. The rows use 0.13 em of artwork height, the available vertical band below the name with interline and edge clearance, and shrink uniformly only if measured width requires it. Values below are conservative 0.7 em cap estimates, not measured ink. Two complete rows impose a width limit: the narrow panels cannot provide 3 cm transfer caps. These rows are secondary transfer information; no distance-readability claim is made.', '',
              '| Board | JR cap cm | Metro cap cm |', '| --- | ---: | ---: |']
    spawn_rows = {r['spawn']: r for r in evidence['recognitionProxy']}
    for b in boards:
        if b['kind'] != 'station-name':
            continue
        # All station artworks use the same transfer band, unaffected by the wide name scale.
        caps = spawn_rows.get(b['anchor'].get('nodeId'), {}).get('transferCapCm')
        if caps is None:
            caps = [0.54*0.13*0.7*min(b['widthM']/3.4, b['heightM']/0.54)*100]*2
        lines.append(f"| {b['id']} | {caps[0]:.2f} | {caps[1]:.2f} |")
    lines += ['', '## Name-region boxes', '',
              'Local metres, front normal +Z; z bounds are 0.039–0.043 m around the face at 0.042 m. Runtime boxes come from actual canvas text ink metrics (em-box fallback on the CPU stub), transformed by exactly the same uniform scale as the artwork. The union encloses Japanese, kana and English and excludes transfer rows. Tests compare geometry aspect and painted bounds at both tiers. The following CPU boxes use the deterministic CJK/Latin estimator; browser font ink may differ.', '',
              '| Board | Min [x,y,z] | Max [x,y,z] |', '| --- | --- | --- |']
    for r in evidence['nameRegions']:
        coord = lambda value: '[' + ', '.join(f'{v:.4f}' for v in value) + ']'
        lines.append(f"| {r['board']} | {coord(r['min'])} | {coord(r['max'])} |")
    lines += ['',
              '## Guided-route rhythm proxy', '',
              'The checker walks the committed I1/I2 guided polylines using 3D segment lengths. Cues are readable-facing sign anchors within 4 m laterally, verified junctions of degree ≥3, gates/exits and stair/escalator mouths; start/end bound the route. This measures cue-anchor gaps, not continuous visual recognition or non-interchangeable 3-second frames. Existing signs already meet 30 m, so no new passage-name board is needed.', '',
              '| Route | Before maximum gap m | After maximum gap m |',
              '| --- | ---: | ---: |']
    for route in evidence['rhythm']['before']:
        lines.append(f"| {route} | {evidence['rhythm']['before'][route]['maxGapM']:.2f} | {evidence['rhythm']['after'][route]['maxGapM']:.2f} |")
    for phase in ('before', 'after'):
        for route, r in evidence['rhythm'][phase].items():
            lines += ['', f'### {route}, {phase} ({r["lengthM"]:.2f} m polyline)', '',
                      '| Interval m | Gap m | From cue → To cue |', '| --- | ---: | --- |']
            for gap in r['gaps']:
                lines.append(f"| {gap['fromM']:.2f}–{gap['toM']:.2f} | {gap['gapM']:.2f} | {', '.join(gap['from'])} → {', '.join(gap['to'])} |")
    lines += ['', '## Source and acceptance boundaries', '',
              '- OSM attribution: © OpenStreetMap contributors, ODbL 1.0. Node 2558121915 v35; Metro relations 9240336 v13, 9240281 v12, 7967610 v17. Retrieved 2026-10-23T15:15Z. JR route relations retrieved 2026-10-24: 1972920 v130 (2026-10-08; other direction 1972960 v134), 21361895 v7 (2026-10-05), 4684034 v138 (2026-10-10). These supply plain-text 山手線 Yamanote JY13 / 埼京線 Saikyo JA12 / 湘南新宿ライン Shonan-Shinjuku JS21 facts only. The date-only JR retrieval is recorded in derivation, not an invented timestamp. Codes and line names remain transfer information, without platform or transfer-path assertions or route evidence.',
              '- The いけふくろう marker is name/location only and APPROXIMATE. Tabi-mag and LIVE JAPAN facts were supplied by the director, retrieved 2026-10-24; time is unspecified, so retrievedAt is null and the date is recorded in notes. The local Toshima guide PDF is unavailable; no page verification or guide citation for this marker is claimed.',
              '- All transfer references are plain type, with no official rings, badges, logos or line colours. Every station-name panel uses two secondary rows (JR, then Metro); the name-region box excludes both. FONT is unchanged.',
              '- Each board uses textVerification for its text facts; placement is always GTEki-authored, not a surveyed sign location. The meeting location remains APPROXIMATE.',
              '- Tests and station typecheck pass using the shared lock and single-worker commands. No rendered five-second recognition claim, third-person collision/raising check, chip-overlap check or 3-second frame acceptance is made. The shared docs/core/contract.md edit is reverted; signs.ts has a structurally matching local IdentityBoardTag pending Explorer PR #347.',
              '- After Q0 integration, the lead must run the authorised font subset update if CI reports missing glyphs, replace the local type once #347 lands, and perform visual/phone acceptance. The equipment failures above remain open acceptance limitations; no added props mask them.', '']
    output = ROOT / 'docs/identity-342.md'
    output.write_text('\n'.join(lines))
    print(output)


if __name__ == '__main__':
    main()
