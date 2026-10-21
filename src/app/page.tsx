"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { IconRefresh, IconBell, IconBellOff, IconPackage, IconDeviceMobileDown, IconVolumeOff, IconWand, IconTrash, IconX, IconSword, IconArrowBackUp, IconNotebook, IconWifiOff, IconCalendarClock, IconSkull, IconAlertTriangle, IconHeart, IconHeartFilled, IconPlus } from "@tabler/icons-react";
import { apiError, jsonInit, sendJson } from "@/lib/client";
import { clearOfflineData } from "@/lib/offline";
import { useAppBadge, useInstallPrompt, useOfflineSync, usePush, useSingleInstance, useToast, type Mutate, type Snapshot } from "@/lib/hooks";
import { useQuests } from "@/lib/useQuests";
import { useNotes } from "@/lib/useNotes";
import { useProphecies } from "@/lib/useProphecies";
import type { Draft, DraftBody, InboxItem, MsgBody, OverviewAccount } from "@/lib/types";
import Hud from "@/components/Hud";
import DraftCard from "@/components/DraftCard";
import ItemRow from "@/components/ItemRow";
import AutosizeTextarea from "@/components/AutosizeTextarea";
import SwipeRow from "@/components/SwipeRow";
import { dayStart, fmtWhen, isOverdue } from "@/lib/dates";
import SortableList from "@/components/SortableList";
import Sheet from "@/components/Sheet";
import Victory from "@/components/Victory";
import QuestPanel from "@/components/QuestPanel";
import RefreshButton from "@/components/RefreshButton";
import NotesPanel from "@/components/NotesPanel";
import AgendaPanel from "@/components/AgendaPanel";
import InboxDrawer from "@/components/InboxDrawer";
import { DraftReader, MessageReader } from "@/components/MessageReader";
import ConfirmDialog from "@/components/ConfirmDialog";
import { parseNoteItems } from "@/lib/items";

function SoonProphecy({ ev, busy, onDone, onDelete, onOpen }: {
  ev: { id: string; text: string; who: string | null; due_at: string; done: boolean };
  busy: boolean;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
  onOpen: () => void;
}) {
  // Tap ≠ swipe : le ref est posé par SwipeRow dès qu'on glisse (>10px).
  const swiped = useRef(false);
  return (
    <SwipeRow
      onRight={() => !busy && onDone(ev.id)}
      onLeft={() => !busy && onDelete(ev.id)}
      rightLabel="⚔ FAITE"
      leftLabel="☠ POTENCE"
      swipedRef={swiped}
      contentClassName="bg-[var(--shadow)] border border-[#3a5a2a] select-none"
    >
      <button
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left"
        onPointerDown={() => (swiped.current = false)}
        onClick={() => { if (!swiped.current) onOpen(); }}
      >
        <span className="flex-1 min-w-0 text-base leading-snug break-words">
          {ev.text}
          {ev.who ? ` — ${ev.who}` : ""}
        </span>
        <span className={`font-pixel text-[7px] shrink-0 ${isOverdue(ev) ? "text-[var(--ruby)]" : "text-[var(--gold)]"}`}>
          {fmtWhen(ev.due_at)}
        </span>
      </button>
    </SwipeRow>
  );
}

