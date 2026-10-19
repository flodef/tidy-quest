"use client";

import { useRef, useState } from "react";
import { IconCheck, IconGripVertical } from "@tabler/icons-react";
import SwipeRow from "@/components/SwipeRow";
import type { GripProps } from "@/components/SortableList";

export { SWIPE_X } from "@/components/SwipeRow";

export default function ItemRow<T>({
  item,
  grip,
  onDone,
  onBottom,
  onEdit,
  dim = false,
  strike = false,
  doneLabel = "⚔ FAIT",
  bottomLabel = "⇣ FOND",
}: {
  item: T;
  /** Absent → pas de poignée ☰ (item non triable, ex. trophées). */
  grip?: GripProps;
  onDone: () => void;
  onBottom: () => void;
  onEdit?: (text: string) => void;
  dim?: boolean;
  /** Texte barré (quête accomplie). */
  strike?: boolean;
  doneLabel?: string;
  bottomLabel?: string;
}) {
  // Un swipe relâché au point de départ produit un click : SwipeRow mémorise
  // tout déplacement >10px pour l'ignorer (vrai tap = pas de drag).
  const dragged = useRef(false);
  const text = (item as { text?: string }).text ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function saveEdit() {
    const t = draft.trim();
    if (t && t !== text) onEdit?.(t);
    setEditing(false);
  }

  return (
    <SwipeRow
      onRight={onDone}
      onLeft={onBottom}
      rightLabel={doneLabel}
      leftLabel={bottomLabel}
      dim={dim}
      disabled={editing}
      swipedRef={dragged}
      contentClassName={`flex items-center gap-2 bg-[var(--shadow)] py-2.5 pr-2.5 ${grip ? "pl-7" : "pl-2.5"} border border-[#3a5a2a] select-none`}
    >
      {/* Poignée HORS de la zone swipe : glisser ☰ horizontalement ne doit
          jamais déclencher l'action gauche/droite (framer capte le pointeur
          en natif avant le stopPropagation de React). */}
      {grip && (
        <button
          {...grip}
          className="absolute -left-px top-0 bottom-0 w-6 z-20 flex items-center justify-center opacity-50 cursor-grab active:cursor-grabbing touch-none"
          aria-label="Réordonner"
        >
          <IconGripVertical size={16} />
        </button>
      )}
      {editing ? (
        <>
          <input
            autoFocus
            className="flex-1 min-w-0 bg-black/30 border border-[var(--gold)] px-2 py-0.5 text-lg outline-none focus:border-[var(--gold-bright)]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit();
              else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
            onBlur={saveEdit}
          />
          <button className="shrink-0 opacity-70 hover:opacity-100" title="Valider" onClick={saveEdit}>
            <IconCheck size={18} />
          </button>
        </>
      ) : (
        <div
          className={`flex-1 min-w-0 text-lg leading-snug break-words${onEdit ? " cursor-text" : ""}${strike ? " line-through" : ""}`}
          onPointerDown={() => (dragged.current = false)}
          onClick={() => {
            if (dragged.current || !onEdit) return;
            setDraft(text);
            setEditing(true);
          }}
        >
          {text}
        </div>
      )}
    </SwipeRow>
  );
}
