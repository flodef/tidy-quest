# Mail Quest — Audit de sécurité : plan d'implémentation

Suivi de l'audit complet (voir détail dans la session). Légende : ⬜ à faire / ✅ fait.

## Étape 0 — Manuelle (hors code, à faire par le propriétaire)
- ⬜ Rotation des secrets exposés dans les transcripts de session : 4 mots de passe mail (IMAP/SMTP), DATABASE_URL Neon, clé API cron-job.org. Puis mettre à jour Vercel + `.env.local` + `pass`.
  (✅ `CRON_SECRET` déjà rotaté : Vercel + pass + .env.local + headers des 2 jobs cron-job.org.)

## Étape 1 — Failles critiques
- ✅ C1 XSS mails : sanitize-html serveur (getMessage/getDraft), variantes `html` / `htmlNoImg` (images distantes bloquées par défaut + bouton « afficher »), iframe sandboxé `allow-same-origin allow-popups` (jamais `allow-scripts`), liens `target=_blank rel=noopener`, auto-height via contentDocument.
- ✅ H2 Headers : CSP, nosniff, Referrer-Policy, Permissions-Policy, poweredByHeader off (next.config.ts).
- ✅ C2+B1+B7 Injection d'en-têtes : createReplyDraft via nodemailer MailComposer, destinataire validé, Reply-To du mail original, In-Reply-To/References, encodage RFC2047 auto, marqueur `X-Mail-Quest: ai`.
- ✅ B2 Correspondance exacte des expéditeurs (deleteFromSender, mutedUnseen, filtres).

## Étape 2 — Authentification renforcée
- ✅ H3 Sessions aléatoires révocables (table `sessions`, expiration 90 j), vérif DB dans proxy, routes publiques en comparaison exacte, déconnexion qui purge le snapshot localStorage.
- ✅ H4 Cron fail-closed : 503 si CRON_SECRET absent, comparaison timing-safe (helper partagé cron+reminders).
- ✅ M8 Jeton bot limité à GET/POST sur tasks/notes + comparaison timing-safe.
- ✅ M5 Rate-limit /api/auth (table login_attempts, 20 essais/15 min/IP → 429).
- ✅ M6 Garde CSRF : mutations /api exigent Sec-Fetch-Site same-origin/none ou Origin même hôte ; content-type JSON requis.
- ✅ M3 `mailbox` résolu côté serveur (findMailbox \Drafts), uid `Number.isInteger && >0`, account validé.
- ✅ M1 Erreurs génériques au client (console.error serveur) via wrapper commun.
- ✅ M2 Clé Gemini en header x-goog-api-key.
- ✅ M4 Allowlist d'endpoints push (FCM/Mozilla/Apple/Windows) + tailles max.
- ✅ M7 Snapshot localStorage effacé à la déconnexion (+ bouton 🔒 dans le tiroir).

## Étape 3 — Fiabilité & bugs
- ✅ H5 Anti prompt-injection : systemInstruction + délimitation contenu non fiable + badge « IA » sur brouillons générés.
- ✅ B3 Fenêtre « derniers messages » après filtrage des bannis.
- ✅ B4 Purge des abonnements push 404/410.
- ✅ B5 Envoi idempotent (flag moved → avertissement client).
- ✅ B6 SW : cache shell uniquement pour "/".
- ✅ B8 Transactions pour reorderTasks/reorderNotes/setInboxOrder.
- ✅ B9 Dédup in-flight du cache overview.
- ✅ B10 Hydratation offline (init false, puis effect).
- ✅ B11 try/catch togglePush.
- ✅ B12 notificationclick → focus client existant ; tag par compte.
- ✅ B13 min=aujourd'hui dans DateTimeInput + clamp jour 31.
- ✅ B14 garde uid NaN pour pièces jointes.
- ✅ B15 Toast : reset du timer précédent.
- ✅ B16 Timeout Gemini (AbortSignal).
- ✅ L1 filename* UTF-8 + nosniff sur pièces jointes.
- ✅ L2 REMINDER_TO requis pour l'envoi (sinon skip loggé).
- ✅ B7bis MIME correct via MailComposer (fait avec C2).

