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
             '| Spawn | Phone JP / EN px | Desktop JP / EN px | Other equipment centres visible | Equipment result |',
             '| --- | ---: | ---: | ---: | --- |']
    equipment = {r['spawn']: r for r in evidence['equipment']}
    for r in evidence['recognitionProxy']:
        lines.append(f"| {r['spawn']} | {r['phone']} | {r['desktop']} | {equipment[r['spawn']]['count']} | {equipment[r['spawn']]['status']} |")
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
              '| Tier | Before pages | After pages | Before MiB | After MiB | Delta MiB |',
              '| --- | --- | --- | ---: | ---: | ---: |']
    pages = lambda ps: ' + '.join(f"{p['w']}×{p['h']}" for p in ps)
    for r in evidence['atlas']:
        lines.append(f"| {r['tier']} | {pages(r['before'])} | {pages(r['after'])} | {r['beforeMiB']:.2f} | {r['afterMiB']:.2f} | {r['afterMiB']-r['beforeMiB']:.2f} |")
    lines += ['', 'Round 1 low-tier baseline was 53.33 → 64.00 MiB (+10.67 MiB). The Round 2 figures above include removal of the utility-light swatch and the expanded, two-line transfer text.', '',
              f"Panels: {len(signs)} existing → {len(signs)+len(boards)} total. Identity proxies: 10, with no mesh, draw call, walkable or collider. Atlas rendering remains one housing batch and one face batch per page. The phone cap is unchanged: 4096×2048 plus at most 4096×1024. Shipped asset count remains 19; declared scene data files increase 7 → 8.", '',
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
