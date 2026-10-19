"use client";

import { useState } from "react";
import { IconNotebook, IconTrash } from "@tabler/icons-react";
import { jsonInit, patchInit } from "@/lib/client";
import type { Ask, Mutate, Say } from "@/lib/hooks";
import type { Note } from "@/lib/db";

/** Fourre-tout : état + actions (UI optimiste + outbox). */
export function useNotes({ mutate, say, ask }: { mutate: Mutate; say: Say; ask: Ask }) {
  const [notes, setNotes] = useState<Note[]>([]);

  function add(body: string) {
    const t = body.trim();
    if (!t) return;
    const id = crypto.randomUUID();
    const first = t.split("\n").map((l) => l.replace(/^[•\-*✅\d.\s]+/, "").trim()).find(Boolean) ?? "Note";
    setNotes((ns) => [
      { id, title: first.slice(0, 60), body: t, position: Math.min(0, ...ns.map((n) => n.position)) - 1, created_at: new Date().toISOString() },
      ...ns,
    ]);
    mutate({ url: "/api/notes", init: jsonInit({ body: t, id }) });
    say("Note rangée au fourre-tout", IconNotebook);
  }

  const remove = (id: string) =>
    ask({
      label: "Jeter cette note à la potence ?",
      run: () => {
        setNotes((ns) => ns.filter((n) => n.id !== id));
        mutate({ url: `/api/notes?id=${encodeURIComponent(id)}`, init: { method: "DELETE" } });
        say("Note jetée", IconTrash);
      },
    });

  function update(id: string, body: string) {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, body } : n)));
    mutate({ url: "/api/notes", init: patchInit({ id, body }) });
  }

  function reorder(ids: string[]) {
    setNotes((ns) => {
      const pos = new Map(ids.map((id, i) => [id, i]));
      return [...ns].sort((a, b) => (pos.get(a.id) ?? a.position) - (pos.get(b.id) ?? b.position));
    });
    mutate({ url: "/api/notes", init: patchInit({ order: ids }) });
  }

  return { notes, setNotes, add, remove, update, reorder };
}
