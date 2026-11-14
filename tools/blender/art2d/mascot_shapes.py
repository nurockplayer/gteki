"""Geometry for the guide-mascot UI set (#132 / #195). Data only; `mascot_svg.py` is the engine.

Each `cat_<expression>` / `dog_<expression>` function returns the primitives for one SVG, in drawing order
(first = furthest back). The engine minifies them, writes the SVGs, index.json and the PNG previews, and checks
them; this module owns the drawing alone.

Primitive format (a plain dict):

    {"shape": "circle",  "cx": 0, "cy": 0, "r": 0, ...}
    {"shape": "ellipse", "cx": 0, "cy": 0, "rx": 0, "ry": 0, "rotate": 0, ...}
    {"shape": "path",    "d": "M0 0L1 1", ...}

Common keys:
    "fill"      sRGB hex, or "none" (default "none").
    "stroke"    sRGB hex, or "none" (default OUTLINE).
    "width"     stroke width (default 2.2 at the 64-unit scale).
    "transform" an SVG transform string, e.g. "rotate(15 32 30)"; optional.

Path extras: "cap" / "join" → stroke-linecap / stroke-linejoin (default "round").
An ellipse's "rotate" (degrees, clockwise) becomes `rotate(<deg> <cx> <cy>)`; give it or "transform", not both.

Coordinates are in the `0 0 64 64` viewBox. Keep one decimal at most; the engine rounds the same way. Colours are
the approved v1 palette below. This is an original GTEki redraw (CC BY 4.0), not a trace of the reference renders.
"""

OUTLINE = "#3B2A22"
INK = "#2B1E18"
WHITE = "#FFFFFF"
ORANGE = "#E8A15A"
PINK = "#F6B8B0"
NAVY = "#0E2554"
CREAM = "#FBF3E4"
CARAMEL = "#C9955C"
CARAMEL_LIGHT = "#E2B98A"
YELLOW = "#F5BD1A"


def _n(value):
    text = "%.1f" % value
    if text.endswith(".0"):
        text = text[:-2]
    return "0" if text == "-0" else text


def circle(cx, cy, r, fill, stroke=OUTLINE, width=2.2, transform=None):
    prim = {"shape": "circle", "cx": cx, "cy": cy, "r": r, "fill": fill, "stroke": stroke, "width": width}
    if transform is not None:
        prim["transform"] = transform
    return prim


def ellipse(cx, cy, rx, ry, fill, stroke=OUTLINE, width=2.2, rotate=None, transform=None):
    prim = {"shape": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry, "fill": fill, "stroke": stroke, "width": width}
    if rotate is not None:
        if transform is not None:
            raise ValueError("an ellipse takes rotate or transform, not both")
        prim["rotate"] = rotate
    if transform is not None:
        prim["transform"] = transform
    return prim


def path(d, fill="none", stroke=OUTLINE, width=2.2, cap="round", join="round", transform=None):
    prim = {"shape": "path", "d": d, "fill": fill, "stroke": stroke, "width": width, "cap": cap, "join": join}
    if transform is not None:
        prim["transform"] = transform
    return prim


def _tilt(parts, deg, cx=32, cy=30):
    """Rotates a group of primitives about (cx, cy) — the head tilt, and the small bow of `sorry`.

    An ellipse that already carries "rotate" gets both transforms: its own rotation in place, then the group's.
    """
    tilt = "rotate(%s %s %s)" % (_n(deg), _n(cx), _n(cy))
    tilted = []
    for part in parts:
        part = dict(part)
        own = part.pop("rotate", None)
        transform = part.get("transform")
        if own is not None:
            own_transform = "rotate(%s %s %s)" % (_n(own), _n(part["cx"]), _n(part["cy"]))
            transform = own_transform if transform is None else own_transform + " " + transform
        part["transform"] = tilt if transform is None else tilt + " " + transform
        tilted.append(part)
    return tilted


# --- cat -----------------------------------------------------------------------------------------------------------------

def _cat_body():
    return [
        path("M21 64L21 52C21 46 25 43 31 43L35 43C42 43 45 46 45 52L45 64Z", WHITE),
        # Orange shoulders/back, white chest between them.
        path("M21 64L21 52C21 47 24 44 27 43L28 64Z", ORANGE),
        path("M45 64L45 52C45 47 42 44 38 43L37 64Z", ORANGE),
        # Navy neckerchief: one white stripe on the knot, no rings or stripes anywhere else.
        path("M22 41C27 44 36 44 41 41L41 45C36 48 27 48 22 45Z", NAVY),
        circle(38, 44, 2.6, NAVY, width=1.8),
        path("M39 46L43 50L39.6 50Z", NAVY, width=1.6),
        path("M36.6 43.2L38.4 44.4", "none", WHITE, 1.1),
        ellipse(24, 55.5, 4.2, 4.8, WHITE),
        ellipse(42, 55.5, 4.2, 4.8, WHITE),
    ]


