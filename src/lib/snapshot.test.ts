import { describe, expect, it } from "vitest";
import { buildSnapshot, completeSnapshot } from "./snapshot";
import type { AgendaEvent } from "./db";

const ev = { id: "e1", text: "dentiste", who: null, due_at: "2026-10-20T08:00:00.000Z", remind_minutes: 30, done: false, reminded_at: null, created_at: "" } satisfies AgendaEvent;

describe("buildSnapshot — échec partiel (B2)", () => {
  it("agenda/inbox-order en échec → undefined (on garde l'affichage)", () => {
    const s = buildSnapshot({ accounts: [] }, { tasks: [] }, { notes: [] }, null, null);
    expect(s.agenda).toBeUndefined();
    expect(s.inboxOrder).toBeUndefined();
  });

  it("réponses OK → données remplies, ordre inbox groupé par compte", () => {
    const s = buildSnapshot({ accounts: [] }, { tasks: [] }, { notes: [] }, { events: [ev] }, { order: [{ account: "a", uid: 2 }, { account: "a", uid: 1 }] });
    expect(s.agenda).toEqual([ev]);
    expect(s.inboxOrder).toEqual({ a: [2, 1] });
  });

  it("snapshot persisté : les parties absentes reprennent le précédent", () => {
    const prev = buildSnapshot({ accounts: [] }, { tasks: [] }, { notes: [] }, { events: [ev] }, { order: [] });
    const partial = buildSnapshot({ accounts: [] }, { tasks: [] }, { notes: [] }, null, null);
    expect(completeSnapshot(partial, prev).agenda).toEqual([ev]);
    expect(completeSnapshot(partial, null).agenda).toEqual([]);
  });
});
