// Formatage de dates partagé entre composants.

/** "14:32" si aujourd'hui, sinon "05/10 14:32". */
export function fmtShort(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const now = new Date();
  const hm = dt.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return dt.toDateString() === now.toDateString()
    ? hm
    : `${dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

/** "mar. 07 oct. à 14:32" — pour les prophéties. */
export function fmtWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} à ${time}${+d < now ? " (PASSÉ)" : ""}`;
}

/** Début du jour de `ts` (min = aujourd'hui pour les sélecteurs de date). */
export const startOfDay = (ts: number = Date.now()) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const startOfToday = () => startOfDay();

/**
 * Minuit Europe/Paris de `ts`, rendu en instant UTC. Le serveur tourne en
 * UTC : sans ça, « le lendemain » basculerait à 1-2h du matin à Paris.
 * Le décalage est pris à l'instant courant — les changements d'heure
 * DST ont lieu à 2-3h, jamais à minuit.
 */
export function startOfDayParis(ts: number = Date.now()): Date {
  const now = new Date(ts);
  const wall = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const offset = wall.getTime() - now.getTime();
  wall.setHours(0, 0, 0, 0);
  return new Date(wall.getTime() - offset);
}

/**
 * Quart d'heure SUIVANT (14:54 → 15:00, 14:46 → 15:00, 15:00 → 15:00) —
 * secondes/ms à zéro. « Suivant » plutôt que « plus proche » : l'heure
 * proposée n'est jamais déjà passée.
 */
export function ceilToQuarter(d: Date): Date {
  const out = new Date(d);
  const aligned =
    out.getMinutes() % 15 === 0 &&
    out.getSeconds() === 0 &&
    out.getMilliseconds() === 0;
  out.setSeconds(0, 0);
  if (!aligned) out.setMinutes(Math.floor(out.getMinutes() / 15) * 15 + 15);
  return out;
}

/** Prophétie dépassée ET non faite : supprimable sans confirmation. */
export const isOverdue = (
  ev: { done: boolean; due_at: string },
  now: number = Date.now(),
) => !ev.done && +new Date(ev.due_at) < now;

export type DateSegment = "day" | "month" | "year" | "hour" | "minute";

/**
 * Saisie clavier d'un segment du champ date+heure (nouvelle Date, ou null
 * si la valeur tapée est hors bornes). La minute est posée TELLE QUELLE :
 * c'est l'appelant qui aligne au quart d'heure suivant (ceilToQuarter) —
 * 53 → :53 → 15:00, et non :45 comme un arrondi au plus proche.
 */
export function setSegment(d: Date, seg: DateSegment, n: number): Date | null {
  const out = new Date(d);
  // setDate(31) en février déborde en mars : on borne au dernier jour du mois.
  if (seg === "day" && n >= 1 && n <= 31)
    out.setDate(
      Math.min(n, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()),
    );
  else if (seg === "month" && n >= 1 && n <= 12) out.setMonth(n - 1);
  else if (seg === "year" && n > 0) out.setFullYear(n);
  else if (seg === "hour" && n >= 0 && n <= 23) out.setHours(n);
  else if (seg === "minute" && n >= 0 && n <= 59) out.setMinutes(n);
  else return null;
  return out;
}

// --- Fenêtre d'envoi des rappels ---

// Les crons (cron-job.org → /api/cron) ne tournent que de 8h à 22h, heure
// de Paris, sur les quarts d'heure. Un rappel ne peut partir que sur un
// tick de cette fenêtre, avec une grâce de 15 min après l'échéance —
// aligné sur REMINDER_GRACE_MIN côté serveur (db.ts).
export const REMINDER_WINDOW_START_H = 8;
export const REMINDER_WINDOW_END_H = 22;
export const REMINDER_GRACE_MS = 15 * 60_000;

/**
 * Moment où le rappel partirait réellement, ou null s'il ne peut jamais
 * partir (aucun tick cron dans [due−remind, due+grâce]).
 * Exemples : prophétie 23h + rappel 60 min → null (prévu 22h, hors fenêtre,
 * grâce expirée le lendemain) ; 7h + 30 min → null ; 7h + 12h → veille 19h.
 */
export function reminderFireTime(
  dueAt: Date,
  remindMin: number,
  now: number = Date.now(),
): Date | null {
  // Un tick déjà passé ne peut plus rien envoyer : la recherche part de now.
  const from = Math.max(+dueAt - remindMin * 60_000, now);
  const to = +dueAt + REMINDER_GRACE_MS;
  // La fenêtre est quotidienne : on teste chaque jour couvert par
  // l'intervalle (remind ≤ 7 j → ≤ 9 jours balayés).
  let day = startOfDay(from);
  for (let i = 0; i < 10 && +day <= to; i++, day = new Date(+day + 86400_000)) {
    const winStart = new Date(day);
    winStart.setHours(REMINDER_WINDOW_START_H, 0, 0, 0);
    const winEnd = new Date(day);
    winEnd.setHours(REMINDER_WINDOW_END_H, 0, 0, 0);
    // Premier tick du quart d'heure ≥ max(from, winStart) — ceilToQuarter
    // gère les secondes (setMinutes(arrondi) renverrait un tick passé).
    const first = ceilToQuarter(new Date(Math.max(from, +winStart)));
    // Borne de grâce STRICTEMENT ouverte : le serveur exige
    // due_at > now() − 15 min — un tick exactement à due+15 min ne part pas.
    if (+first < +winEnd && +first < to) return first;
  }
  return null;
}

export type Recurrence = "weekly" | "monthly";

/** Premier jour du mois suivant, clampé au dernier jour si besoin (31 jan → 28/29 fév). */
function addMonthsClamped(d: Date, n: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

/**
 * Prochaine occurrence d'une série récurrente : ancrée sur `anchorAt` (première
 * échéance) pour éviter la dérive mensuelle (31 jan → 28 fév → 28 mars au lieu
 * de 31). Retourne le premier créneau strictement > `after`.
 */
export function nextOccurrence(anchorAt: string, recur: Recurrence, after: number): Date {
  const anchor = new Date(anchorAt);
  if (recur === "weekly") {
    const step = 7 * 86_400_000;
    const k = Math.floor((after - +anchor) / step) + 1;
    return new Date(+anchor + Math.max(0, k) * step);
  }
  let n = 1;
  let d = addMonthsClamped(anchor, n);
  while (+d <= after) d = addMonthsClamped(anchor, ++n);
  return d;
}

/** Début de la « journée quête » courante : le dernier 6h00 passé (journée 6h→6h). */
export function dayStart(now: Date | number = new Date()): Date {
  const d = new Date(now);
  d.setHours(6, 0, 0, 0);
  if (+d > +now) d.setDate(d.getDate() - 1);
  return d;
}