def _cat_head():
    return [
        path("M17 24L13 8L28 15Z", ORANGE),
        path("M18 21.5L16 12L24 16.5Z", PINK, "none"),
        path("M45 24L49 8L35 14Z", ORANGE),
        path("M44 21.5L46 12L39 15.5Z", PINK, "none"),
        path("M16 29C16 19 22 13 31 13C41 13 47 19 47 29C47 37 41 42 32 42C23 42 16 37 16 29Z", WHITE),
        # Orange cap over the top and sides, with the white blaze rising to the forehead in the middle.
        path("M17 28C17 18 23 13 31 13C40 13 46 18 47 28C44.6 26.6 42 27 40 29C37 25 34.6 22 32 21C29.4 22 27 25 24 29C22 27 19.4 26.6 17 28Z", ORANGE, width=2.0),
    ]


def _cat_face(mood):
    parts = []
    if mood == "happy":
        parts += [
            path("M23.4 28.4Q26.5 24.4 29.6 28.4", "none", INK, 1.8),
            path("M35.4 28.4Q38.5 24.4 41.6 28.4", "none", INK, 1.8),
        ]
    else:
        # Round eyes with a highlight dot, both on the right-facing 3/4 view.
        parts += [
            circle(26.5, 28, 3.0, INK, "none"),
            circle(25.6, 27.2, 1.0, WHITE, "none"),
            circle(38.5, 28, 3.0, INK, "none"),
            circle(37.6, 27.2, 1.0, WHITE, "none"),
        ]
    parts += [
        ellipse(22.5, 33, 2.4, 1.3, PINK, "none"),
        ellipse(42.5, 33, 2.4, 1.3, PINK, "none"),
    ]
    if mood == "sorry":
        # Inner ends raised: regretful, not crying.
        parts.append(path("M22.8 24.6L27.4 22.8M37.2 22.8L41.8 24.6", "none", INK, 1.2))
    elif mood == "unsure":
        parts.append(path("M22.8 23.6L27.4 23.6M37.2 23.6L41.8 23.6", "none", INK, 1.2))
    parts.append(path("M35 31.8L37.4 31.8L36.2 33.3Z", PINK, "none"))
    mouths = {
        "neutral": path("M36.2 33.8L34.2 36M36.2 33.8L38.2 36", "none", INK, 1.1),
        "happy": path("M33.6 34Q36.2 38.2 38.8 34Q36.2 36.2 33.6 34Z", INK, "none"),
        "encourage": path("M34 35Q36.2 37.2 38.4 35", "none", INK, 1.2),
        "sorry": path("M34.2 35.2Q36.2 36.8 38.2 35.2", "none", INK, 1.2),
        "unsure": path("M34.6 35Q36.2 36.2 37.8 35", "none", INK, 1.2),
    }
    parts.append(mouths[mood])
    parts += [
        path("M17.5 30L21 29.6M17 33L20.8 32.6", "none", INK, 0.9),
        path("M47 29.4L44 29.8M47.5 32.6L44.2 32.4", "none", INK, 0.9),
    ]
    return parts


def _cat_arms(mood):
    if mood == "encourage":
        # One small paw raised, palm forward.
        return [
            path("M22 53C17.6 52.4 14.4 49.6 13 46.4L15.8 44.4C17.2 47 19.6 49 23 49.8Z", WHITE),
            ellipse(12.8, 43.6, 3.3, 4.1, WHITE, rotate=-28),
        ]
    if mood == "unsure":
        # Both paws up and out: the exaggerated shrug that has to read at 32 px.
        return [
            path("M21 51C16.8 50.8 13.4 48.6 11.4 45.6L14.2 43.2C16.4 46 19.2 47.6 22.8 48.2Z", WHITE),
            ellipse(10.6, 44.4, 3.5, 4.3, WHITE, rotate=-35),
            path("M45 51C49.2 50.8 52.6 48.6 54.6 45.6L51.8 43.2C49.6 46 46.8 47.6 43.2 48.2Z", WHITE),
            ellipse(53.4, 44.4, 3.5, 4.3, WHITE, rotate=35),
        ]
    return []


def _cat(mood):
    parts = _cat_body() + _cat_arms(mood)
    head = _cat_head() + _cat_face(mood)
    if mood == "unsure":
        head = _tilt(head, 15)
    elif mood == "sorry":
        head = _tilt(head, -4)
    return parts + head


def cat_neutral():
    return _cat("neutral")


def cat_happy():
    return _cat("happy")


def cat_encourage():
    return _cat("encourage")


def cat_sorry():
    return _cat("sorry")


def cat_unsure():
    return _cat("unsure")


# --- dog -----------------------------------------------------------------------------------------------------------------

