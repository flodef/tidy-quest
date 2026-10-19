import { describe, expect, it } from "vitest";
import { cachedMail, invalidateMail } from "./cache";

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("cachedMail — génération (B4)", () => {
  it("une lecture lancée avant une invalidation ne repollue pas le cache", async () => {
    invalidateMail();
    const slow = deferred<string>();
    const first = cachedMail("k", 60_000, () => slow.promise);
    invalidateMail(); // mutation pendant la lecture
    slow.resolve("périmé");
    expect(await first).toBe("périmé"); // l'appelant reçoit sa réponse…
    // …mais le cache n'a rien gardé : l'appel suivant relit.
    expect(await cachedMail("k", 60_000, async () => "frais")).toBe("frais");
  });

  it("après invalidation, on ne se greffe plus sur la lecture en vol", async () => {
    invalidateMail();
    const slow = deferred<string>();
    void cachedMail("k2", 60_000, () => slow.promise);
    invalidateMail();
    const second = cachedMail("k2", 60_000, async () => "frais");
    slow.resolve("périmé");
    expect(await second).toBe("frais");
  });

  it("appels concurrents dédupliqués et mis en cache", async () => {
    invalidateMail();
    let calls = 0;
    const fn = async () => ++calls;
    const [a, b] = await Promise.all([cachedMail("k3", 60_000, fn), cachedMail("k3", 60_000, fn)]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    expect(await cachedMail("k3", 60_000, fn)).toBe(1);
  });
});
