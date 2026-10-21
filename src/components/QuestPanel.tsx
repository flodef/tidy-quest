"use client";

import AutosizeTextarea from "@/components/AutosizeTextarea";
import { useEffect, useRef, useState } from "react";
import {
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconClipboardCopy,
  IconCopyCheck,
  IconPlus,
  IconSearch,
  IconSkull,
  IconX,
} from "@tabler/icons-react";
import ItemRow from "@/components/ItemRow";
import RefreshButton from "@/components/RefreshButton";
import Sheet from "@/components/Sheet";
import SortableList from "@/components/SortableList";
import { copyToClipboard } from "@/lib/clipboard";
import { foldText } from "@/lib/similar";
import type { Task } from "@/lib/db";

const VISIBLE = 5;

export default function QuestPanel({
  tasks,
  busy,
  refreshing,
  onClose,
  onRefresh,
  onAdd,
  onDone,
  onUndone,
  onBottom,
  onTop,
  onReorder,
  onPurge,
  onPurgeOne,
  onUpdate,
  showReserve,
  onToggleReserve,
}: {
  tasks: Task[];
  busy: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onClose: () => void;
  onAdd: (text: string) => void;
  onDone: (id: string) => void;
  onUndone: (id: string) => void;
  onBottom: (id: string) => void;
  onTop: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onPurge: () => void;
  onPurgeOne: (id: string) => void;
  onUpdate: (id: string, text: string) => void;
  /** Réserve (quêtes > top 5) dépliée — état remonté au parent : le bouton
      « voir toutes les quêtes » de l'écran d'accueil l'ouvre direct. */
  showReserve: boolean;
  onToggleReserve: () => void;
}) {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  // Scroll : à l'ouverture de la réserve, on descend jusqu'au 6e item.
  // Double rAF : le panneau sort de `hidden` dans le même commit — le layout
  // doit être posé avant le scrollIntoView, sinon il part dans le vide.
  const firstReserveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showReserve) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        firstReserveRef.current?.scrollIntoView({ block: "nearest" });
      });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [showReserve]);
  const active = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const hidden = active.length - VISIBLE;
  // Recherche : filtre actives + terminées (conservées barrées en fin de liste).
  const q = foldText(query.trim());
  const results = q ? tasks.filter((t) => foldText(t.text).includes(q)) : null;

  // Copie les quêtes en cours (top 5 + réserve) : "• quête", 1 par ligne
  // (les puces sont ignorées au collage dans "Nouvelle quête…").
  async function exportQuests() {
    await copyToClipboard(active.map((t) => `• ${t.text}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function submit() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    onAdd(t);
  }

  // Replié : on réordonne dans le top 5, la réserve reste en place.
  function handleReorder(next: Task[]) {
    onReorder([
      ...next.map((t) => t.id),
      ...active.slice(VISIBLE).map((t) => t.id),
    ]);
  }

  // Déplié : liste unique — glisser une quête de réserve dans le top 5
  // l'insère à cette position et pousse l'ancienne n°5 dans la réserve.
  function handleFullReorder(next: Task[]) {
    onReorder(next.map((t) => t.id));
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className="font-pixel text-[9px] text-[var(--gold-bright)]">
          ⚔ QUÊTES ({active.length})
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className="btn-pixel ghost !px-2"
            onClick={() => {
              setSearchOpen((s) => !s);
              setQuery("");
            }}
            title="Filtrer les quêtes (aussi les terminées)"
          >
            <IconSearch size={18} />
          </button>
          <button
            className="btn-pixel ghost !px-2"
            disabled={busy || active.length === 0}
            onClick={exportQuests}
            title="Copier les quêtes en cours (1 par ligne)"
          >
            {copied ? (
              <IconCopyCheck size={18} className="text-[var(--link-green)]" />
            ) : (
              <IconClipboardCopy size={18} />
            )}
          </button>
          {onRefresh && (
            <RefreshButton
              onClick={onRefresh}
              spinning={refreshing}
              disabled={busy}
            />
          )}
          <button className="btn-pixel ghost !px-2" onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <AutosizeTextarea
          className="flex-1 min-w-0 bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Nouvelle quête… (1 ligne = 1 quête)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="btn-pixel !px-3 self-end"
          disabled={busy || !input.trim()}
          onClick={submit}
        >
          <IconPlus size={18} />
        </button>
      </div>

      {searchOpen && (
        <input
          autoFocus
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Filtrer les quêtes… (actives + terminées)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (query) setQuery("");
              else setSearchOpen(false);
            }
          }}
        />
      )}

      {results ? (
        <div className="flex flex-col gap-1.5">
          {results.length === 0 && (
            <div className="opacity-60">Aucune quête trouvée.</div>
          )}
          {results.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-2 bg-[var(--shadow)] p-2 border border-[#3a5a2a] text-base${t.done ? " opacity-50" : ""}`}
            >
              <div
                className={`flex-1 min-w-0 break-words${t.done ? " line-through" : ""}`}
              >
                {t.text}
              </div>
              <button
                className="shrink-0 opacity-70 hover:opacity-100"
                disabled={busy}
                title={t.done ? "Remettre dans la pile" : "Marquer faite"}
                onClick={() => (t.done ? onUndone(t.id) : onDone(t.id))}
              >
                {t.done ? (
                  <IconArrowBackUp size={16} />
                ) : (
                  <IconCheck size={16} />
                )}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          {!showReserve && (
            <SortableList
              items={active.slice(0, VISIBLE)}
              onReorder={handleReorder}
              renderItem={(t, grip) => (
                <ItemRow
                  item={t}
                  grip={grip}
                  doneLabel="⚔ QUÊTE FAITE"
                  bottomLabel="⇣ FOND DE PILE"
                  onDone={() => onDone(t.id)}
                  onBottom={() => onBottom(t.id)}
                  onEdit={(text) => onUpdate(t.id, text)}
                />
              )}
            />
          )}
          {showReserve && (
            <SortableList
              items={active}
              onReorder={handleFullReorder}
              renderItem={(t, grip, i) => (
                <div ref={i === VISIBLE ? firstReserveRef : undefined} className="scroll-mb-8">
                  {i >= VISIBLE ? (
                    <ItemRow
                      item={t}
                      grip={grip}
                      dim
                      doneLabel="⚔ QUÊTE FAITE"
                      bottomLabel="⇡ EN HAUT DE PILE"
                      onDone={() => onDone(t.id)}
                      onBottom={() => onTop(t.id)}
                      onEdit={(text) => onUpdate(t.id, text)}
                    />
                  ) : (
                    <ItemRow
                      item={t}
                      grip={grip}
                      doneLabel="⚔ QUÊTE FAITE"
                      bottomLabel="⇣ FOND DE PILE"
                      onDone={() => onDone(t.id)}
                      onBottom={() => onBottom(t.id)}
                      onEdit={(text) => onUpdate(t.id, text)}
                    />
                  )}
                </div>
              )}
            />
          )}
          {active.length === 0 && (
            <div className="opacity-60">Aucune quête en cours.</div>
          )}
          {hidden > 0 && (
            // Sticky : le bouton reste visible au bas du panneau quand la réserve
            // est dépliée, au lieu de finir tout en bas de la liste.
            <div
              className={`${showReserve ? "sticky bottom-0 z-10" : ""} bg-[var(--forest-2)] py-1 -my-1`}
            >
              <button
                className="btn-pixel ghost w-full flex items-center justify-center gap-1.5 !py-1.5 font-pixel text-[7px]"
                onClick={onToggleReserve}
              >
                <IconChevronDown
                  size={14}
                  className={`transition-transform ${showReserve ? "rotate-180" : ""}`}
                />
                {hidden} QUÊTE(S) EN RÉSERVE
              </button>
            </div>
          )}
          <div className="font-pixel text-[6px] opacity-50 text-center">
            ◀ FOND DE PILE · GLISSER ☰ POUR RÉORDONNER · QUÊTE FAITE ▶ ·
            TOUCHER POUR ÉDITER
          </div>

          {done.length > 0 && (
            <div className="mt-1 pt-2 border-t border-[#2a4a2a]">
              <div className="flex items-center justify-between">
                <button
                  className="btn-pixel ghost !py-1.5 !px-2 font-pixel text-[7px] flex items-center gap-1.5"
                  onClick={() => setShowDone((s) => !s)}
                >
                  <IconChevronDown
                    size={14}
                    className={`transition-transform ${showDone ? "rotate-180" : ""}`}
                  />
                  TROPHÉES ({done.length})
                </button>
                <button
                  className="btn-pixel danger !py-1.5 !px-2 text-[8px] flex items-center gap-1"
                  disabled={busy}
                  onClick={onPurge}
                >
                  <IconSkull size={14} /> Purger
                </button>
              </div>
              {showDone && (
                <div className="flex flex-col gap-1.5 opacity-50 mt-1.5">
                  {done.map((t) => (
                    <ItemRow
                      key={t.id}
                      item={t}
                      strike
                      doneLabel="⇡ EN HAUT DE PILE"
                      bottomLabel="☠ PURGER"
                      onDone={() => onUndone(t.id)}
                      onBottom={() => onPurgeOne(t.id)}
                      onEdit={(text) => onUpdate(t.id, text)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
