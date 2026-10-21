"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconBell, IconBellOff, IconDeviceMobileDown, type IconSword } from "@tabler/icons-react";
import { sendJson } from "@/lib/client";
import { enqueueOp, flushOps, loadSnapshot, pendingOps, saveSnapshot, type Op } from "@/lib/offline";
import { buildSnapshot, completeSnapshot, type Snapshot } from "@/lib/snapshot";
import type { BeforeInstallPromptEvent } from "@/lib/types";

export type { Snapshot };

export type Say = (msg: string, Icon?: typeof IconSword, onUndo?: () => void) => void;
/** Demande de confirmation (ConfirmDialog). */
export type Ask = (c: { label: string; run: () => void }) => void;
export type Mutate = (op: Op) => void;

// ---------- Toast ----------

export function useToast() {
  const [toast, setToast] = useState<{ msg: string; Icon?: typeof IconSword; onUndo?: () => void } | null>(null);
  // Le timer du toast précédent est annulé — sinon il effacerait le nouveau
  // toast avant la fin de ses 2,5 s.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  const say = useCallback((msg: string, Icon?: typeof IconSword, onUndo?: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, Icon, onUndo });
    timer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  return { toast, say, dismiss };
}

// ---------- Push ----------

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function usePush(say: (msg: string, Icon?: typeof IconSword) => void) {
  const [pushOn, setPushOn] = useState<boolean | null>(null);

  // Enregistre le SW dès le chargement (installabilité PWA + push), puis lit l'abonnement.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      if (!("PushManager" in window)) return;
      const sub = await reg.pushManager.getSubscription();
      setPushOn(!!sub);
    }).catch(() => {});
  }, []);

  const togglePush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      if (pushOn) {
        const sub = await reg.pushManager.getSubscription();
        await sub?.unsubscribe();
        if (sub) await sendJson("/api/push", { endpoint: sub.endpoint }, "DELETE");
        setPushOn(false);
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        say("Le héraut restera muet", IconBellOff);
        return;
      }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await sendJson("/api/push", sub);
      // Serveur qui refuse (endpoint hors allowlist, DB KO) : sans ce test,
      // la cloche affichait « activé » alors qu'aucune notif n'arriverait.
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        say("Le héraut n'a pas pu s'inscrire", IconBellOff);
        return;
      }
      setPushOn(true);
      say("Le héraut te préviendra", IconBell);
    } catch {
      // iOS non-installé, WebView… : subscribe jette sans Notification.permission.
      say("Notifications impossibles ici", IconBellOff);
    }
  }, [pushOn, say]);

  return { pushOn, togglePush };
}

// ---------- Installation PWA ----------

export function useInstallPrompt(say: (msg: string, Icon?: typeof IconSword) => void) {
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);

  // Bouton d'installation : visible tant que la PWA n'est pas installée.
  useEffect(() => {
    const mql = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (mql.matches || iosStandalone) return;
    // iOS ne déclenche jamais beforeinstallprompt : on affiche le bouton (installation manuelle).
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setTimeout(() => setCanInstall(true), 0);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };
    const onDone = () => {
      setInstallEvt(null);
      setCanInstall(false);
    };
    const onMode = (e: MediaQueryListEvent) => {
      if (e.matches) onDone();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onDone);
    mql.addEventListener("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onDone);
      mql.removeEventListener("change", onMode);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (installEvt) {
      try {
        await installEvt.prompt();
        const { outcome } = await installEvt.userChoice;
        if (outcome === "accepted") setCanInstall(false);
      } catch { /* dismissed */ }
      setInstallEvt(null);
      return;
    }
    say("Installe l'app via le menu du navigateur : « Ajouter à l'écran d'accueil »", IconDeviceMobileDown);
  }, [installEvt, say]);

  return { canInstall, installApp };
}

// ---------- Badge de compteur (favicon + Badging API) ----------

export function useAppBadge(count: number) {
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) void nav.setAppBadge?.(count).catch(() => {});
    else void nav.clearAppBadge?.().catch(() => {});

    const img = new Image();
    img.src = "/icon-192.png";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 64, 64);
      if (count > 0) {
        const txt = count > 99 ? "99+" : String(count);
        const r = txt.length > 1 ? 20 : 16;
        ctx.fillStyle = "#b03a2e";
        ctx.beginPath();
        ctx.arc(64 - r - 1, r + 1, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${txt.length > 2 ? 17 : txt.length > 1 ? 20 : 26}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, 64 - r - 1, r + 2);
      }
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = c.toDataURL("image/png");
    };
  }, [count]);
}

