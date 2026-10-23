"""Deterministic rectangle packing for lightmap chart bounds."""


def _place(rects, scale, gap):
    free, placed = [(0.0, 0.0, 1.0, 1.0)], []
    for index, (width, height) in rects:
        best = None
        for fi, (x, y, w, h) in enumerate(free):
            for rotate, (a, b) in enumerate(((width, height), (height, width))):
                a, b = a * scale + gap, b * scale + gap
                if a <= w and b <= h:
                    dx, dy = w - a, h - b
                    score = (min(dx, dy), max(dx, dy), y, x, rotate, fi)
                    if best is None or score < best[0]:
                        best = score, (index, x, y, a, b, rotate)
        if best is None:
            return None
        _, (index, x, y, w, h, rotate) = best
        placed.append((index, x + gap / 2, y + gap / 2, rotate))
        split = []
        for fx, fy, fw, fh in free:
            if x >= fx + fw or x + w <= fx or y >= fy + fh or y + h <= fy:
                split.append((fx, fy, fw, fh))
                continue
            if x > fx:
                split.append((fx, fy, x - fx, fh))
            if x + w < fx + fw:
                split.append((x + w, fy, fx + fw - x - w, fh))
            if y > fy:
                split.append((fx, fy, fw, y - fy))
            if y + h < fy + fh:
                split.append((fx, y + h, fw, fy + fh - y - h))
        # Maximal free rectangles can overlap; remove duplicates and contained ones.
        free = []
        for i, a in enumerate(split):
            ax, ay, aw, ah = a
            if not any(j != i and bx <= ax and by <= ay and bx + bw >= ax + aw and by + bh >= ay + ah
                       and (a != b or j < i) for j, b in enumerate(split) for bx, by, bw, bh in [b]):
                free.append(a)
    return placed


def pack_rectangles(rects, gap):
    """Largest feasible uniform scale found by stable longest-side-first MaxRects.

    Returns (scale, placements), where a placement is (index, x, y, quarter_turn).
    Each rectangle gets half the gap on every boundary, including the atlas border.
    """
    if not rects:
        return 0.0, []
    ordered = sorted(enumerate(rects), key=lambda r: (-max(r[1]), -min(r[1]), r[0]))
    longest = max(max(r) for r in rects)
    lo, hi, best = 0.0, (1 - gap) / longest if longest else 1.0, []
    for _ in range(18):
        mid = (lo + hi) / 2
        placed = _place(ordered, mid, gap)
        if placed is None:
            hi = mid
        else:
            lo, best = mid, placed
    return lo, best
