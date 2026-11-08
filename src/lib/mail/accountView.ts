import type { MailAccount } from "./accounts";
import { fetchAccount } from "./imap";
import type { OverviewAccount } from "@/lib/types";

type AsideRow = { account: string; uid: number };
type MutedRow = { account: string; sender: string };

/** Badge d'un compte à relevé manuel — aucune requête IMAP. */
export function manualView(acc: MailAccount): OverviewAccount {
  return { id: acc.id, label: acc.label, color: acc.color, manual: true, active: [], aside: [] };
}

/** Charge un compte en IMAP et assemble sa vue (stats, quêtes, jarre). */
export async function accountView(acc: MailAccount, asideRows: AsideRow[], mutedRows: MutedRow[]): Promise<OverviewAccount> {
  const mutedSenders = mutedRows.filter((m) => m.account === acc.id).map((m) => m.sender);
  const muted = new Set(mutedSenders.map((s) => `${acc.id}:${s}`));
  const asides = new Set(asideRows.filter((a) => a.account === acc.id).map((a) => `${a.account}:${a.uid}`));
  const { stats, drafts } = await fetchAccount(acc, mutedSenders);
  const latest = stats.latest.filter((m) => !muted.has(`${acc.id}:${m.fromEmail}`));
  const active = drafts.filter((d) => !asides.has(`${acc.id}:${d.uid}`));
  return {
    id: acc.id,
    label: acc.label,
    color: acc.color,
    // Sans ça, un relevé manuel efface le flag → refreshAfter cesse de
    // re-poller le compte et les restaurations post-échec deviennent muettes.
    manual: acc.manual,
    unseen: Math.max(0, stats.unseen - stats.mutedUnseen),
    draftCount: active.length,
    asideCount: drafts.length - active.length,
    latest,
    active,
    aside: drafts.filter((d) => asides.has(`${acc.id}:${d.uid}`)),
  };
}
