// Cache mémoire courte durée pour les routes IMAP coûteuses (Fluid compute :
// l'instance reste chaude entre requêtes, le cache survit aux invocations).
// Toute route qui MUTE l'état mail doit appeler invalidateMail().
// NOTE : en mémoire, propre à l'instance — un déploiement multi-instance peut
// servir des données en cache différentes (limite connue, acceptable ici).

const store = new Map<string, { at: number; data: unknown }>();
// Dédup des appels concurrents : sans ça, N requêtes sur un cache expiré
// lanceraient N fois le même sweep IMAP de 4 comptes.
const inflight = new Map<string, Promise<unknown>>();
// Génération : incrémentée à chaque invalidation. Une lecture IMAP lancée
// AVANT une mutation ne doit pas réécrire ses données (périmées) dans le
// cache une fois résolue — elle n'est stockée que si la génération n'a pas
// bougé entre-temps.
let generation = 0;

export async function cachedMail<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  let p = inflight.get(key) as Promise<T> | undefined;
  if (!p) {
    const gen = generation;
    const run: Promise<T> = fn()
      .then((data) => {
        if (gen === generation) store.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        if (inflight.get(key) === run) inflight.delete(key);
      });
    p = run;
    inflight.set(key, p);
  }
  return p;
}

export function invalidateMail() {
  generation++;
  store.clear();
  // Les lectures en vol sont périmées : les requêtes suivantes ne doivent
  // pas s'y greffer, elles relancent une lecture fraîche.
  inflight.clear();
}
