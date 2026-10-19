<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Règles projet (hors bloc auto)

- **Push après revue** : à la fin d'un lot de travail, une loop de review vérifie le code — ATTENDRE son retour. Ne commit + push sur `main` que quand la loop revient propre (0 modification demandée). Ne jamais pousser de secrets (scan du diff avant commit).
- Vérif avant push : `bunx tsc --noEmit` + `bunx eslint src` + `bun run test` + `bun run build`.
- Messages de commit en français, pas de trailer `Co-Authored-By`.
- `SECURITY_PLAN.md` : cases `⬜`/`✅`, jamais `- [ ]` / `- [x]`.
- Ne jamais lancer `bun dev` (dev server déjà lancé par l'utilisateur).
- Domaine prod : `tidy.fims.fi` (projet Vercel `tidy-quest`). Crons cron-job.org sur ce domaine, 8h–22h Europe/Paris.
