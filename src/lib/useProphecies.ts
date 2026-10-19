"use client";

import { useState } from "react";
import { IconCalendarClock, IconTrash } from "@tabler/icons-react";
import { jsonInit, patchInit } from "@/lib/client";
import { isOverdue } from "@/lib/dates";
import type { Ask, Mutate, Say } from "@/lib/hooks";
import type { AgendaEvent } from "@/lib/db";

const sortAgenda = (es: AgendaEvent[]) =>
  [...es].sort((a, b) => (a.done === b.done ? +new Date(a.due_at) - +new Date(b.due_at) : a.done ? 1 : -1));

/** Prophéties (événements datés + rappel mail) : état + actions. */
export function useProphecies({ mutate, say, ask }: { mutate: Mutate; say: Say; ask: Ask }) {
  const [agenda, setAgenda] = useState<AgendaEvent[]>([]);

  function add(text: string, who: string | null, dueAt: string, remindMinutes: number) {
    const id = crypto.randomUUID();
    setAgenda((es) => sortAgenda([...es, { id, text, who, due_at: dueAt, remind_minutes: remindMinutes, done: false, reminded_at: null, created_at: new Date().toISOString() }]));
    mutate({ url: "/api/agenda", init: jsonInit({ id, text, who, dueAt, remindMinutes }) });
    say("Rendez-vous gravé dans le destin", IconCalendarClock);
  }

  function setDone(id: string, done: boolean) {
    setAgenda((es) => sortAgenda(es.map((e) => (e.id === id ? { ...e, done } : e))));
    mutate({ url: "/api/agenda", init: patchInit({ id, done }) });
  }

  function doRemove(id: string) {
    setAgenda((es) => es.filter((e) => e.id !== id));
    mutate({ url: `/api/agenda?id=${encodeURIComponent(id)}`, init: { method: "DELETE" } });
    say("Prophétie jetée", IconTrash);
  }

  // Dépassée ET non faite → plus d'intérêt, suppression directe. Les
  // prophéties à venir ou déjà faites gardent la confirmation.
  function remove(id: string) {
    const ev = agenda.find((e) => e.id === id);
    if (ev && isOverdue(ev)) return doRemove(id);
    ask({ label: "Jeter cette prophétie à la potence ?", run: () => doRemove(id) });
  }

  function update(id: string, text: string, who: string | null) {
    setAgenda((es) => es.map((e) => (e.id === id ? { ...e, text, who } : e)));
    mutate({ url: "/api/agenda", init: patchInit({ id, text, who }) });
  }

  function schedule(id: string, dueAt: string, remindMinutes: number) {
    setAgenda((es) => sortAgenda(es.map((e) => (e.id === id ? { ...e, due_at: dueAt, remind_minutes: remindMinutes, reminded_at: null } : e))));
    mutate({ url: "/api/agenda", init: patchInit({ id, dueAt, remindMinutes }) });
  }

  return {
    agenda,
    setAgenda,
    add,
    done: (id: string) => setDone(id, true),
    undone: (id: string) => setDone(id, false),
    remove,
    update,
    schedule,
  };
}
