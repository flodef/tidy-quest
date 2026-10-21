import { createHash } from "crypto";
import { neon } from "@neondatabase/serverless";

export function dbReady(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL env var missing");
  return neon(url);
}

// Bump à chaque changement de DDL ci-dessous : une base déjà à jour ne
// rejoue plus les ~13 requêtes de schéma à chaque démarrage à froid.
const SCHEMA_VERSION = 3;

// Promesse unique : des initDb() concurrents (démarrage à froid, requêtes
// parallèles) se disputaient les CREATE TABLE IF NOT EXISTS — Postgres peut
// alors lever une violation d'unicité sur pg_type.
let initPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  initPromise ??= runInit().catch((e) => {
    initPromise = null; // échec (DB injoignable) : on retentera au prochain appel
    throw e;
  });
  return initPromise;
}

async function runInit(): Promise<void> {
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)`;
  const meta = (await q`SELECT version FROM schema_meta WHERE id=1`) as { version: number }[];
  if ((meta[0]?.version ?? 0) >= SCHEMA_VERSION) return;
  await q`CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    keys JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS asides (
    account TEXT NOT NULL,
    uid INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (account, uid)
  )`;
  await q`CREATE TABLE IF NOT EXISTS last_seen (
    account TEXT PRIMARY KEY,
    unseen INTEGER NOT NULL,
    checked_at TIMESTAMPTZ DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS muted_senders (
    account TEXT NOT NULL,
    sender TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (account, sender)
  )`;
  await q`CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text TEXT NOT NULL,
    position DOUBLE PRECISION NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    done_at TIMESTAMPTZ
  )`;
  // Migration v3 : compteur « quêtes exécutées aujourd'hui » (journée 6h→6h).
  await q`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ`;
  await q`CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await q`ALTER TABLE notes ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION`;
  // Backfill : reproduit l'ordre historique (created_at DESC → position croissante)
  await q`UPDATE notes SET position = -EXTRACT(EPOCH FROM created_at) WHERE position IS NULL`;
  await q`CREATE TABLE IF NOT EXISTS inbox_order (
    account TEXT NOT NULL,
    uid INTEGER NOT NULL,
    position DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (account, uid)
  )`;
  await q`CREATE TABLE IF NOT EXISTS agenda (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    text TEXT NOT NULL,
    who TEXT,
    due_at TIMESTAMPTZ NOT NULL,
    remind_minutes INTEGER NOT NULL DEFAULT 30,
    done BOOLEAN NOT NULL DEFAULT false,
    reminded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await q`ALTER TABLE agenda ADD COLUMN IF NOT EXISTS who TEXT`;
  await q`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  )`;
  await q`CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip TEXT NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT now()
  )`;
  await q`INSERT INTO schema_meta (id, version) VALUES (1, ${SCHEMA_VERSION})
    ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version`;
}

function ensureDb(): Promise<void> {
  return initDb();
}

export async function addAside(account: string, uid: number): Promise<void> {
  await ensureDb();
  await sql()`INSERT INTO asides (account, uid) VALUES (${account}, ${uid}) ON CONFLICT DO NOTHING`;
}

export async function removeAside(account: string, uid: number): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM asides WHERE account=${account} AND uid=${uid}`;
}

export async function listAsides(): Promise<{ account: string; uid: number }[]> {
  await ensureDb();
  const rows = await sql()`SELECT account, uid FROM asides`;
  return rows as unknown as { account: string; uid: number }[];
}

export async function addMuted(account: string, sender: string): Promise<void> {
  await ensureDb();
  await sql()`INSERT INTO muted_senders (account, sender) VALUES (${account}, ${sender.toLowerCase()}) ON CONFLICT DO NOTHING`;
}

export async function removeMuted(account: string, sender: string): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM muted_senders WHERE account=${account} AND sender=${sender.toLowerCase()}`;
}

export async function listMuted(): Promise<{ account: string; sender: string }[]> {
  await ensureDb();
  const rows = await sql()`SELECT account, sender FROM muted_senders`;
  return rows as unknown as { account: string; sender: string }[];
}

export async function addPushSub(endpoint: string, keys: unknown): Promise<void> {
  await ensureDb();
  await sql()`INSERT INTO push_subs (endpoint, keys) VALUES (${endpoint}, ${JSON.stringify(keys)}::jsonb) ON CONFLICT (endpoint) DO UPDATE SET keys=EXCLUDED.keys`;
}

export async function removePushSub(endpoint: string): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM push_subs WHERE endpoint=${endpoint}`;
}

