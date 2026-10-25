import type { LocalizedText } from "@gteki/schema";
import type { paceReadout } from "./explorer/guidePace.ts";

type PaceReadout = ReturnType<typeof paceReadout>;

export type Lang = "ja" | "en";

const STRINGS = {
  ja: {
    minimap: "ミニマップ",
    minimapPlayerUp: "キャラクターの向きが上",
    minimapNorthUp: "北を上に固定",
    minimapCollapse: "ミニマップを折りたたむ",
    minimapShow: "ミニマップを表示",
    minimapFloorUnknown: "階不明",
    minimapSchematic: "概略歩行経路（実際の構内図ではありません）",
    minimapDestination: (floor: string) => `目的地のある階：${floor}`,
    minimapNextFloor: (floor: string, mode: string) => `${mode}${floor}へ`,
    minimapMode: {
      walk: "歩いて", stairs: "階段で", escalator: "エスカレーターで", elevator: "エレベーターで",
      ramp: "スロープで", moving_walkway: "動く歩道で", gate: "改札を通って",
    },
    tagline: "駅を探して、歩いて下見する",
    station: "駅",
    from: "出発地",
    to: "目的地",
    fromPlaceholder: "出口・改札・地点を検索",
    toPlaceholder: "出口・トイレ・ホームなどを検索",
    swap: "入れ替え",
    stepFree: "段差なし",
    unpaidOnly: "改札外のみ",
    strictHours: "営業時間が記載されたもののみ",
    startHere: "ここから出発",
    avatarHere: "現在のアバター位置（仮想）",
    searchOnly: "検索のみ（入口未確認）",
    shopNoRoute: "この店舗への道案内はまだありません（位置未確認）",
    shopSearchOnly: "位置未確認・道案内なし",
    /** An approximate, search-display-only point (#463): the ± radius shown, never used for directions. */
    approximatePosition: (m: number) => `おおよその位置（±${m} m）・経路案内には使いません`,
    /** An approximate POI's floor is a label match, not a surveyed floor (#463). */
    floorUnverified: (label: string) => `${label}（階は未確認）`,
    /** A store's printed brand directory (#419): unverified, with the date its listing was checked. */
    tenantAsOf: (date: string) => `店舗情報（${date} 時点・未確認）`,
    /** The route ends at the store entrance; floors inside the store are not modelled. */
    tenantFloorsNotGuided: "店内の階は案内しません",
    /** English-only marker: a store's floor label is quoted exactly as printed, not a station floor. */
    asPrinted: "（原文どおり）",
    noResults: "該当なし",
    route: "ルート",
    minutes: (m: number) => `約${m}分`,
    waiting: (m: number) => `うち待ち約${m}分`,
    meters: (m: number) => `${m}m`,
    floors: (n: number) => (n === 0 ? "同じ階" : `${n}回の階移動`),
    guide: "ガイド開始",
    walk: "自由に歩く",
    overview: "全体表示",
    pause: "一時停止",
    resume: "再開",
    exitGuide: "ガイド終了",
    guidePrev: "前の案内",
    guideNext: "次の案内",
    guidePrevTitle: "前の案内（[ / PageUp）",
    guideNextTitle: "次の案内（] / PageDown）",
    reverseRoute: "逆向きのルート",
    searchAgain: "もう一度検索",
    guideTier: { walk: "歩く", run: "走る", fast: "早送り" },
    guideSpeedLabel: (tier: string, r: PaceReadout) => `${tier} ${r.approx ? "≈" : ""}${r.pace} m/s`,
    guideSpeedAria: (tier: string, r: PaceReadout) =>
      r.approx
        ? `ガイド速度: ${tier}。通路では最大${r.top} m/s、このルートの平均は約${r.pace} m/s（エスカレーター・階段・改札は現実的な速度）`
        : `ガイド速度: ${tier}。最大${r.top} m/s`,
    firstPerson: "一人称",
    graphOverlay: "経路網",
    soundOn: "音声オン",
    soundOff: "音声オフ",
    arrived: "目的地に到着しました",
    noRoute: "データ上で確認できたルートがありません",
    noRouteWhy: {
      no_path: "データ上で確認できた通路だけでは到達できません。条件（段差なし・改札外・営業時間）を見直すか、未調査区間がある可能性があります。",
      unknown_start: "出発地が経路網にありません。",
      unknown_goal: "目的地に、データ上で確認できた入口がありません。",
      start_equals_goal: "出発地と目的地が同じです。",
      search_limit: "探索が上限に達しました。ルートの有無は不明です（到達できないとは限りません）。",
    } as Record<string, string>,
    noPath: {
      one: (option: string) => `「${option}」をオンにしたままでは、データ上で確認できたルートがありません。`,
      unsurveyed: {
        stepFree: (all: boolean) => `見つかった経路は、段差の有無が未調査の通路を${all ? "通ります" : "含みます"}。`,
        unpaidOnly: (all: boolean) => `見つかった経路は、改札の内外が未調査の通路を${all ? "通ります" : "含みます"}。`,
        strictHours: (all: boolean) => `見つかった経路は、営業時間が未確認の通路を${all ? "通ります" : "含みます"}。`,
      } as Record<string, (all: boolean) => string>,
      knownStepFree: (all: boolean) => `見つかった経路は、階段・エスカレーターなど段差のある通路を${all ? "通ります" : "含みます"}。`,
      none: "すべての条件をオフにしても、データ上で確認できた通路ではこの2地点がつながりません。未調査区間がある可能性があります。",
      endpoint: {
        origin: { inside: "出発地は改札内にあります。", unknown: "出発地が改札外にあるか確認できません。" },
        destination: { inside: "目的地は改札内にあります。", unknown: "目的地が改札外にあるか確認できません。" },
        rule: (option: string) => `「${option}」は、改札外と確認できる地点の間だけ案内します。`,
      },
      any: (options: string) => `次のどれか1つをオフにすると経路が見つかります: ${options}`,
      all: (options: string) => `${options}をすべてオフにすると経路が見つかります。`,
      /** The station records nothing the option could pass on: missing data, not a known barrier. */
      noData: {
        stepFree: "この駅にはバリアフリー情報がありません。",
        strictHours: "この駅には営業時間の情報がありません。",
      } as Record<string, string>,
      unknown: "どの条件が原因か判定できませんでした。",
      relax: (option: string) => `「${option}」をオフにする`,
      relaxAll: "すべてオフにして再検索",
      avoidModes: "避ける移動手段",
      joiner: "・",
    },
    unknownHours: "営業時間未確認",
    unknownWheelchair: "車いす可否未確認",
    unknownSteps: "段差有無未確認",
    unknownPaid: "改札内外未確認",
    unknownAccess: "通行条件の根拠なし",
    unknownFare: "改札境界未確認",
    freshnessUnknown: "情報時点不明",
    undatedSources: "日付不明の出典",
    expired: "有効期限切れの出典",
    timeWindow: "時間帯制限あり",
    stale: "情報が古い可能性",
    paidCrossing: "改札を通過",
    synthetic: "合成データ — 実在の駅案内ではありません",
    syntheticShort: "合成",
    realCandidate: "公開データ由来・机上確認のみ（現地未確認）",
    /** Fixed route-card line: no station records an on-site check (there is no such field), so it is always said. */
    deskChecked: "机上確認のみ（現地未確認）",
    freshness: "データ時点",
    /** The route card's dates: the oldest source it rests on, and the desk check of its evidence (#203 B5). */
    oldestSource: "最古の出典",
    deskCheckedOn: "机上確認日",
    dateJoiner: "／",
    /** The time estimate's assumed speeds, read from the router (#203 B6). */
    paceNote: (walk: number, stairs: number) => `所要時間は徒歩${walk} m/s・階段${stairs} m/sで計算（ガイドは独自の速度で進みます）`,
    /** A known stairs edge: not "wheelchair access unknown" (#203 B8). */
    routeStairs: "階段あり",
    /** A graph node with no POI is never shown by its raw id (#203 B11). */
    unnamedPoint: "名称未登録の地点",
    stairFootLabel: (name: string) => `${name}（階段下）`,
    /** GTEki-made wayfinding signs are generated from the graph, not surveyed positions (#203 B14). */
    generatedSigns: "看板は経路データから自動配置しています（実際の現地の看板位置ではありません）",
    sources: "出典",
    /** #491 / OD-22: endpoint sources name the origin/destination; they are never evidence of the path. */
    nameEvidence: "POI名の出典（経路の根拠ではありません）",
    credits: "出典",
    creditsLabel: "データの出典表示",
    /** Modification disclosure required by PDL / CC BY when a source was processed. */
    modified: "加工して作成",
    /** #26 / #122: facts-only sources have no licence to show; the wording specified in #122. */
    factsOnly: "ライセンスなし・事実のみ参照（複製なし）",
    rightsDecision: "権利判断",
    assetDerivations: "3D素材の加工内容",
    dataFileDerivations: "データファイルの出典と加工",
    derivationDetails: "加工の詳細",
    symbolicHeight: "高さは表示用の推定です",
    coverage: "カバー範囲",
    gaps: "未整備・要調査",
    /** #130: plain-language rights labels for the Coverage dialog (the internal rights enum is never shown). */
    rightsReusable: "条件付きで再利用可",
    rightsOwnerOverride: "ライセンス未確認・オーナー判断により公開",
    rightsReference: "参照のみ（公開データには使用しない）",
    rightsRestricted: "利用制限あり（公開データには使用しない）",
    rightsUnverified: "権利未確認（公開データには使用しない）",
    validationFailed: "駅データが検証に失敗したため表示しません（安全側）",
    loading: "読み込み中…",
    identitySide: (exit: string, landmark: string) => `${exit}側：${landmark}`,
    identitySideSeparator: " ・ ",
    identityUnconfirmed: "未確認",
    sceneFallback: "駅の3Dシーンを読み込めず、経路網表示（L0）に切り替えました",
    controlsHint: "WASD/矢印で移動・Shiftで走る・ドラッグで視点",
    touchHint: "左で移動（端まで倒すと走る）・右ドラッグで視点",
    noIndoorPositioning: "屋内測位は行いません。出発地を選んでください。",
    operators: "事業者",
    options: "オプション",
    close: "閉じる",
    searchCount: (n: number) => `${n}件の候補`,
    routeFound: (m: number, min: number) => `ルートが見つかりました：${m}m、約${min}分`,
    liveSeparator: "。",
    coverageStatus: { routable: "経路あり", visual_only: "表示のみ", unverified: "未確認", excluded: "対象外" } as Record<string, string>,
    /** Guide mascot lines (#132): fixed text per event kind, never interpolated with route facts. */
    mascot: {
      arrival: "着いたよ！おつかれさま！",
      arrivalConnector: "ガイドはここまでだよ。このあとのことは、わたしにはわからないの。",
      noPath: {
        no_path: "確認できた道だけでは、つながらなかったの。",
        unknown_start: "その出発地は、わたしにはわからないの。別の場所を選んでね。",
        unknown_goal: "その目的地への入口は、わたしにはわからないの。",
        start_equals_goal: "出発地と目的地が同じだよ。",
        search_limit: "調べきれなかったの。道があるかどうか、わたしにはわからないよ。",
        other: "うまく案内できなかったの。くわしいことは、わたしにはわからないよ。",
      } as Record<string, string>,
      routeUnknowns: "まだ確認できていないところがあるの。そこは、わたしにはわからないよ。バッジを見てね。",
      searchEmpty: "ほかのことばで探してみよう！",
      turn: "つぎの案内は、となりに出ているよ！",
      loadError: "駅のデータを読み込めなかったの。ほかの駅を選んでみてね。",
      sceneFallback: "3Dが表示できなかったから、線の図で見てね。",
      /** Names the actual `to` field label. */
      startHint: "行きたい場所を『目的地』で探してね。",
    },
    language: "English",
  },
  en: {
    minimap: "Minimap",
    minimapPlayerUp: "Player facing up",
    minimapNorthUp: "North up",
    minimapCollapse: "Collapse minimap",
    minimapShow: "Show minimap",
    minimapFloorUnknown: "Floor unknown",
    minimapSchematic: "Schematic walk graph (not a floor plan)",
    minimapDestination: (floor: string) => `Destination floor: ${floor}`,
    minimapNextFloor: (floor: string, mode: string) => `To ${floor} ${mode}`,
    minimapMode: {
      walk: "on foot", stairs: "by stairs", escalator: "by escalator", elevator: "by elevator",
      ramp: "by ramp", moving_walkway: "on the moving walkway", gate: "through the ticket gate",
    },
    tagline: "Find it in the station, then walk it",
    station: "Station",
    from: "From",
    to: "To",
    fromPlaceholder: "Search exits, gates, places",
    toPlaceholder: "Search exits, toilets, platforms…",
    swap: "Swap",
    stepFree: "Step-free",
    unpaidOnly: "Outside gates only",
    strictHours: "Only places with listed hours",
    startHere: "Start here",
    avatarHere: "Current avatar position (virtual)",
    searchOnly: "Search only (entrance not verified)",
    shopNoRoute: "No directions to this shop yet (location not verified).",
    shopSearchOnly: "Location not verified · no directions",
    /** An approximate, search-display-only point (#463): the ± radius shown, never used for directions. */
    approximatePosition: (m: number) => `Approximate position (±${m} m) · not used for directions`,
    /** An approximate POI's floor is a label match, not a surveyed floor (#463). */
    floorUnverified: (label: string) => `${label} (floor unverified)`,
    /** A store's printed brand directory (#419): unverified, with the date its listing was checked. */
    tenantAsOf: (date: string) => `Store directory as printed (${date}, unverified)`,
    /** The route ends at the store entrance; floors inside the store are not modelled. */
    tenantFloorsNotGuided: "Floors inside the store are not guided",
    asPrinted: "(as printed)",
    noResults: "No matches",
    route: "Route",
    minutes: (m: number) => `~${m} min`,
    waiting: (m: number) => `incl. ~${m} min waiting`,
    meters: (m: number) => `${m} m`,
    floors: (n: number) => (n === 0 ? "same level" : `${n} level change${n > 1 ? "s" : ""}`),
    guide: "Start guide",
    walk: "Walk freely",
    overview: "Overview",
    pause: "Pause",
    resume: "Resume",
    exitGuide: "End guide",
    guidePrev: "Previous instruction",
    guideNext: "Next instruction",
    guidePrevTitle: "Previous instruction ([ or PageUp)",
    guideNextTitle: "Next instruction (] or PageDown)",
    reverseRoute: "Reverse route",
    searchAgain: "Search again",
    guideTier: { walk: "Walk", run: "Run", fast: "Fast" },
    guideSpeedLabel: (tier: string, r: PaceReadout) => `${tier} ${r.approx ? "≈" : ""}${r.pace} m/s`,
    guideSpeedAria: (tier: string, r: PaceReadout) =>
      r.approx
        ? `Guide speed, ${tier}: up to ${r.top} m/s in open corridors; this route averages about ${r.pace} m/s (escalators, stairs and gates keep realistic speeds)`
        : `Guide speed, ${tier}: ${r.top} m/s`,
    firstPerson: "First person",
    graphOverlay: "Network",
    soundOn: "Sound on",
    soundOff: "Sound off",
    arrived: "You have arrived",
    noRoute: "No route confirmed in the surveyed data",
    noRouteWhy: {
      no_path: "Passages confirmed in the surveyed data don't connect these points. Relax step-free / outside-gates / hours, or the link may not be surveyed yet.",
      unknown_start: "The start is not on the network.",
      unknown_goal: "The destination has no entrance confirmed in the surveyed data.",
      start_equals_goal: "Start and destination are the same.",
      search_limit: "The search hit its work limit: whether a route exists is unknown (not that there is none).",
    } as Record<string, string>,
    noPath: {
      one: (option: string) => `No route confirmed in the surveyed data with "${option}" on.`,
      unsurveyed: {
        stepFree: (all: boolean) => `The connection found ${all ? "uses" : "includes"} passages whose step-free access is not surveyed.`,
        unpaidOnly: (all: boolean) => `The connection found ${all ? "uses" : "includes"} passages whose gate side is not surveyed.`,
        strictHours: (all: boolean) => `The connection found ${all ? "uses" : "includes"} passages whose hours are not verified.`,
      } as Record<string, (all: boolean) => string>,
      knownStepFree: (all: boolean) => `The connection found ${all ? "uses" : "includes"} stairs, escalators or passages not step-free.`,
      none: "Even with every option off, passages confirmed in the surveyed data don't connect these points; the link may not be surveyed yet.",
      endpoint: {
        origin: { inside: "The start is inside the ticket gates.", unknown: "The start is not known to be outside the ticket gates." },
        destination: { inside: "The destination is inside the ticket gates.", unknown: "The destination is not known to be outside the ticket gates." },
        rule: (option: string) => `"${option}" only routes between points known to be outside the gates.`,
      },
      any: (options: string) => `Turning off any one of these finds a route: ${options}`,
      all: (options: string) => `Turning off all of ${options} finds a route.`,
      noData: {
        stepFree: "This station has no step-free data.",
        strictHours: "This station has no opening-hours data.",
      } as Record<string, string>,
      unknown: "Couldn't determine which option is responsible.",
      relax: (option: string) => `Turn off "${option}"`,
      relaxAll: "Turn all off and retry",
      avoidModes: "Avoided modes",
      joiner: " / ",
    },
    unknownHours: "Hours unverified",
    unknownWheelchair: "Wheelchair access unknown",
    unknownSteps: "Steps unknown",
    unknownPaid: "Paid/unpaid unknown",
    unknownAccess: "No access evidence",
    unknownFare: "Fare boundary unknown",
    freshnessUnknown: "Data date unknown",
    undatedSources: "Undated sources",
    expired: "Source validity ended",
    timeWindow: "Time-restricted",
    stale: "Possibly outdated",
    paidCrossing: "Passes a ticket gate",
    synthetic: "Synthetic data — not real station guidance",
    syntheticShort: "Synthetic",
    realCandidate: "From open data; desk-checked only, not verified on site",
    deskChecked: "Desk-checked against maps and surveys; not verified on site",
    freshness: "Data as of",
    oldestSource: "Oldest source",
    deskCheckedOn: "desk-checked",
    dateJoiner: " · ",
    paceNote: (walk: number, stairs: number) => `Time assumes walking ${walk} m/s and stairs ${stairs} m/s; the guide moves at its own pace`,
    routeStairs: "Stairs",
    unnamedPoint: "Unnamed point",
    stairFootLabel: (name: string) => `${name} (stair foot)`,
    generatedSigns: "Signs are placed from the route data, not at the real sign positions",
    sources: "Sources",
    nameEvidence: "POI name evidence (not route evidence)",
    credits: "Credits",
    creditsLabel: "Data credits",
    modified: "modified",
    /** Proposed English equivalent of the #26 line; adds no claim beyond the Japanese. */
    factsOnly: "No licence; cited for facts only (not reproduced)",
    rightsDecision: "Rights decision",
    assetDerivations: "3D asset derivations",
    dataFileDerivations: "Data files: sources and derivations",
    derivationDetails: "Derivation details",
    symbolicHeight: "Heights are display estimates",
    coverage: "Coverage",
    gaps: "Gaps & survey needs",
    /** #130: plain-language rights labels for the Coverage dialog (the internal rights enum is never shown). */
    rightsReusable: "Reusable with conditions",
    rightsOwnerOverride: "Published under the Owner's decision; licence unconfirmed",
    rightsReference: "Reference only (not used in published data)",
    rightsRestricted: "Restricted (not used in published data)",
    rightsUnverified: "Rights unverified (not used in published data)",
    validationFailed: "Station data failed validation and is not shown (fail-safe)",
    loading: "Loading…",
    identitySide: (exit: string, landmark: string) => `${exit} side: ${landmark}`,
    identitySideSeparator: " · ",
    identityUnconfirmed: "unconfirmed",
    sceneFallback: "Station 3D scene failed; showing the network view (L0)",
    controlsHint: "WASD/arrows to move · Shift to run · drag to look",
    touchHint: "Left thumb to move (push to the edge to run) · drag right side to look",
    noIndoorPositioning: "No indoor positioning. Choose where you start.",
    operators: "Operators",
    options: "Options",
    close: "Close",
    searchCount: (n: number) => `${n} result${n === 1 ? "" : "s"}`,
    routeFound: (m: number, min: number) => `Route found: ${m} m, about ${min} minute${min === 1 ? "" : "s"}`,
    liveSeparator: ". ",
    coverageStatus: { routable: "routable", visual_only: "visual only", unverified: "unverified", excluded: "excluded" } as Record<string, string>,
    /** Guide mascot lines (#132): fixed text per event kind, never interpolated with route facts. */
    mascot: {
      arrival: "We're here! Nice work!",
      arrivalConnector: "The guide ends here. I can't tell you what comes after.",
      noPath: {
        no_path: "The paths I've verified don't connect these two places.",
        unknown_start: "I don't know that start. Please pick another place.",
        unknown_goal: "I don't know an entrance for that destination.",
        start_equals_goal: "Start and destination are the same place.",
        search_limit: "I couldn't finish searching, so I don't know if there's a way.",
        other: "I couldn't guide this one, and I don't know the details.",
      } as Record<string, string>,
      routeUnknowns: "Some parts aren't confirmed yet, and I don't know them. Check the badges.",
      searchEmpty: "Let's try other words!",
      turn: "Your next step is shown next to me!",
      loadError: "I couldn't load this station's data. Please try another station.",
      sceneFallback: "The 3D view didn't load, so here's the line map.",
      /** Names the actual `to` field label. */
      startHint: "Search for where you want to go under \"To\".",
    },
    language: "日本語",
  },
};

export type Strings = (typeof STRINGS)["ja"];

export function strings(lang: Lang): Strings {
  return STRINGS[lang] as Strings;
}

/** Pick the best text for `lang`, falling back to ja then anything. */
export function pick(texts: LocalizedText[] | undefined, lang: Lang): string {
  if (!texts || texts.length === 0) return "";
  return (texts.find((t) => t.lang === lang) ?? texts.find((t) => t.lang === "ja") ?? texts[0]!).text;
}

/**
 * Coverage text is station data (#259): a legacy plain string, or localized text. The requested language wins,
 * then ja, then the first entry; a plain string is shown exactly as the station wrote it.
 */
export function coverageText(value: string | LocalizedText[] | undefined, lang: Lang): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : pick(value, lang);
}

export function initialLang(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "ja" || q === "en") return q;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}
