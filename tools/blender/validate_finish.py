#!/usr/bin/env python3
"""Validate a finish pack (`gteki-finish/0.1`, docs/assets/asset-contract.md section 9). Stdlib only.

  python3 tools/blender/validate_finish.py assets/library/finishes [more packs] [--report out.json]
  python3 tools/blender/validate_finish.py --self-test

Per finish: finish.json schema, files present with the sha256 / bytes that finish.json and the
manifest record, power-of-two sizes that match the JPEG headers (and the pack's texture cap),
seamless tiling of albedo and normal (opposite edges compared), a near-white neutral base for
`tint` finishes, and a sample GLB that embeds exactly the loose map files under the finish's name.
The sample GLB itself is checked by validate_glb.py.

Tiling: for each pair of opposite edges, the mean absolute difference across the wrap (last row
against first row) is divided by the mean difference between neighbouring rows at the edges. A
seamless texture scores about 1; a texture that was cropped or generated without wrapping scores
much higher. This guards against gross seams, not against noise that merely looks alike.
"""
import argparse
import contextlib
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_glb import encode_glb, parse_glb  # noqa: E402

FORMAT = "gteki-finish/0.1"
ROLES = ("floor", "wall", "ceiling", "band", "trim")
MAPS = ("albedo", "orm", "normal")
ID_RE = re.compile(r"gteki_finish_[a-z0-9_]+")
SEAM_MAX = 2.0  # seamless textures measure about 1 (see the module docstring)
SEAM_FLOOR = 8.0  # 8-bit levels: wrap differences up to 2 x this pass on smooth maps (a groove centred on the edge texel is steepest next to it)
TINT_MIN = 225  # 8-bit sRGB mean per channel of a tint base (0.88)
TINT_SPREAD = 8  # and the largest gap between channels (neutral)
HEX64 = re.compile(r"[0-9a-f]{64}")


# --------------------------------------------------------------------------- JPEG decoding

def _zigzag():
    order = []
    for s in range(15):
        pts = [(i, s - i) for i in range(max(0, s - 7), min(s, 7) + 1)]
        if s % 2 == 0:
            pts.reverse()
        order += [r * 8 + c for r, c in pts]
    return order


ZZ = _zigzag()
_T = [[(math.sqrt(0.5) if u == 0 else 1.0) * 0.5 * math.cos((2 * x + 1) * u * math.pi / 16) for u in range(8)] for x in range(8)]


def _idct(coefs):
    """Dequantised natural-order 8x8 coefficients -> 64 samples (level shift included)."""
    tmp = [[sum(coefs[v * 8 + u] * _T[x][u] for u in range(8)) for x in range(8)] for v in range(8)]
    return [sum(_T[y][v] * tmp[v][x] for v in range(8)) + 128.0 for y in range(8) for x in range(8)]


def _lookup(counts, symbols):
    """16-bit prefix table: entry = (code length << 8) | symbol, 0 for unused prefixes."""
    table = [0] * 65536
    code, k = 0, 0
    for length in range(1, 17):
        for _ in range(counts[length - 1]):
            lo = code << (16 - length)
            table[lo:lo + (1 << (16 - length))] = [(length << 8) | symbols[k]] * (1 << (16 - length))
            code, k = code + 1, k + 1
        code <<= 1
    return table


