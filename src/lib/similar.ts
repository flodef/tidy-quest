// Détection de quasi-doublons pour les ajouts (quêtes, items de notes) :
// « beurre de cacahette » ~ « du beurre de cacahuete » → demander confirm ;
// « cacahuètes » seul vs « beurre de cacahuete » → passe (un mot partagé
// ne suffit pas).

const ARTICLES = new Set(["le", "la", "les", "un", "une", "des", "du", "de", "d", "l", "au", "aux", "en", "et", "a"]);

/** Minuscules + sans accents — recherche tolérante (« cacahuete » trouve « cacahuète »). */
export function foldText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Casse, diacritiques, ponctuation et articles retirés. */
export function normalizeItem(s: string): string {
  return foldText(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(" ");
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Coefficient de Dice sur bigrammes (0..1) — robuste aux petites fautes. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/** Candidate existante la plus proche ≥ threshold, ou null. */
export function findSimilar(text: string, candidates: string[], threshold = 0.8): string | null {
  const n = normalizeItem(text);
  if (!n) return null;
  let best: { score: number; c: string } | null = null;
  for (const c of candidates) {
    const nc = normalizeItem(c);
    if (!nc) continue;
    const score = n === nc ? 1 : similarity(n, nc);
    if (score >= threshold && (!best || score > best.score)) best = { score, c };
  }
  return best?.c ?? null;
}