export async function listPushSubs(): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }[]> {
  await ensureDb();
  const rows = await sql()`SELECT endpoint, keys FROM push_subs`;
  return rows as unknown as { endpoint: string; keys: { p256dh: string; auth: string } }[];
}

export async function getLastSeen(account: string): Promise<number | null> {
  await ensureDb();
  const rows = (await sql()`SELECT unseen FROM last_seen WHERE account=${account}`) as { unseen: number }[];
  return rows[0]?.unseen ?? null;
}

export async function setLastSeen(account: string, unseen: number): Promise<void> {
  await ensureDb();
  await sql()`INSERT INTO last_seen (account, unseen, checked_at) VALUES (${account}, ${unseen}, now())
    ON CONFLICT (account) DO UPDATE SET unseen=EXCLUDED.unseen, checked_at=now()`;
}

// --- Quest (task list) ---

export interface Task {
  id: string;
  text: string;
  done: boolean;
  done_at?: string | null;
  position: number;
  created_at: string;
}

export async function listTasks(): Promise<Task[]> {
  await ensureDb();
  const rows = await sql()`SELECT id, text, done, done_at, position, created_at FROM tasks ORDER BY done ASC, position ASC`;
  return rows as unknown as Task[];
}

export async function addTasks(items: { text: string; id?: string }[]): Promise<number> {
  await ensureDb();
  let added = 0;
  // Insertion en haut de pile : on insère les lignes en ordre inverse, chacune
  // à min(position)-1, pour garder l'ordre de saisie (1re ligne = tout en haut).
  const list = items.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text);
  for (const { text, id } of [...list].reverse()) {
    if (id) {
      // ON CONFLICT : le replay de l'outbox offline peut renvoyer un insert déjà
      // reçu (réponse perdue) — sans ça, la violation PK empoisonne la file.
      await sql()`INSERT INTO tasks (id, text, position)
        SELECT ${id}::uuid, ${text}, COALESCE(MIN(position), 1) - 1 FROM tasks
        ON CONFLICT (id) DO NOTHING`;
    } else {
      await sql()`INSERT INTO tasks (text, position)
        SELECT ${text}, COALESCE(MIN(position), 1) - 1 FROM tasks`;
    }
    added++;
  }
  return added;
}

export async function updateTask(id: string, text: string): Promise<void> {
  await ensureDb();
  await sql()`UPDATE tasks SET text=${text} WHERE id=${id}`;
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  await ensureDb();
  // done=true → en haut des trophées ; done=false → en haut de la pile active.
  await sql()`UPDATE tasks SET done=${done}, done_at = CASE WHEN ${done} THEN now() ELSE NULL END,
    position = (SELECT COALESCE(MIN(position), 1) - 1 FROM tasks WHERE done=${done} AND id<>${id})
    WHERE id=${id}`;
}

export async function taskToBottom(id: string): Promise<void> {
  await ensureDb();
  await sql()`UPDATE tasks SET position = (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks) WHERE id=${id}`;
}

export async function taskToTop(id: string): Promise<void> {
  await ensureDb();
  // En haut de la pile ACTIVE (devient visible dans le top 5) — `done` inchangé.
  await sql()`UPDATE tasks SET position = (SELECT COALESCE(MIN(position), 1) - 1 FROM tasks WHERE done=false AND id<>${id}) WHERE id=${id}`;
}

export async function reorderTasks(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureDb();
  const q = sql();
  await q.transaction(ids.map((id, i) => q`UPDATE tasks SET position=${i} WHERE id=${id}`));
}

export async function purgeDoneTasks(): Promise<number> {
  await ensureDb();
  const rows = await sql()`DELETE FROM tasks WHERE done=true RETURNING id`;
  return rows.length;
}

