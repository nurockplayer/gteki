# 2026-11-24 JST. Measure the committed PNGs; all boxes use [left, top, right, bottom).
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops
import json

out = Path(__file__).resolve().parent
receipt = json.loads((out / 'receipt.json').read_text())
linear = [v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4 for v in range(256)]

def stats(file, box=None, polygon=None):
    image = Image.open(out / file).convert('RGB')
    mask = None
    if polygon:
        mask = Image.new('L', image.size)
        ImageDraw.Draw(mask).polygon([(p['x'], p['y']) for p in polygon], fill=255)
    if box:
        image = image.crop(box)
    histogram = image.histogram(mask)
    pixels = sum(histogram[:256])
    mean = sum(sum(histogram[c * 256 + i] * linear[i] for i in range(256)) * w for c, w in enumerate([.2126, .7152, .0722])) / pixels
    clipped = sum(histogram[c * 256 + 255] for c in range(3))
    return {'file': file, 'box': box, 'polygon': polygon, 'pixels': pixels, 'meanLinearY': mean, 'clippedChannelSamples': clipped}

measurements = {'method': 'Mean linear-sRGB Y = .2126 R + .7152 G + .0722 B; PNG sRGB decoded per IEC transfer function. Clipping means any channel equals 255. Sign masks use captured projected quadrilaterals, including board and text.', 'sourceSha': receipt['sourceSha'], 'profiles': []}
rows = []
slab_rows = []
for profile in receipt['profiles']:
    device = profile['device']['name']
    boxes = {'desktop': ([420,452,880,745], [1020,140,1420,300], [490,455,530,465]), 'phone': ([40,400,310,550], [90,160,330,290], [48,426,60,434])}[device]
    entry = stats(device + '-entrance-before.png', box=boxes[0])
    concourse = stats(device + '-entrance-before.png', box=boxes[1])
    context = next(f for f in profile['frames'] if f['name'] == 'entrance-context')
    store = stats(context['file'], polygon=context['boards'])
    wayfinding = stats(context['file'], polygon=context['wayfindingPolygon'])
    rail = stats(device + '-escalator-boarding.png', box=boxes[2])
    door_ratio = entry['meanLinearY'] / concourse['meanLinearY']
    sign_ratio = store['meanLinearY'] / wayfinding['meanLinearY']
    passed = door_ratio >= 1.1 and entry['clippedChannelSamples'] == 0 and concourse['clippedChannelSamples'] == 0 and sign_ratio <= .85 and rail['meanLinearY'] >= .02
    measurements['profiles'].append({'device': device, 'entry': entry, 'concourse': concourse, 'doorRatio': door_ratio, 'storeSign': store, 'wayfinding': wayfinding, 'signRatio': sign_ratio, 'handrail': rail, 'pass': passed})
    rows.append(f"| {device} | {entry['meanLinearY']:.6f} / {concourse['meanLinearY']:.6f} = **{door_ratio:.3f}×** | 0 / 0 | {store['meanLinearY']:.6f} / {wayfinding['meanLinearY']:.6f} = **{sign_ratio:.3f}×** | **{rail['meanLinearY']:.6f}** | {'PASS' if passed else 'FAIL'} |")
    for frame in profile['frames']:
        probe = frame['slabProbe']
        slab_rows.append(f"| {device} {frame['name']} | {'yes' if probe['slabHidesUpperRibbon'] else 'no'} | {probe.get('leaks',0)} | {sum(s['inFrame'] and s['occluded'] for s in probe.get('samples',[]))} | {'upper floor not above camera' if not probe.get('fromBelow',False) else 'upper aisle guide depth-tested against slab'} |")
        if not probe['slabHidesUpperRibbon']:
            raise RuntimeError(f"Slab failed: {device} {frame['name']}")
    if not passed:
        raise RuntimeError(f"Luminance failed: {device}")
receipt['acceptanceMeasurements'] = measurements
(out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
table = '# Acceptance measurements\n\n2026-11-24 JST. Runtime `' + receipt['sourceSha'] + '`. Full sample coordinates and projected sign polygons are in `receipt.json.acceptanceMeasurements`.\n\n| Profile | Door / concourse Y (≥1.1×) | Clipped channel samples, door / concourse | Store / wayfinding Y (≤0.85×) | Rendered handrail Y (≥0.02) | Result |\n| --- | --- | --- | --- | --- | --- |\n' + '\n'.join(rows)
table += '\n\nThe upper-floor probe uses the authored 1F aisle → bypass edge with the approximate amber guide material named in AD comment 7106005972. Each pose records all 33 sampled guide points, projected pixels, slab ray hits and material depth testing in its `slabProbe`; matching `*-upper-guide.png` frames show the rendered result. The original route-free 26 poses are retained. A route visible through the open well is permitted; leakage through the slab is not.\n\n| Pose | Slab hides upper ribbon | Leaks | In-frame occluded samples | Context |\n| --- | --- | --- | --- | --- |\n' + '\n'.join(slab_rows) + '\n'
(out / 'measurements.md').write_text(table)
print(table)
