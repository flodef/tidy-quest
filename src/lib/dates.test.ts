import { describe, expect, it } from "vitest";
import {
  ceilToQuarter,
  fmtShort,
  fmtWhen,
  isOverdue,
  setSegment,
  startOfDay,
  startOfToday,
  reminderFireTime,
} from "./dates";

describe("fmtShort", () => {
  it("heure seule si aujourd'hui, date+heure sinon", () => {
    const now = new Date();
    expect(fmtShort(now)).toMatch(/^\d{2}:\d{2}$/);
    const old = new Date(2020, 0, 5, 14, 32);
    expect(fmtShort(old)).toBe("05/01 14:32");
  });
  it("chaînes invalides / vides", () => {
    expect(fmtShort(null)).toBe("");
    expect(fmtShort("pas une date")).toBe("");
  });
});

describe("fmtWhen", () => {
  it("format jour + heure, marqueur (PASSÉ) si échu", () => {
    const future = fmtWhen(new Date(Date.now() + 3600_000).toISOString());
    expect(future).toContain("à");
    expect(future).not.toContain("PASSÉ");
    const past = fmtWhen(new Date(Date.now() - 3600_000).toISOString());
    expect(past).toContain("(PASSÉ)");
  });
});

describe("startOfToday", () => {
  it("minuit local", () => {
    const d = startOfToday();
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });
});

describe("ceilToQuarter — quart d'heure SUIVANT", () => {
  const at = (h: number, m: number, s = 0) => new Date(2026, 9, 19, h, m, s);
  it("arrondit vers le haut", () => {
    expect(ceilToQuarter(at(14, 54))).toEqual(at(15, 0));
    expect(ceilToQuarter(at(14, 46))).toEqual(at(15, 0));
    expect(ceilToQuarter(at(14, 1))).toEqual(at(14, 15));
    expect(ceilToQuarter(at(23, 50))).toEqual(new Date(2026, 9, 20, 0, 0)); // passe minuit
  });
  it("idempotent sur une valeur alignée, secondes comprises", () => {
    expect(ceilToQuarter(at(15, 0))).toEqual(at(15, 0));
    expect(ceilToQuarter(at(15, 30))).toEqual(at(15, 30));
    expect(ceilToQuarter(at(15, 0, 20))).toEqual(at(15, 15)); // 15:00:20 n'est pas aligné
  });
});

describe("isOverdue — suppression sans popup", () => {
  const now = new Date(2026, 9, 19, 12, 0).getTime();
  const iso = (h: number) => new Date(2026, 9, 19, h, 0).toISOString();
  it("dépassée et non faite → oui", () =>
    expect(isOverdue({ done: false, due_at: iso(10) }, now)).toBe(true));
  it("dépassée mais faite → non (popup conservé)", () =>
    expect(isOverdue({ done: true, due_at: iso(10) }, now)).toBe(false));
  it("à venir → non", () =>
    expect(isOverdue({ done: false, due_at: iso(14) }, now)).toBe(false));
});

describe("startOfDay", () => {
  it("minuit du jour donné", () => {
    expect(startOfDay(new Date(2026, 9, 19, 17, 3).getTime())).toEqual(
      new Date(2026, 9, 19),
    );
  });
});

describe("saisie clavier des minutes → quart d'heure SUIVANT", () => {
  const at = (h: number, m: number) => new Date(2026, 9, 19, h, m);
  // Chemin réel du champ : setSegment (valeur tapée) puis apply() = ceilToQuarter.
  const typed = (n: number) => {
    const d = setSegment(at(14, 0), "minute", n);
    return d && ceilToQuarter(d);
  };
  it("arrondit vers le haut, jamais au plus proche", () => {
    expect(typed(53)).toEqual(at(15, 0)); // et non 14:45
    expect(typed(52)).toEqual(at(15, 0));
    expect(typed(7)).toEqual(at(14, 15)); // et non 14:00
    expect(typed(30)).toEqual(at(14, 30));
    expect(typed(0)).toEqual(at(14, 0));
  });
  it("hors bornes → ignoré", () => {
    expect(setSegment(at(14, 0), "minute", 60)).toBeNull();
    expect(setSegment(at(14, 0), "hour", 24)).toBeNull();
  });
  it("jour borné au dernier jour du mois", () => {
    expect(setSegment(new Date(2026, 1, 10), "day", 31)).toEqual(
      new Date(2026, 1, 28),
    );
  });
});