## Étape 4 — Refactors & qualité
- ✅ Découpage page.tsx : hooks (useOfflineSync, usePush, useInstallPrompt, useToast) + composants (Sheet, ConfirmDialog, MessageReader, EmailBody).
- ✅ lib/api.ts : isUuid partagé, parseJson (content-type), erreurs.
- ✅ lib/dates.ts : fmt courts partagés.
- ✅ ai.ts : helper callGemini mutualisé.
- ✅ imap.ts : addr() unique, mapping enveloppe→InboxItem partagé, getDraft réutilise downloadRaw.
- ✅ Aside/mute via l'outbox offline ; édition de la date d'échéance dans AgendaPanel ; effets mis en pause quand panneaux cachés ; grille HUD dynamique.
- ✅ Tests vitest (items, dates, validate, safeEq) + workflow CI GitHub.
- ✅ README réel (env, architecture, menaces).

## Étape 5 — Vérif & livraison
- ✅ lint + tsc + vitest + build verts.
- ✅ Diff final relu, aucun secret, prêt à commit/push sur demande.

## Étape 6 — Retour de review (2e passe)
- ✅ R1 `headerAddresses`/`extractAddress` : `To:` avec display name « Jean <a@b> » et listes multi-destinataires acceptés par createReplyDraft ; findOriginalMessage matche l'adresse extraite (plus de subject-only fallback).
- ✅ R2 Rate-limit login : `x-real-ip` puis dernier XFF (plus jamais la 1re entrée client-contrôlée) ; seuls les échecs comptent.
- ✅ R3 CSRF vérifié avant l'early-return des routes publiques (/api/auth protégé aussi).
- ✅ R4 `Sheet.panelClass` remplace la max-h par défaut (conflit 70/80dvh).
- ✅ R5 `apiError` déplacé vers `lib/client.ts` (next/server hors du bundle client).
- ✅ R6 `listAsides` sans catch silencieux (500 explicite au lieu de "cleared:0").
- ✅ R7 Scan muté en 2 passes : `1:*` enveloppes+flags, `bodyStructure` seulement sur la fenêtre.
- ✅ R8 Badge IA : valeur exacte `x-mail-quest: ai` (enveloppe ET headers parsés).
- ✅ R9 notes PATCH exige `body` string (plus de wipe par oubli de champ).
- ✅ R10 Sujet des rappels sanitizé (CRLF retirés).
- ✅ Vérif : tsc + eslint + 30 vitest + build — tout vert.

## Étape 7 — Retour de review (3e passe)
- ✅ R11 `htmlNoImg` : attribut `style` retiré — les CSS `url()` (background-image, list-style-image, cursor…) ne contournent plus le blocage des pixels-espions. Test de régression ajouté.
- ✅ R12 `isAuthed` mort retiré d'auth.ts.
- ✅ R13 `improveMissive` : refresh() en catch — la carte retirée optimistement est restaurée sur échec.
- ✅ R14 Sessions : SHA-256 du jeton en DB (un leak de la table ne donne aucun jeton utilisable).
- ✅ R15 `sessionCache` proxy : sweep des entrées expirées au-delà de 500.
- ✅ R16 Bucket "unknown" du rate-limit documenté (hors Vercel).
- ✅ R17 Warn REMINDER_TO une fois par process (plus de spam par overview).
- ✅ R18 createReplyDraft : fallback sur To si le Reply-To est entièrement invalide.
- ✅ R19 `DateTimeInput.setTime` passe par `apply()` (min respecté si jamais il porte une heure).
- ✅ R20 reorderTasks/reorderNotes : no-op sur liste vide.
- ✅ R21 `/api/draft/improve` : `moved:false` remonté si l'original n'a pas pu être rangé (pas de 500 qui pousserait à retenter en doublon).
- ✅ R22 `ai` propagé sur getMessage/findOriginalMessage (+attachments sur findOriginalMessage).
- ✅ Vérif : tsc + eslint + 31 vitest + build — tout vert.

