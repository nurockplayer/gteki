# J11 — YouTube Creative Commons station sound candidates

Ambience candidates for the station sound layers (J11), collected 2026-11-21 JST from YouTube
videos whose licence is Creative Commons Attribution (reuse allowed). Every file below was
checked against the video's `license` field; videos under YouTube's standard licence were never
downloaded. Freesound/Wikimedia sources are collected separately and are not duplicated here.

- Tooling: `yt-dlp 2026.10.26` searches (`ytsearch` and the YouTube search result pages for
  Japanese and English queries such as 新宿駅 環境音, 大江戸線 発車, Tokyo subway ambience,
  エスカレーター 音, 自動改札 音), then one metadata fetch per candidate. Default tool
  User-Agent throughout; no cookies and no sign-in.
- Licence check: each candidate was kept only if its metadata `license` field read, verbatim,
  `Creative Commons Attribution license (reuse allowed)` (the watch page shows
  「クリエイティブ・コモンズ著作権表示必須ライセンス（再利用を許可する）」). YouTube's help page
  links that option to CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/. The field
  itself names no version. `REUSE.toml` records this as `LicenseRef-YouTube-CC-BY-4.0`
  (pointer: `LICENSES/LicenseRef-YouTube-CC-BY-4.0.txt`), because third-party files keep their own
  terms rather than resolving to the repository's CC-BY-4.0 grant.
- Rights ruling (lead, 2026-11-21 JST): segments marked UNKNOWN-melody / UNKNOWN-voice are
  audition-only and may not ship until a separate rights check. The uploader's CC BY covers the
  video upload; it does not cover third-party melodies or recorded announcements inside it.
- Changes made to every file: one segment cut from the source's audio track, re-encoded to Opus
  96 kbps stereo 48 kHz. Nothing else was applied (no noise reduction, EQ or level matching).
- Licence obligation: attribution to the channel, the video title and the licence link, plus an
  indication of the changes. Attribution lines ready for the credits screen are given per file.
- Upload dates are YouTube's reported date (US Pacific); they carry no clock time, so the time
  zone is noted rather than a converted clock.

## Best picks

- Street / exit: `shinjuku-street-night-lofiscape` (night, busiest), `shinjuku-street-walk-tokyolife` (daytime).
- Underground concourse / crowd: `station-crowd-binaural-kurumori` (binaural), `tokyo-station-shinkansen-concourse`.
- Ticket gates: `monorail-gate-chiba` (clean normal entry/exit beeps), `ic-gate-hatchonawate`.
- Escalator: `escalator-takashimaya` (hum + department-store announcement, Tokyo), `escalator-announcement-kurashiki` (safety announcement).
- Subway platform: `shinjuku-platform-12`, `takanawa-gateway-platform`.
- Train arrival / departure / doors: `oedo-ushigome-yanagicho`, `oedo-nerima-departure` (Toei Oedo first).
- Platform PA: `hakata-platform-pa`, `beppu-arrival-pa`.

