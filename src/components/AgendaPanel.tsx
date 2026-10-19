"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconPlus, IconSortAscending, IconSortDescending, IconX } from "@tabler/icons-react";
import DateTimeInput from "@/components/DateTimeInput";
import Sheet from "@/components/Sheet";
import RefreshButton from "@/components/RefreshButton";
import SwipeRow from "@/components/SwipeRow";
import { ceilToQuarter, fmtWhen, reminderFireTime, startOfDay } from "@/lib/dates";
import type { AgendaEvent } from "@/lib/db";

export const REMIND_OPTIONS = [
  { m: 30, l: "30 min" },
  { m: 60, l: "1 h" },
  { m: 120, l: "2 h" },
  { m: 180, l: "3 h" },
  { m: 360, l: "6 h" },
  { m: 720, l: "12 h" },
  { m: 1440, l: "24 h" },
  { m: 2880, l: "48 h" },
  { m: 4320, l: "3 j" },
  { m: 7200, l: "5 j" },
  { m: 10080, l: "7 j" },
];

export function remindLabel(m: number): string {
  return REMIND_OPTIONS.find((o) => o.m === m)?.l ?? `${m} min`;
}

function ReminderHint({ when, remind }: { when: Date | null; remind: number }) {
  const base = `RAPPEL PAR MAIL ${remindLabel(remind).toUpperCase()} AVANT`;
  if (!when) return <div className="font-pixel text-[6px] opacity-50">{base}</div>;
  const fire = reminderFireTime(when, remind);
  if (!fire) {
    const min = REMIND_OPTIONS.find((o) => reminderFireTime(when, o.m));
    return (
      <div className="font-pixel text-[6px] text-[var(--ruby)]">
        ⚠ RAPPEL IMPOSSIBLE : CRON 8H–22H{min ? ` — MIN : -${min.l.toUpperCase()}` : ""}
      </div>
    );
  }
  if (+fire !== +when - remind * 60_000) {
    return (
      <div className="font-pixel text-[6px] text-[var(--gold)]">
        ⚠ ENVOI {fmtWhen(fire.toISOString()).toUpperCase()} — CRON 8H–22H
      </div>
    );
  }
  return <div className="font-pixel text-[6px] opacity-50">{base}</div>;
}

const selectCls =
  "bg-[var(--shadow)] border-2 border-[var(--gold)] px-2 py-1.5 text-base outline-none focus:border-[var(--gold-bright)] [color-scheme:dark]";

