// Formatage de dates partagé entre composants.

/** "14:32" si aujourd'hui, sinon "05/10 14:32". */
export function fmtShort(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const now = new Date();
  const hm = dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return dt.toDateString() === now.toDateString()
    ? hm
    : `${dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

/** "mar. 07 oct. à 14:32" — pour les prophéties. */
export function fmtWhen(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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
 * Quart d'heure SUIVANT (14:54 → 15:00, 14:46 → 15:00, 15:00 → 15:00) —
 * secondes/ms à zéro. « Suivant » plutôt que « plus proche » : l'heure
 * proposée n'est jamais déjà passée.
 */
export function ceilToQuarter(d: Date): Date {
  const out = new Date(d);
  const aligned = out.getMinutes() % 15 === 0 && out.getSeconds() === 0 && out.getMilliseconds() === 0;
  out.setSeconds(0, 0);
  if (!aligned) out.setMinutes(Math.floor(out.getMinutes() / 15) * 15 + 15);
  return out;
}

/** Prophétie dépassée ET non faite : supprimable sans confirmation. */
export const isOverdue = (ev: { done: boolean; due_at: string }, now: number = Date.now()) =>
  !ev.done && +new Date(ev.due_at) < now;

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
  if (seg === "day" && n >= 1 && n <= 31) out.setDate(Math.min(n, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  else if (seg === "month" && n >= 1 && n <= 12) out.setMonth(n - 1);
  else if (seg === "year" && n > 0) out.setFullYear(n);
  else if (seg === "hour" && n >= 0 && n <= 23) out.setHours(n);
  else if (seg === "minute" && n >= 0 && n <= 59) out.setMinutes(n);
  else return null;
  return out;
}
