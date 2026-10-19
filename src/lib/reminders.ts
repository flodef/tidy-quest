import { getAccounts } from "./mail/accounts";
import { sendMail } from "./mail/smtp";
import {
  claimAgendaReminder,
  dbReady,
  dueAgendaReminders,
  unclaimAgendaReminder,
  type AgendaEvent,
} from "./db";

// Throttle des checks paresseux (appelés à chaque /api/overview) : la vraie
// planification est assurée par /api/cron et /api/reminders (ping externe).
let lastCheck = 0;
let warnedNoRecipient = false;
const CHECK_EVERY_MS = 60_000;

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function sendReminder(ev: AgendaEvent, to: string): Promise<void> {
  const accounts = getAccounts();
  const acc = accounts.find((a) => a.id === process.env.REMINDER_ACCOUNT) ?? accounts[0];
  if (!acc) throw new Error("aucun compte SMTP configuré");
  await sendMail(acc, {
    to,
    subject: `⏰ Rappel : ${(ev.text + (ev.who ? ` avec ${ev.who}` : "")).replace(/[\r\n]+/g, " ")}`,
    text: `${ev.text}${ev.who ? ` avec ${ev.who}` : ""}\n\nPrévu le ${fmtWhen(ev.due_at)} (heure de Paris).\n\n— Tidy Quest`,
  });
}

export async function checkReminders(force = false): Promise<number> {
  if (!dbReady()) return 0;
  // REMINDER_TO requis pour l'envoi — sans lui, on ne consomme pas les claims
  // (les rappels repartiront dès que la variable sera configurée).
  const to = process.env.REMINDER_TO;
  if (!to) {
    if (!warnedNoRecipient) {
      warnedNoRecipient = true;
      console.warn("[reminders] REMINDER_TO non configuré — checks ignorés tant que la variable manque");
    }
    return 0;
  }
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_EVERY_MS) return 0;
  lastCheck = now;
  const due = await dueAgendaReminders();
  let sent = 0;
  for (const ev of due) {
    if (!(await claimAgendaReminder(ev.id))) continue;
    try {
      await sendReminder(ev, to);
      sent++;
    } catch (e) {
      console.error("[reminders] envoi échoué:", ev.id, e instanceof Error ? e.message : e);
      // Échec SMTP : on désarme pour retenter au prochain passage.
      await unclaimAgendaReminder(ev.id).catch(() => {});
    }
  }
  return sent;
}