function AgendaRow({
  ev,
  now,
  busy,
  min,
  onDone,
  onUndone,
  onDelete,
  onUpdate,
  onSchedule,
}: {
  ev: AgendaEvent;
  now: number;
  busy: boolean;
  min: Date;
  onDone: (id: string) => void;
  onUndone: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string, who: string | null) => void;
  onSchedule: (id: string, dueAt: string, remindMinutes: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingWhen, setEditingWhen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftWho, setDraftWho] = useState("");
  const [draftWhen, setDraftWhen] = useState<Date | null>(null);
  const [draftRemind, setDraftRemind] = useState(ev.remind_minutes);
  const swiped = useRef(false);
  const past = +new Date(ev.due_at) < now;

  function save() {
    const t = draft.trim();
    const w = draftWho.trim() || null;
    if ((t && t !== ev.text) || w !== ev.who) onUpdate(ev.id, t || ev.text, w);
    setEditing(false);
  }

  function saveWhen() {
    if (draftWhen && (+draftWhen !== +new Date(ev.due_at) || draftRemind !== ev.remind_minutes)) {
      onSchedule(ev.id, draftWhen.toISOString(), draftRemind);
    }
    setEditingWhen(false);
  }

  if (ev.done) {
    return (
      <SwipeRow
        onRight={() => !busy && onUndone(ev.id)}
        onLeft={() => !busy && onDelete(ev.id)}
        rightLabel="↺ RÉTABLIR"
        leftLabel="☠ POTENCE"
        dim
        contentClassName="bg-[var(--shadow)] border border-[#3a5a2a]"
      >
        <div className="p-2.5">
          <div className="text-lg leading-snug break-words line-through">{ev.text}{ev.who ? ` avec ${ev.who}` : ""}</div>
          <div className="font-pixel text-[6px] opacity-60">{fmtWhen(ev.due_at, now)}</div>
        </div>
      </SwipeRow>
    );
  }

  return (
    <SwipeRow
      onRight={() => !busy && onDone(ev.id)}
      onLeft={() => !busy && onDelete(ev.id)}
      rightLabel="⚔ FAITE"
      leftLabel="☠ POTENCE"
      swipedRef={swiped}
      disabled={editing || editingWhen}
      contentClassName="bg-[var(--shadow)] border border-[#3a5a2a]"
    >
      <div className="p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex flex-col gap-1">
              <input
                autoFocus
                className="w-full bg-black/30 border border-[var(--gold)] px-2 py-0.5 text-lg outline-none focus:border-[var(--gold-bright)]"
                value={draft}
                placeholder="quoi…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
                }}
              />
              <input
                className="w-full bg-black/30 border border-[var(--gold)] px-2 py-0.5 text-base opacity-80 outline-none focus:border-[var(--gold-bright)]"
                value={draftWho}
                placeholder="avec qui ? (optionnel)"
                onChange={(e) => setDraftWho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
                }}
              />
            </div>
          ) : (
            <div
              className="text-lg leading-snug break-words cursor-text"
              onPointerDown={() => (swiped.current = false)}
              onClick={() => {
                if (swiped.current) return;
                setDraft(ev.text);
                setDraftWho(ev.who ?? "");
                setEditing(true);
              }}
            >
              {ev.text}{ev.who ? ` avec ${ev.who}` : ""}
            </div>
          )}
          {/* Toucher la date ouvre l'éditeur de prophétie (date + rappel). */}
          <button
            className={`font-pixel text-[6px] mt-0.5 text-left ${past ? "text-[var(--ruby)]" : "opacity-60 hover:opacity-100"}`}
            disabled={busy}
            title="Modifier la date / le rappel"
            onPointerDown={() => (swiped.current = false)}
            onClick={() => {
              if (swiped.current) return;
              // Anciennes prophéties à :54 & co → alignées dès l'édition.
              setDraftWhen(ceilToQuarter(new Date(ev.due_at)));
              setDraftRemind(ev.remind_minutes);
              setEditingWhen((v) => !v);
            }}
          >
            {fmtWhen(ev.due_at, now)} · 🔔 {remindLabel(ev.remind_minutes)} AVANT
          </button>
        </div>
        {editing && (
          <>
            <button className="btn-pixel !p-1.5 shrink-0" disabled={busy} title="Valider" onClick={save}>
              <IconCheck size={16} />
            </button>
            <button className="btn-pixel ghost !p-1.5 shrink-0" disabled={busy} title="Annuler" onClick={() => setEditing(false)}>
              <IconX size={16} />
            </button>
          </>
        )}
      </div>
      {editingWhen && (
        <div className="flex gap-2 items-center flex-wrap border-t border-[#3a5a2a] pt-2">
          <DateTimeInput value={draftWhen} onChange={setDraftWhen} min={min} disabled={busy} className="flex-1 min-w-[220px]" />
          <select className={selectCls} value={draftRemind} onChange={(e) => setDraftRemind(Number(e.target.value))} title="Rappel avant la prophétie">
            {REMIND_OPTIONS.map((o) => (
              <option key={o.m} value={o.m}>-{o.l}</option>
            ))}
          </select>
          <button className="btn-pixel !px-2.5 !py-1.5" disabled={busy || !draftWhen} onClick={saveWhen} title="Valider">
            <IconCheck size={16} />
          </button>
          <button className="btn-pixel ghost !px-2.5 !py-1.5" onClick={() => setEditingWhen(false)} title="Annuler">
            <IconX size={16} />
          </button>
          <div className="w-full"><ReminderHint when={draftWhen} remind={draftRemind} /></div>
        </div>
      )}
      </div>
    </SwipeRow>
  );
}

