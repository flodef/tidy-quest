// Construction du snapshot client à partir des réponses API — module pur
// (testable sans React).
import type { AgendaEvent, Note, Task } from "@/lib/db";
import type { Draft, MutedEntry, OverviewAccount } from "@/lib/types";

export interface Snapshot {
  accounts: OverviewAccount[];
  muted: MutedEntry[];
  pile: Draft[];
  aside: Draft[];
  tasks: Task[];
  notes: Note[];
  /** undefined = l'appel a échoué → garder les données déjà affichées. */
  agenda?: AgendaEvent[];
  /** undefined = l'appel a échoué → garder l'ordre déjà affiché. */
  inboxOrder?: Record<string, number[]>;
}

type Overview = { accounts?: OverviewAccount[]; muted?: MutedEntry[] };

export function buildSnapshot(
  ov: Overview,
  tk: { tasks?: Task[] },
  nt: { notes?: Note[] },
  ag: { events?: AgendaEvent[] } | null,
  io: { order?: { account: string; uid: number }[] } | null,
): Snapshot {
  const accounts = ov.accounts ?? [];
  let inboxOrder: Record<string, number[]> | undefined;
  if (io) {
    inboxOrder = {};
    for (const r of io.order ?? []) (inboxOrder[r.account] ??= []).push(r.uid);
  }
  return {
    accounts,
    muted: ov.muted ?? [],
    pile: accounts.flatMap((a) => a.active ?? []),
    aside: accounts.flatMap((a) => a.aside ?? []),
    tasks: tk.tasks ?? [],
    notes: nt.notes ?? [],
    // Un échec ponctuel de /api/agenda ou /api/inbox-order ne doit PAS
    // vider la liste (écran + snapshot hors-ligne) : undefined = inchangé.
    agenda: ag ? (ag.events ?? []) : undefined,
    inboxOrder,
  };
}

/** Snapshot complet à persister : les parties absentes reprennent le précédent. */
export function completeSnapshot(snap: Snapshot, prev: Snapshot | null): Snapshot {
  return {
    ...snap,
    agenda: snap.agenda ?? prev?.agenda ?? [],
    inboxOrder: snap.inboxOrder ?? prev?.inboxOrder ?? {},
  };
}
