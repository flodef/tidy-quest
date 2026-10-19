// Helpers partagés côté client — NE PAS importer next/server ici (le module
// finit dans le bundle client via page.tsx).

/** Extrait le message d'erreur d'une réponse API. */
export async function apiError(r: Response, fallback = "Échec"): Promise<string> {
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

/** RequestInit JSON (POST par défaut). */
export const jsonInit = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const patchInit = (body: unknown): RequestInit => jsonInit(body, "PATCH");

/** fetch JSON — remplace les fetch(url, { method, headers, body: JSON.stringify }) recopiés. */
export const sendJson = (url: string, body: unknown, method = "POST"): Promise<Response> => fetch(url, jsonInit(body, method));
