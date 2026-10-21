"use client";

import AutosizeTextarea from "@/components/AutosizeTextarea";
import { useMemo, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconChevronDown,
  IconClipboardCopy,
  IconCopyCheck,
  IconGripVertical,
  IconPlus,
  IconSearch,
  IconSkull,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import ItemRow from "@/components/ItemRow";
import Sheet from "@/components/Sheet";
import RefreshButton from "@/components/RefreshButton";
import SortableList, { type GripProps } from "@/components/SortableList";
import { copyToClipboard } from "@/lib/clipboard";
import { fmtShort } from "@/lib/dates";
import { findSimilar, foldText } from "@/lib/similar";
import {
  bulletizeNote,
  parseNoteItems,
  serializeNoteItems,
  type NoteItem,
} from "@/lib/items";
import type { Note } from "@/lib/db";
import type { Ask } from "@/lib/hooks";

type Item = NoteItem & { id: string };

// Id stable = texte + rang d'occurrence (et non l'index) : cocher/réordonner
// un item ne fait plus « glisser » l'état local (mode édition) d'une ligne
// à l'autre — SortableList et React indexent les lignes par cet id.
function parseItems(body: string): Item[] {
  const seen = new Map<string, number>();
  return parseNoteItems(body).map((i) => {
    const n = seen.get(i.text) ?? 0;
    seen.set(i.text, n + 1);
    return { ...i, id: `${i.text}\u0000${n}` };
  });
}

// Compte "fait/total" des items d'une note ; `allDone` quand tout est terminé.
function noteProgress(body: string): {
  done: number;
  total: number;
  allDone: boolean;
} {
  const items = parseNoteItems(body);
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    allDone: items.length > 0 && done === items.length,
  };
}