export async function deleteTask(id: string): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM tasks WHERE id=${id}`;
}

// --- Fourre-tout (notes) ---

export interface Note {
  id: string;
  title: string;
  body: string;
  position: number;
  created_at: string;
}

export async function listNotes(): Promise<Note[]> {
  await ensureDb();
  const rows = await sql()`SELECT id, title, body, position, created_at FROM notes ORDER BY COALESCE(position, -EXTRACT(EPOCH FROM created_at)) ASC`;
  return rows as unknown as Note[];
}

export async function addNote(title: string, body: string, id?: string): Promise<Note> {
  await ensureDb();
  // Nouvelle note en haut de pile (position la plus petite)
  const rows = id
    ? await sql()`INSERT INTO notes (id, title, body, position)
        SELECT ${id}::uuid, ${title}, ${body}, COALESCE(MIN(position), 0) - 1 FROM notes
        ON CONFLICT (id) DO NOTHING
        RETURNING id, title, body, position, created_at`
    : await sql()`INSERT INTO notes (title, body, position)
        SELECT ${title}, ${body}, COALESCE(MIN(position), 0) - 1 FROM notes
        RETURNING id, title, body, position, created_at`;
  // Replay d'un insert déjà reçu : renvoyer la ligne existante.
  if (rows.length === 0 && id) {
    const existing = await sql()`SELECT id, title, body, position, created_at FROM notes WHERE id=${id}::uuid`;
    return existing[0] as unknown as Note;
  }
  return rows[0] as unknown as Note;
}

export async function reorderNotes(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureDb();
  const q = sql();
  await q.transaction(ids.map((id, i) => q`UPDATE notes SET position=${i} WHERE id=${id}`));
}

export async function deleteNote(id: string): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM notes WHERE id=${id}`;
}

export async function updateNote(id: string, body: string): Promise<void> {
  await ensureDb();
  await sql()`UPDATE notes SET body=${body} WHERE id=${id}`;
}

// --- Agenda (échéances datées + rappel par mail) ---

export interface AgendaEvent {
  id: string;
  text: string;
  /** "Quoi … avec qui" — participant affiché avec le texte. */
  who: string | null;
  due_at: string;
  remind_minutes: number;
  done: boolean;
  reminded_at: string | null;
  created_at: string;
}

export async function listAgenda(): Promise<AgendaEvent[]> {
  await ensureDb();
  const rows = await sql()`SELECT id, text, who, due_at, remind_minutes, done, reminded_at, created_at
    FROM agenda ORDER BY done ASC, due_at ASC`;
  return rows as unknown as AgendaEvent[];
}

export async function addAgenda(
  text: string, dueAt: string, remindMinutes: number, id?: string,
  who?: string | null, restore?: { remindedAt?: string | null; createdAt?: string },
): Promise<AgendaEvent> {
  await ensureDb();
  // `restore` : undo « Annuler » — la ligne revient verbatim (reminded_at
  // conservé sinon le rappel repartirait ; created_at préservé).
  const rows = id
    ? await sql()`INSERT INTO agenda (id, text, who, due_at, remind_minutes, reminded_at, created_at)
        VALUES (${id}::uuid, ${text}, ${who ?? null}, ${dueAt}::timestamptz, ${remindMinutes},
                ${restore?.remindedAt ?? null}::timestamptz, COALESCE(${restore?.createdAt ?? null}::timestamptz, now()))
        ON CONFLICT (id) DO NOTHING
        RETURNING id, text, who, due_at, remind_minutes, done, reminded_at, created_at`
    : await sql()`INSERT INTO agenda (text, who, due_at, remind_minutes)
        VALUES (${text}, ${who ?? null}, ${dueAt}::timestamptz, ${remindMinutes})
        RETURNING id, text, who, due_at, remind_minutes, done, reminded_at, created_at`;
  // Replay d'un insert déjà reçu : renvoyer la ligne existante.
  if (rows.length === 0 && id) {
    const existing = await sql()`SELECT id, text, who, due_at, remind_minutes, done, reminded_at, created_at FROM agenda WHERE id=${id}::uuid`;
    return existing[0] as unknown as AgendaEvent;
  }
  return rows[0] as unknown as AgendaEvent;
}

export async function updateAgendaText(id: string, text: string, who: string | null): Promise<void> {
  await ensureDb();
  await sql()`UPDATE agenda SET text=${text}, who=${who} WHERE id=${id}`;
}

// Replanification → réarme le rappel (reminded_at repart à NULL).
export async function updateAgendaSchedule(id: string, dueAt: string, remindMinutes: number): Promise<void> {
  await ensureDb();
  await sql()`UPDATE agenda SET due_at=${dueAt}::timestamptz, remind_minutes=${remindMinutes}, reminded_at=NULL WHERE id=${id}`;
}

export async function setAgendaDone(id: string, done: boolean): Promise<void> {
  await ensureDb();
  // Restauration (done=false) → réarme le rappel. Si l'échéance est passée
  // depuis plus que la grâce, dueAgendaReminders l'ignore : pas de mail pour
  // un événement fini.
  await sql()`UPDATE agenda SET done=${done},
    reminded_at = CASE WHEN ${done} THEN reminded_at ELSE NULL END
    WHERE id=${id}`;
}

export async function deleteAgenda(id: string): Promise<void> {
  await ensureDb();
  await sql()`DELETE FROM agenda WHERE id=${id}`;
}

