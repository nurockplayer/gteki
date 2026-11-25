# Shinjuku JR scene plan

Evidence read 2026-11-26 JST. This is the `?next=1` plan for the JR data in [jr.json](jr.json).

## Facts to carry into the scene

- Keep the B1F underground gate groups, the 1F platforms, and the two separate 2F paid concourses at South and New South. The East–West Free Passage is outside JR fares. Its opening postdates S03, and the historic S03 East/West gate points predate the relocation. [Shinjuku Ward project record](https://www.city.shinjuku.lg.jp/soshiki/toshikei01_002133.html)
- Keep 16 numbered track faces on eight islands. In order, the pairs are 1/2, 3/4, 5/6, 7/8, 9/10, 11/12, 13/14 and 15/16. The last two pairs each carry a Yamanote face and a Chūō–Sōbu Local face. S03 supplies the track and service facts, including the two Narita Express entries absent from the game's search data. The Tobu timetable adds the through limited express on 5/6. [S03 receipt](../../../../docs/gis/acquisitions/tokyo-s03-zip.json) · [Tobu timetable](https://www.tobu.co.jp/pdf/timetable/time-table_01_kudari.pdf?202603=)
- Keep Central West and Central West (Keio Exit) distinct from the Keio paid transfer. The two Odakyu paid transfers also have distinct thresholds. The dataset pairs each physical gate's endpoint records by `poiId`. The `fareArea` field identifies which side belongs to JR, Keio, Odakyu or the public network. Keep the existing POI IDs. The Central West POI retains its historic S03 exit-only label in baseline search. The preview treats it as a public crossing based on the later station records. [Ward gate map](https://www.city.shinjuku.lg.jp/content/000423322.pdf) · [2025 JST gate-use study](https://www.jstage.jst.go.jp/article/journalcpij/61/3/61_11027/_article/-char/ja)
- In the data, `from` and `to` name adjacent endpoints in the representative preview. The graph uses bidirectional links for preview walking. An `evidence` connector records a dated device type. Its landing, direction of operation and live availability still need verification. Preserve the access groups shown by the lift evidence. In particular, tracks 5/6 have a lift from New South, and a paid step-free transfer to South goes via a Saikyō/Shōnan–Shinjuku island. For the B1F walk to 11/12 use a representative approach via Central Passage 2. [Ward lift project](https://www.city.shinjuku.lg.jp/content/000292080.pdf) · [DPI accessibility report](https://dpi-japan.org/blog/workinggroup/traffic/jr%E6%96%B0%E5%AE%BF%E9%A7%85-2%E3%81%A4%E7%9B%AE%E3%81%AE%E3%83%90%E3%83%AA%E3%82%A2%E3%83%95%E3%83%AA%E3%83%BC%E3%83%AB%E3%83%BC%E3%83%88%E3%81%8C%E5%87%BA%E6%9D%A5%E3%81%BE%E3%81%97/) · [JR works corroboration](https://www.jreast.co.jp/info/2025/20251125_to01.pdf)
- Start the integration replay at the existing public E27 B1 junction `n:9ff85d09ae4e40469ec227099d95c775`. Have `rail-scaffold-shinjuku` supply the preview public approach and station-frame tie to JR West Gate. Author the JR gate positions, level elevations and platform geometry after that tie. The JSON leaves those fields null. S03 approximate gate points are search context, and the held navigation receipt has zero routable gate pairs. [S03 position ruling](../../../../docs/gis/decisions/2026-10-24-s03-positions-ruling.md) · [Held S03 graph](../../../../docs/gis/s03/nav-graph-2450f32f7a247690beee.json)

## Scene runs

Each row fits one run of at most 50 minutes once its integration input is ready. Use lane-owned `scene/rail/jr-*.ts` paths. The Shinjuku integration lane owns public seams and shared scene, graph, and POI wiring.

| Run | Track faces | Deliverable |
| --- | --- | --- |
| SJ-JR2 | 13/14 | West Gate fare threshold, first B1F paid landing, lift to 1F, and one island with Chūō–Sōbu and inner-loop Yamanote signs. |
| SJ-JR3 | 15/16 | Adjacent island with outer-loop Yamanote and Chūō–Sōbu labels. Add the East and Central East paid approaches to the B1F network. |
| SJ-JR4 | 11/12 | Takao-bound Chūō Rapid island and the B1F Central Passage 2 approach. Add both distinct Central West thresholds. |
| SJ-JR5 | 7/8 | Tokyo-bound Chūō Rapid island and Central Passage lift. |
| SJ-JR6 | 9/10 | Chūō limited-express island and its B1F connections. |
| SJ-JR7 | 1/2 | First Saikyō/Shōnan–Shinjuku island and the 2F South/East South gate group. |
| SJ-JR8 | 3/4 | Second Saikyō/Shōnan–Shinjuku island and the separate New South paid concourse with its three gates. |
| SJ-JR9 | 5/6 | Narita Express and Tobu through-express island. Add the New South vertical access and the representative B1F approach. Ask integration to register preview destinations for the two faces, whose baseline `poiId` is null. |
| SJ-JR10 | 1–16 | Finish the remaining paid links in the table and the JR sides of the three paid transfer gates. Run public-gate-to-platform coverage and hand over the external transfer endpoints to the Keio and Odakyu lanes. |

For each island, build one walkable island mesh with two numbered platform edges, adjacent track beds, collision and wayfinding. Use E27's edge, fare fence and identity behaviour as reference. Defer train operation. Load JR geometry near the approach under `?next=1`. Measure ≤30 draws per visible floor and ≤60,000 added triangles per slice, including both floors visible during transitions. Check the cold phone load against 1,500 ms.

Exercise the new routes in both directions on phone and desktop. A public approach crosses one JR fare boundary, reaches the correct numbered edge through a continuous paid path, and cannot bypass the gate. Keio and Odakyu far endpoints remain inside their separate fare areas. The integration lane checks existing E27 routes and zero flag-off golden camera changes.
