import type { Lang } from "../i18n.ts";

/**
 * The merchant form's own wording (#438 Phase 2). Kept apart from the explorer's `i18n.ts` because the form
 * is a second page: it loads none of the 3D app, and its strings must say plainly that nothing is sent.
 */
const LABELS = {
  ja: {
    title: "店舗情報の登録・確認フォーム",
    intro: "駅の中や近くの店舗の情報をご提供ください。確認できた範囲の事実だけを、店舗提供として掲載します。未確認の情報は「未確認」と表示し、道案内には使いません。",
    notSent: "このページは送信しません。入力内容を JSON ファイルとして保存し、プロジェクト担当者にお渡しください。連絡先は非公開の受付記録にのみ保管します。",
    station: "駅",
    stationPlaceholder: "駅を選んでください",
    nameLabel: "店名（看板のとおり）",
    nameLangLabel: "この表記の言語",
    aliasesLabel: "別名・読み（1行に1つ、店舗が示すものだけ）",
    categoryLabel: "種別",
    category: { shop: "店舗", locker: "ロッカー", atm: "ATM", service: "サービス", toilet: "トイレ" },
    facilityLabel: "施設・館名（例：南館。任意）",
    floorLabel: "階（駅の階から選ぶ）",
    floorPlaceholder: "階を選んでください",
    anchorLabel: "近くの出口・改札（任意）",
    anchorNone: "指定しない",
    entranceLabel: "入口の説明（例：〇〇改札付近。任意）",
    gatesLabel: "改札の内外",
    gates: { inside: "改札内", outside: "改札外", not_sure: "わからない" },
    hoursLabel: "営業時間（任意・原文のまま）",
    hoursAsOfLabel: "その情報の日付",
    urlLabel: "店舗の公式ページ（任意）",
    contactLabel: "連絡先",
    contactKinds: { email: "メール", phone: "電話" },
    consentLabel: "提供した事実を GTEki が掲載・加工・公開できることに同意します（利用条件 版 {version}）。現在の営業状況は掲載しません。",
    errors: "入力の確認",
    none: "入力内容に問題はありません。",
    preview: "受け渡し用 JSON",
    download: "JSON を保存",
    copy: "JSON をコピー",
    copied: "コピーしました",
    problem: {
      "name.required": "店名を入力してください。",
      "name.too_long": "店名が長すぎます（120 文字まで）。",
      "name.lang": "表記の言語を入力してください。",
      "category.invalid": "種別を選んでください。",
      "floor.required": "階を選んでください。",
      "floor.unknown": "その階はこの駅の階一覧にありません。",
      "anchor.unknown": "その出口・改札はこの駅にありません。",
      "anchor.missing": "入口の説明を書くときは、近くの出口・改札も選んでください。",
      "gates.required": "改札の内外を選んでください。",
      "hours.asOf": "営業時間には、その情報の日付を入れてください。",
      "hours.date": "日付は YYYY-MM-DD の形で入れてください。",
      "hours.text": "日付だけでは登録できません。営業時間も入れてください。",
      "url.invalid": "ページの URL は http(s) で始まる必要があります。",
      "contact.required": "連絡先を入力してください。",
      "contact.email": "メールアドレスの形が正しくありません。",
      "contact.phone": "電話番号の桁数を確認してください。",
      "consent.required": "同意の欄にチェックしてください。",
    },
    previewProblem: "問題がなくなるまで、受け渡し用 JSON は作りません。",
    chooseStation: "駅を選ぶと、その駅の階と出口から選べます。",
  },
  en: {
    title: "Shop listing form",
    intro: "Tell us about a shop in or near the station. We publish the facts you confirm, labelled merchant-submitted. Anything unverified is shown as unverified and is never used for directions.",
    notSent: "This page does not send anything. Save the details as a JSON file and hand it to the project. Contact details are kept only in the private acceptance record.",
    station: "Station",
    stationPlaceholder: "Choose a station",
    nameLabel: "Shop name (as printed)",
    nameLangLabel: "Language of that name",
    aliasesLabel: "Aliases / readings (one per line, only what the shop states)",
    categoryLabel: "Category",
    category: { shop: "Shop", locker: "Locker", atm: "ATM", service: "Service", toilet: "Toilet" },
    facilityLabel: "Facility / building (e.g. 南館; optional)",
    floorLabel: "Floor (from the station's own floors)",
    floorPlaceholder: "Choose a floor",
    anchorLabel: "Nearby exit or ticket gate (optional)",
    anchorNone: "None",
    entranceLabel: "Entrance wording (e.g. near the 〇〇 gate; optional)",
    gatesLabel: "Inside or outside the fare gates",
    gates: { inside: "Inside", outside: "Outside", not_sure: "Not sure" },
    hoursLabel: "Hours (optional, as the shop states them)",
    hoursAsOfLabel: "Date this information is from",
    urlLabel: "The shop's own page (optional)",
    contactLabel: "Contact",
    contactKinds: { email: "E-mail", phone: "Phone" },
    consentLabel: "I agree that GTEki may publish, edit and reuse the facts I submit (terms version {version}). Current opening status is not published.",
    errors: "Check these fields",
    none: "No problems found.",
    preview: "JSON to hand over",
    download: "Save JSON",
    copy: "Copy JSON",
    copied: "Copied",
    problem: {
      "name.required": "Enter the shop name.",
      "name.too_long": "The shop name is too long (120 characters).",
      "name.lang": "Enter the language of the name.",
      "category.invalid": "Choose a category.",
      "floor.required": "Choose a floor.",
      "floor.unknown": "That floor is not in this station's floor list.",
      "anchor.unknown": "That exit or gate is not in this station.",
      "anchor.missing": "An entrance wording needs a nearby exit or gate as well.",
      "gates.required": "Choose inside, outside or not sure.",
      "hours.asOf": "Hours need the date the information is from.",
      "hours.date": "Use the date form YYYY-MM-DD.",
      "hours.text": "A date alone is not a listing; enter the hours too.",
      "url.invalid": "The page URL must start with http(s).",
      "contact.required": "Enter a contact.",
      "contact.email": "That does not look like an e-mail address.",
      "contact.phone": "Check the number of digits in the phone number.",
      "consent.required": "Tick the consent box.",
    },
    previewProblem: "The JSON is built once the problems above are fixed.",
    chooseStation: "Choose a station to pick from its own floors and exits.",
  },
} as const;

export type MerchantLabels = (typeof LABELS)[Lang];

export function merchantLabels(lang: Lang): MerchantLabels {
  return LABELS[lang];
}

/** A problem code as the reader's language words it; an unknown code falls back to the code itself. */
export function problemText(lang: Lang, code: string): string {
  const table: Record<string, string> = LABELS[lang].problem;
  return table[code] ?? code;
}

/** The consent sentence with its terms version filled in. */
export function consentText(lang: Lang, version: string): string {
  return LABELS[lang].consentLabel.replace("{version}", version);
}
