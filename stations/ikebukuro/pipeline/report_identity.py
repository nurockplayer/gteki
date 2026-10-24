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
             'Local CPU implementation receipt, 2026-10-24. No web, browser, GPU or external LLM review in this follow-up.', '',
             '## Recognition proxy', '',
             'The previous receipt used unused station-scene heading suggestions and a first-person eye; its all-spawn framing/readability conclusion is withdrawn. The proxy now replays the real third-person camera against the shipped scene collision world, with no board movement, rotation, name resizing or camera recentering.', '',
             '### Actual spawn rule', '',
             '- `station.json.spawnNodeIds` supplies six origin chips in order: c_mid, c_e2, n_h, sp_e, w_c, sw_h. Selecting a chip changes the route origin; it does not place the camera. `walkFromNode` (including the test hook and station-transfer arrival) calls `walkFrom` without a heading, so every node starts at compass 0°, yaw 0 radians. The route Walk button also omits a heading. Guide mode instead uses the first route tangent and has no single heading per spawn.',
             '- `scene.ts` supplies `spawnPoints` with suggested headings 100°, 100°, 95°, 92°, 340°, 110° respectively. Explorer does not read `spawnPoints`. `build_identity.py` uses these authored directions for placement checks only; they are not opening-view evidence. No generation or placement change was made in this follow-up.',
             '- Spec 13 first spawns facing north, then explicitly turns to its +0: the rounded compass bearing along the first verified incident edge in graph order (otherwise the first edge), orienting geometry from the node and choosing the first vertex at least 2 m away, otherwise the last. Its +90/+180/+270 are further turns. A separate +0 table below matches that setup; it is not the default spawn heading.',
             '- Sources: [Explorer spawn and camera](../../../apps/web/src/explorer/explorer.ts), [follow camera constants](../../../apps/web/src/explorer/followCamera.ts), [UI origin and Walk actions](../../../apps/web/src/ui/app.ts), [spec 13](../../../tests/e2e/specs/13-ikebukuro-vantage-shots.spec.ts), [station suggestions](../scene/scene.ts), [CPU replay](../pipeline/identity_camera.ts).', '',
             'Fresh defaults: third person, pitch -0.12 rad (-6.875°); head = ray-snapped floor +1.62 m. The pivot moves 0.42 m right (side collision reduces this to max(0, hit distance -0.25)). With view direction d, back = normalize(-d + [0,0.14,0]), desired camera = pivot + back × 3.45 m, and look-at = pivot + d × 5 m - [0,0.45,0]. Boom collision uses the actual floor/collider ray targets, 0.30 m clearance, minimum 0.55 m; a squeeze below 1.60 m tries up to five raises in 10° steps. The vertical FOV is 50°, or 60° when squeezed below 1.60 m/on a slope (release hysteresis 1.90 m). The B1 scene has ordinary ceiling colliders; its street context camera-only blockers are inactive underground. Signs and column dressing do not stop the boom. Stationary fresh-spawn/settled poses are measured here; transition smoothing is 10/s and FOV easing has a 0.25 s time constant. Entering from overview can transiently inherit its camera/FOV, and later spawns retain user pitch, zoom and first-person selection.', '',
             'Aspect = Explorer host clientWidth/clientHeight: phone 390/844 = 0.462085, desktop 1280/720 = 1.777778. Near/far = 0.05/2000 m. There is no phone-specific lens change. Phone PASS requires all eight name-box corners inside all six frustum planes, the name face toward the camera, no overlap with the approximate avatar rectangle (x = 130–260, y = 562.67–844 CSS px: central lower third), JP ≥18 and EN ≥12 CSS px. Cap height remains a conservative 0.7 em estimate, projected at each line\'s left anchor. Each row evaluates that spawn\'s assigned identity board; another distant visible board is not substituted. Offscreen/back-facing sizes are mathematical projections, not visible glyphs; caps are unavailable when the name box crosses the camera depth bounds. Distance is camera to board centre, in 3D. PASS covers these framing/size criteria only, not structural visibility, camera-cut fading, font ink or perceived readability.', '',
             '| View | Spawn | Heading ° | Yaw rad | Ground TP m | Camera ENU [x,y,z] | Height above ground m | Shoulder m | Boom m | Raise ° | Look pitch ° | FOV ° |',
             '| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
    for r in evidence['cameraPoses']:
        x, z, ny = r['position']
        lines.append(f"| {r['view']} | {r['spawn']} | {r['heading']} | {r['yaw']:.4f} | {r['ground']:.3f} | [{x:.3f}, {-ny:.3f}, {z:.3f}] | {r['height']:.3f} | {r['shoulder']:.3f} | {r['distance']:.3f} | {r['raise']*180/3.141592653589793:.1f} | {r['lookPitch']*180/3.141592653589793:.3f} | {r['fov']} |")
    px = lambda value: '—' if value is None else f'{value:.1f}'
    yn = lambda value: 'yes' if value else 'no'
    for view, title in [('opening', 'Actual opening view (north)'), ('spec13+0', 'Spec 13 first-edge +0 view')]:
        table = ['', f'### {title}', '',
                 '| Spawn | Heading ° | First edge | Board | Distance m | JP px | EN px | Fully in frame | Avatar overlap | Result / reason |',
                 '| --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- | --- |']
        for r in evidence['recognitionProxy']:
            if r['view'] != view:
                continue
            p = r['phone']
            table.append(f"| {r['spawn']} | {r['heading']} | {r['edge']} | {r['board']} | {r['distanceM']:.2f} | {px(p['jp'])} | {px(p['en'])} | {yn(p['fullyInFrame'])} | {yn(p['avatarOverlap'])} | {'PASS' if p['pass'] else 'FAIL: '+', '.join(p['reasons'])} |")
        lines += table
        print('\n'.join(table))
    lines += ['', 'All failed actual opening views above remain for Explorer #342 Q5 to resolve by spawn-direction decisions. The boards retain their committed geometry and station-name text sizes. The lead reports that only w_c at spec-13 +270 has a large readable board, with c_mid cut at +0 and transfer rows unreadable on phone; those GPU observations are supplied evidence, not rerun here. Open comparison: the assigned identity-sw_h at spec-13 +0 (115°) narrowly passes the CPU size/framing criteria at 19.5/13.9 px, whereas the supplied GPU observation calls it small/far. Reconcile the exact board ID, camera receipt and perceived ink in the lead\'s authorised visual run; this proxy does not override that observation.', '',
              '### Desktop projection (1280×720)', '',
              '| View | Spawn | JP px | EN px | Fully in frame | Avatar overlap |',
              '| --- | --- | ---: | ---: | --- | --- |']
    for r in evidence['recognitionProxy']:
        p = r['desktop']
        lines.append(f"| {r['view']} | {r['spawn']} | {px(p['jp'])} | {px(p['en'])} | {yn(p['fullyInFrame'])} | {yn(p['avatarOverlap'])} |")
    lines += ['', '## Separate equipment placement-eye proxy', '',
              'These equipment counts retain the original authored heading / first-person-eye calculation. They are not the real opening camera and do not contribute to recognition PASS.', '',
              '| Spawn | Other equipment centres visible | Equipment result |',
              '| --- | ---: | --- |']
    for r in evidence['equipment']:
        lines.append(f"| {r['spawn']} | {r['count']} | {r['status']} |")
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
    lines += ['', 'Six station-name boards are anchored to the spawn nodes; this does not imply they are visible on opening. Additional main-passage junctions are c_e1, c_n and sp_m, each with verified degree ≥3. Positions remain in identity.json so approximate meeting-point text, identity metadata and transfer information stay separate from generated directional routing signs. All panel positions are GTEki-authored, not surveyed sign locations. Ceiling-mounted housings retain at least 2 m clearance; the near North Passage wall uses a wall panel. Existing sign text and route data are unchanged.', '',
              '## Atlas and asset delta', '',
              'CPU canvas width estimates use the existing CJK/Latin estimator. Memory is RGBA8 plus a full mip chain (4/3), in MiB; browser glyph widths may differ.', '',
              '| Tier | Round-0 shared pages = final shared pages | Separate identity texture | Round-0 MiB | Final shared MiB | Identity MiB | Final total MiB | Delta MiB |',
              '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |']
    pages = lambda ps: ' + '.join(f"{p['w']}×{p['h']}" for p in ps)
    for r in evidence['atlas']:
        lines.append(f"| {r['tier']} | {pages(r['before'])} | {pages(r['identity'])} | {r['beforeMiB']:.2f} | {r['sharedMiB']:.2f} | {r['identityMiB']:.3f} | {r['afterMiB']:.3f} | {r['identityMiB']:.3f} |")
    lines += ['', 'Round 3 replaced the Round 2 low-tier 53.33 → 64.00 MiB (+10.67 MiB) allocation. Direction/place faces retain exactly the round-0 page sizes. All ten identity boards share one tightly cropped, non-power-of-two canvas with mipmaps (WebGL2), one material and one merged face batch. The canvas contains three shelf-packed artworks: compact station name at 160 px/m low, wide station name at 280 px/m low, and meeting point at 140 px/m low; desktop doubles each density. Identical content reuses the same UV rectangle.', '',
              'Low tier now omits both transfer rows and crops the unused lower band of each station-name artwork to 72% height, expanded if actual name ink plus one texel needs more. The crop keeps the original texel density and offsets the face upward by half the removed physical height, so every name keeps its size and position. High tier retains both transfer rows and its full artwork; the meeting marker is unchanged. CPU dimensions use fallback em boxes; browser ink can expand the low crop and its texture allocation.', '',
              'Each artwork is painted in physical coordinates at 3.4×0.54 m, then uniformly fitted inside each board width and height; solid margins fill the remaining panel area with quads in the same batch. Compact main names retain scale 1.12 and the upward shift; wide names retain 0.8. Low crop changes only the artwork quad extent/offset, not any board housing or metadata name-region coordinates. There is no horizontal fillText compression.', '',
              f"Panels: {len(signs)} existing → {len(signs)+len(boards)} total. Identity proxies: 10, with no mesh, draw call, walkable or collider. Rendering now has one housing batch, one face batch per shared page, and one identity face batch: four draw calls on either tier, one more than round 0 / Round 2. Solid margins add 20 triangles versus Round 2. The new texture, material and geometry are disposed with the rest of the signs; regression tests observe disposal. The shared phone pages are exactly 4096×2048 + 4096×512. Shipped asset count remains 19; declared scene data files remain 8.", '',
              '## High-tier transfer-row cap height', '',
              'Transfer facts remain unchanged in identity.json. Only high tier paints JR / Metro rows, using 0.13 em of the original artwork height and uniform width fitting. Values below are conservative 0.7 em cap estimates, not measured ink. No phone transfer readability claim is made; low tier paints neither row.', '',
              '| Board | JR cap cm | Metro cap cm |', '| --- | ---: | ---: |']
    transfer_caps = {r['board']: r['cm'] for r in evidence['transferCaps']}
    for b in boards:
        if b['kind'] != 'station-name':
            continue
        # All station artworks use the same transfer band, unaffected by the wide name scale.
        caps = transfer_caps[b['id']]
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
              '- High-tier transfer references are plain type, with no official rings, badges, logos or line colours; low tier omits them. The name-region box excludes transfers at both tiers. FONT and POI chips are unchanged.',
              '- Each board uses textVerification for its text facts; placement is always GTEki-authored, not a surveyed sign location. The meeting location remains APPROXIMATE.',
              '- Validation: locked single-worker station Vitest passes (24 files; 357 passed, 3 skipped); locked station tsc passes. The report was regenerated through the shared lock. Third-person ground, shoulder, boom collision/raise and FOV are replayed on CPU; no rendered five-second recognition, chip-overlap or 3-second frame acceptance is made. signs.ts has a structurally matching local IdentityBoardTag pending Explorer PR #347.',
              '- After Q0 integration, the lead must run the authorised font subset update if CI reports missing glyphs, replace the local type once #347 lands, and perform visual/phone acceptance. The equipment failures above remain open acceptance limitations; no added props mask them.', '']
    output = ROOT / 'docs/identity-342.md'
    output.write_text('\n'.join(lines))
    print(output)


if __name__ == '__main__':
    main()
