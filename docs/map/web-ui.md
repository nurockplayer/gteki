---
area: web-ui
owner: gteki-fa
updated: 2026-10-26 JST
---
# Web UI (app shell, search, minimap, cards, rail)

## What it does
`apps/web/src/ui/app.ts` is the shell: one `App` class that builds the DOM, owns the state object `s` (station, router, search index, origin, destination, route, guide), and wires the search panel, route sheet, HUD, credit line and coverage dialog around the `Explorer`. Each small module beside it is a pure helper (keyboard rules for comboboxes, minimap geometry, card models, live-region text) with its own test. Language switching (ja and en) and the URL state (`station`, `from`, `to`) are handled here too.

## Main files and functions
- `apps/web/src/ui/app.ts:83-1479` — class App, the whole shell.
- `apps/web/src/ui/app.ts:131-161` — start(): builds the Explorer (click and guide callbacks), sets the panel, minimap and sheet elements, lists stations, opens the station named in the URL or the first real one.
- `apps/web/src/ui/app.ts:165-215` — layout(): the DOM tree (viewport, panel, sheet, HUD, minimap, toast, credit footer).
- `apps/web/src/ui/firstRun.ts:3-26` — FIRST_RUN_KEY, shouldShowFirstRun(), markFirstRunDone(), DEMO_PAIRS and demoPair().
- `apps/web/src/ui/app.ts:233-266` — field(): one search combobox (from or to) with its note and results list.
- `apps/web/src/ui/app.ts:283-353` — openStation(): loads a station through the registry, creates the router and search index, calls `Explorer.loadStation`, then restores from and to.
- `apps/web/src/ui/app.ts:594-682` — renderResults(): typed hits or grouped, routable empty-query suggestions, recent picks, hints and tenant tags.
- `apps/web/src/ui/app.ts:694-710` — setCombo(): combobox open state and ARIA.
- `apps/web/src/ui/app.ts:720-734` — syncPanelMascot(): shares the start_hint visibility condition with the first-visit guide card.
- `apps/web/src/ui/app.ts:675-702` — setOrigin(), setDestination(), swap().
- `apps/web/src/ui/app.ts:775-801` — computeRoute(): `routeBetween`, then the explorer's showRoute and the minimap's setRoute.
- `apps/web/src/ui/app.ts:803-951` — renderSheet(), fillSheet(): the route sheet (steps, no-route text, hours, credits).
- `apps/web/src/ui/app.ts:963-978` — onMode(), renderIdentity().
- `apps/web/src/ui/app.ts:980-1067` — renderHud(): HUD for the current mode.
- `apps/web/src/ui/app.ts:1165-1215` — startGuide(), jumpGuide().
- `apps/web/src/ui/app.ts:1227-1279` — bindGuideKeys(), onGuideStop(), onGuideProgress().
- `apps/web/src/ui/app.ts:1332-1424` — renderCredit(), openCoverage() (coverage dialog).
- `apps/web/src/ui/app.ts:356-379` — startRailRide(): the rail demo entry.
- `apps/web/src/ui/app.ts:1439-1478` — exposeTestHooks(): the `window.__gteki` test hooks.
- `apps/web/src/ui/combobox.ts:22-41` — comboboxKeys(): arrow and enter behaviour; `58-62` isImeKeydown() ignores IME confirm keys; `83-105` inputAria(), optionAria(), applyAria().
- `apps/web/src/ui/minimap.ts:41-736` — class Minimap: circular minimap, floor picker, full-width overlay on tap. `129-187` constructor; `253-293` setStation(); `302-319` setRoute(); `421-486` refresh(); `585-663` renderOverlay(); `666-687` updateMarkers().
- `apps/web/src/ui/minimapGeometry.ts:12-22` — currentFloorId(); `25-40` floorWalkGraph(); `43-47` toMinimap(); `58-84` routeOnFloor(); `102-118` floorTransitions(); `201-214` advanceRouteSeg(); `223-230` rimBearing().
- `apps/web/src/ui/identityCard.ts:54-111` — class StationIdentityView: station identity card and overview; `66-77` showCard(); `81-103` renderOverview().
- `apps/web/src/ui/merchantCard.ts:19-26` — merchantPrecision() (point, area or search); `45-60` merchantCardModel(); `70-96` merchantCardEl().
- `apps/web/src/ui/railTravel.ts:36-39` — railDemoLink(); `41-45` railStationName(). Only the Ikebukuro and Shinjuku keys.
- `apps/web/src/ui/railRideDemo.ts:13-313` — class RailRideDemo: the rail ride modal; `114-169` buildCabin(); `171-202` setStage(); `210-219` arrive(); `289-312` dispose().
- `apps/web/src/ui/labels.ts:13-16` — poiLabel(); `22-25` nodeLabel().
- `apps/web/src/ui/live.ts:25-36` — routeLiveMessage(); `39-41` searchLiveMessage(); `49-71` class LiveRegion, announce().
- `apps/web/src/ui/mascot.ts:51-82` — mascotLine(); `141-224` class MascotSlot.
- `apps/web/src/ui/categoryFilter.ts:13-16` — categoriesIn(), the shop category filter's options.
- `apps/web/src/ui/emptySuggestions.ts:3-8` — SuggestGroup types and from/to category order; `11-41` emptySuggestions(); `44-58` pushRecent(), readRecent(), writeRecent(); `64-69` exampleQueries().
- `apps/web/src/ui/tenantDisplay.ts:11-27` — tenantLabel(), tenantResultTags().
- `apps/web/src/ui/noRouteText.ts:6-28` — isUnlocatedShop(), poiNoteText(), noRouteText().
- `apps/web/src/ui/unverifiedSteps.ts` — `unverifiedSources()`: source titles for unverified edges in a route or instruction.
- `apps/web/src/ui/motion.ts:11` — watchReducedMotion(), the reduced-motion query.
- `apps/web/src/hours.ts:15-23` — printedHours(): a shop's printed hours, hidden when older than 180 days.
- `apps/web/src/noPath.ts:20-50` — noPathView(): the wording for a no-path cause.
- `apps/web/src/credits.ts:26-34` — sourceCredit(); `57-67` dataFileCredits(); `98-116` overrideCredits(); `119-127` rightsLabel().
- `apps/web/src/i18n.ts:435-458` — strings(), pick(), initialLang(). The Strings type is the ja dictionary's shape.