def _segments(data):
    if data[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    jpg = {"dqt": {}, "dht": {}, "ri": 0, "adobe": None}
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            raise ValueError("bad JPEG marker")
        marker = data[pos + 1]
        if marker == 0xFF:
            pos += 1
            continue
        length = int.from_bytes(data[pos + 2:pos + 4], "big")
        body = data[pos + 4:pos + 2 + length]
        pos += 2 + length
        if marker == 0xDB:
            while body:
                pq, tq = body[0] >> 4, body[0] & 15
                n = 128 if pq else 64
                vals = [int.from_bytes(body[1 + i * (2 if pq else 1):1 + (i + 1) * (2 if pq else 1)], "big") for i in range(64)]
                jpg["dqt"][tq] = vals
                body = body[1 + n:]
        elif marker in (0xC0, 0xC1):
            prec, h, w, n = body[0], int.from_bytes(body[1:3], "big"), int.from_bytes(body[3:5], "big"), body[5]
            if prec != 8 or n not in (1, 3):
                raise ValueError("only 8-bit grayscale / 3-component JPEG is supported")
            jpg.update(w=w, h=h, comps=[{"id": body[6 + 3 * i], "hs": body[7 + 3 * i] >> 4, "vs": body[7 + 3 * i] & 15,
                                         "tq": body[8 + 3 * i]} for i in range(n)])
        elif marker in (0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            raise ValueError("progressive / lossless / arithmetic JPEG is not supported (baseline only)")
        elif marker == 0xC4:
            while body:
                tc, th = body[0] >> 4, body[0] & 15
                counts = list(body[1:17])
                n = sum(counts)
                jpg["dht"][(tc, th)] = _lookup(counts, list(body[17:17 + n]))
                body = body[17 + n:]
        elif marker == 0xDD:
            jpg["ri"] = int.from_bytes(body[:2], "big")
        elif marker == 0xEE and body[:5] == b"Adobe":
            jpg["adobe"] = body[11]
        elif marker == 0xDA:
            ns = body[0]
            scan = [(body[1 + 2 * i], body[2 + 2 * i] >> 4, body[2 + 2 * i] & 15) for i in range(ns)]
            end = re.compile(rb"\xff[^\x00\xd0-\xd7\xff]").search(data, pos)
            raw = data[pos:end.start() if end else len(data)]
            jpg["scan"] = scan
            jpg["raw"] = [s.replace(b"\xff\x00", b"\xff") for s in re.split(rb"\xff[\xd0-\xd7]", raw)]
            return jpg
    raise ValueError("JPEG has no scan")


class Decoded:
    """Edge pixels (first / last two rows and columns) and the mean colour of a baseline JPEG."""

    def __init__(self, data):
        j = _segments(data)
        self.w, self.h = j["w"], j["h"]
        comps = j["comps"]
        hmax, vmax = max(c["hs"] for c in comps), max(c["vs"] for c in comps)
        mx, my = -(-self.w // (8 * hmax)), -(-self.h // (8 * vmax))
        self.hmax, self.vmax, self.comps = hmax, vmax, comps
        want_y = sorted({y for y in (0, 1, self.h - 2, self.h - 1) if 0 <= y < self.h})
        want_x = sorted({x for x in (0, 1, self.w - 2, self.w - 1) if 0 <= x < self.w})
        for c in comps:
            c["rows"] = {(y * c["vs"] // vmax) // 8 for y in want_y}
            c["cols"] = {(x * c["hs"] // hmax) // 8 for x in want_x}
            c["dcsum"], c["nblk"] = 0, 0
        self.blocks = {}
        by_id = {c["id"]: c for c in comps}
        order = [(by_id[cid], j["dht"][(0, td)], j["dht"][(1, ta)]) for cid, td, ta in j["scan"]]
        if len(order) != len(comps):
            raise ValueError("non-interleaved JPEG scans are not supported")
        total = mx * my
        ri = j["ri"] or total
        mcu = 0
        for seg in j["raw"]:
            if mcu >= total:
                break
            mcu = self._scan(seg + b"\0" * 8, order, j["dqt"], mx, mcu, min(total, mcu + ri))
        if mcu < total:
            raise ValueError("JPEG scan ends early")
        self.mean = [c["dcsum"] / c["nblk"] / 8.0 + 128.0 for c in comps]
        self.ycc = len(comps) == 3 and j["adobe"] != 0

    def _scan(self, seg, order, dqt, mx, mcu, stop):
        bits, n, pos = 0, 0, 0
        pred = {id(c): 0 for c, _, _ in order}
        while mcu < stop:
            my_, mx_ = divmod(mcu, mx)
            for c, dc, ac in order:
                q = dqt[c["tq"]]
                for v in range(c["vs"]):
                    for h in range(c["hs"]):
                        br, bc = my_ * c["vs"] + v, mx_ * c["hs"] + h
                        need = br in c["rows"] or bc in c["cols"]
                        if n < 31:
                            bits = ((bits & ((1 << n) - 1)) << 32) | int.from_bytes(seg[pos:pos + 4], "big")
                            pos, n = pos + 4, n + 32
                        e = dc[(bits >> (n - 16)) & 0xFFFF]
                        if not e:
                            raise ValueError("bad Huffman code")
                        n -= e >> 8
                        s = e & 15
                        d = 0
                        if s:
                            d = (bits >> (n - s)) & ((1 << s) - 1)
                            n -= s
                            if d < (1 << (s - 1)):
                                d -= (1 << s) - 1
                        pred[id(c)] += d
                        c["dcsum"] += pred[id(c)] * q[0]
                        c["nblk"] += 1
                        co = [0] * 64
                        co[0] = pred[id(c)] * q[0]
                        k = 1
                        while k < 64:
                            if n < 31:
                                bits = ((bits & ((1 << n) - 1)) << 32) | int.from_bytes(seg[pos:pos + 4], "big")
                                pos, n = pos + 4, n + 32
                            e = ac[(bits >> (n - 16)) & 0xFFFF]
                            if not e:
                                raise ValueError("bad Huffman code")
                            n -= e >> 8
                            rs = e & 255
                            s = rs & 15
                            if s == 0:
                                if rs == 0xF0:
                                    k += 16
                                    continue
                                break
                            k += rs >> 4
                            val = (bits >> (n - s)) & ((1 << s) - 1)
                            n -= s
                            if val < (1 << (s - 1)):
                                val -= (1 << s) - 1
                            if k > 63:
                                raise ValueError("JPEG coefficient run past the block")
                            if need:
                                co[ZZ[k]] = val * q[k]
                            k += 1
                        if need:
                            self.blocks[(id(c), br, bc)] = _idct(co)
            mcu += 1
        return mcu

    def pixel(self, x, y):
        vals = []
        for c in self.comps:
            cx, cy = x * c["hs"] // self.hmax, y * c["vs"] // self.vmax
            vals.append(self.blocks[(id(c), cy // 8, cx // 8)][(cy % 8) * 8 + cx % 8])
        if len(vals) == 1:
            vals = vals * 3
        elif self.ycc:
            yy, cb, cr = vals[0], vals[1] - 128.0, vals[2] - 128.0
            vals = [yy + 1.402 * cr, yy - 0.344136 * cb - 0.714136 * cr, yy + 1.772 * cb]
        return [min(255.0, max(0.0, v)) for v in vals]

    def mean_rgb(self):
        m = self.mean
        if len(m) == 1:
            return [m[0]] * 3
        if not self.ycc:
            return list(m)
        return [m[0] + 1.402 * (m[2] - 128.0), m[0] - 0.344136 * (m[1] - 128.0) - 0.714136 * (m[2] - 128.0),
                m[0] + 1.772 * (m[1] - 128.0)]


def seam_score(img):
    """Worst of the two wrap-around scores (see the module docstring)."""
    def diff(a, b):
        return sum(abs(p - q) for p, q in zip(a, b)) / 3.0

    def one(count, at, far):
        wrap = ref = 0.0
        for i in range(count):
            a, b = at(i, 0), at(i, far)
            wrap += diff(a, b)
            ref += (diff(a, at(i, 1)) + diff(b, at(i, far - 1))) / 2.0
        return (wrap / count) / max(ref / count, SEAM_FLOOR)

    w, h = img.w, img.h
    if w < 4 or h < 4:
        return 0.0
    v = one(w, lambda i, k: img.pixel(i, k), h - 1)
    u = one(h, lambda i, k: img.pixel(k, i), w - 1)
    return max(u, v)


# --------------------------------------------------------------------------- checks

def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def check_doc(doc, fid, tier):
    """Schema problems of one finish.json."""
    p = []
    if not isinstance(doc, dict):
        return ["finish.json is not an object"]
    if doc.get("format") != FORMAT:
        p.append(f"format must be {FORMAT}")
    if doc.get("id") != fid or not ID_RE.fullmatch(str(doc.get("id"))):
        p.append(f"id {doc.get('id')!r} must equal the directory name and match {ID_RE.pattern}")
    if doc.get("role") not in ROLES:
        p.append(f"role must be one of {ROLES}")
    for key in ("gteki_role", "use", "pattern", "sample_glb", "license", "provenance", "generator"):
        if not isinstance(doc.get(key), str) or not doc[key]:
            p.append(f"{key} must be a non-empty string")
    fac = doc.get("facility")
    if not isinstance(fac, list) or not fac or not all(isinstance(x, str) and x for x in fac):
        p.append("facility must be a non-empty list of strings")
    rep = doc.get("repeat_m")
    if not (isinstance(rep, list) and len(rep) == 2 and all(_num(x) and x > 0 for x in rep)):
        p.append("repeat_m must be [u, v] in metres, both positive")
    uv = doc.get("uv")
    if not (isinstance(uv, dict) and all(isinstance(uv.get(k), str) and uv[k] for k in ("u", "v", "surface", "origin"))):
        p.append("uv must describe u, v, surface and origin")
    if doc.get("tier") != tier:
        p.append(f"tier {doc.get('tier')!r} differs from the pack's {tier!r}")
    maps = doc.get("maps")
    if not isinstance(maps, dict) or not maps or not set(maps) <= set(MAPS):
        p.append(f"maps must hold a non-empty subset of {MAPS}")
        maps = {}
    for key, m in maps.items():
        ok = (isinstance(m, dict) and m.get("file") == f"{key}.jpg" and isinstance(m.get("bytes"), int) and m["bytes"] > 0
              and isinstance(m.get("sha256"), str) and HEX64.fullmatch(m["sha256"])
              and isinstance(m.get("size"), list) and len(m["size"]) == 2 and all(isinstance(x, int) for x in m["size"]))
        if not ok:
            p.append(f"maps.{key} must have file {key}.jpg, size [w, h], bytes and sha256")
    if sorted(doc.get("omitted_maps") or []) != sorted(set(MAPS) - set(maps)):
        p.append("omitted_maps must list exactly the maps that are not shipped")
    fa = doc.get("factors")
    if not isinstance(fa, dict):
        p.append("factors must be an object")
    else:
        bc = fa.get("baseColorFactor")
        if not (isinstance(bc, list) and len(bc) == 4 and all(_num(x) and 0 <= x <= 1 for x in bc)):
            p.append("factors.baseColorFactor must be 4 numbers in [0, 1]")
        elif "albedo" in maps and bc != [1.0, 1.0, 1.0, 1.0] and not doc.get("tint"):
            p.append("an albedo map is shipped, so baseColorFactor must be [1, 1, 1, 1]")
        for key in ("roughnessFactor", "metallicFactor"):
            if not (_num(fa.get(key)) and 0 <= fa[key] <= 1):
                p.append(f"factors.{key} must be a number in [0, 1]")
            elif "orm" in maps and fa[key] != 1.0:
                p.append(f"an ORM map is shipped, so {key} must be 1")
    if not isinstance(doc.get("tint"), bool):
        p.append("tint must be true or false")
    elif doc["tint"] and not isinstance(doc.get("tint_info"), dict):
        p.append("a tint finish needs tint_info (mode, formula, set)")
    return p


def _sha(path):
    data = Path(path).read_bytes()
    return hashlib.sha256(data).hexdigest(), len(data)


def check_finish(root, rec, cap, tier):
    """(problems, info) for one manifest `finishes` record under `root`."""
    fid = rec.get("id", "?")
    p, info = [], {"id": fid}
    d = root / fid
    fj = d / "finish.json"
    if not fj.is_file():
        return [f"{fid}: finish.json is missing"], info
    sha, size = _sha(fj)
    want = rec.get("finish_json", {})
    if (sha, size) != (want.get("sha256"), want.get("bytes")):
        p.append(f"{fid}: finish.json differs from the manifest (sha256 / bytes)")
    try:
        doc = json.loads(fj.read_text())
    except ValueError as e:
        return p + [f"{fid}: finish.json is not valid JSON ({e})"], info
    p += [f"{fid}: {x}" for x in check_doc(doc, fid, tier)]
    maps = doc.get("maps") if isinstance(doc.get("maps"), dict) else {}
    loose = {}
    decoded = {}
    for key, m in maps.items():
        f = d / f"{key}.jpg"
        if not isinstance(m, dict) or not f.is_file():
            p.append(f"{fid}: {key}.jpg is missing")
            continue
        sha, size = _sha(f)
        loose[sha] = key
        if (sha, size) != (m.get("sha256"), m.get("bytes")):
            p.append(f"{fid}: {key}.jpg sha256 / bytes differ from finish.json")
        mf = rec.get("files", {}).get(key, {})
        if (mf.get("sha256"), mf.get("bytes")) != (sha, size):
            p.append(f"{fid}: {key}.jpg differs from the manifest record")
        try:
            img = Decoded(f.read_bytes())
        except (ValueError, IndexError, KeyError) as e:
            p.append(f"{fid}: {key}.jpg cannot be decoded ({e})")
            continue
        decoded[key] = img
        if [img.w, img.h] != m.get("size"):
            p.append(f"{fid}: {key}.jpg is {img.w}x{img.h}, finish.json says {m.get('size')}")
        for side in (img.w, img.h):
            if side & (side - 1):
                p.append(f"{fid}: {key}.jpg is {img.w}x{img.h}: sizes must be powers of two")
                break
        if cap and max(img.w, img.h) > cap:
            p.append(f"{fid}: {key}.jpg is {img.w}x{img.h}, above the pack's cap {cap}")
        if key in ("albedo", "normal"):
            score = seam_score(img)
            info[f"seam_{key}"] = round(score, 2)
            if score > SEAM_MAX:
                p.append(f"{fid}: {key}.jpg does not tile (seam score {score:.1f} > {SEAM_MAX})")
    info["bytes"] = sum(m.get("bytes", 0) for m in maps.values() if isinstance(m, dict))
    if doc.get("tint") is True:
        if "albedo" in decoded:
            mean = decoded["albedo"].mean_rgb()
        else:
            mean = [255.0 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)
                    for c in doc.get("factors", {}).get("baseColorFactor", [0, 0, 0])[:3]]
        info["tint_base"] = [round(v) for v in mean]
        if min(mean) < TINT_MIN or max(mean) - min(mean) > TINT_SPREAD:
            p.append(f"{fid}: a tint base must be near white and neutral (mean sRGB {[round(v) for v in mean]}, "
                     f"need every channel >= {TINT_MIN} and within {TINT_SPREAD} of each other)")
    p += _check_sample(root, fid, rec, doc, loose)
    return p, info


def _check_sample(root, fid, rec, doc, loose):
    glb = root / "glb" / f"{fid}.glb"
    if rec.get("sample_glb") != f"glb/{fid}.glb" or doc.get("sample_glb") != f"../glb/{fid}.glb":
        return [f"{fid}: sample_glb must be glb/{fid}.glb (finish.json: ../glb/{fid}.glb)"]
    if not glb.is_file():
        return [f"{fid}: sample GLB glb/{fid}.glb is missing"]
    try:
        gdoc, binary = parse_glb(glb.read_bytes())
    except (ValueError, KeyError, IndexError, struct.error) as e:
        return [f"{fid}: sample GLB cannot be parsed ({e})"]
    p = []
    names = [m.get("name") for m in gdoc.get("materials", [])]
    if names != [fid]:
        p.append(f"{fid}: sample GLB materials are {names}, expected exactly [{fid!r}]")
    # the sample's own baked occlusion map (contract §4, one per asset) is not a finish map
    occlusion = {gdoc["textures"][m["occlusionTexture"]["index"]]["source"]
                 for m in gdoc.get("materials", []) if "occlusionTexture" in m}
    shas = set()
    for i, im in enumerate(gdoc.get("images", [])):
        if i in occlusion:
            continue
        view = gdoc["bufferViews"][im["bufferView"]]
        start = view.get("byteOffset", 0)
        shas.add(hashlib.sha256(binary[start:start + view["byteLength"]]).hexdigest())
    if shas != set(loose):
        p.append(f"{fid}: the sample GLB embeds different images than the loose maps")
    return p


def check_pack(root):
    """(problems, rows) for a finish pack directory (manifest.json, glb/, <id>/)."""
    root = Path(root)
    try:
        man = json.loads((root / "manifest.json").read_text())
    except (OSError, ValueError) as e:
        return [f"{root}: manifest.json unreadable ({e})"], []
    p = []
    if man.get("finish_pack") != FORMAT:
        p.append(f"{root}: manifest finish_pack must be {FORMAT}")
    recs = man.get("finishes")
    if not isinstance(recs, list) or not recs:
        return p + [f"{root}: manifest has no finishes"], []
    tier = man.get("profile", "full")
    cap = man.get("texture_resolution")
    ids = [r.get("id") for r in recs]
    if len(set(ids)) != len(ids):
        p.append("manifest lists a finish more than once")
    dirs = sorted(x.name for x in root.glob("gteki_finish_*") if x.is_dir())
    if dirs != sorted(ids):
        p.append(f"finish directories {dirs} differ from the manifest {sorted(ids)}")
    assets = {a.get("id"): a for a in man.get("assets", [])}
    if sorted(assets) != sorted(ids):
        p.append("manifest assets (sample GLBs) and finishes list different ids")
    rows = []
    for rec in recs:
        fp, info = check_finish(root, rec, cap, tier)
        glb = root / "glb" / f"{rec.get('id')}.glb"
        a = assets.get(rec.get("id"), {})
        if glb.is_file() and (_sha(glb) != (a.get("sha256"), a.get("bytes"))):
            fp.append(f"{rec.get('id')}: sample GLB differs from its manifest record (sha256 / bytes)")
        p += fp
        info["status"] = "FAIL" if fp else "PASS"
        rows.append(info)
    return p, rows


# --------------------------------------------------------------------------- self-test

def _fdct(block):
    return [[sum(_T[x][u] * sum(_T[y][v] * block[y][x] for y in range(8)) for x in range(8)) for u in range(8)] for v in range(8)]


def _codes(counts):
    """Canonical Huffman codes {symbol index: (code, length)} for symbols listed in order."""
    out, code, k = {}, 0, 0
    for length in range(1, 17):
        for _ in range(counts[length - 1]):
            out[k] = (code, length)
            code, k = code + 1, k + 1
        code <<= 1
    return out


def _encode_jpeg(w, h, pix):
    """Baseline 4:4:4 JPEG of `pix[y][x] = (r, g, b)` (w and h multiples of 8) with unit quantisation
    and plain canonical Huffman tables: just enough to give the decoder test pixels without
    third-party packages."""
    dc_counts = [0, 0, 0, 12] + [0] * 12  # symbols 0..11, 4-bit codes
    ac_counts = [0] * 7 + [128, 128] + [0] * 7  # symbols 0..255: 128 8-bit codes, 128 9-bit codes
    dc, ac = _codes(dc_counts), _codes(ac_counts)
    out, acc = bytearray(), [0, 0]

    def put(code, length):
        acc[0] = (acc[0] << length) | code
        acc[1] += length
        while acc[1] >= 8:
            b = (acc[0] >> (acc[1] - 8)) & 255
            out.append(b)
            if b == 255:
                out.append(0)
            acc[1] -= 8
        acc[0] &= (1 << acc[1]) - 1

    def ext(v):
        s = abs(v).bit_length()
        return s, (v if v > 0 else v + (1 << s) - 1)

    planes = [[[c for c in (0.299 * r + 0.587 * g + 0.114 * b - 128, -0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 * r - 0.418688 * g - 0.081312 * b)]
               for r, g, b in row] for row in pix]
    pred = [0, 0, 0]
    for by in range(0, h, 8):
        for bx in range(0, w, 8):
            for c in range(3):
                blk = [[planes[by + y][bx + x][c] for x in range(8)] for y in range(8)]
                f = _fdct(blk)
                q = [round(f[ZZ[k] // 8][ZZ[k] % 8]) for k in range(64)]
                s, bits = ext(q[0] - pred[c])
                pred[c] = q[0]
                put(*dc[s])
                if s:
                    put(bits, s)
                run = 0
                for k in range(1, 64):
                    if q[k] == 0:
                        run += 1
                        continue
                    while run > 15:
                        put(*ac[0xF0])
                        run -= 16
                    s, bits = ext(q[k])
                    put(*ac[(run << 4) | s])
                    put(bits, s)
                    run = 0
                if run:
                    put(*ac[0])
    put((1 << (-acc[1] % 8)) - 1, -acc[1] % 8)
    head = bytearray(b"\xff\xd8")

    def seg(marker, body):
        head.extend(b"\xff" + bytes([marker]) + (len(body) + 2).to_bytes(2, "big") + body)

    seg(0xDB, b"\x00" + bytes([1] * 64))
    seg(0xC0, bytes([8]) + h.to_bytes(2, "big") + w.to_bytes(2, "big") + bytes([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]))
    seg(0xC4, b"\x00" + bytes(dc_counts) + bytes(range(12)))
    seg(0xC4, b"\x10" + bytes(ac_counts) + bytes(range(256)))
    seg(0xDA, bytes([3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]))
    return bytes(head) + bytes(out) + b"\xff\xd9"


def _noise(x, y, k):
    return ((x * 7919 + y * 104729 + k * 31337) * 2654435761 >> 7) % 17 - 8


def _image(n, kind):
    """n x n test pixels. `tile`: periodic pattern; `ramp`: cropped, so its edges do not match;
    `light` / `dark`: a flat near-white or dark field with noise; `normal`: a tangent-space-like field."""
    pix = []
    for y in range(n):
        row = []
        for x in range(n):
            if kind == "tile":
                v = 128 + 60 * math.sin(2 * math.pi * 3 * x / n) * math.cos(2 * math.pi * 2 * y / n)
                row.append(tuple(max(0, min(255, round(v + _noise(x, y, k)))) for k in range(3)))
            elif kind == "ramp":
                row.append((x * 255 // (n - 1), y * 255 // (n - 1), 128))
            elif kind in ("light", "dark"):
                base = 242 if kind == "light" else 60
                row.append(tuple(max(0, min(255, base - (2 if k == 2 else 0) + _noise(x, y, k) // 4)) for k in range(3)))
            else:
                row.append((128 + _noise(x, y, 0) // 2, 128 + _noise(x, y, 1) // 2, 255 - abs(_noise(x, y, 2)) // 4))
        pix.append(row)
    return pix


def _write_pack(root, fid="gteki_finish_test", albedo="tile", size=64, tint=False, role="wall", mutate=None):
    """A complete valid pack with one finish; `mutate(files, doc, man)` may break it."""
    root.mkdir(parents=True, exist_ok=True)
    d = root / fid
    d.mkdir()
    files = {"albedo": _encode_jpeg(size, size, _image(size, albedo)),
             "orm": _encode_jpeg(size, size, _image(size, "tile")),
             "normal": _encode_jpeg(size, size, _image(size, "normal"))}
    doc = {"format": FORMAT, "id": fid, "kit_version": "0.1.0", "tier": "full", "role": role, "gteki_role": "wall",
           "facility": ["passage"], "use": "test", "pattern": "test", "source_material": None, "repeat_m": [1.0, 1.0],
           "uv": {"u": "along the wall", "v": "up", "surface": "wall face", "origin": "repeat starts at 0"},
           "omitted_maps": [], "tint": tint, "sample_glb": f"../glb/{fid}.glb", "license": "x", "provenance": "x",
           "generator": "x", "factors": {"baseColorFactor": [1.0, 1.0, 1.0, 1.0], "roughnessFactor": 1.0, "metallicFactor": 1.0}}
    if tint:
        doc["tint_info"] = {"mode": "multiply"}
    man = {"finish_pack": FORMAT, "texture_resolution": 64}
    if mutate:
        mutate(files, doc, man)
    maps = {}
    for key, raw in files.items():
        if raw is not None:
            (d / f"{key}.jpg").write_bytes(raw)
        maps[key] = {"file": f"{key}.jpg", "size": [size, size], "bytes": len(raw or b""),
                     "sha256": hashlib.sha256(raw or b"").hexdigest()}
    doc["maps"] = maps
    (d / "finish.json").write_text(json.dumps(doc, indent=2))
    fj = (d / "finish.json").read_bytes()
    loose = {m["sha256"]: k for k, m in maps.items()}
    (root / "glb").mkdir()
    images = [files[k] for k in MAPS if files[k] is not None]
    binary, views = b"", []
    for raw in images:
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
        binary += raw + b"\0" * (-len(raw) % 4)
    gdoc = {"asset": {"version": "2.0"}, "buffers": [{"byteLength": len(binary)}], "bufferViews": views,
            "images": [{"bufferView": i, "mimeType": "image/jpeg"} for i in range(len(images))],
            "textures": [{"source": i} for i in range(len(images))], "materials": [{"name": fid}]}
    glb = encode_glb(gdoc, binary)
    (root / "glb" / f"{fid}.glb").write_bytes(glb)
    rec = {"id": fid, "finish_json": {"file": f"{fid}/finish.json", "bytes": len(fj), "sha256": hashlib.sha256(fj).hexdigest()},
           "files": {k: {"file": f"{fid}/{k}.jpg", "bytes": m["bytes"], "sha256": m["sha256"]} for k, m in maps.items()},
           "sample_glb": f"glb/{fid}.glb"}
    man.update(finishes=[rec], assets=[{"id": fid, "sha256": hashlib.sha256(glb).hexdigest(), "bytes": len(glb)}])
    (root / "manifest.json").write_text(json.dumps(man))
    return root


def self_test():
    import tempfile

    img = Decoded(_encode_jpeg(64, 64, _image(64, "tile")))
    assert img.w == img.h == 64
    want = _image(64, "tile")
    for x, y in ((0, 0), (63, 0), (5, 63), (63, 63), (1, 1), (62, 62), (0, 40)):
        got = img.pixel(x, y)
        assert all(abs(g - w) <= 3 for g, w in zip(got, want[y][x])), (x, y, got, want[y][x])
    assert seam_score(img) < 1.6, seam_score(img)
    assert seam_score(Decoded(_encode_jpeg(64, 64, _image(64, "ramp")))) > 10
    assert all(abs(m - 242) <= 3 for m in Decoded(_encode_jpeg(64, 64, _image(64, "light"))).mean_rgb())

    def drop(files, doc, man):
        files["orm"] = None

    def bad_sha(files, doc, man):
        files["albedo"] = files["albedo"] + b"\0"  # file bytes no longer match the recorded digest

    def bad_repeat(files, doc, man):
        doc["repeat_m"] = [0, 1.0]

    def bad_role(files, doc, man):
        doc["role"] = "rug"

    def factor(files, doc, man):
        doc["factors"]["roughnessFactor"] = 0.4  # an ORM map is shipped: the factor would apply twice

    def corrupt(files, doc, man):
        files["normal"] = files["normal"][:200]

    cases = {
        "good": (dict(), None, ""),
        "good tint": (dict(albedo="light", tint=True), None, ""),
        "missing file": (dict(), drop, "orm.jpg is missing"),
        "bad sha": (dict(), bad_sha, ""),
        "non-tileable": (dict(albedo="ramp"), None, "does not tile"),
        "tint on a dark base": (dict(albedo="dark", tint=True), None, "near white and neutral"),
        "tint on a tiled mid grey": (dict(albedo="tile", tint=True), None, "near white and neutral"),
        "non power of two": (dict(size=72), None, "powers of two"),
        "zero repeat": (dict(), bad_repeat, "repeat_m"),
        "bad role": (dict(), bad_role, "role must be"),
        "double factor": (dict(), factor, "roughnessFactor must be 1"),
        "truncated jpeg": (dict(), corrupt, "cannot be decoded"),
    }
    with tempfile.TemporaryDirectory() as tmp:
        for i, (name, (kw, mutate, expect)) in enumerate(cases.items()):
            root = _write_pack(Path(tmp) / str(i), mutate=mutate, **kw)
            problems, rows = check_pack(root)
            if name == "bad sha":
                # the digest in finish.json was computed over the modified bytes, so tamper afterwards
                data = (root / "gteki_finish_test" / "albedo.jpg").read_bytes()
                (root / "gteki_finish_test" / "albedo.jpg").write_bytes(data[:-3] + b"\x00\x00\x00")
                problems, rows = check_pack(root)
                expect = "differ"
            if expect:
                assert any(expect in x for x in problems), (name, problems)
                assert rows[0]["status"] == "FAIL", name
            else:
                assert not problems, (name, problems)
                assert rows[0]["status"] == "PASS", name
        # the sample GLB must embed the loose maps
        root = _write_pack(Path(tmp) / "glb")
        (root / "glb" / "gteki_finish_test.glb").write_bytes(encode_glb(
            {"asset": {"version": "2.0"}, "materials": [{"name": "gteki_finish_test"}]}, b""))
        problems, _ = check_pack(root)
        assert any("embeds different images" in x for x in problems), problems
        # a directory the manifest does not list
        root = _write_pack(Path(tmp) / "extra")
        (root / "gteki_finish_stray").mkdir()
        assert any("differ from the manifest" in x for x in check_pack(root)[0])
        # ... which fails the command even though every finish passes
        argv, sys.argv = sys.argv, ["validate_finish.py", str(root)]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                assert main() == 1
        finally:
            sys.argv = argv
    print("validate_finish self-test: PASS")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packs", nargs="*", help="finish pack directories (assets/library/finishes)")
    ap.add_argument("--report", help="write the per-finish results as JSON")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        if not args.packs:
            return 0
    if not args.packs:
        ap.error("pack directory required")
    report, failed = {}, 0
    for pack in args.packs:
        problems, rows = check_pack(pack)
        for r in rows:
            seams = " ".join(f"{k[5:]} {v}" for k, v in r.items() if k.startswith("seam_"))
            print(f"{r['status']} {r['id']}: {r['bytes'] / 1024:.0f} KiB maps, seam {seams or 'n/a'}"
                  + (f", tint base {r['tint_base']}" if "tint_base" in r else ""))
        for p in problems:
            print(f"  FAIL {p}")
        bad = sum(r["status"] == "FAIL" for r in rows)
        failed += bad + (not rows) + bool(problems)
        print(f"{pack}: {len(rows)} finishes, {len(rows) - bad} PASS, {bad} FAIL" + ("" if rows else " (nothing to check)"))
        report[str(pack)] = {"problems": problems, "finishes": rows}
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
