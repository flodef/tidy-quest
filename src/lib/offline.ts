// Mode hors-ligne : snapshot localStorage des dernières données connues +
// outbox des mutations à rejouer au retour du réseau. Client-side only.

export type Op = { url: string; init: RequestInit };

const CACHE_KEY = "mq-cache";
const OUTBOX_KEY = "mq-outbox";
// Bump si le shape du snapshot change — un vieux snapshot est ignoré.
const SNAP_VERSION = 2;

export function saveSnapshot(data: object) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: SNAP_VERSION, data }));
  } catch { /* quota/SSR */ }
}

export function loadSnapshot<T>(): T | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { v?: number; data?: T };
    return obj.v === SNAP_VERSION && obj.data !== undefined ? (obj.data as T) : null;
  } catch {
    return null;
  }
}

export function pendingOps(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as Op[];
  } catch {
    return [];
  }
}

function writeOps(ops: Op[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch { /* noop */ }
}

export function enqueueOp(op: Op): number {
  const ops = [...pendingOps(), op];
  writeOps(ops);
  return ops.length;
}

/** Purge le snapshot et l'outbox (verrouillage de l'app). */
export function clearOfflineData() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(OUTBOX_KEY);
  } catch { /* noop */ }
}

// Verrou inter-onglets (Web Locks) : un seul flush à la fois, toutes
// fenêtres confondues — sinon deux onglets rejouent les mêmes ops et
// s'écrasent mutuellement la file. Sans support : exécution directe.
function withOutboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  return locks ? (locks.request("mq-outbox", fn) as Promise<T>) : fn();
}

// Rejoue la file dans l'ordre, TÊTE PAR TÊTE : chaque op traitée est retirée
// d'une lecture fraîche de la file. Les ops enfilées pendant le flush (même
// onglet ou autre onglet) ne sont donc jamais écrasées — seul le flusheur
// retire, les autres ne font qu'ajouter en fin.
// - 401/403 : session morte → on CONSERVE les ops (elles marcheront après
//   re-login) et on le signale — jamais de drop silencieux.
// - 5xx/réseau : on s'arrête et on garde le reste pour la prochaine tentative.
// - Autres 4xx : op invalide qui ne réussira jamais → jetée.
export function flushOps(): Promise<{ remaining: number; authLost: boolean }> {
  return withOutboxLock(async () => {
    let authLost = false;
    for (let op = pendingOps()[0]; op; op = pendingOps()[0]) {
      let drop = false;
      try {
        const r = await fetch(op.url, op.init);
        if (r.ok) drop = true;
        else if (r.status === 401 || r.status === 403) authLost = true;
        else if (r.status < 500) drop = true;
      } catch {
        /* réseau : on garde l'op */
      }
      if (!drop) break;
      writeOps(pendingOps().slice(1));
    }
    return { remaining: pendingOps().length, authLost };
  });
}
