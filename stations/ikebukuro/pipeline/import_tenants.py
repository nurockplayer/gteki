"""Import the Tobu Department Store (Ikebukuro) brand directory as a facts-only tenant file.

    python3 -I stations/ikebukuro/pipeline/import_tenants.py
    python3 -I stations/ikebukuro/pipeline/import_tenants.py --check   # fails if outputs would change

Input:  docs/research/merchants/ikebukuro-tobu-dept-tenants.json (860 brands; OD-34 facts-only)
Output: stations/ikebukuro/gteki/tenants.json (gteki.tenants/0.1)
        the floor pages the input cites registered in stations/ikebukuro/data/graph.src.json
        and its generated stations/ikebukuro/gteki/station.json

Only the printed brand name, floor label and category are carried over. Hours, positions, logos
and every other directory field are left out. A row without a printed name, floor or known
source is skipped and counted.

The evidence cites the floor page the input names, so those pages must be registered as
facts-only sources. The converter adds any that are missing, reusing the publisher, decision
record (#377, OD-34) and retrieval time of the store's existing directory source; it inserts
them next to it in both files and leaves every other byte alone. Both outputs are deterministic,
so a re-run is a no-op.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))
SRC = os.path.join(REPO, "docs", "research", "merchants", "ikebukuro-tobu-dept-tenants.json")
GRAPH_SRC = os.path.join(ROOT, "data", "graph.src.json")
STATION = os.path.join(ROOT, "gteki", "station.json")
OUT = os.path.join(ROOT, "gteki", "tenants.json")
DIRECTORY_SOURCE = "tobu-dept-ikebukuro-2026-10"  # the store's top page, already registered
METHOD = "facts-only tenant directory listing (OD-34), UNVERIFIED"


def render(obj, indent=1):
    """The station files' layout: one-space indent steps, decisions on one line (build_station.write_json)."""
    text = json.dumps(obj, ensure_ascii=False, indent=indent)
    return re.sub(r'"decision": \{\n\s+"url": ("[^"]*"),\n\s+"date": ("[^"]*")\n\s+\}',
                  r'"decision": { "url": \1, "date": \2 }', text)


def write(path, text):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def tenant(row, poi_id, checked):
    out = {
        "id": row["id"],
        "poiId": poi_id,
        "names": [{"lang": "ja", "text": row["name"].strip()}],
        "aliases": [{"lang": "ja", "text": a.strip()} for a in row.get("aliases") or [] if a.strip()],
        "floorLabel": [{"lang": "ja", "text": row["floorLabel"].strip()}],
    }
    category = (row.get("category") or "").strip()
    if category:
        out["category"] = [{"lang": "ja", "text": category}]
    out["evidence"] = {"sourceIds": [row["sourceId"]], "method": METHOD, "checkedDate": checked}
    return out


def register_floor_sources(text, research):
    """Insert the floor pages the input cites after the store's directory source; return the new text."""
    data = json.loads(text)
    top = next((s for s in data["sources"] if s["id"] == DIRECTORY_SOURCE), None)
    if top is None:
        sys.exit(f"FAIL: {DIRECTORY_SOURCE} is not registered as a source")
    known = {s["id"] for s in data["sources"]}
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
    if not entries:
        return text, known, 0
    # The directory source is not the last entry, so its closing "  }" is followed by the list comma.
    at = text.index(f'"id": "{DIRECTORY_SOURCE}"')
    end = text.index("\n  }", at) + len("\n  }")
    assert text[end] == ",", f"{DIRECTORY_SOURCE} is the last source; cannot insert after it"
    block = ",\n" + ",\n".join("\n".join("  " + line for line in render(e).split("\n")) for e in entries)
    out = text[:end] + block + text[end:]
    # The insertion must only add those sources, in order.
    expected = []
    for s in data["sources"]:
        expected.append(s)
        if s["id"] == DIRECTORY_SOURCE:
            expected.extend(entries)
    assert json.loads(out)["sources"] == expected, "source insertion corrupted the file"
    return out, known | {e["id"] for e in entries}, len(entries)


def main():
    research = json.load(open(SRC, encoding="utf-8"))
    graph_text, source_ids, added = register_floor_sources(open(GRAPH_SRC, encoding="utf-8").read(), research)
    station_text, station_ids, station_added = register_floor_sources(open(STATION, encoding="utf-8").read(), research)
    assert station_ids == source_ids and station_added == added, "station.json and graph.src.json disagree"
    pois = json.load(open(os.path.join(ROOT, "gteki", "pois.json"), encoding="utf-8"))["pois"]
    poi_id = research["storePoiId"]
    if not any(p["id"] == poi_id and p["category"] == "shop" for p in pois):
        sys.exit(f"FAIL: store POI {poi_id} is not a shop POI in pois.json")

    checked = research["retrievedAt"][:10]
    tenants = []
    skipped = []
    for row in research["tenants"]:
        if not (row.get("name") or "").strip() or not (row.get("floorLabel") or "").strip():
            skipped.append((row.get("id"), "no printed name or floor"))
        elif row.get("sourceId") not in source_ids:
            skipped.append((row.get("id"), f"unknown source {row.get('sourceId')}"))
        else:
            tenants.append(tenant(row, poi_id, checked))

    outputs = (
        (GRAPH_SRC, graph_text),
        (STATION, station_text),
        (OUT, render({"schema": "gteki.tenants/0.1", "tenants": tenants})),
    )
    stale = [(p, text) for p, text in outputs
             if not os.path.exists(p) or open(p, encoding="utf-8").read() != text]
    if "--check" in sys.argv:
        if stale:
            print("FAIL: outputs would change: " + ", ".join(os.path.relpath(p, REPO) for p, _ in stale))
            sys.exit(1)
    else:
        for path, text in stale:
            write(path, text)

    print(f"OK: {len(tenants)} tenants from {len(research['tenants'])} rows, "
          f"{len(skipped)} skipped, {added} floor sources added")
    for tenant_id, reason in skipped:
        print(f"  skip {tenant_id}: {reason}")


if __name__ == "__main__":
    main()
