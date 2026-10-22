"""Extract PLATEAU ubld (CityGML LOD4.1) surfaces into a station-local ENU JSON.

Usage: python3 -I extract_plateau_ubld.py <input.gml> <output.json>

Stdlib only. Coordinates: EPSG:6697 (JGD2011 lat, lon + orthometric height m)
-> local tangent plane ENU (metres) around ORIGIN. x = east, y = north,
z = orthometric height (TP, metres) unchanged, i.e. ORIGIN h = 0.

Heights are orthometric, not ellipsoidal. Over this ~400 m footprint the
geoid undulation is effectively constant, so treating them as ellipsoidal
for the horizontal ENU conversion introduces < 1 mm error.

Nothing here infers topology. It only re-expresses source polygons.
"""
import hashlib
import json
import os
import math
import sys
import xml.etree.ElementTree as ET

ORIGIN = {"lat": 35.7297, "lon": 139.7114, "h_m": 0.0}

# GRS80 (JGD2011 ellipsoid)
A = 6378137.0
F = 1 / 298.257222101
E2 = F * (2 - F)

GML = "{http://www.opengis.net/gml}"
BLDG = "{http://www.opengis.net/citygml/building/2.0}"
GRP = "{http://www.opengis.net/citygml/cityobjectgroup/2.0}"
URO = "{https://www.geospatial.jp/iur/uro/3.2}"
XLINK = "{http://www.w3.org/1999/xlink}"


def ecef(lat, lon, h):
    la, lo = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return (
        (n + h) * math.cos(la) * math.cos(lo),
        (n + h) * math.cos(la) * math.sin(lo),
        (n * (1 - E2) + h) * math.sin(la),
    )


_O = ecef(ORIGIN["lat"], ORIGIN["lon"], 0.0)
_LA, _LO = math.radians(ORIGIN["lat"]), math.radians(ORIGIN["lon"])


def to_enu(lat, lon, h):
    x, y, z = ecef(lat, lon, 0.0)
    dx, dy, dz = x - _O[0], y - _O[1], z - _O[2]
    e = -math.sin(_LO) * dx + math.cos(_LO) * dy
    n = (
        -math.sin(_LA) * math.cos(_LO) * dx
        - math.sin(_LA) * math.sin(_LO) * dy
        + math.cos(_LA) * dz
    )
    # Horizontal from the tangent plane; vertical keeps the source height.
    return [round(e, 3), round(n, 3), round(h, 3)]


def ring(lr):
    pl = lr.find(GML + "posList")
    v = list(map(float, pl.text.split()))
    pts = [to_enu(v[i], v[i + 1], v[i + 2]) for i in range(0, len(v), 3)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def polygons(el):
    """All gml:Polygon under el as {id, outer, holes}. Skips xlink references."""
    out = []
    for p in el.iter(GML + "Polygon"):
        ext = p.find(GML + "exterior/" + GML + "LinearRing")
        if ext is None:
            continue
        holes = [ring(i) for i in p.findall(GML + "interior/" + GML + "LinearRing")]
        out.append({"id": p.get(GML + "id"), "outer": ring(ext), "holes": holes})
    return out


def tag(e):
    return e.tag.split("}")[1]


def main(src, dst):
    raw = open(src, "rb").read()
    root = ET.fromstring(raw)
    ub = root.find(".//" + URO + "UndergroundBuilding")
    group = root.find(".//" + GRP + "CityObjectGroup")
    out = {
        "schema": "gteki.plateau-ubld-extract/0",
        "source": {
            "file": src.rsplit("/", 1)[-1],
            "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw),
            "crs": "EPSG:6697 (JGD2011 geographic 3D: lat, lon, orthometric height)",
            "license": "PLATEAU Site Policy 「３．著作権について」に拠る; modified: reprojected and re-encoded",
        },
        "frame": {
            "type": "ENU local tangent plane",
            "origin": ORIGIN,
            "axes": "x=east m, y=north m, z=orthometric height m (TP)",
            "ellipsoid": "GRS80",
        },
        "group": {
            "id": group.get(GML + "id") if group is not None else None,
            "name": group.findtext(GML + "name") if group is not None else None,
        },
        "building": {
            "id": ub.get(GML + "id"),
            "creationDate": ub.findtext("{http://www.opengis.net/citygml/2.0}creationDate"),
            "buildingID": ub.findtext(".//" + URO + "buildingID"),
            "lodType": ub.findtext(".//" + URO + "lodType"),
        },
        "shell": [],
        "rooms": [],
        "installations": [],
    }
    for bb in ub.findall(BLDG + "boundedBy"):
        for s in bb:
            out["shell"].append({"type": tag(s), "id": s.get(GML + "id"), "polygons": polygons(s)})
    for ii in ub.findall(BLDG + "interiorBuildingInstallation"):
        for s in ii:
            out["installations"].append({
                "id": s.get(GML + "id"),
                "scope": "building",
                "function": s.findtext(BLDG + "function"),
                "polygons": polygons(s),
            })
    for room in ub.iter(BLDG + "Room"):
        r = {"id": room.get(GML + "id"), "surfaces": [], "openings": []}
        for c in room:
            if tag(c) == "boundedBy":
                for s in c:
                    r["surfaces"].append({"type": tag(s), "id": s.get(GML + "id"), "polygons": polygons(s)})
                    for op in s.findall(BLDG + "opening"):
                        for o in op:
                            r["openings"].append({
                                "type": tag(o), "id": o.get(GML + "id"),
                                "host": s.get(GML + "id"), "polygons": polygons(o),
                            })
            elif tag(c) == "roomInstallation":
                for s in c:
                    out["installations"].append({
                        "id": s.get(GML + "id"),
                        "scope": r["id"],
                        "function": s.findtext(BLDG + "function"),
                        "polygons": polygons(s),
                    })
        out["rooms"].append(r)

    # Opening polygons are also emitted inside their host surface by some writers;
    # keep them only under "openings" so they are not rendered twice.
    for r in out["rooms"]:
        op_ids = {p["id"] for o in r["openings"] for p in o["polygons"]}
        for s in r["surfaces"]:
            s["polygons"] = [p for p in s["polygons"] if p["id"] not in op_ids]

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    def count(items):
        return sum(len(i["polygons"]) for i in items)

    print(json.dumps({
        "sha256": out["source"]["sha256"],
        "shell_polys": count(out["shell"]),
        "rooms": [
            {"id": r["id"][-5:],
             "surfaces": {s["type"]: len(s["polygons"]) for s in r["surfaces"]},
             "openings": {o["type"]: len(o["polygons"]) for o in r["openings"]}}
            for r in out["rooms"]
        ],
        "installations": {i["id"][-12:]: len(i["polygons"]) for i in out["installations"]},
    }, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
