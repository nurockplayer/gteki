# #221 fix-3 cause — 2026-11-05 17:49 JST

The 25 m horizon was misclassified as an opening. These flights already have pitched roofs.
Cone probes hit surrounding ceilings, shell sides and steps; forward rays follow the incline.
Every original ray hits existing geometry within 60.88 m; all hits remain underground (Y ≤ -4.70 m).
Direct upward rays hit shell roofs at 10%, 50%, 90% and 100% of every climb.

| Flight | Misses at 25 m | Misses at 250 m | Distance of formerly missed hits | Cause |
| --- | ---: | ---: | --- | --- |
| e:2768d162a2 | 129/171 | 0/171 | 25.008–45.579 m | Ray stops before existing finish; upper-end roof is present. |
| e:fc787100b1 | 140/154 | 0/154 | 25.045–46.282 m | Ray stops before existing finish; upper-end roof is present. |
| e:abdb4369e9 | 120/122 | 0/122 | 25.042–59.329 m | Ray stops before existing finish; upper-end roof is present. |
| e:d1463e426f | 69/97 | 0/97 | 25.029–46.282 m | Ray stops before existing finish; upper-end roof is present. |
| e:06a78a8f61 | 64/90 | 0/90 | 25.024–46.282 m | Ray stops before existing finish; upper-end roof is present. |
| e:6113a2285c | 57/79 | 0/79 | 25.101–60.876 m | Ray stops before existing finish; upper-end roof is present. |
| e:7628a98a51 | 68/73 | 0/73 | 25.004–57.830 m | Ray stops before existing finish; upper-end roof is present. |

No streetLimit clipping, lift exemption, or missing upper-end roof was found at the tested points.
The shell roof is 3.4 m above the steps, measured as 0.95 m above the 2.45 m upward-probe origin.
No builder, plan, data, fixture, test or navmesh gate was changed.
A regression test requiring a newly added upper-end roof cannot fail on this baseline: that roof exists.
The required ≤5% miss rate at 25 m would demand extra geometry inside already enclosed sightlines.
Lead decision needed: correct the probe range/classification or supply an actual opening to repair.

Commands: baseline-probe.ts and diagnose.ts via orb-test --memory 3g --cpus 2 --out .qa/221.
Results: before-gap.log PASS; diagnosis.log PASS diagnosis. Raw rays and cone hits are in the adjacent JSON evidence.
