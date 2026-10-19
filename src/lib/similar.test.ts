import { describe, expect, it } from "vitest";
import { findSimilar, foldText, normalizeItem, similarity } from "./similar";

describe("findSimilar — quasi-doublons d'items", () => {
  const existing = ["du beurre de cacahuete", "acheter du lait", "appeler la banque"];

  it("variantes quasi identiques → bloquées", () => {
    expect(findSimilar("beurre de cacahuete", existing)).toBe("du beurre de cacahuete");
    expect(findSimilar("beurre de cacahette", existing)).toBe("du beurre de cacahuete"); // faute de frappe
    expect(findSimilar("Du Beurre de Cacahuete !", existing)).toBe("du beurre de cacahuete");
    expect(findSimilar("beurre  cacahuete", existing)).toBe("du beurre de cacahuete");
  });

  it("mot partagé seul → passe", () => {
    expect(findSimilar("cacahuètes", existing)).toBeNull();
    expect(findSimilar("cacahuete", existing)).toBeNull();
    expect(findSimilar("beurre", existing)).toBeNull();
    expect(findSimilar("miel", existing)).toBeNull();
    expect(findSimilar("appeler le coiffeur", existing)).toBeNull();
  });
});

describe("normalizeItem", () => {
  it("retire casse, accents, articles, ponctuation", () => {
    expect(normalizeItem("Du Beurre de Cacahuete !")).toBe("beurre cacahuete");
    expect(normalizeItem("à l'école")).toBe("ecole");
  });
  it("similarity reflète la proximité", () => {
    expect(similarity("beurre cacahuete", "beurre cacahette")).toBeGreaterThan(0.85);
    expect(similarity("cacahuetes", "beurre cacahuete")).toBeLessThan(0.8);
  });
});

describe("foldText — recherche tolérante", () => {
  it("ignore casse et accents", () => {
    expect(foldText("Beurre de CACAHUÈTE")).toBe("beurre de cacahuete");
    expect(foldText("Réunion été").includes(foldText("reunion"))).toBe(true);
  });
});
