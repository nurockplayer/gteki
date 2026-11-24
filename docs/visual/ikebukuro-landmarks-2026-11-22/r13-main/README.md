# origin/main connector baseline — 2026-11-24 JST

Source `936bfe0f8353722bb929ad0b6fafeebe45a24c28`, flag off, desktop 1440×900 and phone 390×844. The snapshot was extracted from origin/main and used its own frozen offline pnpm installation. Runtime connectorRoutePaths and normal walkPath input hook match the PR capture. Per-frame timestamps are UTC in walks.json; job depato-ikb-ai-r13b ran 2026-11-24 06:29:47–06:33:32 JST. Its final failure is the subsequent candidate's oversized Sunshine sign, after this main baseline completed.

Both devices reproduce the prior PR failures exactly (ENU metres):

- x18 outward waypoint index 22: target (-93, 154.5, 30.545), avatar (-93.163795, 155.074787, 30.544950), stuck=true. Outward fails and the unteleported return fails at return index 0: target (-98.5, 156, 33.168), avatar (-93.271960, 155.120694, 30.545000).
- x22 outward passes; return waypoint index 26: target (71.5, 116.5, 28.45), avatar (72.290861, 117.492505, 28.450420), stuck=true. This is combined leg index 53 used in the earlier report.

Raw walks.json contains initial pose/avatar/camera controls, source SHA, paths, both directions, every result and position, plus four corresponding screenshots. Candidate r13 desktop next reproduces these exact first failures too. The existing r12-retry set records both devices and flags. The lead routes these inherited connector failures to a separate breakage issue; they no longer block #1512.
