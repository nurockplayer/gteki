"""Seeded, tileable texture synthesis in pure numpy.

Every generator returns float32 arrays in [0, 1] with shape (res, res, C) and
wraps seamlessly (all noise is spectral or toroidal), so the same code produces
identical pixels for a given (name, res, seed) on any machine. No third-party
images are involved.

Conventions:
  * albedo is sRGB-encoded (what glTF baseColorTexture expects),
  * normal maps are OpenGL / glTF convention (+Y green up), tangent space,
  * "orm" packs R=occlusion (1.0), G=roughness, B=metallic like glTF.
"""

import numpy as np

TEXSYNTH_VERSION = 4  # bump when output pixels change, invalidates caches
# Generators that take `hq` = res / the material's canonical res (its size at
# the default 1024 build): 1 in the committed library, 2 at TEX_RES=2048. They
# scale noise relief with it so HQ builds keep the canonical look. The value is
# a cache salt for non-canonical sizes: cache file names become glTF image
# names, so bumping TEXSYNTH_VERSION would rename every embedded image.
HQ_AWARE = {"concrete": 1, "brushed_metal": 1, "painted_metal": 1}  # 1: relief scales with hq


# --------------------------------------------------------------------------- noise


def spectral_noise(res, seed, beta=2.0, aniso=(1.0, 1.0), lowcut=1.0):
    """Tileable fractal noise via 1/f^beta filtered white noise. Returns [0,1]."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((res, res))
    fx = np.fft.fftfreq(res) * res
    fy = np.fft.rfftfreq(res) * res
    kx, ky = np.meshgrid(fy * aniso[0], fx * aniso[1])
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1.0
    filt = 1.0 / np.power(np.maximum(k, lowcut), beta / 2.0)
    filt[0, 0] = 0.0
    out = np.fft.irfft2(np.fft.rfft2(white) * filt, s=(res, res))
    out -= out.min()
    out /= max(out.max(), 1e-8)
    return out.astype(np.float32)


def band_noise(res, seed, freq, width=0.5):
    """Tileable noise concentrated around a spatial frequency (cycles per tile)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((res, res))
    fx = np.fft.fftfreq(res) * res
    fy = np.fft.rfftfreq(res) * res
    kx, ky = np.meshgrid(fy, fx)
    k = np.sqrt(kx * kx + ky * ky)
    filt = np.exp(-((k - freq) ** 2) / (2.0 * (freq * width) ** 2))
    filt[0, 0] = 0.0
    out = np.fft.irfft2(np.fft.rfft2(white) * filt, s=(res, res))
    out -= out.min()
    out /= max(out.max(), 1e-8)
    return out.astype(np.float32)


def normal_from_height(height, strength):
    """Wrap-aware tangent-space normal map (OpenGL +Y) from a height field.

    `strength` is roughly "height units per texel"; larger = bumpier. For features
    drawn at a physical size (scaled with resolution) pass strength * (res / 1024)
    so the slope per metre, and the visible relief, stays the same at HQ.
    """
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * 0.5 * strength
    # Image row 0 is the top (V=1) once saved, so +V is toward smaller row index.
    nx, ny, nz = -dx, dy, np.ones_like(height)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx * inv, ny * inv, nz * inv], axis=-1)
    return (n * 0.5 + 0.5).astype(np.float32)


def wrap_pitch(res, pitch_px_1024):
    """Pitch (texels) nearest the 1024-texel design value that tiles `res` an integer
    number of times, so periodic features stay seamless at every resolution."""
    cycles = max(1, round(1024.0 / pitch_px_1024))
    return res / cycles


def blur_wrap(img, radius):
    """Cheap separable box blur with wraparound (radius in texels)."""
    if radius <= 0:
        return img
    out = img.astype(np.float32)
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for o in range(-radius, radius + 1):
            acc += np.roll(out, o, axis=axis)
        out = acc / (2 * radius + 1)
    return out


def srgb(rgb):
    return np.asarray(rgb, dtype=np.float32)


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a + (b - a) * t