function NoteDetail({
  note,
  busy,
  ask,
  onBack,
  onClose,
  onUpdate,
  onDelete,
}: {
  note: Note;
  busy: boolean;
  /** Confirmation (ConfirmDialog de la page). */
  ask: Ask;
  onBack: () => void;
  /** Ferme tout le panneau (✕ de l'en-tête). */
  onClose: () => void;
  onUpdate: (id: string, body: string) => void;
  onDelete: (id: string) => void;
}) {
  const items = useMemo(() => parseItems(note.body), [note.body]);
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const idCounter = useRef(0);

  const active = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  // Recherche dans les items de la note (sans accents, actifs + faits).
  // Pendant le filtrage : poignées ☰ masquées — un réordonnancement partiel
  // corromprait l'ordre complet (même règle que la recherche de la liste).
  const q = foldText(query.trim());
  const matchQ = (i: Item) => foldText(i.text).includes(q);
  const shownActive = q ? active.filter(matchQ) : active;
  const shownDone = q ? done.filter(matchQ) : done;

  // Exporte la note dans le presse-papier : "• tâche" / "✅ tâche", 1 par ligne
  // (format réimportable via parseNoteItems).
  async function exportItems() {
    await copyToClipboard(serializeNoteItems(items));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function save(next: Item[]) {
    onUpdate(note.id, serializeNoteItems(next));
  }

  // Anti quasi-doublon (ajout ET édition) : ressemble à un item actif →
  // confirmation inline, `run` applique l'action si on confirme.
  const [dupAsk, setDupAsk] = useState<{
    text: string;
    match: string;
    run: () => void;
  } | null>(null);

  function addItem(t: string) {
    setInput("");
    save([
      ...active,
      { id: `n${++idCounter.current}`, text: t, done: false },
      ...done,
    ]);
  }

  function submit() {
    const t = input.trim();
    if (!t) return;
    const match = findSimilar(
      t,
      active.map((i) => i.text),
    );
    if (match) setDupAsk({ text: t, match, run: () => addItem(t) });
    else addItem(t);
  }

  function confirmDup() {
    const run = dupAsk?.run;
    setDupAsk(null);
    run?.();
  }

  function itemDone(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    // Fait → tout en haut de la section "faits" (le dernier terminé est visible).
    save([
      ...active.filter((i) => i.id !== id),
      { ...it, done: true },
      ...done,
    ]);
  }

  function itemBottom(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    save([...active.filter((i) => i.id !== id), it, ...done]);
  }

  function itemEdit(id: string, text: string) {
    const apply = () =>
      save(items.map((i) => (i.id === id ? { ...i, text } : i)));
    const match = findSimilar(
      text,
      active.filter((i) => i.id !== id).map((i) => i.text),
    );
    if (match) setDupAsk({ text, match, run: apply });
    else apply();
  }

  // Suppression d'un item fait : confirmée (on efface rarement dans une
  // note — elle se coche item par item puis se termine en entier).
  function itemRemove(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    ask({
      label: `Supprimer « ${it.text.slice(0, 60)} » de la note ?`,
      run: () => save(items.filter((i) => i.id !== id)),
    });
  }

  function purgeDone() {
    ask({
      label: `Supprimer les ${done.length} item(s) fait(s) de la note ?`,
      run: () => save(active),
    });
  }

  function itemUndone(id: string) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    save([
      { ...it, done: false },
      ...active,
      ...done.filter((i) => i.id !== id),
    ]);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <button
          className="btn-pixel ghost !px-2"
          onClick={onBack}
          title="Retour à la liste"
        >
          <IconArrowLeft size={18} />
        </button>
        <div className="font-pixel text-[8px] text-[var(--gold-bright)] flex-1 min-w-0 break-words">
          {note.title}
          {items.length > 0 && (
            <span className="opacity-60">
              {" "}
              {done.length}/{items.length}
            </span>
          )}
        </div>
        <button
          className="btn-pixel ghost !px-2 shrink-0"
          onClick={() => {
            setSearchOpen((v) => !v);
            setQuery("");
          }}
          title="Chercher dans la note"
        >
          <IconSearch size={18} />
        </button>
        <button
          className="btn-pixel ghost !px-2 shrink-0"
          disabled={busy || items.length === 0}
          onClick={exportItems}
          title="Copier les tâches (1 par ligne)"
        >
          {copied ? (
            <IconCopyCheck size={16} className="text-[var(--link-green)]" />
          ) : (
            <IconClipboardCopy size={16} />
          )}
        </button>
        <button
          className="btn-pixel danger !px-2 shrink-0"
          disabled={busy}
          onClick={() => onDelete(note.id)}
          title="Jeter la note"
        >
          <IconTrash size={16} />
        </button>
        <button
          className="btn-pixel ghost !px-2 shrink-0"
          onClick={onClose}
          title="Fermer"
        >
          <IconX size={18} />
        </button>
      </div>
      <div className="font-pixel text-[6px] opacity-50">
        {fmtShort(note.created_at)}
      </div>

      {searchOpen && (
        <input
          autoFocus
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Chercher dans les items…"
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
      {q && (
        <div className="font-pixel text-[6px] opacity-50">
          {shownActive.length + shownDone.length} ITEM(S) TROUVÉ(S)
        </div>
      )}

      <div className="flex gap-2">
        <AutosizeTextarea
          className="flex-1 min-w-0 bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Ajouter un item…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <button
          className="btn-pixel !px-3"
          disabled={busy || !input.trim()}
          onClick={submit}
        >
          <IconPlus size={18} />
        </button>
      </div>

      {dupAsk && (
        <div className="flex items-center gap-2 bg-[var(--shadow)] border border-[var(--gold)] p-2 text-base">
          <div className="flex-1 min-w-0">
            « {dupAsk.text} » ressemble à « {dupAsk.match} » — confirmer quand
            même ?
          </div>
          <button
            className="btn-pixel !py-1 !px-2 text-[8px] shrink-0"
            disabled={busy}
            onClick={confirmDup}
          >
            Oui
          </button>
          <button
            className="btn-pixel ghost !py-1 !px-2 text-[8px] shrink-0"
            disabled={busy}
            onClick={() => setDupAsk(null)}
          >
            Non
          </button>
        </div>
      )}

      {q ? (
        <div className="flex flex-col gap-1.5">
          {shownActive.length === 0 && shownDone.length === 0 && (
            <div className="opacity-60">Aucun item trouvé.</div>
          )}
          {shownActive.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              onDone={() => itemDone(i.id)}
              onBottom={() => itemBottom(i.id)}
              onEdit={(text) => itemEdit(i.id, text)}
            />
          ))}
          {shownDone.map((i) => (
            <ItemRow
              key={i.id}
              item={i}
              strike
              doneLabel="⇡ REMETTRE"
              bottomLabel="☠ SUPPRIMER"
              onDone={() => itemUndone(i.id)}
              onBottom={() => itemRemove(i.id)}
            />
          ))}
        </div>
      ) : (
        <SortableList
          items={active}
          onReorder={(next) => save([...next, ...done])}
          renderItem={(i, grip) => (
            <ItemRow
              item={i}
              grip={grip}
              onDone={() => itemDone(i.id)}
              onBottom={() => itemBottom(i.id)}
              onEdit={(text) => itemEdit(i.id, text)}
            />
          )}
        />
      )}
      {active.length === 0 && items.length === 0 && (
        <div className="opacity-60">Note vide.</div>
      )}
      {!q && active.length === 0 && items.length > 0 && (
        <div className="opacity-60">Tout est fait ✅</div>
      )}
      {!q && (
        <div className="font-pixel text-[6px] opacity-50 text-center">
          ◀ FOND DE PILE · GLISSER ☰ POUR RÉORDONNER · FAIT ▶
        </div>
      )}

      {!q && done.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-1">
            <div className="font-pixel text-[8px] opacity-70">
              FAITS ({done.length})
            </div>
            <button
              className="btn-pixel danger !py-1.5 !px-2 text-[8px] flex items-center gap-1"
              disabled={busy}
              onClick={purgeDone}
            >
              <IconSkull size={14} /> Purger
            </button>
          </div>
          <div className="flex flex-col gap-1.5 opacity-50">
            {done.map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                strike
                doneLabel="⇡ REMETTRE"
                bottomLabel="☠ SUPPRIMER"
                onDone={() => itemUndone(i.id)}
                onBottom={() => itemRemove(i.id)}
              />
            ))}
          </div>
          <div className="font-pixel text-[6px] opacity-50 text-center">
            ◀ SUPPRIMER · REMETTRE ▶
          </div>
        </>
      )}
    </>
  );
}