## Data flow
- Search: a keystroke in `field()` calls `this.s.search.search(q, ...)` (search index from @gteki/search, created in `openStation`). Hits go to `renderResults`, then the chosen one to `setOrigin` or `setDestination`.
- Route: `computeRoute` runs `routeBetween` from @gteki/navigation. A success goes to `Explorer.showRoute`, `minimap.setRoute` and `renderSheet`. A failure goes to `noRouteText` and `explainNoPathBetween`, then to the sheet and the mascot.
- Guide: `startGuide` passes the polyline and stop points to `Explorer.startGuide`; progress comes back through `onGuideProgress`, which updates the HUD and the live region.
- Minimap: `Minimap` reads `Explorer.getPose()` every frame and draws through `minimapGeometry`. Its floor picker uses `currentFloorId` and the station bundle.
- Credits: `renderCredit` and `openCoverage` read the bundle's sources through `credits.ts`.
- Language: a language change re-renders through `refreshAll` (406-425) and `layoutText`. Strings come from `i18n.ts`.

## Tests CI runs
- Root test job: `pnpm typecheck`, then `pnpm vitest run --maxWorkers=2`. Vitest picks up every the tests in apps/web/src/ui.
- Local, one area only: `pnpm vitest run apps/web/src/ui`. Run the full CI command first.
- Through the container: `orb-test --heavy -- sh -c "pnpm typecheck && pnpm vitest run --maxWorkers=2"`.
- e2e-smoke runs the browser flow in `tests/e2e`. The spec list is in [[e2e]].

## Pitfalls
- `app.ts` is 1479 lines and holds all the state. Put pure logic in a helper module with a test (the folder is built that way) rather than in App.
- IME: Enter during Japanese composition must not select a result. Keep `isImeKeydown` in the key path (`compositionEndMs`).
- The minimap stops jumping on a stray floor reading (#220 follow-up). Floor changes need the connector hint.
- Shop listings: a shop's own point is not a verified entrance (#213), and a search-only listing's point is not verified with a connector (#525). Do not label those as entrances.
- Hours are hidden when the reading date is in the future or older than 180 days (OD-32, `hours.ts`, fix 6625fb80).
- Route evidence: endpoint name evidence is kept out of the path's sources (#491).
- The phone sheet is an occluder for the explorer's overview (#385). Changing the sheet's size refits the overview.
- Test hooks in `exposeTestHooks` are used by QA specs. Changing their names breaks them.

## Related PRs and issues
- #213 — shop category filter and merchant card (PR #480, first slice); the card's point is not an entrance.
- #220 — circular minimap, player-up or north-up (PR #422); floor picker, full-width overlay (`4fdc4a84`, `bb538faf`); stray floor reading fix (`e5059694`).
- #240 — rail demo review items (PR #247).
- #385 — phone route sheet sets the overview's free area (`c7c24e43`).
- #400 — POI chips and identity nudge (PR #483).
- #419 — department-store brand search end to end (`5669a828`); tenant display.
- #121 — list declared data files in the Coverage dialog (`121144d6`, `894eb7d1`).
- #297 — credit wording in ja (`941209b9`).
- OD-32 — printed shop hours (`d42dece0`, fix `6625fb80`).
- #525 — search-only listing is not verified with a connector (`3568e2c5`).
- #491 — endpoint name evidence out of the path's sources (`9761ac83`).
- See [[web-explorer]] for the Explorer the shell drives, [[web-merchant]] for the merchant form, [[pkg-search]] and [[pkg-navigation]] for the engines, and [[INDEX]].