// ---------- Sync offline (snapshot + outbox) ----------

export function useOfflineSync(applySnapshot: (s: Snapshot) => void, onAuthLost: () => void) {
  // Init à false puis effect : navigator.onLine en init casserait l'hydratation
  // (rendu serveur différent du rendu client hors-ligne).
  const [offline, setOffline] = useState(false);
  // Réseau OK mais API en erreur (DB/serveur KO) : distinct de « hors-ligne ».
  const [serverDown, setServerDown] = useState(false);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);

  // Incrémenté à chaque mutation locale : si une mutation arrive pendant
  // qu'un refresh est en vol, sa réponse est périmée → on la jette.
  const dataVersion = useRef(0);
  // Instance en pause (une autre fenêtre est active) : ni refresh ni rejeu
  // de la file — seule l'instance active parle au serveur.
  const paused = useRef(false);
  const setPaused = useCallback((p: boolean) => {
    paused.current = p;
  }, []);

  // `fresh` : geste manuel (boutons refresh) → le serveur vide son cache
  // mail au lieu de servir des données vieilles de jusqu'à 60 s.
  const refresh = useCallback(async (opts?: { fresh?: boolean }) => {
    if (paused.current) return;
    const v = dataVersion.current;
    let networkDown = false;
    try {
      const [ovR, tkR, ntR, agR, ioR] = await Promise.all([
        fetch(`/api/overview${opts?.fresh ? "?fresh=1" : ""}`),
        fetch("/api/tasks"),
        fetch("/api/notes"),
        fetch("/api/agenda").catch(() => null),
        fetch("/api/inbox-order").catch(() => null),
      ]).catch((e) => {
        networkDown = true;
        throw e;
      });
      // Session morte → redirect login (pas un "hors-ligne").
      if ([ovR, tkR, ntR, agR, ioR].some((r) => r && (r.status === 401 || r.status === 403))) {
        onAuthLost();
        return;
      }
      if (!ovR.ok || !tkR.ok || !ntR.ok) throw new Error("api error");
      const [ov, tk, nt, ag, io] = await Promise.all([
        ovR.json(),
        tkR.json(),
        ntR.json(),
        agR?.ok ? agR.json() : null,
        ioR?.ok ? ioR.json() : null,
      ]);
      if (v !== dataVersion.current) return;
      const snap = buildSnapshot(ov, tk, nt, ag, io);
      applySnapshot(snap);
      saveSnapshot(completeSnapshot(snap, loadSnapshot<Snapshot>()));
      setOffline(false);
      setServerDown(false);
    } catch {
      if (v !== dataVersion.current) return;
      const s = loadSnapshot<Snapshot>();
      if (s) applySnapshot(s);
      if (networkDown) setOffline(true);
      else setServerDown(true);
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, onAuthLost]);

  // Sync sérialisée : un seul flush à la fois, trailing-edge — une mutation
  // arrivée en cours de route est rejouée dans l'itération suivante, et un
  // seul refresh final se fait après que la file est vide.
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  const sync = useCallback(async () => {
    if (paused.current) return;
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    syncing.current = true;
    try {
      let flushed = false;
      do {
        syncAgain.current = false;
        const had = pendingOps().length;
        const { remaining, authLost } = await flushOps();
        setPending(remaining);
        if (authLost) {
          // Session expirée : les ops sont conservées pour après re-login.
          onAuthLost();
          return;
        }
        if (remaining === 0) setOffline(false);
        flushed ||= had > remaining;
        if (remaining > 0) return; // hors-ligne ou serveur KO — on retentera
      } while (syncAgain.current);
      if (flushed) await refresh(); // état serveur faisant foi après rejoue
    } finally {
      syncing.current = false;
      if (syncAgain.current) void sync(); // op arrivée pendant le refresh final
    }
  }, [refresh, onAuthLost]);

  // Mutation offline-capable : toujours en file pour préserver l'ordre,
  // flush immédiat (no-op réseau quand en ligne).
  const mutate = useCallback(
    (op: Op) => {
      dataVersion.current++;
      setPending(enqueueOp(op));
      void sync();
    },
    [sync],
  );

  useEffect(() => {
    // Pas de setOffline() direct ici (setState synchrone dans un effect) :
    // si on est hors-ligne, le refresh() du mount échoue → catch → offline.
    const onOnline = () => void sync();
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const id = setTimeout(() => void sync(), 0);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimeout(id);
    };
  }, [sync]);

  // Hydrate instantanément depuis le snapshot local, puis refresh en fond.
  useEffect(() => {
    const id = setTimeout(() => {
      const s = loadSnapshot<Snapshot>();
      if (s) {
        applySnapshot(s);
        setPending(pendingOps().length);
        setLoading(false);
      }
      void refresh();
    }, 0);
    return () => clearTimeout(id);
  }, [refresh, applySnapshot]);

  return { mutate, refresh, pending, offline, serverDown, loading, setPaused };
}