function NoteCard({
  note,
  grip,
  onOpen,
}: {
  note: Note;
  grip?: GripProps;
  onOpen: () => void;
}) {
  const progress = noteProgress(note.body);
  const [copied, setCopied] = useState(false);

  // Copie tous les items ("• tâche" / "✅ tâche") — même export que dans le
  // détail, mais sans ouvrir la note. En absolu : la carte est un bouton,
  // un bouton imbriqué serait du HTML invalide.
  async function exportItems(e: React.MouseEvent) {
    e.stopPropagation();
    await copyToClipboard(bulletizeNote(note.body));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-stretch gap-1.5">
      {grip && (
        <button
          {...grip}
          className="shrink-0 opacity-50 cursor-grab active:cursor-grabbing touch-none flex items-center"
          aria-label="Réordonner"
        >
          <IconGripVertical size={18} />
        </button>
      )}
      <div className="relative flex-1 min-w-0">
        <button
          className="w-full h-full bg-[var(--shadow)] p-3 border border-[#3a5a2a] flex flex-col gap-1.5 text-left cursor-pointer"
          onClick={onOpen}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-pixel text-[8px] text-[var(--gold-bright)] min-w-0 break-words flex-1">
              {note.title}
            </div>
            {progress.total > 0 && (
              <div
                className={`font-pixel text-[8px] shrink-0 ${progress.allDone ? "text-[var(--link-green)]" : "opacity-70"}`}
              >
                {progress.done}/{progress.total}
              </div>
            )}
          </div>
          <div className="text-base leading-snug whitespace-pre-wrap break-words line-clamp-3">
            {parseNoteItems(note.body)
              .filter((i) => !i.done)
              .map((i) => i.text)
              .join("\n") || note.body}
          </div>
          <div className="font-pixel text-[6px] opacity-50">
            {fmtShort(note.created_at)}
          </div>
        </button>
        {progress.total > 0 && (
          <button
            className="absolute bottom-1.5 right-2 opacity-50 hover:opacity-100 p-1"
            onClick={exportItems}
            title="Copier les items (1 par ligne)"
          >
            {copied ? (
              <IconCopyCheck size={15} className="text-[var(--link-green)]" />
            ) : (
              <IconClipboardCopy size={15} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function NotesPanel({
  notes,
  busy,
  ask,
  refreshing,
  onClose,
  onRefresh,
  onAdd,
  onDelete,
  onUpdate,
  onReorder,
}: {
  notes: Note[];
  busy: boolean;
  ask: Ask;
  refreshing?: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onAdd: (body: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, body: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const open = notes.find((n) => n.id === openId) ?? null;
  // Recherche titre + corps, sans casse ni accents, sur toutes les notes
  // (en cours ET terminées).
  const q = foldText(query.trim());
  const results = q
    ? notes.filter((n) => foldText(`${n.title}\n${n.body}`).includes(q))
    : null;

  // Groupes terminés (tous les items faits) : relégués en bas, masqués par défaut.
  const [pending, completed] = useMemo(() => {
    const p: Note[] = [];
    const c: Note[] = [];
    for (const n of notes) (noteProgress(n.body).allDone ? c : p).push(n);
    return [p, c];
  }, [notes]);

  function submit() {
    const t = input.trim();
    if (!t) return;
    setInput("");
    onAdd(t);
  }

  function handleReorder(next: Note[]) {
    onReorder([...next, ...completed].map((n) => n.id));
  }

  return (
    <Sheet
      onClose={onClose}
      onEscape={open ? () => setOpenId(null) : undefined}
    >
      {!open && (
        <div className="flex items-center justify-between">
          <div className="font-pixel text-[9px] text-[var(--gold-bright)]">
            📒 FOURRE-TOUT ({notes.length})
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className="btn-pixel ghost !px-2"
              onClick={() => {
                setSearchOpen((v) => !v);
                setQuery("");
              }}
              title="Chercher dans les notes"
            >
              <IconSearch size={18} />
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
      )}

      {searchOpen && !open && (
        <input
          autoFocus
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Chercher… (titres + contenu)"
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

      {open ? (
        <NoteDetail
          note={open}
          busy={busy}
          ask={ask}
          onBack={() => setOpenId(null)}
          onClose={onClose}
          onUpdate={onUpdate}
          onDelete={(id) => {
            setOpenId(null);
            onDelete(id);
          }}
        />
      ) : results ? (
        // Pendant une recherche : pas de poignée ☰ — réordonner une liste
        // filtrée enverrait un ordre partiel et mélangerait la pile.
        <div className="flex flex-col gap-2">
          {results.length === 0 && (
            <div className="opacity-60">Aucune note trouvée.</div>
          )}
          {results.map((n) => (
            <div
              key={n.id}
              className={noteProgress(n.body).allDone ? "opacity-50" : ""}
            >
              <NoteCard note={n} onOpen={() => setOpenId(n.id)} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <AutosizeTextarea
              className="flex-1 min-w-0 bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
              placeholder="Note rapide… (1 ligne = 1 item)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              className="btn-pixel !px-3 self-end"
              disabled={busy || !input.trim()}
              onClick={submit}
            >
              <IconPlus size={18} />
            </button>
          </div>

          {notes.length === 0 && (
            <div className="opacity-60">Le fourre-tout est vide.</div>
          )}

          <SortableList
            items={pending}
            onReorder={handleReorder}
            renderItem={(n, grip) => (
              <NoteCard note={n} grip={grip} onOpen={() => setOpenId(n.id)} />
            )}
          />

          {showDone &&
            completed.map((n) => (
              <div key={n.id} className="opacity-50">
                <NoteCard note={n} onOpen={() => setOpenId(n.id)} />
              </div>
            ))}
          {completed.length > 0 && (
            // Sticky : reste visible au bas du panneau quand la liste des
            // terminés est dépliée (comme la réserve de Quêtes).
            <div
              className={`${showDone ? "sticky bottom-0 z-10" : ""} bg-[var(--forest-2)] py-1 -my-1`}
            >
              <button
                className="btn-pixel ghost w-full flex items-center justify-center gap-1.5 !py-1.5 font-pixel text-[7px]"
                onClick={() => setShowDone((s) => !s)}
              >
                <IconChevronDown
                  size={14}
                  className={`transition-transform ${showDone ? "rotate-180" : ""}`}
                />
                {completed.length} TERMINÉ(S)
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