## Étape 8 — Audit #2 : plan d'implémentation
### A — Pertes de données (urgent)
- ✅ B1+B2 sendDraft envoie le MIME BRUT du brouillon (`envelope` + `raw` nodemailer) — HTML original, PJ et en-têtes préservés. Bonus découvert : l'en-tête Bcc est retiré avant envoi (sinon exposé aux destinataires) + test.
- ✅ B3 flushOps : 401/403 → ops conservées + `onAuthLost` → redirect /login (re-login rejoue la file). refresh() détecte aussi 401 (plus de faux « hors-ligne »).
- ✅ B4 doClearJar : refresh() en catch.
- ✅ B5 Login : inputMode="numeric" retiré.
### B — Durcissement
- ✅ M1 Timeouts SMTP : connection 20s / greeting 15s / socket 25s.
- ✅ M2 Cache-Control: private,no-store sur /api/* (next.config).
- ✅ M3 /api/cron : events génériques, détails en console.error.
- ✅ M5 isKnownAccount() appliqué à aside, mute, inbox-order.
- ✅ M6 fetchParsed : headers+bodyStructure puis UNIQUEMENT les parts texte (ImapFlow décode CTE+UTF-8) ; PJ = métadonnées ; getAttachment télécharge la part directement. Testé en réel sur fims/tradiz/jobconciergerie.
- ✅ M7 Rate-limit : IPv6 bucketé par /64 + cap ip 64.
- ✅ M8 Entrées Gemini déjà cappées (6000/4000/3000).
### C — Polissage
- ✅ passcode cap 256.
- ✅ .env.example : GEMINI_API_KEY, GEMINI_MODEL, BOT_API_TOKEN.
- ✅ sw.js : bump mq-shell-v2 (cache unique) + purge des vieux caches à l'activate.
- ✅ InboxRow : fmtDate remplacé par lib/dates fmtShort.
- ✅ vitest.config.ts → .mts.
- ✅ Snapshot : v:2, mismatch ignoré.
- ✅ Vérif : tsc + eslint + 32 vitest + build verts ; smoke-test IMAP réel OK.
### Décisions documentées
- M4 (DB down → /login partout) : fail-closed maintenu — PWA offline compense.
- `html` (images affichées) garde `style` : consentement utilisateur explicite.
- `free` : credentials refusés au login (NO Invalid login or password) — préexistant, à vérifier à la rotation.

## Étape 9 — Retour de review (4e passe)
- ✅ R23 IPv6 /64 : `ipv6Prefix64` — expansion `::` AVANT extraction des 4 hextets + normalisation hex (0db8=db8) + IPv4-mapped → IPv4. 7 tests (compression, normalisation, mapped, /64 distincts).
- ✅ R24 fetchParsed : le fallback "1" ne s'applique qu'à un nœud EXISTANT sans numéro — plus de HTML/binaire dans `text`/`preview`, plus de double téléchargement.
- ✅ R25 getAttachment : nœud racine sans part (mail entier attachment) → fallback "1" — plus de PJ listée mais intéléchargeable.
- ✅ R26 libmime en dep directe (5.4.6) + `src/lib/libmime.d.ts` — plus de createRequire sur dep transitive.
- ✅ R27 Limite `parameters.name` sans disposition documentée dans isAttachmentNode.
- ✅ R28 stripOutboundHeaders : Bcc + DKIM-Signature (signature obsolète après modif → spam) ; test déplacé vers smtp.test.ts.
- ✅ R29 refresh() : check 401/403 sur les 5 endpoints.
- ✅ R30 sw.js : purge `caches.keys()` ≠ SHELL_CACHE à l'activate.
- ✅ R31 vitest.config.mts : `import.meta.dirname`.
- ✅ getAttachment : `dl.meta.filename` (décodé ImapFlow) prioritaire.
- ✅ Vérif : tsc + eslint + 34 vitest + build verts.

## Étape 10 — Retour de review (5e passe)
- ✅ R32 `htmlToPlain` : mails html-only → texte dérivé du HTML sanitizé (tags strippés, blocs → \n, entités décodées incl. U+00A0, `&amp;` en dernier). Restaure `text`/`preview`/contexte IA — parity avec mailparser. 2 tests.
- ✅ R33 `stripOutboundHeaders` : scan des lignes d'en-tête même SANS séparateur corps (une ligne non-header clôt la zone) + LF-only + Resent-Bcc ajouté. 2 tests.
- ✅ R34 `envelopeTo` filtré par EMAIL_RE (enveloppe malformée → erreur propre).
- ✅ R35 `isKnownAccount` cohérent sur draft, send, trash, message, generate, improve (400 au lieu de 500).
- ✅ R36 `sendDraft.to` : joint tous les destinataires si `To:` vide (brouillons Cc/Bcc-only — toast correct).
- ✅ R37 `streamToBuffer` mutualisé (partText, downloadRaw, getAttachment) + `maxBytes` 30 Mo sur les PJ.
- ✅ Vérif : tsc + eslint + 37 vitest + build verts.

## Étape 11 — Retour de review (6e passe)
- ✅ R38 STRIP_HEADERS += `X-Mail-Quest` (le marqueur IA interne ne part plus aux destinataires) + `Received:`/`Return-Path:` (un mail reçu déplacé en brouillon ne fuiterait plus la chaîne serveur).
- ✅ R39 stripOutboundHeaders : la ligne vide clôt la zone d'en-têtes — plus de suppression silencieuse de lignes de corps ressemblant à des en-têtes.
- ✅ R40 getAttachment : `truncated` remonté (expectedSize vs reçu) → 413 "pièce jointe trop volumineuse" au lieu d'un fichier corrompu.
- ✅ R41 Attachment `size` : estimation décodée (~0.75×) pour les parts base64 (BODYSTRUCTURE donne les octets encodés).
- ✅ R42 envelopeTo : local-parts quotés (`"foo bar"@x.fr`) acceptés + repli sur les en-têtes To/Cc/Bcc parsés si l'enveloppe est entièrement invalide.
- ✅ R43 fetchParsed concatène TOUTES les parts text/plain + html non-PJ (parity mailparser sur multipart/mixed).
- ✅ R44 flushOps testé : 401 conserve+authLost, 5xx/réseau conserve, 4xx jette, ordre préservé (offline.test.ts).
- ✅ R45 Fallback `acc.smtp.from ?? user` retiré (from requis).
- ✅ Vérif : tsc + eslint + 41 vitest + build verts.

## Étape 12 — Retour de review (7e passe)
- ✅ R46 `truncated` cassait TOUTES les PJ : `dl.meta.expectedSize` = taille du message ENTIER (RFC822.SIZE), pas de la part → toujours "tronqué" → 413 partout. Fix : `content.length >= 30 Mo` (le passe-plat s'arrête pile au cap). Vérifié en réel : PDF 238 Ko télécharge OK.
- ✅ R43 RÉELLEMENT implémenté : fetchParsed concatène toutes les parts text/plain + html non-PJ (Promise.all + join) — la 1re tentative n'avait pas atterri.
- ✅ R47 isAttachmentNode : `name=` sur parts NON-texte compte comme PJ (vieux clients `Content-Type: pdf; name="x"`), name= sur text/* reste du texte.
- ✅ R48 createReplyDraft : fallback `?? acc.smtp.user` retiré aussi (from requis partout).
- ✅ R49 envelopeTo : chaque liste filtrée PUIS choix — repli sur les en-têtes si TOUTES les adresses d'enveloppe sont invalides (pas seulement liste vide).
- ✅ R50 partText cap 10 Mo / downloadRaw cap 60 Mo (mémoire bornée).
- ✅ Vérif : tsc + eslint + 41 vitest + build verts + test réel PJ sur fims.

## Étape 13 — Retour de review (8e passe)
- ✅ R51 getDraftRaw : brouillon > 60 Mo tronqué par maxBytes → MIME malformé envoyé. Désormais `throw` "brouillon trop volumineux" — jamais de courrier corrompu (getAttachment avait son flag, le chemin raw l'avait oublié).
- ✅ R52 Racine mono-part non-texte (scanner/fax : corps = pdf/image sans name=/disposition) → `attachmentNodes` partagé inclut la racine → PJ listée ET téléchargeable (avant : "(vide)" sans accès au contenu).
- ✅ R53 loadSnapshot : `{v:2}` sans `data` → null (plus d'`applySnapshot(undefined)`).
- ✅ R54 `?part=abc` → 400 explicite (était fallback silencieux sur le fetch du message).
- ✅ R55 ipv6Prefix64 : forme hex `::ffff:0102:0304` → IPv4.
- ✅ R56 S1 documenté : From/Date/Message-ID du brouillon préservés (redirect assumé, enveloppe correcte).
- ✅ Vérif : tsc + eslint + 41 vitest + build verts.

## Étape 14 — Relevé manuel (comptes "manual")
- ✅ `MailAccount.manual` (flag `manual: true` dans MAIL_ACCOUNTS) : le cron et l'overview ignorent le compte — zéro IMAP automatique (anti-blocage free.fr : ses logins depuis IP de datacenter font bloquer le compte comme « compromis »).
- ✅ `GET /api/account?account=x` : relevé à la demande d'un seul compte.
- ✅ Tap sur le badge du compte manuel → relevé + merge dans accounts/pile/aside ; refresh global conserve ses données déjà relevées.
- ✅ HUD : icône ✋ à la place du compteur ; InboxDrawer : états « relevé en cours » / « pas de relevé ».
- ✅ `manual: true` posé sur `free` dans `.env.local` + Vercel (prod/preview/dev).
- ✅ `.env.example` + README documentés ; tsc + eslint + 41 vitest + build verts.

## Étape 15 — Audit #3 (QA) + 4 demandes
### Bugs de données
- ✅ B1 Rappels : `dueAgendaReminders` ne sélectionnait pas `who` → « avec qui » absent des mails.
- ✅ B2 Refresh : un échec de `/api/agenda` ou `/api/inbox-order` vidait la liste (écran + snapshot) → on conserve l'existant.
- ✅ B3 Outbox : op enfilée pendant un flush écrasée (même onglet) + race multi-onglets → flush tête-par-tête + Web Locks.
- ✅ B6 Rappels : prophétie restaurée/replanifiée/créée dans le passé → rappel immédiat → plus de rappel au-delà de 15 min après l'échéance (voir R60).
- ✅ B12 `initDb` concurrent (race DDL Postgres) → promesse unique.
### Demandes
- ✅ C Minutes arrondies au quart d'heure SUIVANT (défaut + toutes saisies) ; heure par défaut calculée à l'ouverture (plus figée au montage) ; B7 `min`/`now` recalculés à l'ouverture.
- ✅ A Prophétie dépassée ET non faite → suppression sans popup.
- ✅ D Recherche dans le fourre-tout (titre + corps, sans accents, sans tri pendant la recherche) ; `foldText` partagé avec les quêtes.
- ✅ B Instance unique : manifest (`id`, `scope`, `launch_handler` focus-existing) + SW network-first manifest/icônes + écran « déjà ouvert ailleurs — Utiliser ici » (BroadcastChannel).
### Fraîcheur
- ✅ B4 Cache serveur : génération (une lecture IMAP lancée avant une mutation ne réécrit plus de données périmées).
- ✅ B5 Boutons refresh : `?fresh=1` vide le cache overview (rate-limité).
- ✅ B10 Comptes manuels relevés après une action (forger, reforger, envoyer, supprimer, ressusciter).
- ✅ B11 Aperçus des cartes : une seule tentative par brouillon (plus de boucle IMAP).
### Finitions
- ✅ B8 Ids stables des items de note + swipes sur les items faits.
- ✅ B9 Positions des quêtes calculées sur l'état courant ; doublons détectés dans un même collage et à l'édition.
- ✅ Robustesse : push vérifie la réponse serveur, verrouillage averti si modifs en attente, version de schéma DB, `ensureDb` partout, « SERVEUR KO » distinct de « HORS-LIGNE ».
- ✅ UX : Échap + focus sur ConfirmDialog/Sheet, `lang` dans le manifest.
- ✅ Refactors : `useQuests`/`useNotes`/`useProphecies` (page.tsx 853 → ~700 lignes), helpers fetch (`jsonInit`/`sendJson`), `clearOfflineData`, `sortTasks` immuable. Brouillons/inbox restent dans page.tsx (très liés à refresh/pollAccount/busy — découpage à part).
- ✅ Tests : 60 vitest (+19 : quart d'heure, isOverdue, foldText, snapshot partiel, cache à génération, outbox pendant flush) ; tsc + eslint + build verts ; schéma + requête des rappels vérifiés sur la vraie DB.
### Non fait (volontairement)
- ⬜ Toast « Annuler » après une suppression sans popup (optionnel au plan).
- ✅ Icône `maskable` du manifest : faite (R65) — variantes 192/512 avec zone sûre.

## Étape 16 — Retour de review (audit #3)
- ✅ R57 Minutes tapées au clavier : arrondies au quart SUIVANT (53 → 15:00), plus au plus proche (53 → :45). `setSegment` pur + 3 tests sur le chemin réel.
- ✅ R58 Instance unique par **Web Lock** tenu toute la vie de l'onglet (fini le ping/pong de 400 ms) : acquisition atomique (deux fenêtres ouvertes en même temps → une seule active), verrou libéré par le navigateur à la fermeture/crash (l'instance en pause reprend seule), « Utiliser ici » = `steal` (marche même si l'instance active est gelée).
- ✅ R59 Instance en pause réellement inerte : `<main inert>` (ni clic, ni Tab, ni Entrée) + refresh/rejeu de file suspendus.
- ✅ R60 Rappels : fenêtre de grâce de 15 min après l'échéance au lieu de `due_at > now()` strict — `remind_minutes = 0` refonctionne, un cron en retard envoie le rappel en retard au lieu de le perdre.
- ✅ R61 Sélecteur de date : l'heure proposée à l'ouverture devient la vraie valeur (plus de « 15:00 » affiché sans valeur, bouton Ajouter bloqué).
- ✅ R62 Indentation du panneau fourre-tout réalignée.

## Étape 17 — Renommage Mail Quest → Tidy Quest + icônes Linux
- ✅ Nom visible partout : en-tête, écran de connexion, overlay instance, titre/metadata, manifest (`name`/`short_name`), notifications SW, signature des rappels, tag push, `package.json`, README.
- ✅ En-tête interne renommé `X-Tidy-Quest` avec compat `X-Mail-Quest` : les brouillons IA existants gardent leur badge, les deux formes sont stripées à l'envoi.
- ✅ Identifiants internes déjà neutres (`mq-*` : verrous, clés localStorage, cache SW) — aucune donnée perdue au renommage.
- ✅ Icônes : set complet 48→512 généré en NEAREST (pixel art net), variantes maskable (zone sûre), `favicon.ico` multi-résolutions — couvre l'install PWA Ubuntu/GNOME (les icônes ne sont téléchargées qu'à l'installation → réinstaller l'app pour les voir).
- ⬜ Reste externe : nom du repo GitHub (`flodef/mail-quest`), chemin `pass` — volontairement inchangés.
- ✅ R64 Outbox : course inter-onglets restante couverte — `enqueueOp` écrit hors verrou (durabilité) puis revérifie sous verrou via `repairEnqueued` ; le flusheur marque les ids consommés dans `mq-outbox-sent` (anneau) pour distinguer « écrasée » (remise en file) de « envoyée » (jamais dupliquée). 3 tests.
- ✅ R65 Icônes maskable (Android) : art porté à 78% du cadre (~97% de la zone sûre de 80%) — leçon du fix Fidelity (fond opaque plein cadre + artwork remplissant la zone sûre, jamais de marges blanches). Vérifié par rendu masqué circulaire.
- ✅ R66 Domaine : `mail.fims.fi` → **`tidy.fims.fi`** — domaine sur le projet Vercel, CNAME `tidy` → `cname.vercel-dns.com.` dans la zone OVH `fims.fi`. `mail.fims.fi` SUPPRIMÉ (domaine Vercel retiré + CNAME OVN effacé, plus de redirection). Projet Vercel renommé **tidy-quest** → `tidy-quest.vercel.app` (`mail-quest.vercel.app` libéré, 404). Jobs cron-job.org repointés sur `https://tidy.fims.fi` et renommés « tidy-quest … ».
- ✅ R67 Quota Neon (82% consommé) : le job cron « reminders » toutes les 5 min empêchait l'autosuspend (seuil 300 s) → DB éveillée en permanence ≈ 180 CU·h/mois. Le job est redondant (`/api/cron` appelle déjà `checkReminders`) → **désactivé** côté cron-job.org. Reste 4 wakes/h via `/api/cron` + lazy-check d'overview (throttle 60 s).
- ✅ R68 Cron `/api/cron` limité aux heures d'éveil (8h–22h Europe/Paris, dernier run 21h45) : ~56 wakes/jour au lieu de 96 → quota Neon estimé ~15–20%. Les rappels de nuit sautent via la fenêtre de grâce (15 min) — pas de mail à 8h pour une prophétie de 23h.
- ✅ R69 UI rappels vs fenêtre cron : `reminderFireTime` (dates.ts) calcule l'envoi réel — un rappel n'est proposable que s'il tombe sur un tick cron (8h–22h). AgendaPanel affiche « ⚠ RAPPEL IMPOSSIBLE — MIN : -X » (rappel prévu hors fenêtre et grâce dépassée), « ⚠ ENVOI {date} » (envoi réel différent : moins d'avance que demandé) ou le label normal. Valable à l'ajout ET à l'édition. 8 tests sur les cas 23h/7h/8h15.
- ✅ R70 Fourre-tout : en-tête contextuel. Vue liste = « FOURRE-TOUT (n) » + 🔍 liste/⟳/✕ ; vue détail = « ← titre — faits/total » + 🔍 items/📋/🗑/✕ (fini le double en-tête et le « 8 » trompeur). Recherche dans les items d'une note (sans accents, actifs+faits, poignées désactivées pendant le filtrage). Échap dans le détail → retour liste (Sheet gagne `onEscape`, distinct du clic backdrop qui ferme toujours). Bouton copie des cartes conservé.
- ✅ R71 Pile vide : au lieu de l'écran « QUEST COMPLETE » seul, la zone centrale affiche les 5 premières quêtes actives avec les mêmes swipes que le panneau (▶ faite, ◀ fond de pile, tap = édition) + bouton « ⚔ VOIR TOUTES LES QUÊTES (n) » qui ouvre le panneau. `Victory` reste quand pile ET quêtes sont vides.
- ✅ R72 « Voir toutes les quêtes » : affiché seulement si >5 quêtes actives, ouvre le panneau avec la réserve dépliée (`showReserve` remonté en prop contrôlée dans page.tsx) et scrolle jusqu'au 6e item (ref sur le premier item de réserve). Le bouton nav ⚔ ouvre le panneau sans forcer l'état.
- ✅ R73 Écran pile vide : label « PILE VIDE — n QUÊTES » retiré ; les 5 quêtes visibles sont réordonnables par drag ☰ (SortableList, réordonnancement des 5 premières + reste inchangé, même sémantique que le panneau).
- ✅ R74 Review 4 : `reminderFireTime` borne la recherche à `now` (plus de tick passé / « ENVOI …(PASSÉ) »), borne de grâce strictement ouverte (alignée sur le `due_at > now()−15min` du serveur), `ceilToQuarter` pour les secondes. Tests avec `now` fixe + 3 régressions (rappel déjà entamé, borne exacte, secondes). Outbox : le flush saute les ops déjà envoyées (anneau SENT — fini la résurrection/double envoi) ; repairEnqueued documenté (remise en fin de file). QuestPanel : `key` superflue retirée, scroll en `nearest` (ne bouge pas le document). Échap dans un champ recherche vide → ferme la recherche (liste + détail). Commentaire route reminders + ⬜ maskable du plan corrigés. Prettier passé.
- ✅ R75 Review 5 : le check `sentIds` du flush (annoncé R74 mais jamais écrit) réellement implémenté — une op ressuscitée par un enqueue concurrent est retirée sans re-fetch (test de régression : A rejoué 0 fois). Échap de la recherche quêtes aligné sur le fourre-tout (vide → ferme la recherche). `scroll-mb-8` sur le 6e item — ne finit plus collé sous le bouton sticky.