// ---------- Instance unique (onglets + fenêtres d'app) ----------

const INSTANCE_LOCK = "mq-instance";

/**
 * Une seule instance active à la fois (onglets ET fenêtre de l'app
 * installée), via un Web Lock tenu pendant toute la vie de l'instance :
 * - acquisition atomique → deux fenêtres ouvertes en même temps ne peuvent
 *   pas être actives toutes les deux (pas d'heuristique de délai) ;
 * - le navigateur libère le verrou à la fermeture/crash de l'onglet → une
 *   instance en pause redevient active d'elle-même ;
 * - « Utiliser ici » VOLE le verrou (`steal`) : marche même si l'instance
 *   active est gelée (mobile, économie d'énergie, bfcache) — elle découvre
 *   le vol (AbortError) à son réveil et se met en pause.
 * Le manifest (`launch_handler: focus-existing`) couvre en plus la relance
 * de l'app installée. Sans Web Locks (très vieux navigateurs) : toujours active.
 */
export function useSingleInstance(onActivate: () => void) {
  const [blocked, setBlocked] = useState<null | "busy" | "taken">(null);
  const steal = useRef<() => void>(() => {});
  const activate = useRef(onActivate);
  useEffect(() => {
    activate.current = onActivate;
  });

  useEffect(() => {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return;
    // Chaque tentative a un numéro : seule la plus récente pilote l'état
    // (une attente annulée ou une ancienne détention ne doit rien écraser).
    let attempt = 0;
    let release = () => {};
    let waiting: AbortController | null = null;
    let wasBlocked = false;

    const pause = (why: "busy" | "taken") => {
      setBlocked(why);
      wasBlocked = true;
    };

    function acquire(mode: "try" | "wait" | "steal") {
      const id = ++attempt;
      waiting?.abort();
      waiting = null;
      let opts: LockOptions = {};
      if (mode === "try") opts = { ifAvailable: true };
      else if (mode === "steal") opts = { steal: true };
      else {
        waiting = new AbortController();
        opts = { signal: waiting.signal };
      }
      locks!
        .request(INSTANCE_LOCK, opts, async (lock) => {
          if (id !== attempt) return; // tentative périmée : on lâche
          if (!lock) {
            // Déjà tenu ailleurs : pause, et file d'attente pour reprendre
            // la main automatiquement quand l'autre instance se fermera.
            pause("busy");
            queueMicrotask(() => acquire("wait"));
            return;
          }
          setBlocked(null);
          if (wasBlocked) {
            wasBlocked = false;
            activate.current(); // l'autre instance a pu modifier des données
          }
          await new Promise<void>((resolve) => (release = resolve));
        })
        .catch(() => {
          // AbortError : verrou volé par une autre fenêtre (ou attente annulée).
          if (id !== attempt) return;
          pause("taken");
          acquire("wait");
        });
    }

    steal.current = () => acquire("steal");
    acquire("try");
    return () => {
      attempt++; // toute tentative en cours devient périmée
      waiting?.abort();
      release();
      steal.current = () => {};
    };
  }, []);

  const takeOver = useCallback(() => steal.current(), []);

  return { blocked, takeOver };
}
