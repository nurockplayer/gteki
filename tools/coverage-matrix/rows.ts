// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// Public POI ownership only. Shared JR gates and the station-wide JR B1 graph repeat per line.
// Unattributed Toei exits stay with S01; E27 owns the original MLIT POIs and graph.
export interface RowSpec {
  label: string;
  station: "ikebukuro" | "shinjuku";
  ids?: string[];
  prefixes?: string[];
  buildings?: string[];
  graph?: boolean;
}

export const rowMap: RowSpec[] = [
  {"label": "池袋 JR 山手線", "station": "ikebukuro", "prefixes": ["jr-"], "graph": true},
  {"label": "池袋 JR 埼京線・湘南新宿ライン", "station": "ikebukuro", "prefixes": ["jr-"], "graph": true},
  {"label": "池袋 東武東上線", "station": "ikebukuro", "prefixes": ["tobu-"]},
  {"label": "池袋 西武池袋線", "station": "ikebukuro", "prefixes": ["seibu-"]},
  {"label": "池袋 Metro 丸ノ内線 M25", "station": "ikebukuro", "prefixes": ["metro-m-"]},
  {"label": "池袋 Metro 有楽町線 Y09", "station": "ikebukuro", "prefixes": ["metro-y-"]},
  {"label": "池袋 Metro 副都心線 F09", "station": "ikebukuro", "prefixes": ["metro-f-", "exit-c"]},
  {"label": "新宿 JR 山手線 (14・15番線)", "station": "shinjuku", "prefixes": ["poi:jreast-gate:"], "ids": ["poi:jreast-platform:14", "poi:jreast-platform:15"]},
  {"label": "新宿 JR 中央線快速・中央本線 (7・8・11・12番線; 特急 9・10)", "station": "shinjuku", "prefixes": ["poi:jreast-gate:"], "ids": ["poi:jreast-platform:7", "poi:jreast-platform:8", "poi:jreast-platform:9", "poi:jreast-platform:10", "poi:jreast-platform:11", "poi:jreast-platform:12"]},
  {"label": "新宿 JR 中央・総武線各停 (13・16番線)", "station": "shinjuku", "prefixes": ["poi:jreast-gate:"], "ids": ["poi:jreast-platform:13", "poi:jreast-platform:16"]},
  {"label": "新宿 JR 埼京線・湘南新宿ライン (1–4番線)", "station": "shinjuku", "prefixes": ["poi:jreast-gate:"], "ids": ["poi:jreast-platform:1", "poi:jreast-platform:2", "poi:jreast-platform:3", "poi:jreast-platform:4"]},
  {"label": "新宿 小田急線", "station": "shinjuku", "prefixes": ["poi:odakyu-", "poi:jreast-odakyu-transfer:"]},
  {"label": "新宿 京王線", "station": "shinjuku", "prefixes": ["poi:keio-", "poi:jreast-keio-transfer:"]},
  {"label": "新宿 京王新線", "station": "shinjuku", "ids": ["poi:keio-gate:1", "poi:keio-gate:2", "poi:keio-gate:3"]},
  {"label": "新宿 都営新宿線 S01", "station": "shinjuku", "prefixes": ["poi:toei-exit:"]},
  {"label": "新宿 都営大江戸線 E27", "station": "shinjuku", "prefixes": ["poi:exit:", "poi:gate:", "poi:platform:", "poi:elevator:", "poi:toilet:"], "graph": true},
  {"label": "新宿 Metro 丸ノ内線 M08", "station": "shinjuku", "prefixes": ["poi:tokyometro-"]},
  {"label": "西武新宿線 (西武新宿駅, separate station)", "station": "shinjuku", "ids": ["poi:sep-seibu-shinjuku"]},
  {"label": "新宿三丁目 (副都心 F13, 丸ノ内 M09, 新宿 S02)", "station": "shinjuku", "ids": ["poi:sep-shinjuku-sanchome"]},
  {"label": "新宿西口 (大江戸 E01)", "station": "shinjuku", "ids": ["poi:sep-shinjuku-nishiguchi"]},
  {"label": "池袋 西武池袋本店", "station": "ikebukuro", "buildings": ["shop-ikb-seibu-honten"], "prefixes": ["shop-ikb-seibu-"]},
  {"label": "池袋 東武百貨店", "station": "ikebukuro", "buildings": ["shop-ikb-tobudept"], "prefixes": []},
  {"label": "池袋 ルミネ池袋", "station": "ikebukuro", "buildings": ["shop-ikb-lumine"], "prefixes": ["shop-ikb-lumine-"]},
  {"label": "池袋 エソラ池袋", "station": "ikebukuro", "buildings": ["shop-ikb-esola"], "prefixes": ["shop-ikb-esola-"]},
  {"label": "池袋 PARCO", "station": "ikebukuro", "buildings": ["shop-ikb-parco"], "prefixes": []},
  {"label": "池袋 Echika", "station": "ikebukuro", "buildings": [], "prefixes": ["shop-ikb-echika-"]},
  {"label": "池袋 ISP (池袋ショッピングパーク)", "station": "ikebukuro", "buildings": ["shop-ikb-isp"], "prefixes": ["shop-ikb-isp-"]},
  {"label": "池袋 東武ホープセンター", "station": "ikebukuro", "buildings": [], "prefixes": ["shop-ikb-hope-"]},
  {"label": "新宿 伊勢丹 本館・メンズ館 (and the B5–B3 promenade levels)", "station": "shinjuku", "buildings": ["shop-sjk-isetan-honkan", "shop-sjk-isetan-mens"], "prefixes": []},
  {"label": "新宿マルイ 本館 / アネックス / メン", "station": "shinjuku", "buildings": ["shop-sjk-marui-honkan", "shop-sjk-marui-annex", "shop-sjk-marui-men"], "prefixes": []},
  {"label": "新宿 高島屋 (タイムズスクエア)", "station": "shinjuku", "buildings": ["shop-sjk-takashimaya"], "prefixes": []},
  {"label": "新宿 京王百貨店", "station": "shinjuku", "buildings": ["shop-sjk-keio"], "prefixes": []},
  {"label": "新宿 小田急百貨店 (西口ハルク)", "station": "shinjuku", "buildings": ["shop-sjk-odakyudept"], "prefixes": []},
  {"label": "新宿 ルミネ1・ルミネ2", "station": "shinjuku", "buildings": ["shop-sjk-lumine1", "shop-sjk-lumine2"], "prefixes": ["shop-sjk-lumine-"]},
  {"label": "新宿 ルミネエスト", "station": "shinjuku", "buildings": ["shop-sjk-lumineest"], "prefixes": ["shop-sjk-lumineest-"]},
  {"label": "新宿 NEWoMan", "station": "shinjuku", "buildings": ["shop-sjk-newoman"], "prefixes": ["shop-sjk-newoman-"]},
  {"label": "新宿 サブナード", "station": "shinjuku", "buildings": ["shop-sjk-subnade"], "prefixes": []},
  {"label": "新宿 小田急エース / 京王モール", "station": "shinjuku", "buildings": [], "prefixes": ["shop-sjk-rec-"]},
  {"label": "新宿 メトロプロムナード", "station": "shinjuku", "buildings": [], "prefixes": ["shop-sjk-metro-"]},
];
