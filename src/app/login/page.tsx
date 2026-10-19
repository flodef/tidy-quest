"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: code }),
    });
    setLoading(false);
    if (res.ok) router.replace("/");
    else setError(true);
  }

  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <form onSubmit={submit} className="panel p-8 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="text-5xl anim-bob">🗡️</div>
        <h1 className="font-pixel text-[var(--gold-bright)] text-sm text-center leading-relaxed">
          TIDY QUEST
        </h1>
        <p className="text-lg text-center opacity-80">Entre le code secret pour ouvrir le portail</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-4 py-3 text-center text-2xl tracking-widest outline-none focus:border-[var(--gold-bright)]"
          placeholder="••••"
        />
        {error && <p className="text-[var(--ruby)] font-pixel text-[9px]">LE SCEAU NE RÉPOND PAS !</p>}
        <button type="submit" className="btn-pixel w-full" disabled={loading || !code}>
          {loading ? "…" : "FRANCHIR LE PORTAIL"}
        </button>
      </form>
    </main>
  );
}
