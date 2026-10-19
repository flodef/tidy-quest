# Tidy Quest ⚔️

PWA « heroic fantasy » de tri d'emails : les brouillons des boîtes arrivent
sous forme de « missives » à expédier ou ranger dans la jarre. Quêtes (tâches),
fourre-tout (notes-checklists), agenda daté avec rappels par mail, badges de
non-lus, notifications push, mode hors-ligne avec outbox.

Next.js 16 · React 19 · Tailwind 4 · Neon Postgres · ImapFlow · Nodemailer ·
web-push · Gemini.

## Démarrage

```bash
cp .env.example .env.local   # remplir toutes les variables
bun install
bun dev
```

## Variables d'environnement

| Variable | Rôle | Requis |
|---|---|---|
| `MAIL_PASSCODE` | Code d'accès de l'app (écran de login) | oui |
| `MAIL_ACCOUNTS` | JSON des boîtes IMAP/SMTP (voir `.env.example`) — `"manual": true` sur un compte = jamais de polling (cron + overview l'ignorent), relevé uniquement à l'ouverture de la boîte | oui |
| `DATABASE_URL` | Neon Postgres (quêtes, notes, agenda, sessions, push, mutes) | oui |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (`bunx web-push generate-vapid-keys`) | oui |
| `VAPID_SUBJECT` | Contact `mailto:` déclaré aux services push | oui |
| `CRON_SECRET` | Bearer requis par `/api/cron` et `/api/reminders` | oui |
| `GEMINI_API_KEY` | Génération/amélioration de brouillons, titres de notes | sinon fallbacks locaux |
| `BOT_API_TOKEN` | Bearer pour GET/POST `/api/tasks` + `/api/notes` (OpenClaw) | optionnel |
| `REMINDER_TO` | Destinataire des rappels d'agenda | requis pour `/api/reminders` |
| `REMINDER_ACCOUNT` | Id de compte émetteur des rappels (défaut : premier) | optionnel |

## Scheduling — cron-job.org, JAMAIS Vercel Cron

Deux jobs externes (pas de `vercel.json`, c'est voulu) :

- `GET /api/cron` toutes les 15 min — scan IMAP + push « nouveau non-lu » ;
- `GET /api/reminders` toutes les 5 min — rappels d'agenda échus (léger, pas d'IMAP).

Les deux exigent `Authorization: Bearer $CRON_SECRET` et sont **fail-closed**
(503 si le secret est absent). Les creds cron-job.org sont dans `pass`
(`cron-job-org/api-key`, `mail-quest/cron-secret`).

## Modèle de sécurité

- **Auth** : `MAIL_PASSCODE` → session aléatoire en base (`sessions`, 90 j,
  révocable), cookie `mq_session` httpOnly/secure/lax. Rate-limit du login :
  20 essais / 15 min / IP (`login_attempts`).
- **Proxy** (`src/proxy.ts`) : tout est protégé sauf `/login`, les assets et
  les API auto-protégées (`/api/auth`, `/api/cron`, `/api/reminders`).
  Comparaison exacte/par sous-chemin — pas de préfixe fourre-tout.
- **CSRF** : les mutations d'API exigent `Sec-Fetch-Site` same-origin/none ou
  un `Origin` du même hôte + `content-type: application/json`.
- **Bot** : `BOT_API_TOKEN` limité à GET/POST sur `/api/tasks` et `/api/notes`,
  comparaison en temps constant.
- **Emails** : HTML nettoyé par `sanitize-html` côté serveur, rendu dans un
  `<iframe sandbox>` sans scripts ; images distantes masquées par défaut
  (anti pixel-espion) ; liens `target=_blank rel=noopener`.
- **Brouillons** : générés via MailComposer (en-têtes encodés RFC 2047,
  destinataire unique validé, `Reply-To` honoré, `In-Reply-To`/`References`,
  marqueur `X-Tidy-Quest: ai` affiché en badge 🤖).
- **Erreurs** : messages génériques au client, détails loggés côté serveur.
- **Headers** : CSP stricte, nosniff, no-referrer, Permissions-Policy,
  pas de `X-Powered-By`.
- **Circuit breaker IMAP** : après un échec d'auth, le compte est suspendu
  30 min pour ne pas faire verrouiller la boîte (en mémoire, par instance).

## Hors-ligne

- Snapshot localStorage hydraté à l'ouverture (contacts, quêtes, notes,
  agenda, ordres d'inbox).
- Mutations mises en file (`mq-outbox`) et rejouées dans l'ordre au retour
  réseau ; les inserts portent un `id` client + `ON CONFLICT DO NOTHING` →
  rejouables sans doublon.
- Service worker : cache du shell `/` et des assets immutables ; réception
  des notifications push (tag par compte, focus de la fenêtre existante).
- **Verrouiller** (tiroir inbox, en bas) révoque la session serveur et purge
  le snapshot local.

## Base

Schéma créé au runtime par `initDb()` (`CREATE TABLE IF NOT EXISTS` —
tasks, notes, agenda, push_subs, muted_senders, asides, inbox_order,
cron_state, sessions, login_attempts). Les réordonnancements sont
transactionnels.

## Qualité

```bash
bun run lint        # eslint
bun run typecheck   # tsc --noEmit
bun run test        # vitest (items, accès proxy, validation, sanitize/XSS, dates)
bun run build
```

CI : `.github/workflows/ci.yml` (lint + typecheck + tests + build + audit).
Audit sécu complet & plan d'implémentation : `SECURITY_PLAN.md`.

## Endpoints

| Route | Accès |
|---|---|
| `/api/overview`, `/api/tasks`, `/api/notes`, `/api/agenda`, `/api/inbox-order`, `/api/mute`, `/api/aside`, `/api/push`, `/api/message`, `/api/draft*`, `/api/send`, `/api/trash` | session |
| `/api/tasks`, `/api/notes` (GET/POST) | session ou `BOT_API_TOKEN` |
| `/api/cron`, `/api/reminders` | `Bearer CRON_SECRET` |
| `/api/auth` | public (rate-limité) |