def _stamp_disc(field, cx, cy, r, value, mode="max"):
    """Stamp an anti-aliased disc at (cx, cy) in texels with toroidal wrap."""
    res = field.shape[0]
    ri = int(np.ceil(r)) + 1
    xs = np.arange(int(cx) - ri, int(cx) + ri + 1)
    ys = np.arange(int(cy) - ri, int(cy) + ri + 1)
    gx, gy = np.meshgrid(xs, ys)
    d = np.sqrt((gx + 0.5 - cx) ** 2 + (gy + 0.5 - cy) ** 2)
    cover = np.clip(r - d + 0.5, 0.0, 1.0)
    iy, ix = np.mod(gy, res), np.mod(gx, res)
    if mode == "max":
        field[iy, ix] = np.maximum(field[iy, ix], cover * value)
    return cover, iy, ix


def quantize8(img):
    """The 8-bit values write_png stores for a [0,1] float image."""
    return np.clip(np.asarray(img) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def png_bytes(img, gray=False):
    """Deterministic 8-bit PNG of a [0,1] float image: RGB/RGBA, or with `gray` an HxW greyscale (colour type 0)."""
    import struct
    import zlib

    a = quantize8(img)
    if gray:
        a = a[..., None]
    elif a.ndim == 2:
        a = a[..., None].repeat(3, axis=2)
    h, w, c = a.shape
    color_type = {1: 0, 3: 2, 4: 6}[c]
    if gray:  # smooth maps: per row, the cheapest of the None / Sub / Up filters (sum of |residual|)
        rows = []
        for y in range(h):
            row = a[y]
            sub = row.copy()
            sub[1:] -= row[:-1]
            options = [(0, row), (1, sub)] + ([(2, row - a[y - 1])] if y else [])
            kind, best = min(options, key=lambda o: (np.abs(o[1].astype(np.int8).astype(np.int32)).sum(), o[0]))
            rows.append(bytes([kind]) + best.tobytes())
        raw = b"".join(rows)
    else:
        raw = b"".join(b"\x00" + a[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def write_png(path, img):
    """Minimal deterministic 8-bit RGB/RGBA PNG writer (stdlib only)."""
    with open(path, "wb") as f:
        f.write(png_bytes(img))


def read_png(path):
    """Read a PNG written by `write_png` (8-bit RGB/RGBA, filter 0) as uint8 HxWxC."""
    import struct
    import zlib

    with open(path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    pos, idat, w = 8, b"", None
    while pos < len(data):
        n, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or ctype not in (2, 6) or interlace:
                raise ValueError(f"{path}: only 8-bit RGB/RGBA non-interlaced PNGs are supported")
            c = 3 if ctype == 2 else 4
        elif tag == b"IDAT":
            idat += body
        pos += 12 + n
    rows = np.frombuffer(zlib.decompress(idat), dtype=np.uint8).reshape(h, 1 + w * c)
    if rows[:, 0].any():
        raise ValueError(f"{path}: filtered rows are not supported (write_png uses filter 0)")
    return rows[:, 1:].reshape(h, w, c)


def _out(albedo, normal, rough, metal):
    orm = np.stack([np.ones_like(rough), rough, metal], axis=-1)
    return {"albedo": np.clip(albedo, 0, 1), "normal": np.clip(normal, 0, 1), "orm": np.clip(orm, 0, 1)}


# --------------------------------------------------------------------------- materials


def terrazzo(res, seed, base=(0.78, 0.76, 0.72), chips=((0.35, 0.34, 0.33), (0.93, 0.92, 0.89), (0.55, 0.48, 0.42), (0.20, 0.21, 0.22)), density=1.0):
    """Polished cementitious terrazzo with stone chips. One tile = 1.0 m."""
    rng = np.random.default_rng(seed)
    base = srgb(base)
    cloud = spectral_noise(res, seed + 1, beta=2.6)
    albedo = np.empty((res, res, 3), np.float32)
    albedo[:] = base
    albedo *= (0.94 + 0.08 * cloud)[..., None]
    chip_mask = np.zeros((res, res), np.float32)
    n_chips = int(16000 * density)  # chips per tile (1 m^2), independent of res
    scale = res / 1024.0
    palette = [srgb(c) for c in chips]
    for _ in range(n_chips):
        cx, cy = rng.uniform(0, res, 2)
        r = rng.choice([1.2, 1.8, 2.6, 3.6, 5.5], p=[0.35, 0.3, 0.2, 0.11, 0.04]) * scale
        col = palette[rng.integers(len(palette))] * rng.uniform(0.9, 1.08)
        cover, iy, ix = _stamp_disc(chip_mask, cx, cy, r * rng.uniform(0.8, 1.25), 1.0)
        albedo[iy, ix] = albedo[iy, ix] * (1 - cover[..., None]) + col * cover[..., None]
    fine = spectral_noise(res, seed + 2, beta=0.6)
    albedo *= (0.97 + 0.06 * fine)[..., None]
    height = 0.15 * cloud + 0.05 * fine  # polished: nearly flat, only faint waviness
    normal = normal_from_height(height, strength=0.6 * scale)
    rough = 0.32 + 0.12 * spectral_noise(res, seed + 3, beta=2.0) - 0.06 * chip_mask
    return _out(albedo, normal, rough, np.zeros_like(rough))


def tile_grid(res, seed, tiles=(2, 2), grout_px=6, base=(0.74, 0.74, 0.72), variation=0.035, grout=(0.42, 0.42, 0.41), rough_base=0.45, bevel_px=4, speckle=0.04):
    """Rectangular tile field with grout and per-tile tint/height variation.

    `tiles` = (columns, rows) per texture repeat; e.g. 600 mm porcelain floor
    tiles with a 1.2 m repeat -> tiles=(2, 2).
    """
    rng = np.random.default_rng(seed)
    scale = res / 1024.0
    gp = max(1, int(round(grout_px * scale)))
    bp = max(1, int(round(bevel_px * scale)))
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    tw, th = res / tiles[0], res / tiles[1]
    col_i = np.floor(xx / tw).astype(int)
    row_i = np.floor(yy / th).astype(int)
    lx = xx - col_i * tw
    ly = yy - row_i * th
    edge = np.minimum(np.minimum(lx, tw - lx), np.minimum(ly, th - ly))
    tile_id = row_i * tiles[0] + col_i
    tints = rng.normal(1.0, variation, size=tiles[0] * tiles[1] + 1).astype(np.float32)
    tilt = rng.normal(0.0, 0.25, size=(tiles[0] * tiles[1] + 1, 2)).astype(np.float32)
    in_tile = np.clip((edge - gp * 0.5) / 1.0, 0, 1)
    shoulder = np.clip((edge - gp * 0.5) / bp, 0, 1)
    shoulder = shoulder * shoulder * (3 - 2 * shoulder)
    cloud = spectral_noise(res, seed + 1, beta=2.4)
    fine = spectral_noise(res, seed + 2, beta=0.4)
    base = srgb(base)
    tile_col = base[None, None, :] * tints[tile_id][..., None] * (0.96 + 0.06 * cloud)[..., None]
    tile_col *= (1 - speckle + 2 * speckle * fine)[..., None]
    grout_col = srgb(grout) * (0.9 + 0.2 * cloud)[..., None]
    albedo = lerp(grout_col, tile_col, in_tile)
    lean = (tilt[tile_id][..., 0] * (lx / tw - 0.5) + tilt[tile_id][..., 1] * (ly / th - 0.5)) * 0.02
    height = shoulder * (1.0 + lean) + 0.01 * cloud
    normal = normal_from_height(height, strength=2.5 * scale)
    rough = np.where(in_tile > 0.5, rough_base + 0.08 * cloud, 0.85).astype(np.float32)
    return _out(albedo, normal, rough, np.zeros_like(rough))


def brushed_metal(res, seed, base=(0.62, 0.63, 0.64), rough=0.32, hq=1.0):
    """Brushed stainless: streaks along U."""
    streak = spectral_noise(res, seed, beta=1.6, aniso=(40.0, 1.0), lowcut=2.0)
    cloud = spectral_noise(res, seed + 1, beta=2.5)
    albedo = srgb(base)[None, None, :] * (0.92 + 0.12 * streak + 0.04 * cloud)[..., None]
    height = streak * 0.3
    # streak noise is partly scale-free: sqrt(hq) keeps the relief within ~5 % (HQ_AWARE)
    normal = normal_from_height(height, strength=0.8 * hq ** 0.5)
    r = rough + 0.10 * (streak - 0.5) + 0.06 * cloud
    return _out(albedo, normal, r.astype(np.float32), np.ones_like(r))


def painted_metal(res, seed, base, rough=0.38, orange_peel=0.25, hq=1.0):
    """Powder-coated / enamel steel with faint orange-peel."""
    peel = band_noise(res, seed, freq=180 * res / 1024, width=0.5)
    cloud = spectral_noise(res, seed + 1, beta=2.6)
    albedo = srgb(base)[None, None, :] * (0.975 + 0.04 * cloud)[..., None]
    normal = normal_from_height(peel * orange_peel, strength=1.0 * hq ** 0.5)  # see brushed_metal
    r = rough + 0.05 * (cloud - 0.5)
    return _out(albedo, normal, r.astype(np.float32), np.zeros_like(r))


def concrete(res, seed, base=(0.56, 0.56, 0.55), rough=0.82, hq=1.0):
    rng = np.random.default_rng(seed)
    cloud = spectral_noise(res, seed, beta=2.2)
    fine = spectral_noise(res, seed + 1, beta=0.8)
    pits = np.zeros((res, res), np.float32)
    scale = res / 1024.0
    for _ in range(900):
        cx, cy = rng.uniform(0, res, 2)
        _stamp_disc(pits, cx, cy, rng.uniform(0.6, 2.2) * scale, 1.0)
    albedo = srgb(base)[None, None, :] * (0.86 + 0.2 * cloud + 0.06 * fine - 0.25 * pits)[..., None]
    height = 0.4 * cloud + 0.2 * fine - 0.6 * pits
    normal = normal_from_height(height, strength=1.2 * hq)  # HQ_AWARE
    r = rough + 0.08 * (fine - 0.5)
    return _out(albedo, normal, r.astype(np.float32), np.zeros_like(r))


def linear_spandrel(res, seed, pitch_px=102, base=(0.86, 0.86, 0.85), rough=0.42):
    """Aluminium linear ceiling strips (pitch 100 mm per 1 m repeat), grooves along U."""
    scale = res / 1024.0
    p = wrap_pitch(res, pitch_px)
    yy = np.mgrid[0:res, 0:res][0].astype(np.float32)
    ph = np.mod(yy, p) / p
    groove = np.clip(1.0 - np.abs(ph - 0.5) * 2.0 / 0.08, 0, 1)  # thin slot in the middle
    crown = 0.5 - 0.5 * np.cos(ph * 2 * np.pi)
    cloud = spectral_noise(res, seed, beta=2.4)
    streak = spectral_noise(res, seed + 1, beta=1.4, aniso=(30.0, 1.0), lowcut=2.0)
    albedo = srgb(base)[None, None, :] * (1.0 - 0.75 * groove + 0.03 * cloud)[..., None] * (0.97 + 0.04 * streak)[..., None]
    height = 0.3 * crown - 1.0 * groove
    normal = normal_from_height(height, strength=3.0 * scale)
    r = rough + 0.1 * groove + 0.05 * (streak - 0.5)
    return _out(albedo, normal, r.astype(np.float32), np.full_like(r, 0.85))


def tactile(res, seed, kind="dots", base=(0.93, 0.74, 0.06), rough=0.55):
    """Tactile walking-surface indicator block, one block (300 mm) per repeat.

    Pattern geometry follows the widely published JIS T 9251 layout family:
    `dots` = 5x5 truncated domes (warning), `bars` = 4 elongated bars along V
    (direction). Values are generic-typical, not measured at any station.
    """
    scale = res / 1024.0
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    u, v = (xx + 0.5) / res, (yy + 0.5) / res  # 0..1 over 300 mm
    h = np.zeros((res, res), np.float32)
    if kind == "dots":
        pitch = 1.0 / 5.0
        cu = (np.floor(u / pitch) + 0.5) * pitch
        cv = (np.floor(v / pitch) + 0.5) * pitch
        d = np.sqrt((u - cu) ** 2 + (v - cv) ** 2) * 300.0  # mm
        top_r, base_r = 11.0, 13.0  # mm; ~22 mm top, slight batter
        h = np.clip((base_r - d) / (base_r - top_r), 0, 1)
    else:
        pitch = 1.0 / 4.0
        cu = (np.floor(u / pitch) + 0.5) * pitch
        du = np.abs(u - cu) * 300.0
        dv = np.minimum(v, 1 - v) * 300.0  # bars stop short of block edges
        ends = np.clip((dv - 12.0) / 3.0, 0, 1)
        h = np.clip((19.0 - du) / 2.5, 0, 1) * ends
    h = h * h * (3 - 2 * h)
    # block joint: small groove at the repeat boundary
    edge = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)) * 300.0
    joint = np.clip(1.0 - edge / 1.2, 0, 1)
    fine = spectral_noise(res, seed, beta=0.8)
    cloud = spectral_noise(res, seed + 1, beta=2.4)
    albedo = srgb(base)[None, None, :] * (0.92 + 0.06 * cloud + 0.03 * fine + 0.05 * h - 0.45 * joint)[..., None]
    height = h * 1.0 - 0.4 * joint + 0.02 * fine
    normal = normal_from_height(height, strength=5.0 * scale)
    r = rough - 0.12 * h + 0.06 * (fine - 0.5) + 0.3 * joint
    return _out(albedo, normal, r.astype(np.float32), np.zeros_like(r))


def rubber_grip(res, seed, base=(0.09, 0.09, 0.09), pitch_px=64):
    """Ribbed rubber / anti-slip stair nosing, ribs along U."""
    scale = res / 1024.0
    p = wrap_pitch(res, pitch_px)
    yy = np.mgrid[0:res, 0:res][0].astype(np.float32)
    ph = np.mod(yy, p) / p
    rib = 0.5 + 0.5 * np.cos(ph * 2 * np.pi)
    fine = spectral_noise(res, seed, beta=0.6)
    albedo = srgb(base)[None, None, :] * (0.9 + 0.2 * fine)[..., None]
    normal = normal_from_height(rib * 1.0 + 0.05 * fine, strength=4.0 * scale)
    r = 0.7 + 0.1 * fine
    return _out(albedo, normal, r.astype(np.float32), np.zeros_like(r))


def escalator_tread(res, seed, base=(0.22, 0.22, 0.23), pitch_px=40):
    """Cleated aluminium escalator step tread, cleats along V (direction of travel)."""
    scale = res / 1024.0
    p = wrap_pitch(res, pitch_px)
    xx = np.mgrid[0:res, 0:res][1].astype(np.float32)
    ph = np.mod(xx, p) / p
    cleat = np.clip(1.0 - np.abs(ph - 0.5) * 2 / 0.55, 0, 1)
    cleat = cleat * cleat * (3 - 2 * cleat)
    cloud = spectral_noise(res, seed, beta=2.2)
    albedo = srgb(base)[None, None, :] * (0.55 + 0.6 * cleat + 0.05 * cloud)[..., None]
    normal = normal_from_height(cleat, strength=5.0 * scale)
    r = 0.55 - 0.25 * cleat + 0.05 * cloud
    return _out(albedo, normal, r.astype(np.float32), np.full_like(r, 0.9))


GENERATORS = {
    "terrazzo": terrazzo,
    "tile_grid": tile_grid,
    "brushed_metal": brushed_metal,
    "painted_metal": painted_metal,
    "concrete": concrete,
    "linear_spandrel": linear_spandrel,
    "tactile": tactile,
    "rubber_grip": rubber_grip,
    "escalator_tread": escalator_tread,
}