describe("reminderFireTime — fenêtre cron 8h-22h", () => {
  const at = (h: number, m = 0) => new Date(2026, 4, 20, h, m); // jour fixe
  // now fixe (6h du jour de test) — le helper borne la recherche à maintenant.
  const now = +new Date(2026, 4, 20, 6, 0);
  const fire = (d: Date, m: number) => reminderFireTime(d, m, now);

  it("cas normal : prophétie 14h, rappel 30 min → part à 13h30", () => {
    expect(fire(at(14), 30)).toEqual(at(13, 30));
  });
  it("23h + 60 min : rappel prévu 22h hors fenêtre, grâce expirée → null", () => {
    expect(fire(at(23), 60)).toBeNull();
  });
  it("23h + 2 h : prévu 21h → tick 21h existe", () => {
    expect(fire(at(23), 120)).toEqual(at(21, 0));
  });
  it("7h + 30 min : prévu 6h30, grâce 7h15 < premier tick 8h → null", () => {
    expect(fire(new Date(2026, 4, 20, 7, 0), 30)).toBeNull();
  });
  it("7h + 12 h : prévu 19h la veille → envoyé la veille à 19h", () => {
    // now = la veille 17h : la fenêtre du rappel n'est pas encore entamée.
    expect(
      reminderFireTime(
        new Date(2026, 4, 20, 7, 0),
        720,
        +new Date(2026, 4, 19, 17, 0),
      ),
    ).toEqual(new Date(2026, 4, 19, 19, 0));
  });
  it("7h + 12 h vu le lendemain 6h : fenêtre entièrement passée → null", () => {
    expect(fire(new Date(2026, 4, 20, 7, 0), 720)).toBeNull();
  });
  it("8h15 + 30 min : prévu 7h45 → part au premier tick, 8h00", () => {
    expect(fire(new Date(2026, 4, 20, 8, 15), 30)).toEqual(
      new Date(2026, 4, 20, 8, 0),
    );
  });
  it("21h50 + 0 min : plus de tick (dernier 21h45) → null", () => {
    expect(fire(new Date(2026, 4, 20, 21, 50), 0)).toBeNull();
  });
  it("21h30 + 0 min : tick 21h30 dans la fenêtre → part à 21h30", () => {
    expect(fire(new Date(2026, 4, 20, 21, 30), 0)).toEqual(
      new Date(2026, 4, 20, 21, 30),
    );
  });

  // Régressions de la review : la recherche part de `now`, jamais avant.
  it("rappel dont le délai a DÉJÀ commencé : tick suivant ≥ now, jamais dans le passé", () => {
    // Prophétie demain 14h créée à 20h avec rappel 24h → prévu aujourd'hui
    // 14h (passé) → le vrai envoi = prochain tick ≥ now (20h, aligné).
    const tmrw = new Date(2026, 4, 21, 14, 0);
    const now20 = +new Date(2026, 4, 20, 20, 0);
    expect(reminderFireTime(tmrw, 1440, now20)).toEqual(
      new Date(2026, 4, 20, 20, 0),
    );
  });
  it("borne de grâce strictement ouverte : tick exactement à due+15 min → null", () => {
    // due 7h45, rappel 0 : le serveur exige due_at > now()−15min — à 8h00
    // pile, 7h45 > 7h45 est faux → pas d'envoi.
    expect(fire(new Date(2026, 4, 20, 7, 45), 0)).toBeNull();
  });
  it("secondes non nulles : ceilToQuarter monte au tick suivant, pas avant", () => {
    // now 13h45:30 — setSeconds(0) tronquerait à 13h45 (tick passé) ; il faut 14h00.
    const nowSec = +new Date(2026, 4, 20, 13, 45, 30);
    expect(reminderFireTime(new Date(2026, 4, 20, 15, 0), 90, nowSec)).toEqual(
      new Date(2026, 4, 20, 14, 0),
    );
  });
});
