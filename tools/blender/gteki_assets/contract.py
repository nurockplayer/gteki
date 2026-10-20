"""Constants shared by every generator. See docs/assets/asset-contract.md."""

CONTRACT = "gteki-asset/0.1"
KIT_VERSION = "0.1.0"

LICENSE = "UNDECIDED — original GTEki work; repository licence pending Owner decision"
PROVENANCE = "original procedural geometry and textures; see assets/library/PROVENANCE.md"
FIDELITY = "generic kit; not a replica of any operator equipment or station"
NAVIGATION = "none — visual/physical only; routing truth lives in the station graph"

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