export default function Game() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<OverviewAccount[]>([]);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [pile, setPile] = useState<Draft[]>([]);
  const [aside, setAside] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<DraftBody | null>(null);
  const [showAside, setShowAside] = useState(false);
  const [inboxOf, setInboxOf] = useState<string | null>(null);
  const [inboxOrder, setInboxOrder] = useState<Record<string, number[]>>({});
  const [trash, setTrash] = useState<InboxItem[] | null>(null);
  const [readingMsg, setReadingMsg] = useState<MsgBody | null>(null);
  const [openingMsg, setOpeningMsg] = useState(false);
  const [readingCtx, setReadingCtx] = useState<Draft | null>(null);
  const [improveText, setImproveText] = useState<string | null>(null);
  const [muted, setMuted] = useState<{ account: string; sender: string }[]>([]);
  const [confirm, setConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const [showQuest, setShowQuest] = useState(false);
  const [quickAdd, setQuickAdd] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [questReserve, setQuestReserve] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  // Texte "Reforger la missive" en cours, conservé par missive si on ferme le popup.
  const [improveSaved, setImproveSaved] = useState<Record<string, string>>({});

  const { toast, say, dismiss: dismissToast } = useToast();
  const { pushOn, togglePush } = usePush(say);
  const { canInstall, installApp } = useInstallPrompt(say);
  useAppBadge(pile.length);

  // Les hooks métier ont besoin de `mutate`, qui vient de useOfflineSync…
  // qui a besoin des setters de ces hooks (applySnapshot). On casse le cycle
  // par une indirection stable : mutateLater appelle le mutate courant.
  const mutateRef = useRef<Mutate>(() => {});
  const mutateLater = useCallback<Mutate>((op) => mutateRef.current(op), []);
  const quests = useQuests({ mutate: mutateLater, say, ask: setConfirm });
  const notesApi = useNotes({ mutate: mutateLater, say, ask: setConfirm });
  const prophecies = useProphecies({ mutate: mutateLater, say, ask: setConfirm });
  const { tasks, setTasks } = quests;
  const { notes, setNotes } = notesApi;
  const { agenda, setAgenda } = prophecies;

  const applySnapshot = useCallback((s: Snapshot) => {
    // Comptes à relevé manuel : leurs données ne viennent pas du snapshot
    // global (overview les saute) — on conserve les piles/tiroirs déjà
    // relevés à la demande.
    const manualIds = new Set((s.accounts ?? []).filter((a) => a.manual).map((a) => a.id));
    setAccounts((prev) =>
      (s.accounts ?? []).map((a) => {
        const old = prev.find((o) => o.id === a.id);
        return a.manual && old?.latest !== undefined
          ? { ...a, latest: old.latest, unseen: old.unseen, draftCount: old.draftCount, asideCount: old.asideCount }
          : a;
      }),
    );
    setMuted(s.muted ?? []);
    setPile((prev) => [...prev.filter((d) => manualIds.has(d.account)), ...(s.pile ?? [])]);
    setAside((prev) => [...prev.filter((d) => manualIds.has(d.account)), ...(s.aside ?? [])]);
    setTasks(s.tasks ?? []);
    setNotes(s.notes ?? []);
    // undefined = appel en échec → on garde l'affichage courant (B2).
    if (s.agenda) setAgenda(s.agenda);
    if (s.inboxOrder) setInboxOrder(s.inboxOrder);
  }, [setTasks, setNotes, setAgenda]);

  const onAuthLost = useCallback(() => router.replace("/login"), [router]);
  const { mutate, refresh, pending, offline, serverDown, loading, setPaused } = useOfflineSync(applySnapshot, onAuthLost);
  useEffect(() => {
    mutateRef.current = mutate;
  }, [mutate]);
  // Instance unique (onglets / fenêtres d'app) : l'instance « reprise »
  // ailleurs se met en pause derrière un écran ; « Utiliser ici » la réactive.
  // À la réactivation : sortie de pause AVANT le refresh (l'autre instance a
  // pu modifier des données entre-temps).
  const { blocked, takeOver } = useSingleInstance(
    useCallback(() => {
      setPaused(false);
      void refresh({ fresh: true });
    }, [setPaused, refresh]),
  );
  useEffect(() => {
    setPaused(!!blocked);
  }, [blocked, setPaused]);

  // Relevé manuel d'un compte "manual" (exclu du cron + overview) :
  // déclenché uniquement quand l'utilisateur ouvre la boîte.
  const pollAccount = useCallback(async (id: string) => {
    setPollingId(id);
    try {
      const res = await fetch(`/api/account?account=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await apiError(res));
      const acc = (await res.json()) as OverviewAccount & { active?: Draft[]; aside?: Draft[] };
      setAccounts((prev) => prev.map((a) => (a.id === id ? acc : a)));
      setPile((prev) => [...prev.filter((d) => d.account !== id), ...(acc.active ?? [])]);
      setAside((prev) => [...prev.filter((d) => d.account !== id), ...(acc.aside ?? [])]);
    } catch (e) {
      say(e instanceof Error ? e.message : "relevé impossible", IconSkull);
    } finally {
      setPollingId(null);
    }
  }, [say]);

  const isManual = (id: string) => !!accounts.find((a) => a.id === id)?.manual;
  // Après une action sur un compte « manual », le refresh global ne le relit
  // jamais : on relance son relevé (le geste vient de l'utilisateur).
  async function refreshAfter(account: string) {
    await refresh();
    if (isManual(account)) await pollAccount(account);
  }

  // Pré-remplit l'aperçu des 3 premières cartes (le listing drafts n'embarque
  // pas le corps). Une seule tentative par brouillon : un corps vide n'est
  // plus redemandé en IMAP à chaque changement de pile (= chaque swipe).
  const previewTried = useRef(new Set<string>());
  useEffect(() => {
    const targets = pile.slice(0, 3).filter((d) => !d.preview && !previewTried.current.has(`${d.account}:${d.uid}`));
    if (targets.length === 0) return;
    for (const d of targets) previewTried.current.add(`${d.account}:${d.uid}`);
    // Pas d'annulation au changement de pile : la tentative est unique, la
    // réponse doit donc être appliquée — la mise à jour par clé reste sûre
    // même si la pile a bougé entre-temps.
    void Promise.all(
      targets.map(async (d) => {
        const r = await fetch(`/api/draft?account=${d.account}&uid=${d.uid}`).catch(() => null);
        if (!r?.ok) return null;
        const j = (await r.json()) as { preview?: string; text?: string | null };
        return { key: `${d.account}:${d.uid}`, preview: j.preview || (j.text ?? "").replace(/\s+/g, " ").slice(0, 160) };
      }),
    ).then((rows) => {
      const map = new Map(rows.filter((r): r is { key: string; preview: string } => !!r && !!r.preview).map((r) => [r.key, r.preview]));
      if (map.size === 0) return;
      setPile((prev) => prev.map((d) => (map.has(`${d.account}:${d.uid}`) ? { ...d, preview: map.get(`${d.account}:${d.uid}`)! } : d)));
    });
  }, [pile]);

  const sameDraft = (x: Draft, d: Draft) => x.account === d.account && x.uid === d.uid;

  async function act(d: Draft, action: "send" | "aside" | "restore") {
    const key = `${d.account}:${d.uid}`;
    if (busy) return;
    setBusy(key);
    // UI optimiste : on retire/déplace la carte tout de suite ; en cas
    // d'échec, le refresh post-flush restaure l'état serveur.
    if (action === "aside") {
      setPile((p) => p.filter((x) => !sameDraft(x, d)));
      setAside((p) => (p.some((x) => sameDraft(x, d)) ? p : [d, ...p]));
    } else if (action === "restore") {
      setAside((p) => p.filter((x) => !sameDraft(x, d)));
      setPile((p) => (p.some((x) => sameDraft(x, d)) ? p : [d, ...p]));
    } else {
      setPile((p) => p.filter((x) => !sameDraft(x, d)));
      setAside((p) => p.filter((x) => !sameDraft(x, d)));
    }
    // Le réseau part en tâche de fond : l'action suivante est libre tout de
    // suite (la carte est déjà retirée/déplacée optimistement).
    setBusy(null);
    void (async () => {
      try {
        if (action === "send") {
          const r = await sendJson("/api/send", { account: d.account, uid: d.uid });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error ?? "Échec");
          // SMTP OK mais déplacement du brouillon KO → on prévient plutôt que
          // de risquer un double envoi au prochain swipe.
          if (j.moved === false) say(`Envoyée à ${j.to} — mais le brouillon traîne encore`, IconSword);
          else say("La missive s'envole !", IconSword);
          await refreshAfter(d.account);
        } else if (action === "aside") {
          // DB-only → file hors-ligne (rejoué au retour du réseau).
          mutate({ url: "/api/aside", init: jsonInit({ account: d.account, uid: d.uid }) });
          say("Rangée dans la jarre", IconPackage);
        } else {
          mutate({ url: "/api/aside", init: jsonInit({ account: d.account, uid: d.uid }, "DELETE") });
          say("De retour dans la quête", IconArrowBackUp);
        }
      } catch (e) {
        say(e instanceof Error ? e.message : "Erreur", IconSkull);
        await refreshAfter(d.account);
      }
    })();
  }

  // Retire des messages du tiroir inbox + ajuste le compteur de non-lus (optimiste).
  function dropInboxItems(accountId: string, pred: (m: InboxItem) => boolean) {
    setAccounts((prev) =>
      prev.map((a) => {
        if (a.id !== accountId) return a;
        const latest = a.latest ?? [];
        const removedUnread = latest.filter((x) => pred(x) && x.unread).length;
        return { ...a, latest: latest.filter((x) => !pred(x)), unseen: Math.max(0, (a.unseen ?? 0) - removedUnread) };
      }),
    );
  }

  async function read(d: Draft) {
    const r = await fetch(`/api/draft?account=${d.account}&uid=${d.uid}`);
    if (r.ok) setReading(await r.json());
  }

  async function readOriginal(d: Draft) {
    setOpeningMsg(true);
    try {
      const r = await fetch(`/api/message?account=${d.account}&to=${encodeURIComponent(d.to)}&subject=${encodeURIComponent(d.subject)}`);
      if (r.ok) {
        setReadingCtx(d);
        setImproveText(improveSaved[`${d.account}:${d.uid}`] ?? null);
        setReadingMsg(await r.json());
      } else say("Parchemin introuvable", IconSkull);
    } finally {
      setOpeningMsg(false);
    }
  }

  async function improveMissive() {
    const d = readingCtx;
    if (!d || !improveText?.trim()) return;
    setBusy("improve");
    setPile((p) => p.filter((x) => !sameDraft(x, d)));
    setAside((p) => p.filter((x) => !sameDraft(x, d)));
    try {
      const r = await sendJson("/api/draft/improve", { account: d.account, uid: d.uid, instructions: improveText.trim() });
      if (!r.ok) throw new Error(await apiError(r));
      const j = (await r.json().catch(() => ({}))) as { moved?: boolean };
      if (j.moved === false) say("Reforgée — mais l'originale traîne encore", IconWand);
      else say("Missive reforgée !", IconWand);
      const k = `${d.account}:${d.uid}`;
      setImproveSaved((s) => {
        const n = { ...s };
        delete n[k];
        return n;
      });
      setReadingMsg(null);
      setReadingCtx(null);
      setImproveText(null);
      await refreshAfter(d.account);
    } catch (e) {
      say(e instanceof Error ? e.message : "Erreur", IconSkull);
      await refreshAfter(d.account); // restaure la carte retirée optimistement
    } finally {
      setBusy(null);
    }
  }

  async function doClearJar() {
    setBusy("jar");
    setAside([]);
    try {
      const r = await fetch("/api/aside/clear", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Échec");
      say(`Jarre brisée : ${j.cleared ?? 0} missive(s) jetée(s)`, IconPackage);
      await refresh();
    } catch (e) {
      say(e instanceof Error ? e.message : "Erreur", IconSkull);
      await refresh(); // restaure la jarre vidée optimistement
    } finally {
      setBusy(null);
    }
  }

  const clearJar = () =>
    setConfirm({
      label: `Briser la jarre ? Les ${aside.length} missive(s) fileront à la potence.`,
      run: doClearJar,
    });

  // Les missives sans ordre enregistré (nouveautés) arrivent en tête, puis
  // l'ordre de priorité choisi par le joueur (glisser ☰ dans le tiroir).
  function orderedInbox(acc: OverviewAccount): InboxItem[] {
    const list = acc.latest ?? [];
    const order = new Map((inboxOrder[acc.id] ?? []).map((uid, i) => [uid, i]));
    const known = list.filter((m) => order.has(m.uid)).sort((a, b) => (order.get(a.uid) ?? 0) - (order.get(b.uid) ?? 0));
    return [...list.filter((m) => !order.has(m.uid)), ...known];
  }

  function inboxReorder(accountId: string, next: InboxItem[]) {
    const uids = next.map((m) => m.uid);
    setInboxOrder((o) => ({ ...o, [accountId]: uids }));
    mutate({ url: "/api/inbox-order", init: jsonInit({ account: accountId, uids }) });
  }

  // Potence = corbeille IMAP du compte (chargée à la demande, pas cachée).
  async function loadTrash(accountId: string) {
    setTrash(null);
    const r = await fetch(`/api/trash?account=${accountId}`);
    if (r.ok) setTrash((await r.json()).items ?? []);
    else say("Potence illisible", IconSkull);
  }

  async function trashAction(m: InboxItem, action: "restore" | "purge") {
    if (busy) return;
    setBusy(`trash:${m.uid}`);
    try {
      const init = action === "restore" ? jsonInit({ account: m.account, uid: m.uid }) : { method: "DELETE" as const };
      const url = action === "restore" ? "/api/trash" : `/api/trash?account=${m.account}&uid=${m.uid}`;
      const r = await fetch(url, init);
      if (!r.ok) throw new Error(await apiError(r));
      setTrash((t) => t?.filter((x) => x.uid !== m.uid) ?? t);
      say(action === "restore" ? "Missive ressuscitée !" : "Missive réduite en cendres", action === "restore" ? IconArrowBackUp : IconSkull);
      if (action === "restore") await refreshAfter(m.account);
    } catch (e) {
      say(e instanceof Error ? e.message : "Erreur", IconSkull);
    } finally {
      setBusy(null);
    }
  }

  const purgeTrashAll = () =>
    setConfirm({
      label: `Réduire en cendres les ${trash?.length ?? 0} missive(s) de la potence ? Irréversible !`,
      run: () =>
        void (async () => {
          if (!inbox) return;
          setBusy("trash:all");
          try {
            const r = await fetch(`/api/trash?account=${inbox.id}&all=1`, { method: "DELETE" });
            if (!r.ok) throw new Error(await apiError(r));
            setTrash([]);
            say("Potence purgée", IconSkull);
          } catch (e) {
            say(e instanceof Error ? e.message : "Erreur", IconSkull);
          } finally {
            setBusy(null);
          }
        })(),
    });

  async function readMsg(m: InboxItem) {
    setOpeningMsg(true);
    try {
      const r = await fetch(`/api/message?account=${m.account}&uid=${m.uid}`);
      if (r.ok) {
        setReadingCtx(null);
        setImproveText(null);
        setReadingMsg(await r.json());
      } else say("Parchemin illisible", IconSkull);
    } finally {
      setOpeningMsg(false);
    }
  }

  // Ferme la lecture d'une missive : le texte "Reforger" en cours est conservé
  // (par missive) pour être restauré à la prochaine ouverture.
  function closeReadingMsg() {
    if (readingCtx && improveText?.trim()) {
      setImproveSaved((s) => ({ ...s, [`${readingCtx.account}:${readingCtx.uid}`]: improveText }));
    }
    setReadingMsg(null);
    setReadingCtx(null);
    setImproveText(null);
  }

  async function msgAction(m: InboxItem, action: "generate" | "mute" | "delete" | "deleteAll" | "deleteAllGo" | "unmute") {
    const key = `msg:${m.account}:${m.uid}`;
    if (busy) return;
    setBusy(key);
    try {
      if (action === "generate") {
        say("La missive se forge…", IconWand);
        const r = await sendJson("/api/message/generate", { account: m.account, uid: m.uid });
        if (!r.ok) throw new Error(await apiError(r));
        say("Missive forgée !", IconWand);
        await refreshAfter(m.account);
      } else if (action === "mute") {
        dropInboxItems(m.account, (x) => x.fromEmail === m.fromEmail);
        setMuted((p) => (p.some((x) => x.account === m.account && x.sender === m.fromEmail) ? p : [...p, { account: m.account, sender: m.fromEmail }]));
        mutate({ url: "/api/mute", init: jsonInit({ account: m.account, sender: m.fromEmail }) });
        say("Correspondant banni", IconVolumeOff);
      } else if (action === "unmute") {
        setMuted((p) => p.filter((x) => !(x.account === m.account && x.sender === m.fromEmail)));
        mutate({ url: "/api/mute", init: jsonInit({ account: m.account, sender: m.fromEmail }, "DELETE") });
        say("Correspondant gracié", IconBell);
      } else if (action === "delete") {
        dropInboxItems(m.account, (x) => x.uid === m.uid);
        // Non bloquant : suppression IMAP + re-relève en tâche de fond — le
        // swipe suivant est libre tout de suite (l'item est déjà retiré).
        void (async () => {
          try {
            const r = await fetch(`/api/message?account=${m.account}&uid=${m.uid}`, { method: "DELETE" });
            if (!r.ok) throw new Error(await apiError(r));
            say("Missive à la potence", IconTrash);
            await refreshAfter(m.account);
          } catch (e) {
            say(e instanceof Error ? e.message : "Erreur", IconSkull);
            await refreshAfter(m.account);
          }
        })();
      } else if (action === "deleteAll") {
        setBusy(null);
        setConfirm({
          label: `Jeter TOUTES les missives de ${m.from} à la potence ?`,
          run: () => void msgAction(m, "deleteAllGo"),
        });
        return;
      } else {
        // deleteAllGo — après confirmation (suppression par adresse exacte).
        dropInboxItems(m.account, (x) => x.fromEmail === m.fromEmail);
        void (async () => {
          try {
            const r = await fetch(`/api/message?account=${m.account}&sender=${encodeURIComponent(m.fromEmail)}`, { method: "DELETE" });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error ?? "Échec");
            say(`${j.deleted ?? 0} missive(s) à la potence`, IconTrash);
            await refreshAfter(m.account);
          } catch (e) {
            say(e instanceof Error ? e.message : "Erreur", IconSkull);
            await refreshAfter(m.account);
          }
        })();
      }
    } catch (e) {
      say(e instanceof Error ? e.message : "Erreur", IconSkull);
      await refreshAfter(m.account);
    } finally {
      setBusy(null);
    }
  }

  // Verrouillage : révoque la session serveur et purge le snapshot local
  // (métadonnées mails + quêtes stockées en clair dans localStorage).
  async function logout() {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch { /* offline : le cookie restera, expiré à sa date */ }
    clearOfflineData();
    router.push("/login");
  }

  // Des modifs hors-ligne en attente seraient perdues : on prévient d'abord.
  function lock() {
    if (pending === 0) return void logout();
    setConfirm({
      label: `${pending} modification(s) pas encore synchronisée(s) seront perdues. Verrouiller quand même ?`,
      run: () => void logout(),
    });
  }

  const top = pile.slice(0, 3);
  const activeQuests = tasks.filter((t) => !t.done);
  // Quêtes accomplies dans la « journée » courante (6h du matin → 6h du matin).
  const doneToday = tasks.filter((t) => t.done && t.done_at && +new Date(t.done_at) >= +dayStart()).length;
  // Cœurs : 5 emplacements vides, +1 par quête au-delà, cap à 10 (+n au-delà).
  const heartsFilled = Math.min(doneToday, 10);
  const heartsTotal = Math.min(Math.max(5, doneToday), 10);
  // Le ref mémorise le compte précédent : les cœurs nouvellement gagnés « poppent ».
  const prevDone = useRef(doneToday);
  useEffect(() => { prevDone.current = doneToday; }, [doneToday]);
  // Prophéties < 24h (passées non faites incluses) affichées sur l'accueil.
  const soon = agenda.filter((e) => !e.done && +new Date(e.due_at) < Date.now() + 24 * 3600_000);
  const inbox = inboxOf ? accounts.find((a) => a.id === inboxOf) : null;

  // Ajout rapide (bouton + du header) : 1 ligne = 1 quête, en haut de pile.
  const submitQuick = () => {
    if (!quickText.trim()) return;
    quests.add(quickText);
    setQuickText("");
    setQuickAdd(false);
  };

  return (
    <>
      {/* inert en pause : ni clic, ni Tab, ni Entrée n'atteignent l'app sous
          l'écran « déjà ouvert ailleurs » — l'instance ne peut rien modifier. */}
      <main className="min-h-dvh flex flex-col p-4 gap-4 max-w-md mx-auto w-full" inert={!!blocked}>
        <header className="flex items-center justify-between">
          <h1 className="font-pixel text-[var(--gold-bright)] text-xs">TIDY QUEST</h1>
          <div className="flex gap-2 items-center">
            {(offline || pending > 0) && (
              <span className="font-pixel text-[7px] text-[var(--gold-bright)] flex items-center gap-1" title={pending > 0 ? `${pending} modif(s) en attente` : "Hors-ligne"}>
                <IconWifiOff size={14} /> {pending > 0 ? `HORS-LIGNE (${pending})` : "HORS-LIGNE"}
              </span>
            )}
            {/* Réseau OK mais API en erreur : ne pas faire croire à un hors-ligne. */}
            {serverDown && !offline && (
              <span className="font-pixel text-[7px] text-[var(--ruby)] flex items-center gap-1" title="Le serveur ne répond pas correctement">
                <IconAlertTriangle size={14} /> SERVEUR KO
              </span>
            )}
            <button className="btn-pixel ghost !px-2" onClick={() => { setQuickText(""); setQuickAdd(true); }} title="Nouvelle quête">
              <IconPlus size={18} />
            </button>
            {canInstall && (
              <button className="btn-pixel ghost !px-2" onClick={() => void installApp()} title="Installer l'app"><IconDeviceMobileDown size={18} /></button>
            )}
            <button className="btn-pixel ghost !px-2" onClick={() => void togglePush()} title="Notifications">
              {pushOn ? <IconBell size={18} /> : <IconBellOff size={18} />}
            </button>
            <button className="btn-pixel ghost !px-2" onClick={() => void refresh({ fresh: true })} title="Rafraîchir"><IconRefresh size={18} /></button>
          </div>
        </header>

        <Hud accounts={accounts} onAccountTap={(id) => {
          setInboxOf(id);
          setTrash(null);
          if (accounts.find((a) => a.id === id)?.manual) void pollAccount(id);
        }} />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5" title={`${doneToday} quête${doneToday > 1 ? "s" : ""} exécutée${doneToday > 1 ? "s" : ""} aujourd'hui (jour = 6h→6h)`}>
            {Array.from({ length: heartsTotal }, (_, i) =>
              i < heartsFilled ? (
                <IconHeartFilled
                  key={i}
                  size={17}
                  className={`text-[var(--ruby)]${i >= prevDone.current ? " animate-[heartPop_.5s_ease-out]" : ""}`}
                />
              ) : (
                <IconHeart key={i} size={17} className="opacity-40" />
              ),
            )}
          </div>
          <div className="flex gap-1.5">
            <button className="btn-pixel ghost !px-2 !py-1 text-[9px] flex items-center gap-1" onClick={() => setShowAgenda(true)} title="Prophéties">
              <IconCalendarClock size={16} /> {agenda.filter((e) => !e.done).length}
            </button>
            <button className="btn-pixel ghost !px-2 !py-1 text-[9px] flex items-center gap-1" onClick={() => setShowNotes(true)} title="Fourre-tout">
              <IconNotebook size={16} /> {notes.filter((n) => { const it = parseNoteItems(n.body); return it.length === 0 || it.some((i) => !i.done); }).length}
            </button>
            <button className="btn-pixel ghost !px-2 !py-1 text-[9px] flex items-center gap-1" onClick={() => setShowQuest(true)} title="Quêtes">
              <IconSword size={16} /> {tasks.filter((t) => !t.done).length}
            </button>
            <button className="btn-pixel ghost !px-2 !py-1 text-[9px] flex items-center gap-1" onClick={() => setShowAside(!showAside)} title="Jarre">
              <IconPackage size={16} /> {aside.length}
            </button>
          </div>
        </div>

        <div className="relative flex-1 min-h-[340px]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center font-pixel text-[10px] anim-hint">LE VOYAGE COMMENCE…</div>
          ) : pile.length === 0 ? (
            // Pile vide : pas d'écran mort — les quêtes en cours prennent
            // la place, avec les mêmes swipes que le panneau Quêtes.
            activeQuests.length === 0 && soon.length === 0 ? (
              <Victory />
            ) : (
              <div className="flex flex-col gap-1.5 pt-2">
                {soon.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <div className="font-pixel text-[7px] opacity-60 text-center">🔮 PROCHAINES PROPHÉTIES</div>
                    {soon.slice(0, 5).map((e) => (
                      <SoonProphecy
                        key={e.id}
                        ev={e}
                        busy={!!busy}
                        onDone={prophecies.done}
                        onDelete={prophecies.remove}
                        onOpen={() => setShowAgenda(true)}
                      />
                    ))}
                    {soon.length > 5 && (
                      <button className="btn-pixel ghost !py-1.5 mt-0.5 text-[8px]" onClick={() => setShowAgenda(true)}>
                        🔮 VOIR TOUTES LES PROPHÉTIES ({soon.length})
                      </button>
                    )}
                  </div>
                )}
                {activeQuests.length > 0 && soon.length > 0 && <div className="border-t-2 border-[var(--gold)] my-1" />}
                {activeQuests.length > 0 && (
                  <div className="font-pixel text-[7px] opacity-60 text-center">
                    ⚔ QUÊTES EN COURS
                  </div>
                )}
                <SortableList
                  items={activeQuests.slice(0, 5)}
                  onReorder={(next) =>
                    quests.reorder([...next.map((t) => t.id), ...activeQuests.slice(5).map((t) => t.id)])
                  }
                  renderItem={(t, grip) => (
                    <ItemRow
                      item={t}
                      grip={grip}
                      doneLabel="⚔ QUÊTE FAITE"
                      bottomLabel="⇣ FOND DE PILE"
                      onDone={() => quests.done(t.id)}
                      onBottom={() => quests.bottom(t.id)}
                      onEdit={(text) => quests.update(t.id, text)}
                    />
                  )}
                />
                {activeQuests.length > 5 && (
                  <button
                    className="btn-pixel ghost !py-2 mt-1 text-[9px]"
                    onClick={() => { setQuestReserve(true); setShowQuest(true); }}
                  >
                    ⚔ VOIR TOUTES LES QUÊTES ({activeQuests.length})
                  </button>
                )}
              </div>
            )
          ) : (
            <AnimatePresence>
              {[...top].reverse().map((d, i) => {
                const idx = top.length - 1 - i;
                return (
                  <DraftCard
                    key={`${d.account}:${d.uid}`}
                    draft={d}
                    accountColor={accounts.find((a) => a.id === d.account)?.color ?? "#888"}
                    zIndex={10 + idx}
                    onSend={() => act(d, "send")}
                    onAside={() => act(d, "aside")}
                    onExpand={() => read(d)}
                    onReadOriginal={() => readOriginal(d)}
                  />
                );
              })}
            </AnimatePresence>
          )}
          {pile.length > 0 && (
            <div className="absolute -bottom-2 inset-x-0 flex justify-between font-pixel text-[7px] opacity-60 pointer-events-none px-2">
              <span className="anim-hint">◀ À LA JARRE</span>
              <span className="anim-hint">EXPÉDIER ▶</span>
            </div>
          )}
        </div>

        {/* Boutons accessibles (fallback sans swipe) */}
        {pile.length > 0 && (
          <div className="flex gap-3 safe-bottom">
            <button className="btn-pixel danger flex-1 flex items-center justify-center gap-2" disabled={!!busy} onClick={() => act(pile[0], "aside")}><IconPackage size={24} /> Jarre</button>
            <button className="btn-pixel flex-1 flex items-center justify-center gap-2" disabled={!!busy} onClick={() => act(pile[0], "send")}><IconSword size={24} /> Expédier</button>
          </div>
        )}

        {/* Panneaux toujours montés (cachés en CSS) : le texte en cours de
            saisie survit à la fermeture/réouverture. */}
        <div className={showQuest ? "contents" : "hidden"}>
          <QuestPanel
            tasks={tasks}
            busy={!!busy}
            refreshing={loading}
            onRefresh={() => void refresh({ fresh: true })}
            onClose={() => { setShowQuest(false); setQuestReserve(false); }}
            open={showQuest}
            onAdd={quests.add}
            onDone={quests.done}
            onUndone={quests.undone}
            onBottom={quests.bottom}
            onTop={quests.top}
            onReorder={quests.reorder}
            onPurge={quests.purge}
            onPurgeOne={quests.purgeOne}
            onUpdate={quests.update}
            showReserve={questReserve}
            onToggleReserve={() => setQuestReserve((v) => !v)}
          />
        </div>

        <div className={showNotes ? "contents" : "hidden"}>
          <NotesPanel
            notes={notes}
            busy={!!busy}
            ask={setConfirm}
            refreshing={loading}
            onRefresh={() => void refresh({ fresh: true })}
            onClose={() => setShowNotes(false)}
            onAdd={notesApi.add}
            onDelete={notesApi.remove}
            onUpdate={notesApi.update}
            onReorder={notesApi.reorder}
          />
        </div>

        <div className={showAgenda ? "contents" : "hidden"}>
          <AgendaPanel
            events={agenda}
            busy={!!busy}
            refreshing={loading}
            onRefresh={() => void refresh({ fresh: true })}
            open={showAgenda}
            onClose={() => setShowAgenda(false)}
            onAdd={prophecies.add}
            onDone={prophecies.done}
            onUndone={prophecies.undone}
            onDelete={prophecies.remove}
            onUpdate={prophecies.update}
            onSchedule={prophecies.schedule}
          />
        </div>

        {/* Pile "de côté" */}
        {showAside && (
          <Sheet onClose={() => setShowAside(false)}>
            <div className="flex items-center justify-between">
              <div className="font-pixel text-[9px] text-[var(--gold-bright)]">LA JARRE AUX MISSIVES ({aside.length})</div>
              <div className="flex items-center gap-2">
                {aside.length > 0 && (
                  <button className="btn-pixel danger !py-1.5 !px-2 text-[8px] flex items-center gap-1" disabled={!!busy} onClick={clearJar}>
                    <IconTrash size={16} /> Briser la jarre
                  </button>
                )}
                <RefreshButton onClick={() => void refresh({ fresh: true })} spinning={loading} disabled={!!busy} />
                <button className="btn-pixel ghost !px-2" onClick={() => setShowAside(false)}><IconX size={18} /></button>
              </div>
            </div>
            {aside.length === 0 && <div className="opacity-60">La jarre est vide.</div>}
            {aside.map((d) => (
              <div key={`${d.account}:${d.uid}`} className="flex items-center gap-3 bg-[var(--shadow)] p-3 border border-[#3a5a2a]">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-lg">
                    {d.to} — {d.subject}
                    {d.ai && <span className="font-pixel text-[6px] text-[#8a6d3b] ml-2" title="Forgée par l'IA">🤖</span>}
                  </div>
                  <div className="font-pixel text-[7px] opacity-60">{d.account}</div>
                </div>
                <button className="btn-pixel !py-2 !px-2.5" title="Renvoyer en quête" disabled={!!busy} onClick={() => act(d, "restore")}><IconArrowBackUp size={20} /></button>
                <button className="btn-pixel danger !py-2 !px-2.5" title="Expédier" disabled={!!busy} onClick={() => act(d, "send")}><IconSword size={20} /></button>
              </div>
            ))}
          </Sheet>
        )}

        {/* Ajout rapide de quête (bouton + du header). */}
        {quickAdd && (
          <Sheet onClose={() => setQuickAdd(false)}>
            <div className="font-pixel text-[9px] text-[var(--gold-bright)]">⚔ NOUVELLE QUÊTE</div>
            <div className="flex gap-2 items-end">
              <AutosizeTextarea
                autoFocus
                className="flex-1 min-w-0 bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
                placeholder="Ta quête, héros… (1 ligne = 1 quête)"
                value={quickText}
                onChange={(e) => setQuickText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitQuick(); }
                }}
              />
              <button className="btn-pixel !px-3 self-end" disabled={!!busy || !quickText.trim()} onClick={submitQuick} title="Ajouter">
                <IconPlus size={18} />
              </button>
            </div>
          </Sheet>
        )}

        {/* Tiroir inbox */}
        {inbox && (
          <InboxDrawer
            inbox={inbox}
            items={orderedInbox(inbox)}
            polling={pollingId === inbox.id}
            muted={muted}
            trash={trash}
            busy={!!busy}
            refreshing={loading}
            onRefresh={() => { void refresh({ fresh: true }); if (inbox.manual) void pollAccount(inbox.id); }}
            onClose={() => { setInboxOf(null); setTrash(null); }}
            onOpen={(m) => void readMsg(m)}
            onReorder={(next) => inboxReorder(inbox.id, next)}
            onAction={(m, action) => void msgAction(m, action)}
            onLoadTrash={() => void loadTrash(inbox.id)}
            onTrashAction={(m, action) => void trashAction(m, action)}
            onPurgeTrash={purgeTrashAll}
            onLogout={lock}
          />
        )}

        {/* Chargement d'une missive (IMAP peut prendre 1-2 s) */}
        {openingMsg && !readingMsg && (
          <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
            <div className="card-parchment max-w-md w-full p-5 text-center font-pixel text-[9px] text-[#8a6d3b] animate-pulse">
              Décachetage de la missive…
            </div>
          </div>
        )}

        {/* Lecture message inbox */}
        {readingMsg && (
          <MessageReader
            msg={readingMsg}
            ctx={readingCtx}
            improveText={improveText}
            busy={!!busy}
            onImproveText={setImproveText}
            onClose={closeReadingMsg}
            onImprove={() => void improveMissive()}
            onGenerate={(m) => { setReadingMsg(null); void msgAction(m, "generate"); }}
          />
        )}

        {/* Lecture draft */}
        {reading && (
          <DraftReader
            draft={reading}
            busy={!!busy}
            onClose={() => setReading(null)}
            onReadOriginal={(d) => { setReading(null); void readOriginal(d); }}
            onAside={(d) => { setReading(null); void act(d, "aside"); }}
            onSend={(d) => { setReading(null); void act(d, "send"); }}
          />
        )}

        {/* Confirmation stylée */}
        {confirm && (
          <ConfirmDialog
            label={confirm.label}
            onCancel={() => setConfirm(null)}
            onConfirm={() => { const r = confirm.run; setConfirm(null); r(); }}
          />
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 inset-x-0 z-50 flex justify-center pointer-events-none">
            <div className="panel px-5 py-3 font-pixel text-[9px] text-[var(--gold-bright)] flex items-center gap-2.5">
              {toast.Icon && <toast.Icon size={24} />}
              {toast.msg}
              {toast.onUndo && (
                <button
                  className="pointer-events-auto font-pixel text-[9px] text-[var(--gold)] border-b border-[var(--gold)] leading-none"
                  onClick={() => { toast.onUndo?.(); dismissToast(); }}
                >
                  ANNULER
                </button>
              )}
            </div>
          </div>
        )}
      </main>
      {/* Instance unique : cette fenêtre est en pause, une autre est active. */}
      {blocked && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" data-layer="">
          <div className="panel max-w-sm w-full p-5 flex flex-col gap-4 text-center">
            <div className="font-pixel text-[9px] text-[var(--gold-bright)]">⚔ TIDY QUEST</div>
            <div className="text-lg leading-snug">
              {blocked === "busy" ? "Tidy Quest est déjà ouvert dans une autre fenêtre ou un autre onglet." : "Tidy Quest a été repris dans une autre fenêtre."}
            </div>
            <button className="btn-pixel" autoFocus onClick={takeOver}>Utiliser ici</button>
          </div>
        </div>
      )}
    </>
  );
}