export default function AgendaPanel({
  events,
  busy,
  refreshing,
  open,
  onClose,
  onRefresh,
  onAdd,
  onDone,
  onUndone,
  onDelete,
  onUpdate,
  onSchedule,
}: {
  events: AgendaEvent[];
  busy: boolean;
  refreshing?: boolean;
  open: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  onAdd: (text: string, who: string | null, dueAt: string, remindMinutes: number) => void;
  onDone: (id: string) => void;
  onUndone: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string, who: string | null) => void;
  onSchedule: (id: string, dueAt: string, remindMinutes: number) => void;
}) {
  const [text, setText] = useState("");
  const [who, setWho] = useState("");
  const [when, setWhen] = useState<Date | null>(null);
  const [remind, setRemind] = useState(30);
  const [showDone, setShowDone] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);
  // Horloge locale, seulement quand le panneau est ouvert : rafraîchie DÈS
  // l'ouverture (le panneau reste monté des heures — sinon les prophéties
  // devenues passées n'étaient pas en rouge pendant 30 s), puis toutes les 30 s.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [open]);
  // Jour mini du calendrier dérivé de l'horloge : une app ouverte la veille
  // ne propose plus « hier ».
  const min = useMemo(() => startOfDay(now), [now]);

  const upcoming = events
    .filter((e) => !e.done)
    .sort((a, b) => (+new Date(a.due_at) - +new Date(b.due_at)) * (sortAsc ? 1 : -1));
  const done = events.filter((e) => e.done).sort((a, b) => +new Date(b.due_at) - +new Date(a.due_at));

  function submit() {
    const t = text.trim();
    if (!t || !when) return;
    onAdd(t, who.trim() || null, when.toISOString(), remind);
    setText("");
    setWho("");
    setWhen(null);
    setRemind(30);
  }

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className="font-pixel text-[9px] text-[var(--gold-bright)]">🔮 PROPHÉTIES ({upcoming.length})</div>
        <div className="flex items-center gap-1.5">
          <button
            className="btn-pixel ghost !px-2"
            onClick={() => setSortAsc((v) => !v)}
            title={sortAsc ? "Du plus proche au plus lointain" : "Du plus lointain au plus proche"}
          >
            {sortAsc ? <IconSortAscending size={18} /> : <IconSortDescending size={18} />}
          </button>
          {onRefresh && <RefreshButton onClick={onRefresh} spinning={refreshing} disabled={busy} />}
          <button className="btn-pixel ghost !px-2" onClick={onClose}><IconX size={18} /></button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <input
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-lg outline-none focus:border-[var(--gold-bright)]"
          placeholder="Nouvelle prophétie…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <input
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-3 py-2 text-base opacity-80 outline-none focus:border-[var(--gold-bright)]"
          placeholder="avec qui ? (optionnel)"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <div className="flex gap-2 items-center">
          <DateTimeInput value={when} onChange={setWhen} min={min} disabled={busy} className="flex-1 min-w-0" />
          <select
            className={`${selectCls} !py-2`}
            value={remind}
            onChange={(e) => setRemind(Number(e.target.value))}
            title="Rappel par mail avant la prophétie"
          >
            {REMIND_OPTIONS.map((o) => (
              <option key={o.m} value={o.m}>-{o.l}</option>
            ))}
          </select>
          <button className="btn-pixel !px-3" disabled={busy || !text.trim() || !when} onClick={submit} title="Ajouter"><IconPlus size={18} /></button>
        </div>
        <ReminderHint when={when} remind={remind} />
      </div>

      {upcoming.length === 0 && <div className="opacity-60">Aucune prophétie à venir.</div>}
      <div className="flex flex-col gap-1.5">
        {upcoming.map((ev) => (
          <AgendaRow key={ev.id} ev={ev} now={now} busy={busy} min={min} onDone={onDone} onUndone={onUndone} onDelete={onDelete} onUpdate={onUpdate} onSchedule={onSchedule} />
        ))}
      </div>
      {upcoming.length > 0 && (
        <div className="font-pixel text-[6px] opacity-50 text-center">◀ POTENCE · FAITE ▶ · TOUCHER TEXTE OU DATE POUR ÉDITER</div>
      )}

      {done.length > 0 && (
        <div className="mt-1 pt-3 border-t border-[#2a4a2a]">
          <button
            className="btn-pixel ghost w-full flex items-center justify-center gap-1.5 !py-1.5 font-pixel text-[7px]"
            onClick={() => setShowDone((s) => !s)}
          >
            <IconChevronDown size={14} className={`transition-transform ${showDone ? "rotate-180" : ""}`} />
            {done.length} PASSÉE(S)/FAITE(S)
          </button>
          {showDone && (
            <div className="flex flex-col gap-1.5 mt-2 opacity-50">
              {done.map((ev) => (
                <AgendaRow key={ev.id} ev={ev} now={now} busy={busy} min={min} onDone={onDone} onUndone={onUndone} onDelete={onDelete} onUpdate={onUpdate} onSchedule={onSchedule} />
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
