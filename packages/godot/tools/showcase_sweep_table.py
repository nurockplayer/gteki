"""Print the luminance ratios of showcase_compare reports as one sweep row per tag.

Usage: python3 -I showcase_sweep_table.py <camera> <tag> <report.json> [<tag> <report.json> ...]

Reads only each report's `luminance` block (ratios are godot / reference, `null` when the reference is black),
so it needs no GLB, display or GPU. Columns are `whole`, `bottom_third`, then every extra `--region` name seen in
any report, sorted for a stable table.
"""

import json
import sys

DEFAULTS = ("whole", "top_third", "middle_third", "bottom_third")
COLUMNS = ("whole", "bottom_third")


def luminance(path, camera):
    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)
    entry = report.get("luminance", {}).get(camera)
    if entry is None:
        raise SystemExit(f"showcase_sweep_table: {path} has no luminance for camera {camera}")
    return entry


def cell(entry, name):
    region = entry.get(name)
    if region is None:
        return "-"
    ratio = region.get("ratio")
    return "null" if ratio is None else f"{ratio:.3f}"


def main(argv):
    if len(argv) < 3 or (len(argv) - 1) % 2 != 0:
        raise SystemExit("usage: showcase_sweep_table.py <camera> <tag> <report.json> [<tag> <report.json> ...]")
    camera = argv[0]
    rows = []
    extras = set()
    for index in range(1, len(argv), 2):
        entry = luminance(argv[index + 1], camera)
        rows.append((argv[index], entry))
        extras.update(name for name in entry if name not in DEFAULTS)
    header = ("tag",) + COLUMNS + tuple(sorted(extras))
    table = [header] + [tuple([tag] + [cell(entry, name) for name in header[1:]]) for tag, entry in rows]
    widths = [max(len(row[column]) for row in table) for column in range(len(header))]
    for row in table:
        print("  ".join(value.ljust(widths[column]) for column, value in enumerate(row)).rstrip())


if __name__ == "__main__":
    main(sys.argv[1:])
