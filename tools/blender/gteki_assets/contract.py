"""Constants shared by every generator. See docs/assets/asset-contract.md."""

CONTRACT = "gteki-asset/0.1"
KIT_VERSION = "0.1.0"

# --- Rights (Owner decision, Issue #123, 2026-10-22) --------------------------------------------
# Original procedural assets are CC-BY-4.0, attribution "GTEki contributors"; AI-generated 2D
# images are CC0-1.0. These constants are the decided values.
RIGHTS_CLASS = "original"  # rights class of everything the kit generates itself
LICENSE_SPDX = "CC-BY-4.0"
ATTRIBUTION = "GTEki contributors"
AI_IMAGE_SPDX = "CC0-1.0"  # AI-generated 2D images (assets/library/source/posters/)

# EMBED_SPDX is the single switch for writing license_spdx / rights_class / attribution into the
# manifest and every GLB's extras.gteki, and for replacing the "UNDECIDED" strings below
# (LICENSE, the GLB copyright). The AO rollout rebuild turned it on and committed the new GLBs,
# both manifests and the new hashes together. See docs/assets/asset-contract.md.
EMBED_SPDX = True  # on since the AO rollout rebuild (#160)

LICENSE_UNDECIDED = "UNDECIDED — original GTEki work; repository licence pending Owner decision"
LICENSE_DECIDED = f"{LICENSE_SPDX} — original GTEki work; attribution: {ATTRIBUTION}"
LICENSE = LICENSE_DECIDED if EMBED_SPDX else LICENSE_UNDECIDED  # value unchanged while the switch is off

GLB_COPYRIGHT_UNDECIDED = "GTEki (original work; licence pending Owner decision)"
GLB_COPYRIGHT_DECIDED = f"{ATTRIBUTION}. {LICENSE_SPDX}"
GLB_COPYRIGHT = GLB_COPYRIGHT_DECIDED if EMBED_SPDX else GLB_COPYRIGHT_UNDECIDED  # GLB asset.copyright


def rights_fields(license_spdx=None):
    """The machine-readable rights keys; empty while EMBED_SPDX is off so that no bytes change."""
    if not EMBED_SPDX:
        return {}
    return {"license_spdx": license_spdx or LICENSE_SPDX, "rights_class": RIGHTS_CLASS, "attribution": ATTRIBUTION}


PROVENANCE = "original procedural geometry and textures; see assets/library/PROVENANCE.md"
FIDELITY = "generic kit; not a replica of any operator equipment or station"
NAVIGATION = "none — visual/physical only; routing truth lives in the station graph"

# Station bake roles (contract §10): optional `gteki_role` on the root and VIS_* nodes of dressing pieces.
ROLES = ("barriers", "transport", "stairs_ramps")
# Anchor classes (contract §10): optional `anchor` in a catalog entry, for pieces whose origin is
# not the plain `placement` one; the Godot import test checks the origin by it when present.
ANCHORS = ("linear_run", "edge_anchored", "surface")

# dimension_basis values (contract §3). The kit never claims "station-verified".
GENERIC_TYPICAL = "generic-typical"
SYNTHETIC = "synthetic"

# Node prefixes / suffixes (contract §2).
VIS = "VIS_"
COL = "COL_"
COL_SUFFIX = "-colonly"
SOCKET = "SOCKET_"
LIGHTHINT = "LIGHTHINT_"

# Default texture resolution for the canonical Web GLB; Godot HQ builds pass --tex-res.
DEFAULT_TEX_RES = 1024

# Blender authoring frame (converted to glTF +Y up / front +Z by the exporter):
#   Blender X  -> glTF X   (width, centred)
#   Blender Y  -> glTF -Z  (travel axis: entry at y=0, far end at y=+length)
#   Blender Z  -> glTF Y   (up; walking surface at z=0)


# An asset id is the GLB file name and the root node name: one safe path
# component (no separators, no dots, so never absolute or "..").
ASSET_ID_PATTERN = r"[A-Za-z0-9_][A-Za-z0-9_-]*"


def is_asset_id(value):
    import re

    return isinstance(value, str) and re.fullmatch(ASSET_ID_PATTERN, value) is not None

# Build profiles (contract §8). "full" is the canonical library. "mobile" is a
# derived low-cost tier: static parts merged into one node, materials folded
# into a kit-wide palette, fewer segments, no bevels, lightmap UVs in TEXCOORD_1.
PROFILES = ("full", "mobile")
PALETTE = "gteki_palette"  # opaque palette (also carries emission)
PALETTE_BLEND = "gteki_palette_blend"  # alpha-blended palette (glass)
