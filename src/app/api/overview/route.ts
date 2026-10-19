import { NextResponse, after } from "next/server";
import { getAccounts } from "@/lib/mail/accounts";
import { accountView, manualView } from "@/lib/mail/accountView";
import { dbReady, listAsides, listMuted } from "@/lib/db";
import { cachedMail, invalidateMail } from "@/lib/cache";
import { checkReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
// ?fresh=1 (bouton refresh manuel) vide le cache mail — au plus une fois
// toutes les 10 s par instance : un spam du bouton ne martèle pas l'IMAP.
const FRESH_MIN_MS = 10_000;
let lastFresh = 0;

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("fresh") === "1" && Date.now() - lastFresh > FRESH_MIN_MS) {
    lastFresh = Date.now();
    invalidateMail();
  }
  // Rappels agenda : check paresseux à l'usage de l'app (throttlé dans checkReminders)
  after(() => checkReminders().catch(() => {}));
  const data = await cachedMail("overview", TTL_MS, async () => {
    const accounts = getAccounts();
    const [asideRows, mutedRows] = dbReady()
      ? await Promise.all([listAsides().catch(() => []), listMuted().catch(() => [])])
      : [[], []];
    const results = await Promise.allSettled(
      // manual: true → badge sans relevé IMAP (le compte ne se charge que
      // via /api/account quand l'utilisateur ouvre sa boîte).
      accounts.map((acc) => (acc.manual ? Promise.resolve(manualView(acc)) : accountView(acc, asideRows, mutedRows))),
    );
    return {
      accounts: results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : (() => {
              // Détails IMAP loggés serveur — le client reçoit un flag générique.
              console.error("[overview]", accounts[i].id, r.reason instanceof Error ? r.reason.message : r.reason);
              return { id: accounts[i].id, label: accounts[i].label, color: accounts[i].color, error: "unreachable", active: [], aside: [] };
            })(),
      ),
      muted: mutedRows,
    };
  });
  return NextResponse.json(data);
}
