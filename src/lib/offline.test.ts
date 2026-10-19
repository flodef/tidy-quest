import { describe, expect, it, vi, afterEach } from "vitest";

// Stub localStorage minimal (Map) — offline.ts est client-side only.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const { enqueueOp, flushOps, pendingOps } = await import("./offline");

const op = (url: string): { url: string; init: RequestInit } => ({
  url,
  init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
});

const statusFetch = (status: number) => vi.fn(async () => new Response("{}", { status })) as typeof fetch;

afterEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

describe("flushOps — rejoue outbox", () => {
  it("401/403 : ops conservées + authLost (re-login rejouera)", async () => {
    vi.stubGlobal("fetch", statusFetch(401));
    enqueueOp(op("/api/tasks"));
    enqueueOp(op("/api/notes"));
    const res = await flushOps();
    expect(res.authLost).toBe(true);
    expect(res.remaining).toBe(2);
    expect(pendingOps()).toHaveLength(2);
  });

  it("5xx / réseau : ops conservées pour la tentative suivante", async () => {
    vi.stubGlobal("fetch", statusFetch(503));
    enqueueOp(op("/api/tasks"));
    const res = await flushOps();
    expect(res.authLost).toBe(false);
    expect(res.remaining).toBe(1);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await flushOps()).remaining).toBe(1);
  });

  it("succès purge la file ; 4xx non-auth jetée mais la suite continue", async () => {
    enqueueOp(op("/api/tasks"));
    enqueueOp(op("/api/notes"));
    enqueueOp(op("/api/agenda"));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response("{}", { status: String(input).includes("notes") ? 400 : 200 })));
    const res = await flushOps();
    expect(res).toEqual({ remaining: 0, authLost: false });
    expect(pendingOps()).toHaveLength(0);
  });

  it("401 au milieu de la file : le reste n'est pas exécuté (ordre préservé)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("{}", { status: String(input).includes("tasks") ? 401 : 200 });
    }));
    enqueueOp(op("/api/tasks"));
    enqueueOp(op("/api/agenda"));
    const res = await flushOps();
    expect(calls).toEqual(["/api/tasks"]); // agenda jamais appelé
    expect(res.authLost).toBe(true);
    expect(pendingOps()).toHaveLength(2);
  });

  it("op enfilée PENDANT le flush : jamais écrasée (B3)", async () => {
    let injected = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      // Une mutation arrive pendant que la 1re requête est en vol.
      if (!injected) {
        injected = true;
        enqueueOp(op("/api/notes"));
      }
      return new Response("{}", { status: 503 });
    }));
    enqueueOp(op("/api/tasks"));
    const res = await flushOps();
    expect(res.remaining).toBe(2);
    expect(pendingOps().map((o) => o.url)).toEqual(["/api/tasks", "/api/notes"]);
  });

  it("op enfilée pendant un flush qui réussit : rejouée dans la foulée", async () => {
    let injected = false;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      if (!injected) {
        injected = true;
        enqueueOp(op("/api/notes"));
      }
      return new Response("{}", { status: 200 });
    }));
    enqueueOp(op("/api/tasks"));
    const res = await flushOps();
    expect(calls).toEqual(["/api/tasks", "/api/notes"]);
    expect(res.remaining).toBe(0);
  });
});

