"use client";

import { useState } from "react";
import { IconSkull, IconSword } from "@tabler/icons-react";
import { jsonInit, patchInit } from "@/lib/client";
import { findSimilar } from "@/lib/similar";
import type { Ask, Mutate, Say } from "@/lib/hooks";
import type { Task } from "@/lib/db";

// Tri immuable : actives d'abord (par position), puis trophées.
const sortTasks = (ts: Task[]) => [...ts].sort((a, b) => (a.done === b.done ? a.position - b.position : a.done ? 1 : -1));

/** Plus petite position du groupe (actives ou trophées) hors `id`, moins 1 : tout en haut. */
const topOf = (ts: Task[], done: boolean, id?: string) => Math.min(0, ...ts.filter((x) => x.done === done && x.id !== id).map((x) => x.position)) - 1;

/** Quêtes : état + actions (UI optimiste + outbox). */
export function useQuests({ mutate, say, ask }: { mutate: Mutate; say: Say; ask: Ask }) {
  const [tasks, setTasks] = useState<Task[]>([]);

  // Insertion en haut de pile — positions calculées sur l'état COURANT (et
  // non sur une capture : un « ajouter quand même » confirmé plus tard
  // donnait sinon les mêmes positions que les lignes déjà ajoutées).
  function insert(texts: string[]) {
    if (!texts.length) return;
    const now = new Date().toISOString();
    const ids = texts.map(() => crypto.randomUUID());
    setTasks((ts) => {
      const base = Math.min(0, ...ts.map((x) => x.position)) - texts.length;
      return sortTasks([...ts, ...texts.map((text, i) => ({ id: ids[i], text, done: false, position: base + i, created_at: now }))]);
    });
    mutate({ url: "/api/tasks", init: jsonInit({ texts: texts.map((text, i) => ({ text, id: ids[i] })) }) });
  }

  function add(text: string) {
    // 1 ligne = 1 quête ; puces ("-", "•", …) ignorées, espaces trimmés.
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^[•\-–—*]\s*/, "").trim())
      .filter(Boolean);
    if (!lines.length) return;
    // Anti quasi-doublon : contre les quêtes actives ET les lignes déjà
    // acceptées du même collage (deux lignes quasi identiques).
    const clean: string[] = [];
    const dups: { l: string; match: string }[] = [];
    const active = tasks.filter((t) => !t.done).map((t) => t.text);
    for (const l of lines) {
      const match = findSimilar(l, [...active, ...clean]);
      if (match) dups.push({ l, match });
      else clean.push(l);
    }
    insert(clean);
    if (dups.length) {
      const extra = dups.length > 1 ? ` (+${dups.length - 1} autre(s))` : "";
      ask({
        label: `« ${dups[0].l.slice(0, 60)} » ressemble à « ${dups[0].match.slice(0, 60)} »${extra} — ajouter quand même ?`,
        run: () => insert(dups.map((d) => d.l)),
      });
    }
  }

  function done(id: string) {
    // Terminée → tout en haut des trophées.
    setTasks((ts) => sortTasks(ts.map((t) => (t.id === id ? { ...t, done: true, done_at: new Date().toISOString(), position: topOf(ts, true, id) } : t))));
    mutate({ url: "/api/tasks", init: patchInit({ id, done: true }) });
    say("Quête accomplie !", IconSword);
  }

  function undone(id: string) {
    // Restaurée → tout en haut de la pile active (visible dans le top 5).
    setTasks((ts) => sortTasks(ts.map((t) => (t.id === id ? { ...t, done: false, done_at: null, position: topOf(ts, false, id) } : t))));
    mutate({ url: "/api/tasks", init: patchInit({ id, done: false }) });
  }

  function bottom(id: string) {
    setTasks((ts) => {
      const max = Math.max(0, ...ts.map((t) => t.position));
      return sortTasks(ts.map((t) => (t.id === id ? { ...t, position: max + 1 } : t)));
    });
    mutate({ url: "/api/tasks", init: patchInit({ id, toBottom: true }) });
  }

  function top(id: string) {
    // Réserve → tout en haut de la pile active (devient n°1 du top 5).
    setTasks((ts) => sortTasks(ts.map((t) => (t.id === id ? { ...t, position: topOf(ts, false, id) } : t))));
    mutate({ url: "/api/tasks", init: patchInit({ id, toTop: true }) });
  }

  function applyUpdate(id: string, text: string) {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, text } : t)));
    mutate({ url: "/api/tasks", init: patchInit({ id, text }) });
  }

  function update(id: string, text: string) {
    // Édition aussi soumise à l'anti-doublon (hors la quête elle-même).
    const match = findSimilar(text, tasks.filter((t) => !t.done && t.id !== id).map((t) => t.text));
    if (!match) return applyUpdate(id, text);
    ask({
      label: `« ${text.slice(0, 60)} » ressemble à « ${match.slice(0, 60)} » — enregistrer quand même ?`,
      run: () => applyUpdate(id, text),
    });
  }

  function reorder(ids: string[]) {
    setTasks((ts) => {
      const pos = new Map(ids.map((id, i) => [id, i]));
      return sortTasks(ts.map((t) => (pos.has(t.id) ? { ...t, position: pos.get(t.id)! } : t)));
    });
    mutate({ url: "/api/tasks", init: patchInit({ order: ids }) });
  }

  const purge = () =>
    ask({
      label: `Purger les ${tasks.filter((t) => t.done).length} quête(s) accomplie(s) ?`,
      run: () => {
        setTasks((ts) => ts.filter((t) => !t.done));
        mutate({ url: "/api/tasks?purge=1", init: { method: "DELETE" } });
        say("Trophées purgés", IconSkull);
      },
    });

  const purgeOne = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    ask({
      label: `Purger « ${t.text.slice(0, 60)} » ?`,
      run: () => {
        setTasks((ts) => ts.filter((x) => x.id !== id));
        mutate({ url: `/api/tasks?id=${encodeURIComponent(id)}`, init: { method: "DELETE" } });
        say("Trophée purgé", IconSkull);
      },
    });
  };

  return { tasks, setTasks, add, done, undone, bottom, top, update, reorder, purge, purgeOne };
}
