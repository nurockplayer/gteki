# #220 follow-up drafts

Prepared 2026-11-04 09:07 JST. The code fixes are small; the remaining POI data work belongs to the station lane. Browser evidence is pending.

## Title: QA: finish #220 desktop/375 px visual acceptance on the merged minimap

Capture the same public Ikebukuro/Shinjuku walk and guide states at desktop and 375 px after the small fixes land.
Use the numeric overlap measurements in `.qa/audit.md` alongside screenshots to judge labels, floor text and controls for readability.
Check the mascot, search panel, credits and active joystick in the capture; this worker's brief permits numbers only.
Attach the candidate SHA, CI result and lead review when closing #220. Fullscreen, floor picker, filters and train icons stay separate from this evidence task.

## Title: Ikebukuro: supply evidenced current-floor minimap POI positions

The audited public bundle has 543 POIs but zero records with all of displayPosition, floorId and a connector; its minimap therefore has zero precise POI dots.
Audit source-backed exit, elevator and ticket-gate positions in the Ikebukuro station lane; populate map fields only where the source proves a precise point.
Keep search-only/area-only records and unsurveyed station-level ties unpinned; do not promote their centroids to entrances.
Acceptance: eligible current-floor POIs appear with source evidence, while listings without precise evidence remain searchable without map dots.
This is station-data acquisition/verification work, outside the small shared-UI fixes in this PR.
