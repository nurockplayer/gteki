"""Record the shipped lightmap WebP sizes in the lit GLB sidecar (run by bake_lighting.sh).

    python3 -I stations/ikebukuro/pipeline/record_lightmaps.py

blender_bake_lighting.py rewrites gteki/assets/ikebukuro_b1_lit.meta.json before the WebP files
exist; this step runs after the conversions so the declared sidecar always describes the shipped
files.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), "gteki", "assets")
SHIPPED = ("ikebukuro_b1_lightmap.webp", "ikebukuro_b1_lightmap_2k.webp")


def main():
    path = os.path.join(ASSETS, "ikebukuro_b1_lit.meta.json")
    meta = json.load(open(path))
    meta["shipped_lightmaps"] = {name: {"bytes": os.path.getsize(os.path.join(ASSETS, name))} for name in SHIPPED}
    # Same format as blender_bake_lighting.py writes; temp file + rename so a dev server never reads half a file.
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            f.write(json.dumps(meta, indent=2) + "\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    print("shipped_lightmaps: " + ", ".join(f"{k} {v['bytes']:,} B" for k, v in meta["shipped_lightmaps"].items()))


if __name__ == "__main__":
    main()
