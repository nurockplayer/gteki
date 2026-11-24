# Partial first capture — 2026-11-24 JST

Job depato-ikb-ai-r13b failed after completing origin/main baseline walks and four candidate desktop next walks plus four comparison frames. Source SHA c0b854ff33c5e50845a1eaf30d16100b6ec63e94. Exact failure: `Sunshine top-band sign is not fully backed by its facade`. The unsuccessful 6 m sign setting is not an acceptance result.

Desktop next Seibu walk contrast 7.178761; look contrast 5.761496, facade/sky 0.661482. P'PARCO walk contrast 6.896013; look contrast 7.719980, facade/sky 0.557577. Main baseline evidence is in ../r13-main/. x37/x38 pass both directions; x18/x22 reproduce main's failures. Phone candidate and Sunshine frames were not reached.

The final permitted capture uses a 5 m Sunshine sign centred at y=251 rather than y=253. Direct GLB ray checks at the six sign corners/midpoints confirm that rectangle stays on the original facade; the original-centre size diagnostic is retained in sunshine-fit.json. Weight 800 and coverage 0.25–0.55 are unchanged. x35 heading is centred on the tower at 94.2 degrees, with ordinary look-up pitch 0.42 radians and the real follow lens. Roof-frame checks now project actual highest roof vertices, rather than extending the whole complex's ground footprint artificially to roof height.
