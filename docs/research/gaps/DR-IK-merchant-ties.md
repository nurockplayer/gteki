# DR-IK-MER: printed entrance ties for Ikebukuro B1 merchants (#209 data asks)

- Asked by: merchant lead, 2026-10-28 03:00 JST, for [`docs/assets/merchant-scene-inventory-2026-10-28.md`](../../assets/merchant-scene-inventory-2026-10-28.md) section 5 (PR #580).
- Checked: 2026-10-28 03:00–03:30 JST. Desk read of the official access pages (page text only, default curl, no images or maps read).
- Rule: facts only (OD-34 precedent). A printed route sentence is a fact about which gate or exit an entrance is reached from; the wording is not copied into the game. Positions read off a map image would be tier P and are not used here.
- Mapping to scene graph node ids is left to the reader; this note names gates and exits as printed.

## 1. Ties found

| Merchant | Printed tie (facts) | Gate / exit named | Strength | Source |
|---|---|---|---|---|
| ルミネ池袋 | Reached 「JR池袋駅南改札、正面右手よりすぐ」. The page gives B1 インフォメーション; nothing finer | JR 南改札 (public side) | Relative only, as before; no finer printed position | MER-01 |
| 池袋ショッピングパーク (ISP) | **From 丸ノ内線 中央通路東改札:** on leaving, 池袋ショッピングパーク メトロ口 (南館, by ポンパドウル) is immediately on the left | Metro 中央通路東改札 → ISP メトロ口 | Strong: "でるとすぐ左手側" | MER-02 |
| ISP | **From 西武池袋線 1階改札:** go down stair 36 beside 池袋駅東口（南） opposite the gate; at the foot turn right (keep left of the passage centre); about 10 m on, メトロ口 is on the left; ISP sign hangs from the passage ceiling | Seibu 1階改札 → stair 36 → ISP メトロ口 (~10 m printed) | Strong; same メトロ口 as above | MER-02 |
| ISP | **From JR 北改札:** turn right; pass the いけふくろう statue; do not take the stairs up, follow the underground passage; down a short escalator into ISP レンガ通り (right 南館, left 北館) | JR 北改札 → いけふくろう → short escalator → レンガ通り | Medium: sequence, no distances | MER-02 |
| 東武ホープセンター | From JR 中央改札, Tobu 中央改札 / 1F 改札 (stairs down), Metro 中央通路西改札 / 南通路西改札: "exit and go along the underground passage towards 西口"; from 西通路東改札 "left along the underground passage"; 「池袋駅西口より階段で地下1Fへ」 | Gates named; no entrance or exit number | Weak: direction only (already DR-IK-08) | MER-03 |
| エチカ池袋 | 「東京メトロ池袋駅構内」 only; floor guide lists 区画 numbers whose positions exist only on a map image | none | None (map image would be tier P) | MER-04 |
| 西武池袋本店 | 西武池袋線 「地下1階改札口から徒歩すぐ」; JR 「南改札口から徒歩すぐ」; Metro (丸ノ内・有楽町) 「東口方面改札口から徒歩約3分」; 池袋駅 東口直結 | Seibu B1 gate, JR 南改札 | Weak for the east passage: no B1 door named on 中央通路 east or 北通路 | MER-05 |

## 2. Against the three asks

1. **ルミネ池袋 finer position:** no facts-only source gives more than 「南改札、正面右手よりすぐ」. Field item FC-MER-01 (field list T1) settles which opening it is.
2. **エチカ / ISP / ホープセンター ties:** ISP has two strong ties to one entrance, **ISP メトロ口**: right outside Metro 中央通路東改札 (left side), and ~10 m from the foot of stair 36 (Seibu 1階改札 side). It also prints a route from JR 北改札 by いけふくろう into レンガ通り. ホープセンター: direction only. エチカ: none.
3. **East passage (中央通路 east → 北通路 → east):** the only printed tie found is the ISP JR 北改札 route (いけふくろう, then a short escalator into レンガ通り). Whether that route runs along the scene's east passage is a map question, not settled here. 西武池袋本店 prints no B1 door on that passage. No tie to the openings around JR 南改札 except ルミネ池袋 and 西武 (「南改札口から徒歩すぐ」, no side given).

## 3. Sources

| id | Page | Operator | URL | Read | Terms |
|---|---|---|---|---|---|
| MER-01 | アクセス | ルミネ池袋 | https://www.lumine.ne.jp/ikebukuro/access/ | 2026-10-28 | facts-only (as #580) |
| MER-02 | アクセス | 池袋ショッピングパーク | https://www.web-isp.co.jp/access/ | 2026-10-28 | https://www.web-isp.co.jp/terms/ §3 bars reuse of the site's text and images without consent; facts stated in it are not content reuse → facts-only |
| MER-03 | アクセス・駐車場 | 東武ホープセンター | https://tobuhopecenter.jp/info/access/ | 2026-10-28 | as DR-IK-08 |
| MER-04 | 交通アクセス / フロアガイド | エチカ池袋 (Metro Properties) | https://www.metropro-sc.jp/echika-ikebukuro/shop/access.jsp , …/shop/floor.jsp | 2026-10-28 | as DR-IK-13 |
| MER-05 | アクセス・駐車場 | 西武池袋本店 | https://www.sogo-seibu.jp/ikebukuro/access/ | 2026-10-28 | facts-only (sogo-seibu precedent, #578) |