// Échéances dont l'heure de rappel est passée, pas encore notifiées.
// - `who` sélectionné : sinon le mail de rappel perdait « avec qui ».
// - Fenêtre de grâce de REMINDER_GRACE_MIN après l'échéance :
//   · une prophétie restaurée, replanifiée ou créée bien dans le passé ne
//     déclenche plus de rappel pour un événement terminé ;
//   · remind_minutes = 0 (accepté par l'API, ex. bot) part encore — avec un
//     `due_at > now()` strict sa fenêtre était vide : rappel jamais envoyé ;
//   · un cron en retard de quelques minutes envoie le rappel en retard
//     au lieu de le perdre silencieusement.
const REMINDER_GRACE_MIN = 15;

export async function dueAgendaReminders(): Promise<AgendaEvent[]> {
  await ensureDb();
  const rows = await sql()`SELECT id, text, who, due_at, remind_minutes, done, reminded_at, created_at
    FROM agenda
    WHERE done = false AND reminded_at IS NULL
      AND due_at > now() - make_interval(mins => ${REMINDER_GRACE_MIN})
      AND due_at - make_interval(mins => remind_minutes) <= now()`;
  return rows as unknown as AgendaEvent[];
}

// Réclame l'envoi du rappel (atomique : un seul worker gagne). false = déjà pris.
export async function claimAgendaReminder(id: string): Promise<boolean> {
  await ensureDb();
  const rows = await sql()`UPDATE agenda SET reminded_at = now() WHERE id=${id} AND reminded_at IS NULL RETURNING id`;
  return rows.length > 0;
}

export async function unclaimAgendaReminder(id: string): Promise<void> {
  await ensureDb();
  await sql()`UPDATE agenda SET reminded_at = NULL WHERE id=${id}`;
}

// --- Inbox (ordre de priorité des missives reçues) ---

export async function listInboxOrder(): Promise<{ account: string; uid: number }[]> {
  await ensureDb();
  const rows = await sql()`SELECT account, uid FROM inbox_order ORDER BY position ASC`;
  return rows as unknown as { account: string; uid: number }[];
}

export async function setInboxOrder(account: string, uids: number[]): Promise<void> {
  // Liste vide = réinitialiser l'ordre du compte : la transaction contient
  // toujours au moins le DELETE.
  await ensureDb();
  const q = sql();
  await q.transaction([
    q`DELETE FROM inbox_order WHERE account=${account}`,
    ...uids.map((uid, i) => q`INSERT INTO inbox_order (account, uid, position) VALUES (${account}, ${uid}, ${i})`),
  ]);
}

// --- Sessions (jetons aléatoires révocables) ---

// Seul le SHA-256 du jeton est stocké : une lecture de la table ne donne
// aucun jeton utilisable. Le cookie client garde la valeur brute.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(token: string, days: number): Promise<void> {
  await ensureDb();
  await sql()`INSERT INTO sessions (token, expires_at) VALUES (${hashToken(token)}, now() + make_interval(days => ${days}))`;
  await sql()`DELETE FROM sessions WHERE expires_at < now()`.catch(() => {});
}

export async function sessionValid(token: string): Promise<boolean> {
  if (!dbReady()) return false;
  await ensureDb();
  const rows = await sql()`SELECT 1 FROM sessions WHERE token=${hashToken(token)} AND expires_at > now() LIMIT 1`;
  return rows.length > 0;
}

export async function deleteSession(token: string): Promise<void> {
  if (!dbReady()) return;
  await ensureDb();
  await sql()`DELETE FROM sessions WHERE token=${hashToken(token)}`;
}

// --- Rate-limit du login ---

const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_ATTEMPTS = 20;
// Sans x-real-ip/XFF (hors Vercel), tous les clients partagent l'IP
// "unknown" — ils peuvent se bloquer mutuellement (limite connue).

export async function tooManyLoginAttempts(ip: string): Promise<boolean> {
  if (!dbReady()) return false;
  await ensureDb();
  const rows = await sql()`
    SELECT count(*)::int AS n FROM login_attempts
    WHERE ip=${ip} AND attempted_at > now() - make_interval(mins => ${LOGIN_WINDOW_MIN})`;
  return ((rows[0] as { n: number }).n ?? 0) >= LOGIN_MAX_ATTEMPTS;
}

export async function recordLoginAttempt(ip: string): Promise<void> {
  if (!dbReady()) return;
  await ensureDb();
  await sql()`INSERT INTO login_attempts (ip) VALUES (${ip})`;
  await sql()`DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'`.catch(() => {});
}
