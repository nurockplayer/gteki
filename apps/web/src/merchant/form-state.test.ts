import { describe, expect, it } from "vitest";
import { newFormState, withConsent, withDraft, withLang, withStation } from "./form-state.ts";

const ID = "11111111-2222-3333-4444-555555555555";
const at = (iso: string) => () => new Date(iso);
const fresh = () => newFormState("ja", "shinjuku", () => ID, at("2026-10-25T03:10:00.000Z"));

describe("merchant form state (#438 review)", () => {
  it("records the consent tick time, not the preview time, and keeps it until the box is unticked", () => {
    const empty = fresh();
    expect(empty.clock.submittedAt).toBe("2026-10-25T03:10:00.000Z");
    expect(empty.clock.consentAcceptedAt).toBe("");

    const ticked = withConsent(empty, true, at("2026-10-25T03:12:34.000Z"));
    expect(ticked.draft.consent).toBe(true);
    expect(ticked.clock.consentAcceptedAt).toBe("2026-10-25T03:12:34.000Z");
    expect(ticked.clock.consentAcceptedAt).not.toBe(ticked.clock.submittedAt);

    // A re-render (a second change event for the same value) moves nothing.
    expect(withConsent(ticked, true, at("2026-10-25T04:00:00.000Z"))).toBe(ticked);
    // Unticking clears it, so a later tick records its own time.
    const unticked = withConsent(ticked, false, at("2026-10-25T03:30:00.000Z"));
    expect(unticked.clock.consentAcceptedAt).toBe("");
    expect(withConsent(unticked, true, at("2026-10-25T03:31:00.000Z")).clock.consentAcceptedAt).toBe("2026-10-25T03:31:00.000Z");
  });

  it("keeps the client request id and the consent tick time across a language switch", () => {
    const ticked = withConsent(fresh(), true, at("2026-10-25T03:12:34.000Z"));
    const en = withLang(ticked, "en");
    expect(en.lang).toBe("en");
    expect(en.clock).toBe(ticked.clock);
    expect(en.clock.clientRequestId).toBe(ID);
    expect(en.clock.consentAcceptedAt).toBe("2026-10-25T03:12:34.000Z");
    // Switching back is the same clock again: a language switch never makes a new submission session.
    expect(withLang(en, "ja").clock.clientRequestId).toBe(ID);
  });

  it("edits the draft and a station change without touching the clock", () => {
    const ticked = withConsent(fresh(), true, at("2026-10-25T03:12:34.000Z"));
    const edited = withDraft(ticked, { nameText: "サンプル薬局", floorId: "toei-nwd-1" });
    expect(edited.draft.nameText).toBe("サンプル薬局");
    expect(edited.clock).toBe(ticked.clock);
    // A station change drops the station-scoped fields but keeps the shop's own words, its contact and the tick.
    const moved = withStation({ ...edited, draft: { ...edited.draft, facility: "南館", hoursText: "10:00–20:00" } }, "ikebukuro");
    expect(moved.draft.stationId).toBe("ikebukuro");
    expect(moved.draft.floorId).toBe("");
    expect(moved.draft.facility).toBe("");
    expect(moved.draft.hoursText).toBe("");
    expect(moved.draft.nameText).toBe("サンプル薬局");
    expect(moved.draft.consent).toBe(true);
    expect(moved.clock).toBe(ticked.clock);
  });
});