def _dog_body():
    return [
        path("M20 64L20 51C20 45 25 42 32 42C39 42 44 45 44 51L44 64Z", CREAM),
        # The yellow backpack shows only as two thin shoulder straps over the chest.
        path("M24 43C22.4 49 22.6 54 23.4 58", "none", OUTLINE, 3.6),
        path("M24 43C22.4 49 22.6 54 23.4 58", "none", YELLOW, 2.2),
        path("M40 43C41.6 49 41.4 54 40.6 58", "none", OUTLINE, 3.6),
        path("M40 43C41.6 49 41.4 54 40.6 58", "none", YELLOW, 2.2),
        # Paws hold nothing.
        ellipse(24, 56, 4.4, 4.8, CREAM),
        ellipse(42, 56, 4.4, 4.8, CREAM),
    ]


def _dog_head():
    return [
        path("M17 29C17 20 22 14 31 14C40 14 47 19 47 28C47 37 41 42 32 42C23 42 17 37 17 29Z", CREAM),
        # Long floppy ears drawn over the head's rim, attached high and hanging past the jaw (behind the head they read
        # as round lobes at the temples).
        ellipse(14.9, 26, 4.5, 10.2, CARAMEL, rotate=12),
        ellipse(15.2, 26.9, 2.1, 6.2, CARAMEL_LIGHT, "none", rotate=12),
        ellipse(49.1, 26, 4.5, 10.2, CARAMEL, rotate=-12),
        ellipse(48.8, 26.9, 2.1, 6.2, CARAMEL_LIGHT, "none", rotate=-12),
        # One head tuft.
        path("M28 14C27 10 30 8 31.5 10.5C33 8 36 9 35 13Z", CREAM, width=2.0),
    ]


def _dog_face(mood):
    parts = []
    if mood == "happy":
        parts += [
            path("M23.8 27.8Q27 23.8 30.2 27.8", "none", INK, 1.8),
            path("M36.6 27.8Q39.8 23.8 43 27.8", "none", INK, 1.8),
        ]
    else:
        parts += [
            circle(27, 27.5, 3.4, INK, "none"),
            circle(26.1, 26.6, 1.1, WHITE, "none"),
            circle(39.5, 27.5, 3.4, INK, "none"),
            circle(38.6, 26.6, 1.1, WHITE, "none"),
        ]
    parts += [
        ellipse(22.2, 32.6, 2.4, 1.4, PINK, "none"),
        ellipse(42.8, 32.6, 2.4, 1.4, PINK, "none"),
    ]
    if mood == "sorry":
        parts.append(path("M22.6 24L27.2 22.6M37.2 22.6L41.8 24", "none", INK, 1.2))
    elif mood == "unsure":
        parts.append(path("M22.6 23.4L27.2 23.4M37.2 23.4L41.8 23.4", "none", INK, 1.2))
    # Nose low enough to stay clear of the big eyes (an overlap merged into a blob at 32 px).
    parts.append(ellipse(37, 32.3, 1.8, 1.1, INK, "none"))
    mouths = {
        "neutral": path("M37 35.2L35.2 37.2M37 35.2L38.8 37.2", "none", INK, 1.1),
        "happy": path("M33.6 34.6Q37 39.2 40.4 34.6Q37 36.6 33.6 34.6Z", INK, "none"),
        "encourage": path("M34.8 34.8Q37 37 39.2 34.8", "none", INK, 1.2),
        "sorry": path("M35 34.8Q37 36.4 39 34.8", "none", INK, 1.2),
        "unsure": path("M35.2 35Q37 36.2 38.8 35", "none", INK, 1.2),
    }
    parts.append(mouths[mood])
    if mood == "happy":
        parts.append(ellipse(37, 36.0, 1.4, 0.8, PINK, "none"))
    return parts


def _dog_arms(mood):
    if mood == "encourage":
        return [
            path("M22 53C17.6 52.4 14.4 49.6 13 46.4L15.8 44.4C17.2 47 19.6 49 23 49.8Z", CREAM),
            ellipse(12.8, 43.6, 3.3, 4.1, CREAM, rotate=-28),
        ]
    if mood == "unsure":
        return [
            path("M21 51C16.8 50.8 13.4 48.6 11.4 45.6L14.2 43.2C16.4 46 19.2 47.6 22.8 48.2Z", CREAM),
            ellipse(10.6, 44.4, 3.5, 4.3, CREAM, rotate=-35),
            path("M45 51C49.2 50.8 52.6 48.6 54.6 45.6L51.8 43.2C49.6 46 46.8 47.6 43.2 48.2Z", CREAM),
            ellipse(53.4, 44.4, 3.5, 4.3, CREAM, rotate=35),
        ]
    return []


def _dog(mood):
    parts = _dog_body() + _dog_arms(mood)
    head = _dog_head() + _dog_face(mood)
    if mood == "unsure":
        head = _tilt(head, 15)
    elif mood == "sorry":
        head = _tilt(head, -4)
    return parts + head


def dog_neutral():
    return _dog("neutral")


def dog_happy():
    return _dog("happy")


def dog_encourage():
    return _dog("encourage")


def dog_sorry():
    return _dog("sorry")


def dog_unsure():
    return _dog("unsure")