## A. Shinjuku street / exit ambience

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `shinjuku-street-night-lofiscape.opus` | [Insta360 One X2 \| Walking Around Shinjuku in Tokyo at night. With neon light. [4K][ASMR][POV]](https://www.youtube.com/watch?v=-dQlSw-OdQM) | LoFi Scape Tokyo | 2020-12-13 (YouTube, PT) | 2:00–4:00 | Night walk from Shinjuku South Exit toward Shinjuku Sanchome; passers-by, traffic, street life | -27.8 LUFS integrated, TP -1.0 dBFS; quiet, good headroom |
| `shinjuku-soundscape-illmilione.opus` | [2018.5.6 0:05 Shinjuku Tokyo SOUNDSCAPE](https://www.youtube.com/watch?v=iz3B2k2Q_aw) | ILLMILIONE | 2018-05-07 (YouTube, PT) | 0:00–1:00 | Shinjuku night street soundscape (recorded 00:05) | -24.0 LUFS, TP -0.2 dBFS |
| `shinjuku-street-walk-tokyolife.opus` | [SHINJUKU TOKYO 4K - Summer Walking Tour in Japan](https://www.youtube.com/watch?v=F43l35P_Fr4) | Tokyo Life | 2026-07-31 (YouTube, PT) | 10:00–11:30 | Daytime summer walk through Shinjuku's busy streets: crowd murmur, traffic, crossing signals | -22.5 LUFS, TP -8.0 dBFS; low peak level |

Attribution: "Insta360 One X2 | Walking Around Shinjuku in Tokyo at night. With neon light." by
LoFi Scape Tokyo, YouTube, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) — trimmed to
2:00–4:00, re-encoded to Opus.
"2018.5.6 0:05 Shinjuku Tokyo SOUNDSCAPE" by ILLMILIONE, YouTube, CC BY 4.0 — trimmed to 0:00–1:00,
re-encoded to Opus.
"SHINJUKU TOKYO 4K - Summer Walking Tour in Japan" by Tokyo Life, YouTube, CC BY 4.0 — trimmed to
10:00–11:30, re-encoded to Opus.

## B. Underground concourse: crowd and footsteps

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `station-crowd-binaural-kurumori.opus` | [バイノーラル?録音take01 駅の雑踏](https://www.youtube.com/watch?v=QMaSoO9lxbU) | クロモリ | 2014-05-31 (YouTube, PT) | 1:00–3:00 | Binaural walk through a crowded station: crowd murmur and footsteps | -20.9 LUFS, TP -3.2 dBFS; true stereo binaural image |
| `shinjuku-underground-passage.opus` | [DSCN8160新宿駅の地下道20180224ドラえもん](https://www.youtube.com/watch?v=DauJDzqoboM) | MIYAGAYAOOTAHARA | 2018-02-25 (YouTube, PT) | 0:00–0:45 | Shinjuku Station underground passage ambience, footsteps | -17.8 LUFS, TP -5.3 dBFS; compact-camera audio, narrow image |
| `tokyo-station-shinkansen-concourse.opus` | [東京駅新幹線ゲート付近の環境音｜フリー音素材](https://www.youtube.com/watch?v=sY0hsSFVYtM) | Hybrid Ambience | 2020-01-15 (YouTube, PT) | 3:30–5:30 | Tokyo Station Shinkansen gate concourse: travellers, wheeled bags, cart impacts, footsteps | -26.0 LUFS, TP -0.7 dBFS; clean PCM-D100 recording |
| `akihabara-gate-concourse.opus` | [秋葉原駅・昭和通り口改札付近の環境音素材](https://www.youtube.com/watch?v=fl3OrFJq4Q8) | Hybrid Ambience | 2020-01-17 (YouTube, PT) | 4:00–5:20 | Akihabara Station Showa-dori gate concourse: crowd, footsteps, passing trains overhead | -19.3 LUFS, TP -2.3 dBFS; UNKNOWN-voice (ambient station announcements may appear in the background) |

Attribution: "バイノーラル?録音take01 駅の雑踏" by クロモリ, YouTube, CC BY 4.0 — trimmed to 1:00–3:00,
re-encoded to Opus.
"DSCN8160新宿駅の地下道20180224ドラえもん" by MIYAGAYAOOTAHARA, YouTube, CC BY 4.0 — trimmed to
0:00–0:45, re-encoded to Opus.
"東京駅新幹線ゲート付近の環境音｜フリー音素材" by Hybrid Ambience, YouTube, CC BY 4.0 — trimmed to
3:30–5:30, re-encoded to Opus.
"秋葉原駅・昭和通り口改札付近の環境音素材" by Hybrid Ambience, YouTube, CC BY 4.0 — trimmed to
4:00–5:20, re-encoded to Opus.

## C. Ticket gates (IC card beeps)

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `monorail-gate-chiba.opus` | [千葉モノレール 日本信号GX-7改札機 動作シーン集](https://www.youtube.com/watch?v=ftMIm6IIR5w) | yoshi | 2023-05-29 (YouTube, PT) | 0:13–1:13 | IC touch: error beeps (expired/insufficient card) and normal entry/exit beeps | -20.6 LUFS, TP +0.6 dBFS; source clips on the beeps |
| `ic-gate-hatchonawate.opus` | [八丁畷駅 JR東日本⇔京急乗換用 IC簡易改札機 動作シーン集](https://www.youtube.com/watch?v=-UHzghAO8n8) | yoshi | 2023-05-19 (YouTube, PT) | 0:15–0:55 | JR/Keikyu transfer IC gate: error and normal touch beeps | -20.1 LUFS, TP -0.7 dBFS; wide level range (error vs normal) |
| `iruca-gate-kotoden.opus` | [ことでん Iruca IC専用簡易改札機 動作シーン集](https://www.youtube.com/watch?v=VGpg1D1_qrs) | yoshi | 2023-04-08 (YouTube, PT) | 0:09–0:53 | Iruca IC gate: error and normal touch beeps | -22.9 LUFS, TP -9.5 dBFS; quiet beeps |

Attribution: "千葉モノレール 日本信号GX-7改札機 動作シーン集" by yoshi, YouTube, CC BY 4.0 —
trimmed to 0:13–1:13, re-encoded to Opus.
"八丁畷駅 JR東日本⇔京急乗換用 IC簡易改札機 動作シーン集" by yoshi, YouTube, CC BY 4.0 — trimmed to
0:15–0:55, re-encoded to Opus.
"ことでん Iruca IC専用簡易改札機 動作シーン集" by yoshi, YouTube, CC BY 4.0 — trimmed to 0:09–0:53,
re-encoded to Opus.

## D. Escalator hum and safety announcement

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `escalator-takashimaya.opus` | [髙島屋のエスカレーター｜環境音素材](https://www.youtube.com/watch?v=r4QiUa6p-UU) | Hybrid Ambience | 2020-03-14 (YouTube, PT) | 0:00–2:00 | Escalator motor hum with heavy low end, footsteps, children's voices, department-store escalator announcement | -23.2 LUFS, TP +0.5 dBFS; strong low rumble, source clips slightly. UNKNOWN-voice (recorded escalator announcement) |
| `escalator-montreal-metro.opus` | [Sounds of an Escalator](https://www.youtube.com/watch?v=vyn0eDOOTOM) | NazmusLabs | 2016-03-19 (YouTube, PT) | 0:00–1:40 | Mechanical escalator sound at Montreal Metro | -26.2 LUFS, TP -2.3 dBFS; hum only, not Tokyo |
| `escalator-announcement-kurashiki.opus` | [くらしきシティプラザ倉敷西ビル エスカレーター放送](https://www.youtube.com/watch?v=SqGd-757rSE) | 岡山電車区 | 2020-11-17 (YouTube, PT) | 0:00–0:42 | Escalator safety announcement (building, not a station), with escalator room tone | -15.4 LUFS, TP -1.4 dBFS; speech dominant. UNKNOWN-voice (recorded announcement) |

Attribution: "髙島屋のエスカレーター｜環境音素材" by Hybrid Ambience, YouTube, CC BY 4.0 — trimmed to
0:00–2:00, re-encoded to Opus.
"Sounds of an Escalator" by NazmusLabs, YouTube, CC BY 4.0 — trimmed to 0:00–1:40, re-encoded to
Opus.
"くらしきシティプラザ倉敷西ビル エスカレーター放送" by 岡山電車区, YouTube, CC BY 4.0 — trimmed to
0:00–0:42, re-encoded to Opus.

## E. Subway platform ambience

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `shinjuku-platform-12.opus` | [【環境音】新宿駅12番線中央快速線ホーム](https://www.youtube.com/watch?v=TOt5gkovrBs) | SkyRail Kyushu Tokyo | 2017-11-23 (YouTube, PT) | 1:00–3:00 | Shinjuku Station platform 12 (Chuo rapid): trains arriving/departing, platform PA | -19.6 LUFS, TP -2.5 dBFS. UNKNOWN-voice/melody (recorded announcements, possible departure melody) |
| `takanawa-gateway-platform.opus` | [高輪ゲートウェイ駅ホーム環境音（フリー）](https://www.youtube.com/watch?v=A27O1OqEX7c) | Hybrid Ambience | 2020-10-03 (YouTube, PT) | 0:10–2:10 | Takanawa Gateway platform: quiet platform tone, Yamanote arrival, English announcement | -31.3 LUFS, TP -11.9 dBFS; very quiet, needs normalising. UNKNOWN-voice (recorded announcements) |
| `subway-platform-white-noise.opus` | [[15min][ world noise No.1] japanese subway train's white noise](https://www.youtube.com/watch?v=1k_GjpDYLjQ) | girafferrz | 2019-09-19 (YouTube, PT) | 1:00–3:00 | Japanese subway platform/train white-noise loop | -23.0 LUFS, TP -6.0 dBFS; steady bed, little variation. UNKNOWN-voice (may include announcements) |

Attribution: "【環境音】新宿駅12番線中央快速線ホーム" by SkyRail Kyushu Tokyo, YouTube, CC BY 4.0 —
trimmed to 1:00–3:00, re-encoded to Opus.
"高輪ゲートウェイ駅ホーム環境音（フリー）" by Hybrid Ambience, YouTube, CC BY 4.0 — trimmed to
0:10–2:10, re-encoded to Opus.
"[15min][ world noise No.1] japanese subway train's white noise" by girafferrz, YouTube, CC BY 4.0
— trimmed to 1:00–3:00, re-encoded to Opus.

## F. Train arrival / departure / doors (Toei Oedo first)

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `oedo-ushigome-yanagicho.opus` | [【No Copyright】 Toei Subway Ōedo Line 12-000 series Train, Ushigome-Yanagicho](https://www.youtube.com/watch?v=-Z2e8lPcix0) | Tama Reco / 多摩レコ | 2021-04-24 (YouTube, PT) | 0:00–1:54 | Oedo Line 12-000 at Ushigome-Yanagicho platform: approach, stop, departure | -17.3 LUFS, TP -3.0 dBFS; uploader notes wind-noise reduction was left on, so the top end is dulled |
| `oedo-nerima-departure.opus` | [都営地下鉄大江戸線 12-000形 12-181F 練馬駅発車](https://www.youtube.com/watch?v=VZJcw4hD62k) | THanamiRailway | 2012-04-27 (YouTube, PT) | 0:00–1:01 | Oedo Line 12-000 departing Nerima: traction and door chime | -11.3 LUFS, TP -2.3 dBFS; loud, compressed. UNKNOWN-melody (door chime) |
| `oedo-ride-ueno-okachimachi.opus` | [【🚇東京遊】都營12-000形行走聲音 - 都營大江戶綫（上野御徒町→門前仲町）](https://www.youtube.com/watch?v=WZFZ2Kd8Buw) | SF's Rail Depot | 2019-09-04 (YouTube, PT) | 5:00–7:00 | In-train Oedo Line 12-000 running sound, station stop and doors | -11.1 LUFS, TP -0.2 dBFS; loud. UNKNOWN-voice (in-car announcements) |
| `chuo-line-shinjuku-arrival.opus` | [前面展望 JR 中央線各駅停車 E231 東中野～新宿](https://www.youtube.com/watch?v=jVACKKxLst8) | 川越 観光 街めぐりKAWAGOE JAPAN | 2020-07-20 (YouTube, PT) | 1:00–3:00 | JR Chuo Line E231 entering Shinjuku platform, departure chime, doors | -24.1 LUFS, TP -1.7 dBFS. UNKNOWN-melody/voice (departure chime, in-car announcements) |
| `odakyu-shinjuku-departure.opus` | [4000形 小田急小田原線 新宿駅発車！](https://www.youtube.com/watch?v=4fCfXE-uzaE) | akka1b353 | 2018-03-24 (YouTube, PT) | 0:30–2:30 | Odakyu 4000 series departing Shinjuku: traction, doors, platform | -11.6 LUFS, TP +1.1 dBFS; loud and clipped. UNKNOWN-melody (possible departure bell) |

Attribution: "【No Copyright】 Toei Subway Ōedo Line 12-000 series Train, Ushigome-Yanagicho" by
Tama Reco / 多摩レコ, YouTube, CC BY 4.0 — trimmed to 0:00–1:54, re-encoded to Opus.
"都営地下鉄大江戸線 12-000形 12-181F 練馬駅発車" by THanamiRailway, YouTube, CC BY 4.0 — trimmed to
0:00–1:01, re-encoded to Opus.
"【🚇東京遊】都營12-000形行走聲音 - 都營大江戶綫（上野御徒町→門前仲町）" by SF's Rail Depot,
YouTube, CC BY 4.0 — trimmed to 5:00–7:00, re-encoded to Opus.
"前面展望 JR 中央線各駅停車 E231 東中野～新宿" by 川越 観光 街めぐりKAWAGOE JAPAN, YouTube,
CC BY 4.0 — trimmed to 1:00–3:00, re-encoded to Opus.
"4000形 小田急小田原線 新宿駅発車！" by akka1b353, YouTube, CC BY 4.0 — trimmed to 0:30–2:30,
re-encoded to Opus.

## G. Platform PA murmur

| File | Source | Channel | Upload | Segment | Contains | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| `hakata-platform-pa.opus` | [【作業用：環境音】JR博多駅在来線ホーム：ベル、アナウンスが鳴り響く](https://www.youtube.com/watch?v=kSwV4AGztnA) | SkyRail Kyushu Tokyo | 2017-04-16 (YouTube, PT) | 1:00–3:00 | Hakata Station platforms 1–4: departure bells, recorded announcements, train movement | -23.6 LUFS, TP -0.7 dBFS; low-fi video audio (144p source). UNKNOWN-voice (recorded announcements) |
| `beppu-arrival-pa.opus` | [別府駅列車音、到着放送、構内アナウンス（環境音）](https://www.youtube.com/watch?v=wkaFv81Xq9c) | SkyRail Kyushu Tokyo | 2017-04-05 (YouTube, PT) | 0:20–2:20 | Beppu Station platforms 1–2: arrival announcements, station PA, trains | -21.4 LUFS, TP -3.3 dBFS. UNKNOWN-voice (recorded announcements) |

Attribution: "【作業用：環境音】JR博多駅在来線ホーム：ベル、アナウンスが鳴り響く" by SkyRail Kyushu
Tokyo, YouTube, CC BY 4.0 — trimmed to 1:00–3:00, re-encoded to Opus.
"別府駅列車音、到着放送、構内アナウンス（環境音）" by SkyRail Kyushu Tokyo, YouTube, CC BY 4.0 —
trimmed to 0:20–2:20, re-encoded to Opus.

## Gaps and open points

- **Escalator safety announcement at a station**: no CC BY video found. `escalator-announcement-kurashiki`
  is a shopping-centre building announcement, `escalator-takashimaya` a department store. Both are
  UNKNOWN-voice (the announcement is a separate recorded work from the CC BY video).
- **Platform PA murmur in Tokyo**: no CC BY clip of a Tokyo platform PA alone turned up within the
  search budget. `shinjuku-platform-12` is Tokyo and carries PA, but it is filed under E because
  trains dominate; the G files are Fukuoka (Hakata, Beppu).
- **Toei Oedo platform announcements**: none found under CC BY; the three Oedo files cover train
  sound, doors and running noise.
- **Melody and voice rights**: departure melodies (発車メロディ), door chimes and recorded
  announcements can be separate works from the video. Every file whose segment may contain them is
  marked UNKNOWN-melody / UNKNOWN-voice above; per the lead's 2026-11-21 JST ruling those are
  audition-only and may not ship until a separate rights check.
- **Source quality**: `odakyu-shinjuku-departure` and `monorail-gate-chiba` hit 0 dBFS in the source
  (TP +1.1 / +0.6 dBFS); `takanawa-gateway-platform` is very quiet (TP -11.9 dBFS). No processing
  was applied beyond the trim and the Opus encode.
- **YouTube access**: some watch-page requests during collection returned HTTP 429 / a bot-check
  page and some stream URLs were SABR-only; the downloads were then made with yt-dlp's
  `web_embedded` client over HLS, still without cookies or sign-in. No download was taken under the
  standard YouTube licence.
