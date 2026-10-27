"""Import the Ikebukuro department-store brand directories (Tobu, Seibu) as a facts-only tenant file.

    python3 -I stations/ikebukuro/pipeline/import_tenants.py
    python3 -I stations/ikebukuro/pipeline/import_tenants.py --check   # fails if outputs would change

Input:  docs/research/merchants/ikebukuro-tobu-dept-tenants.json (860 brands; OD-34 facts-only)
        docs/research/merchants/ikebukuro-seibu-honten-tenants.json (307 brands; OD-35 S facts-only, recheck-at-C)
Output: stations/ikebukuro/gteki/tenants.json (gteki.tenants/0.1)
        the floor pages the input cites registered in stations/ikebukuro/data/graph.src.json
        and its generated stations/ikebukuro/gteki/station.json

Only the printed brand name, floor label and category are carried over. Hours, positions, logos
and every other directory field are left out. A row without a printed name, floor or known
source is skipped and counted.

The evidence cites the floor page the input names, so those pages must be registered as
facts-only sources. The converter adds any that are missing after the store's existing
directory source, reusing its publisher, decision record (#377, OD-34) and retrieval time.
A research file whose sources are full records (with a title, e.g. Seibu) has them appended as written.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_station import write_json  # noqa: E402  (the station files' writer: one-space indent, decisions on one line)

ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))
MERCHANTS = os.path.join(REPO, "docs", "research", "merchants")
INPUTS = [os.path.join(MERCHANTS, "ikebukuro-tobu-dept-tenants.json"),
          os.path.join(MERCHANTS, "ikebukuro-seibu-honten-tenants.json")]
GRAPH_SRC = os.path.join(ROOT, "data", "graph.src.json")
STATION = os.path.join(ROOT, "gteki", "station.json")
OUT = os.path.join(ROOT, "gteki", "tenants.json")
DIRECTORY_SOURCE = "tobu-dept-ikebukuro-2026-10"  # the store's top page, already registered
METHOD = "facts-only tenant directory listing (OD-34), UNVERIFIED"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def tenant(row, poi_id, checked):
    out = {
        "id": row["id"],
        "poiId": poi_id,
        "names": [{"lang": "ja", "text": row["name"].strip()}],
        "aliases": [a if isinstance(a, dict) else {"lang": "ja", "text": a.strip()}
                    for a in row.get("aliases") or [] if (a["text"] if isinstance(a, dict) else a).strip()],
        "floorLabel": [{"lang": "ja", "text": row["floorLabel"].strip()}],
    }
    category = (row.get("category") or "").strip()
    if category:
        out["category"] = [{"lang": "ja", "text": category}]
    out["evidence"] = {"sourceIds": [row["sourceId"]], "method": METHOD, "checkedDate": checked}
    return out


def add_floor_sources(file, research):
    """Register the floor pages the input cites after the store's directory source."""
    sources = file["sources"]
    if all("title" in s for s in research["sources"]):
        entries = [s for s in research["sources"] if s["id"] not in {x["id"] for x in sources}]
        sources.extend(entries)
        return {s["id"] for s in sources}, len(entries)
    top = next((s for s in sources if s["id"] == DIRECTORY_SOURCE), None)
    if top is None:
        sys.exit(f"FAIL: {DIRECTORY_SOURCE} is not registered as a source")
    known = {s["id"] for s in sources}
    entries = []
    for s in research["sources"]:
        if s["id"] in known:
            continue
        floor = s["id"].rsplit("-", 1)[-1]
        entries.append({
            "id": s["id"],
            "title": f"東武百貨店 池袋店 フロアガイド {floor}",
            "publisher": top["publisher"],
            "url": s["url"],
            "license": None,
            "rights": "REFERENCE_ONLY",
            "usage": "facts-only",
            "decision": top["decision"],
            "attribution": f"東武百貨店 池袋店 フロアガイド {floor} (facts only, UNVERIFIED; not reproduced)",
            "modified": False,
            "retrievedAt": research["retrievedAt"],
            "datasetDate": None,
            "notes": "Tenant names, printed floors/categories and store IDs only; no descriptive directory text reproduced.",
        })
    at = sources.index(top) + 1
    sources[at:at] = entries
    return {s["id"] for s in sources}, len(entries)


def main():
    graph_src = load(GRAPH_SRC)
    station = load(STATION)
    pois = load(os.path.join(ROOT, "gteki", "pois.json"))["pois"]
    tenants = []
    skipped = []
    added = 0
    rows = 0
    for src in INPUTS:
        research = load(src)
        source_ids, n = add_floor_sources(graph_src, research)
        station_ids, station_n = add_floor_sources(station, research)
        assert station_ids == source_ids and station_n == n, "station.json and graph.src.json disagree"
        added += n
        poi_id = research["storePoiId"]
        if not any(p["id"] == poi_id and p["category"] == "shop" for p in pois):
            sys.exit(f"FAIL: store POI {poi_id} is not a shop POI in pois.json")

        checked = research["retrievedAt"][:10]
        rows += len(research["tenants"])
        for row in research["tenants"]:
            if not (row.get("name") or "").strip() or not (row.get("floorLabel") or "").strip():
                skipped.append((row.get("id"), "no printed name or floor"))
            elif row.get("sourceId") not in source_ids:
                skipped.append((row.get("id"), f"unknown source {row.get('sourceId')}"))
            else:
                tenants.append(tenant(row, poi_id, checked))

    outputs = (
        (GRAPH_SRC, graph_src),
        (STATION, station),
        (OUT, {"schema": "gteki.tenants/0.1", "tenants": tenants}),
    )
    stale = [(path, obj) for path, obj in outputs
             if not os.path.exists(path) or load(path) != obj]
    if "--check" in sys.argv:
        if stale:
            print("FAIL: outputs would change: " + ", ".join(os.path.relpath(p, REPO) for p, _ in stale))
            sys.exit(1)
    else:
        for path, obj in stale:
            write_json(path, obj, indent=1)

    print(f"OK: {len(tenants)} tenants from {rows} rows, "
          f"{len(skipped)} skipped, {added} floor sources added")
    for tenant_id, reason in skipped:
        print(f"  skip {tenant_id}: {reason}")


if __name__ == "__main__":
    main()
