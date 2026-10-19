import { ImapFlow, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import sanitizeHtml from "sanitize-html";
import MailComposer from "nodemailer/lib/mail-composer";
import { Libmime } from "libmime";
import type { MailAccount } from "./accounts";

// Noms de fichiers PJ encodés =?utf-8?...?=.
const mime = new Libmime();

export interface DraftSummary {
  account: string;
  mailbox: string;
  uid: number;
  to: string;
  subject: string;
  date: string | null;
  preview: string;
  /** Brouillon généré par l'IA (en-tête X-Tidy-Quest: ai). */
  ai?: boolean;
}

export interface DraftFull extends DraftSummary {
  /** HTML nettoyé (scripts/handlers/formulaires retirés, liens sécurisés). */
  html: string | null;
  /** Variante sans images distantes (anti pixel-espion). */
  htmlNoImg: string | null;
  text: string | null;
  cc: string;
}

export interface InboxItem {
  account: string;
  uid: number;
  from: string;
  fromEmail: string;
  subject: string;
  date: string | null;
  unread: boolean;
  hasAttachment?: boolean;
}

export interface AttachmentMeta {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface InboxFull extends InboxItem {
  to: string;
  html: string | null;
  htmlNoImg: string | null;
  text: string | null;
  attachments?: AttachmentMeta[];
  replyTo?: string;
  replyToEmail?: string;
  messageId?: string;
}

// Circuit-breaker anti-verrouillage : un échec d'authentification suspend les
// appels IMAP du compte pendant 30 min. Certains hébergeurs (Free) bloquent le
// compte après des échecs répétés — un mot de passe périmé ne doit pas marteler.
// NOTE : en mémoire, propre à l'instance — un déploiement multi-instance peut
// laisser passer des échecs sur d'autres instances (limite connue, à partager
// en DB si ça devient un problème).
const authFailAt = new Map<string, number>();
const AUTH_COOLDOWN_MS = 30 * 60 * 1000;

function authSuspendedUntil(accountId: string): number | null {
  const at = authFailAt.get(accountId);
  return at && Date.now() - at < AUTH_COOLDOWN_MS ? at + AUTH_COOLDOWN_MS : null;
}

function isAuthError(e: unknown): boolean {
  const err = e as { authenticationFailed?: boolean; response?: string; message?: string };
  return Boolean(
    err?.authenticationFailed ||
      /authentication|credential|AUTHENTICATIONFAILED/i.test(err?.response ?? err?.message ?? ""),
  );
}

async function withClient<T>(acc: MailAccount, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const until = authSuspendedUntil(acc.id);
  if (until) {
    throw new Error(`compte suspendu encore ${Math.ceil((until - Date.now()) / 60000)} min (échec d'authentification)`);
  }
  const client = new ImapFlow({
    host: acc.imap.host,
    port: acc.imap.port,
    secure: acc.imap.secure,
    auth: { user: acc.imap.user, pass: acc.imap.password },
    logger: false,
    socketTimeout: 20000,
  });
  try {
    await client.connect();
    const out = await fn(client);
    authFailAt.delete(acc.id);
    return out;
  } catch (e) {
    if (isAuthError(e)) authFailAt.set(acc.id, Date.now());
    throw e;
  } finally {
    try { await client.logout(); } catch { /* noop */ }
  }
}

function iso(d: string | Date | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

// --- Helpers d'extraction partagés ---

/** Adresses d'un champ d'en-tête parsé (from/to/cc/replyTo). */
function addrList(v: AddressObject | AddressObject[] | undefined): { email: string; name: string }[] {
  if (!v) return [];
  const groups = Array.isArray(v) ? v : [v];
  return groups.flatMap((g) => g.value.map((a) => ({ email: (a.address ?? "").trim(), name: (a.name ?? "").trim() })));
}

/** "Nom <a@b>" pour l'affichage. */
function addrDisplay(v: AddressObject | AddressObject[] | undefined): string {
  return addrList(v).map((a) => (a.name && a.email ? `${a.name} <${a.email}>` : a.email || a.name)).filter(Boolean).join(", ");
}

/** Première adresse, en minuscules — pour les correspondances expéditeur. */
function firstAddr(v: AddressObject | AddressObject[] | undefined): string {
  return (addrList(v)[0]?.email ?? "").toLowerCase();
}

// Correspondance expéditeur EXACTE (insensible à la casse) — un "includes"
// transformerait "banni a@b.com" en "banni aussi aa@b.com / a@b.com.fr".
const sameSender = (fromEmail: string, want: string) => fromEmail.toLowerCase() === want.toLowerCase();

// LIST des mailboxes mis en cache par connexion (drafts+trash résolus en 1 appel).
const mailboxCache = new WeakMap<ImapFlow, Awaited<ReturnType<ImapFlow["list"]>>>();

async function findMailbox(client: ImapFlow, special: string, fallbacks: string[]): Promise<string | null> {
  let all = mailboxCache.get(client);
  if (!all) {
    all = await client.list();
    mailboxCache.set(client, all);
  }
  const bySpecial = all.find((b) => b.specialUse === special);
  if (bySpecial) return bySpecial.path;
  for (const fb of fallbacks) {
    const hit = all.find(
      (b) => b.path.toLowerCase() === fb.toLowerCase() || b.path.toLowerCase().endsWith("." + fb.toLowerCase()),
    );
    if (hit) return hit.path;
  }
  return null;
}

export async function draftsMailbox(client: ImapFlow): Promise<string> {
  return (await findMailbox(client, "\\Drafts", ["Drafts", "Brouillons", "INBOX.Drafts", "INBOX.INBOX.Drafts"])) ?? "Drafts";
}

export async function trashMailbox(client: ImapFlow): Promise<string> {
  return (await findMailbox(client, "\\Trash", ["Trash", "Corbeille", "INBOX.Trash", "INBOX.INBOX.Trash"])) ?? "Trash";
}

// --- Sanitisation HTML des mails (XSS + pixels-espions) ---

const SANITIZE_BASE: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img", "center", "font", "html", "head", "body",
  ],
  allowedAttributes: {
    // target + rel doivent être autorisés : transformTags les injecte avant
    // le filtrage des attributs, sinon ils sont retirés.
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    "*": ["style", "class", "dir", "align", "valign", "bgcolor", "color", "face", "size", "cellpadding", "cellspacing", "border", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "data", "cid"],
  // data: uniquement sur <img> — un lien data:text/html serait du markup
  // injectable en nouvel onglet (les navigateurs bloquent, ceinture+bretelles).
  allowedSchemesByTag: { img: ["http", "https", "data", "cid"], a: ["http", "https", "mailto", "tel"] },
  allowProtocolRelative: false,
  transformTags: {
    // Liens vers l'extérieur forcés en nouvel onglet sans window.opener.
    a: (tag, attribs) => ({
      tagName: "a",
      attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
  },
};

const SANITIZE_NO_IMG: sanitizeHtml.IOptions = {
  ...SANITIZE_BASE,
  // Variante « sans images distantes » : seules les images embarquées restent.
  allowedSchemesByTag: { img: ["data", "cid"], a: ["http", "https", "mailto", "tel"] },
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    // Surtout PAS de `style` : sanitize-html ne filtre pas le contenu CSS —
    // background-image/list-style-image/content:url(tracker) passeraient et
    // contourneraient le blocage des pixels-espions.
    "*": ["class", "dir", "align", "valign", "bgcolor", "color", "face", "size", "cellpadding", "cellspacing", "border", "width", "height"],
  },
};

export const sanitizeBody = (html: string | false | undefined, images: boolean): string | null =>
  typeof html === "string" && html ? sanitizeHtml(html, images ? SANITIZE_BASE : SANITIZE_NO_IMG) : null;

// Texte brut dérivé du HTML SANITIZÉ (pas de part text/plain — mailparser
// faisait la même chose via htmlToText) : contexte IA + preview des mails
// html-only. Les fermetures de blocs deviennent des sauts de ligne avant le
// strip total des tags.
export function htmlToPlain(html: string): string {
  const withBreaks = html.replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/td|\/h[1-6]|\/table|\/blockquote)\b[^>]*>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&") // en dernier : "&amp;lt;" doit rester "&lt;"
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Nœuds feuilles de la BODYSTRUCTURE (message/rfc822 = blob attaché entier).
function* leafNodes(node: MessageStructureObject | undefined): Generator<MessageStructureObject> {
  if (!node) return;
  if (node.childNodes?.length && node.type !== "message/rfc822") {
    for (const c of node.childNodes) yield* leafNodes(c);
    return;
  }
  yield node;
}

// PJ si disposition attachment, un filename est porté, un mail encapsulé —
// ou `name=` sur une part NON-texte (vieux clients : Content-Type: pdf;
// name="doc.pdf" sans Content-Disposition). name= sur text/* reste du texte.
const isAttachmentNode = (n: MessageStructureObject) =>
  n.disposition === "attachment" ||
  Boolean(n.dispositionParameters?.filename) ||
  n.type === "message/rfc822" ||
  Boolean(n.parameters?.name && !n.type.startsWith("text/"));

// Liste des PJ d'une structure — inclut le corps entier quand le mail est
// mono-part non-texte (scanner/fax : body = pdf/image sans name= ni
// disposition). Partagé entre meta et téléchargement → index cohérents.
function attachmentNodes(root: MessageStructureObject | undefined): MessageStructureObject[] {
  const leaves = [...leafNodes(root)];
  return leaves.filter((n) => isAttachmentNode(n) || (leaves.length === 1 && !n.type.startsWith("text/")));
}

const decodeFilename = (v: string | undefined, fallback: string) => {
  if (!v) return fallback;
  try {
    return mime.decodeWords(v) || fallback;
  } catch {
    return v;
  }
};

// --- Drafts ---

// En-tête interne « généré par l'IA ». `x-mail-quest` est l'ancien nom
// (avant le renommage en Tidy Quest) : les brouillons déjà posés en IMAP le
// portent encore — on lit les deux, on n'écrit que le nouveau.
const AI_HEADER = "x-tidy-quest";
const AI_HEADER_LEGACY = "x-mail-quest";
// Valeur exacte "ai" — un "X-Tidy-Quest: no" ou un préfixe ressemblant ne
// doit pas marquer le brouillon.
const hasAiMark = (headers: ParsedMail["headers"]) => {
  const v = headers?.get(AI_HEADER) ?? headers?.get(AI_HEADER_LEGACY);
  const s = typeof v === "string" ? v : (v as { value?: string } | undefined)?.value;
  return s?.trim().toLowerCase() === "ai";
};

async function listDraftsOn(client: ImapFlow, acc: MailAccount): Promise<DraftSummary[]> {
  const box = await draftsMailbox(client);
  const lock = await client.getMailboxLock(box);
  try {
    const out: DraftSummary[] = [];
    for await (const msg of client.fetch("1:*", { envelope: true, headers: [AI_HEADER, AI_HEADER_LEGACY] }, { uid: true })) {
      const env = msg.envelope;
      const to = (env?.to ?? []).map((a) => a.address ?? a.name ?? "").filter(Boolean).join(", ");
      out.push({
        account: acc.id,
        mailbox: box,
        uid: msg.uid,
        to,
        subject: env?.subject ?? "(sans sujet)",
        date: iso(env?.date),
        preview: "",
        // L'en-tête brut est recherché ligne par ligne : "x-tidy-quest: ai"
        // (ou l'ancien "x-mail-quest: ai") exact — ni "X-Tidy-Quest-Extra:",
        // ni une autre valeur.
        ai: /(?:^|\r?\n)x-(?:tidy|mail)-quest:\s*ai\s*$/im.test(msg.headers?.toString() ?? "") || undefined,
      });
    }
    return out;
  } finally {
    lock.release();
  }
}

export async function listDrafts(acc: MailAccount): Promise<DraftSummary[]> {
  return withClient(acc, (client) => listDraftsOn(client, acc));
}

async function downloadRaw(client: ImapFlow, uid: number): Promise<Buffer | null> {
  const raw = await client.download(String(uid), undefined, { uid: true, maxBytes: 60_000_000 });
  if (!raw?.content) return null;
  return streamToBuffer(raw.content);
}

interface ParsedParts {
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  replyTo?: string;
  replyToEmail?: string;
  messageId?: string;
  subject: string;
  date: string | null;
  preview: string;
  html: string | null;
  htmlNoImg: string | null;
  text: string | null;
  attachments: AttachmentMeta[];
  ai?: boolean;
}

// Contenu d'une part MIME : client.download décode le transfer-encoding ET
// convertit le texte en UTF-8 côté ImapFlow.
// Collecte d'un stream en Buffer — utilisé par partText, downloadRaw et
// getAttachment (3 fois le même collecteur avant).
const streamToBuffer = (stream: NodeJS.ReadableStream): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

async function partText(client: ImapFlow, uid: number, part: string | undefined): Promise<string | null> {
  if (!part) return null;
  const dl = await client.download(String(uid), part, { uid: true, maxBytes: 10_000_000 });
  if (!dl?.content) return null;
  return (await streamToBuffer(dl.content)).toString("utf8");
}

/**
 * Parse sélectif : en-têtes + BODYSTRUCTURE d'abord, puis UNIQUEMENT les
 * parts text/plain et text/html — les pièces jointes ne sont jamais
 * téléchargées (leurs métadonnées viennent de la structure). Un mail de
 * 25 Mo n'explose plus la mémoire.
 */
async function fetchParsed(client: ImapFlow, uid: number): Promise<ParsedParts | null> {
  const msg = await client.fetchOne(String(uid), { headers: true, bodyStructure: true }, { uid: true });
  if (!msg || !msg.headers) return null;
  const head: ParsedMail = await simpleParser(msg.headers);
  const leaves = [...leafNodes(msg.bodyStructure)];
  const textNodes = leaves.filter((n) => n.type === "text/plain" && !isAttachmentNode(n));
  const htmlNodes = leaves.filter((n) => n.type === "text/html" && !isAttachmentNode(n));
  // Nœud trouvé mais sans numéro de part (racine mono-part) → "1".
  // AUCUN nœud → on ne télécharge pas "1" (ce serait du HTML brut ou du
  // binaire dans `text`/`preview`).
  // Toutes les parts texte sont concaténées (parity mailparser — un
  // multipart/mixed peut avoir plusieurs segments texte inline).
  const textParts = (await Promise.all(textNodes.map((n) => partText(client, uid, n.part ?? "1")))).filter((t): t is string => t !== null);
  const htmlParts = (await Promise.all(htmlNodes.map((n) => partText(client, uid, n.part ?? "1")))).filter((t): t is string => t !== null);
  const rawText = textParts.length ? textParts.join("\n") : null;
  const htmlRaw = htmlParts.length ? htmlParts.join("\n") : null;
  const html = htmlRaw !== null ? sanitizeBody(htmlRaw, true) : null;
  // Pas de part text/plain → texte dérivé du HTML sanitizé (parity mailparser).
  const text = rawText ?? (html ? htmlToPlain(html) : null);
  const replyTo = addrList(head.replyTo);
  return {
    from: addrDisplay(head.from) || (head.from?.text ?? ""),
    fromEmail: firstAddr(head.from),
    to: addrDisplay(head.to),
    cc: addrDisplay(head.cc),
    replyTo: addrDisplay(head.replyTo) || undefined,
    replyToEmail: replyTo[0]?.email.toLowerCase() || undefined,
    messageId: head.messageId || undefined,
    subject: head.subject ?? "(sans sujet)",
    date: iso(head.date),
    preview: (text ?? "").replace(/\s+/g, " ").slice(0, 140),
    html,
    htmlNoImg: sanitizeBody(htmlRaw ?? false, false),
    text,
    attachments: attachmentNodes(msg.bodyStructure).map((n, index) => ({
      index,
      filename: decodeFilename(n.dispositionParameters?.filename ?? n.parameters?.name, `piece-jointe-${index + 1}`),
      contentType: n.type ?? "application/octet-stream",
      // n.size = octets encodés (BODYSTRUCTURE) — estimation décodée pour base64.
      size: n.encoding === "base64" ? Math.floor((n.size ?? 0) * 0.75) : n.size ?? 0,
    })),
    ai: hasAiMark(head.headers) || undefined,
  };
}

// La boîte à brouillons est résolue côté serveur — jamais depuis le client.
export async function getDraft(acc: MailAccount, uid: number): Promise<DraftFull | null> {
  return withClient(acc, async (client) => {
    const box = await draftsMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      const f = await fetchParsed(client, uid);
      if (!f) return null;
      return {
        account: acc.id,
        mailbox: box,
        uid,
        to: f.to,
        cc: f.cc,
        subject: f.subject,
        date: f.date,
        preview: f.preview,
        html: f.html,
        htmlNoImg: f.htmlNoImg,
        text: f.text,
        ai: f.ai,
      };
    } finally {
      lock.release();
    }
  });
}

/**
 * Brouillon BRUT tel que stocké (MIME complet, PJ incluses) + destinataires
 * de l'enveloppe. Utilisé par sendDraft : on envoie exactement ce que le
 * brouillon contient — jamais le HTML sanitizé de l'aperçu.
 */
export async function getDraftRaw(
  acc: MailAccount,
  uid: number,
): Promise<{ raw: Buffer; envelopeTo: string[]; to: string; subject: string } | null> {
  return withClient(acc, async (client) => {
    const box = await draftsMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      const meta = await client.fetchOne(String(uid), { envelope: true, headers: true }, { uid: true });
      if (!meta) return null;
      const raw = await downloadRaw(client, uid);
      if (!raw) return null;
      // Brouillon > cap : un MIME tronqué part aux destinataires si on
      // l'envoie — refuser plutôt que corrompre (le passe-plat s'arrête
      // pile à maxBytes).
      if (raw.length >= 60_000_000) throw new Error("brouillon trop volumineux pour l'envoi");
      const env = meta.envelope;
      const head: ParsedMail = await simpleParser(meta.headers ?? Buffer.alloc(0));
      // Adresses filtrées — une enveloppe malformée ne casse pas la session
      // SMTP. Local-parts quotés ("foo bar"@x.fr) acceptés ; si l'enveloppe
      // est entièrement invalide, repli sur les en-têtes parsés.
      const envAddrs = [...(env?.to ?? []), ...(env?.cc ?? []), ...(env?.bcc ?? [])].map((a) => (a.address ?? "").trim());
      const headAddrs = [...addrList(head.to), ...addrList(head.cc), ...addrList(head.bcc)].map((a) => a.email);
      const valid = (a: string) => EMAIL_RE.test(a) || /^"[^"\r\n]+"@[^\s@<>]+\.[^\s@<>]+$/.test(a);
      const envFiltered = envAddrs.filter(valid);
      const envelopeTo = envFiltered.length ? envFiltered : headAddrs.filter(valid);
      return { raw, envelopeTo, to: addrDisplay(head.to), subject: head.subject ?? "(sans sujet)" };
    } finally {
      lock.release();
    }
  });
}

export async function moveDraft(acc: MailAccount, uid: number): Promise<void> {
  await withClient(acc, async (client) => {
    const box = await draftsMailbox(client);
    const trash = await trashMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      await client.messageMove(String(uid), trash, { uid: true });
    } finally {
      lock.release();
    }
  });
}

// --- Stats & liste INBOX ---

interface InboxStats {
  unseen: number;
  mutedUnseen: number;
  total: number;
  latest: InboxItem[];
}

interface EnvelopeMsg {
  uid: number;
  envelope?: { from?: { address?: string; name?: string }[]; subject?: string; date?: Date | string };
  flags?: Set<string>;
  bodyStructure?: MessageStructureObject;
}

function envToItem(acc: MailAccount, msg: EnvelopeMsg): InboxItem {
  const env = msg.envelope;
  return {
    account: acc.id,
    uid: msg.uid,
    from: (env?.from ?? []).map((a) => a.name ?? a.address ?? "").filter(Boolean).join(", "),
    fromEmail: (env?.from?.[0]?.address ?? "").toLowerCase(),
    subject: env?.subject ?? "(sans sujet)",
    date: iso(env?.date),
    unread: !(msg.flags?.has("\\Seen") ?? false),
    hasAttachment: [...leafNodes(msg.bodyStructure)].some(isAttachmentNode),
  };
}

const FETCH_META = { envelope: true, flags: true, bodyStructure: true } as const;

async function inboxStatsOn(client: ImapFlow, acc: MailAccount, mutedSenders: string[] = []): Promise<InboxStats> {
  const lock = await client.getMailboxLock("INBOX");
  try {
    const status = await client.status("INBOX", { unseen: true, messages: true });
    const total: number = typeof status === "object" && status ? (status.messages ?? 0) : 0;
    const unseen: number = typeof status === "object" && status ? (status.unseen ?? 0) : 0;

    // Avec des expéditeurs bannis, un seul scan 1:* sert à la fois au décompte
    // des non-lus bannis ET à la fenêtre des 8 derniers — prise APRÈS filtrage
    // des bannis, sinon une page entière de bannis masquerait l'aperçu.
    // (IMAP SEARCH peu fiable chez OVH — cf. inboxEnvelopes. Coût : 1 fetch 1:*
    // par compte bannisseur à chaque overview (cache 60 s) et run cron.)
    if (mutedSenders.length > 0) {
      // 1re passe légère (enveloppes+flags seulement) : décompte des bannis
      // et uids des non-bannis — pas de bodyStructure sur toute la boîte.
      const light = { envelope: true, flags: true } as const;
      let mutedUnseen = 0;
      const visibleUids: number[] = [];
      for await (const msg of client.fetch("1:*", light, { uid: true })) {
        const from = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
        const muted = mutedSenders.some((s) => sameSender(from, s));
        if (muted && !(msg.flags?.has("\\Seen") ?? false)) mutedUnseen++;
        if (!muted) visibleUids.push(msg.uid);
      }
      // 2e passe : bodyStructure (pièces jointes) seulement sur la fenêtre visible.
      const tailUids = visibleUids.slice(-8);
      const byUid = new Map<number, EnvelopeMsg>();
      if (tailUids.length > 0) {
        for await (const msg of client.fetch(tailUids.join(","), FETCH_META, { uid: true })) {
          byUid.set(msg.uid, msg as EnvelopeMsg);
        }
      }
      const latest = tailUids.map((u) => byUid.get(u) ?? ({ uid: u } as EnvelopeMsg)).reverse().map((m) => envToItem(acc, m));
      return { unseen, mutedUnseen, total, latest };
    }

    const latest: InboxItem[] = [];
    if (total > 0) {
      const range = `${Math.max(1, total - 7)}:*`;
      for await (const msg of client.fetch(range, FETCH_META, { uid: true })) {
        latest.unshift(envToItem(acc, msg));
      }
    }
    return { unseen, mutedUnseen: 0, total, latest };
  } finally {
    lock.release();
  }
}

export async function inboxStats(acc: MailAccount, mutedSenders: string[] = []): Promise<InboxStats> {
  return withClient(acc, (client) => inboxStatsOn(client, acc, mutedSenders));
}

// Stats INBOX + drafts en UNE connexion (économie Fluid : 1 TLS+auth au lieu de 2).
export async function fetchAccount(acc: MailAccount, mutedSenders: string[] = []): Promise<{ stats: InboxStats; drafts: DraftSummary[] }> {
  return withClient(acc, async (client) => ({
    stats: await inboxStatsOn(client, acc, mutedSenders),
    drafts: await listDraftsOn(client, acc),
  }));
}

export async function getMessage(acc: MailAccount, uid: number): Promise<InboxFull | null> {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const f = await fetchParsed(client, uid);
      if (!f) return null;
      return {
        account: acc.id,
        uid,
        from: f.from,
        fromEmail: f.fromEmail,
        to: f.to,
        subject: f.subject,
        date: f.date,
        unread: false,
        html: f.html,
        htmlNoImg: f.htmlNoImg,
        text: f.text,
        attachments: f.attachments,
        replyTo: f.replyTo,
        replyToEmail: f.replyToEmail,
        messageId: f.messageId,
        ai: f.ai,
      };
    } finally {
      lock.release();
    }
  });
}

// Télécharge une pièce jointe (index = position dans parsed.attachments).
export async function getAttachment(
  acc: MailAccount,
  uid: number,
  index: number,
): Promise<{ filename: string; contentType: string; content: Buffer; truncated?: boolean } | null> {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
      if (!msg) return null;
      const node = attachmentNodes(msg.bodyStructure)[index];
      if (!node) return null;
      // Nœud racine sans numéro (mail entier déclaré attachment) → "1".
      // Cap mémoire : une PJ géante est tronquée plutôt que bufferisée.
      // maxBytes = cap+1 : « reçu > cap » prouve la troncation.
      const dl = await client.download(String(uid), node.part ?? "1", { uid: true, maxBytes: 30_000_001 });
      if (!dl?.content) return null;
      const content = await streamToBuffer(dl.content);
      // Tronquée seulement si on a atteint le cap maxBytes (le passe-plat
      // s'arrête pile dessus). expectedSize ≠ utilisable : c'est la taille
      // du message ENTIER (RFC822.SIZE), pas de la part.
      const truncated = content.length > 30_000_000;
      return {
        // dl.meta.filename est déjà décodé par ImapFlow — priorité.
        filename: dl.meta?.filename || decodeFilename(node.dispositionParameters?.filename ?? node.parameters?.name, `piece-jointe-${index + 1}`),
        contentType: node.type ?? "application/octet-stream",
        content,
        truncated,
      };
    } finally {
      lock.release();
    }
  });
}

export async function deleteMessage(acc: MailAccount, uid: number): Promise<void> {
  await withClient(acc, async (client) => {
    const trash = await trashMailbox(client);
    const lock = await client.getMailboxLock("INBOX");
    try {
      await client.messageMove(String(uid), trash, { uid: true });
    } finally {
      lock.release();
    }
  });
}

async function listTrashOn(client: ImapFlow, acc: MailAccount): Promise<InboxItem[]> {
  const box = await trashMailbox(client);
  const lock = await client.getMailboxLock(box);
  try {
    const status = await client.status(box, { messages: true });
    const total: number = typeof status === "object" && status ? (status.messages ?? 0) : 0;
    const out: InboxItem[] = [];
    if (total > 0) {
      const range = `${Math.max(1, total - 29)}:*`;
      for await (const msg of client.fetch(range, FETCH_META, { uid: true })) {
        out.unshift(envToItem(acc, msg));
      }
    }
    return out;
  } finally {
    lock.release();
  }
}

export async function listTrash(acc: MailAccount): Promise<InboxItem[]> {
  return withClient(acc, (client) => listTrashOn(client, acc));
}

export async function restoreTrash(acc: MailAccount, uid: number): Promise<void> {
  await withClient(acc, async (client) => {
    const box = await trashMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      await client.messageMove(String(uid), "INBOX", { uid: true });
    } finally {
      lock.release();
    }
  });
}

// Suppression définitive dans la corbeille (uid précis, ou toute la boîte sans uid).
export async function purgeTrash(acc: MailAccount, uid?: number): Promise<number> {
  return withClient(acc, async (client) => {
    const box = await trashMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      if (Number.isInteger(uid)) {
        await client.messageDelete(String(uid), { uid: true });
        return 1;
      }
      const status = await client.status(box, { messages: true });
      const total: number = typeof status === "object" && status ? (status.messages ?? 0) : 0;
      if (total > 0) await client.messageDelete("1:*", { uid: false });
      return total;
    } finally {
      lock.release();
    }
  });
}

export async function deleteFromSender(acc: MailAccount, senderEmail: string): Promise<number> {
  return withClient(acc, async (client) => {
    const trash = await trashMailbox(client);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const want = senderEmail.toLowerCase();
      const envs = await inboxEnvelopes(client);
      const uids = envs.filter((e) => sameSender(e.fromEmail, want)).map((e) => e.uid);
      if (uids.length > 0) {
        await client.messageMove(uids.join(","), trash, { uid: true });
      }
      return uids.length;
    } finally {
      lock.release();
    }
  });
}

// OVH IMAP SEARCH is unreliable (returns empty), so we filter envelopes client-side.
async function inboxEnvelopes(client: ImapFlow): Promise<{ uid: number; fromEmail: string; subject: string }[]> {
  const status = await client.status("INBOX", { messages: true });
  const total = typeof status === "object" && status ? (status.messages ?? 0) : 0;
  if (total === 0) return [];
  const out: { uid: number; fromEmail: string; subject: string }[] = [];
  for await (const m of client.fetch("1:*", { envelope: true }, { uid: true })) {
    out.push({
      uid: m.uid,
      fromEmail: (m.envelope?.from?.[0]?.address ?? "").toLowerCase(),
      subject: m.envelope?.subject ?? "",
    });
  }
  return out;
}

const stripRe = (s: string) => s.replace(/^((re|fwd?|tr)\s*:\s*)+/i, "").trim().toLowerCase();

export async function findOriginalMessage(acc: MailAccount, toAddr: string, subject: string): Promise<InboxFull | null> {
  const want = stripRe(subject);
  // "Jean Dupont <jean@x.fr>" → "jean@x.fr" (match exact contre l'expéditeur).
  const wantFrom = extractAddress(toAddr.split(",")[0] ?? "");
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const envs = await inboxEnvelopes(client);
      let bestUid: number | null = null;
      for (const e of envs) {
        const subjMatch = stripRe(e.subject) === want;
        const fromMatch = wantFrom && sameSender(e.fromEmail, wantFrom);
        if (subjMatch && fromMatch) bestUid = e.uid;
      }
      if (bestUid === null) {
        for (const e of envs) if (stripRe(e.subject) === want) bestUid = e.uid;
      }
      if (bestUid === null) return null;
      const f = await fetchParsed(client, bestUid);
      if (!f) return null;
      return {
        account: acc.id,
        uid: bestUid,
        from: f.from,
        fromEmail: f.fromEmail,
        to: f.to,
        subject: f.subject,
        date: f.date,
        unread: false,
        html: f.html,
        htmlNoImg: f.htmlNoImg,
        text: f.text,
        attachments: f.attachments,
        replyTo: f.replyTo,
        replyToEmail: f.replyToEmail,
        messageId: f.messageId,
        ai: f.ai,
      };
    } finally {
      lock.release();
    }
  });
}

export async function clearDraftsToTrash(acc: MailAccount, uids: number[]): Promise<number> {
  if (uids.length === 0) return 0;
  return withClient(acc, async (client) => {
    const box = await draftsMailbox(client);
    const trash = await trashMailbox(client);
    const lock = await client.getMailboxLock(box);
    try {
      let moved = 0;
      for (const uid of uids) {
        try {
          await client.messageMove(String(uid), trash, { uid: true });
          moved++;
        } catch { /* skip missing */ }
      }
      return moved;
    } finally {
      lock.release();
    }
  });
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const cleanHeaderValue = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Adresse d'un segment d'en-tête : "Jean Dupont <jean@x.fr>" → "jean@x.fr". */
export function extractAddress(v: string): string {
  const s = cleanHeaderValue(v);
  const lt = s.lastIndexOf("<");
  const gt = s.lastIndexOf(">");
  const inner = lt >= 0 && gt > lt ? s.slice(lt + 1, gt).trim() : s.trim();
  return inner.toLowerCase();
}

/**
 * Toutes les adresses valides d'un en-tête To/Cc (listes multi-destinataires
 * comprises). Les segments invalides sont ignorés ; jette si aucun valide —
 * jamais de CRLF (cleanHeaderValue les neutralise avant).
 */
export function headerAddresses(v: string): string[] {
  const out = cleanHeaderValue(v)
    .split(",")
    .map(extractAddress)
    .filter((a) => EMAIL_RE.test(a));
  if (out.length === 0) throw new Error("destinataire invalide");
  return out;
}

/**
 * Crée un brouillon de réponse via MailComposer (nodemailer) : encodage
 * RFC 2047 des en-têtes non-ASCII, CRLF neutralisés, To/Reply-To validés —
 * un sujet de mail reçu ne peut plus injecter d'en-têtes (Cc caché, From…).
 */
export async function createReplyDraft(
  acc: MailAccount,
  opts: { to: string; replyTo?: string; subject: string; body: string; inReplyTo?: string; references?: string; ai?: boolean },
): Promise<void> {
  // Reply-To (si valide) a priorité sur From — réponses aux listes/noreply.
  // Tous les destinataires valides sont conservés (To multi-adresses).
  // Si le Reply-To est entièrement invalide, on retombe sur To plutôt que 500.
  let to: string;
  if (opts.replyTo) {
    try {
      to = headerAddresses(opts.replyTo).join(", ");
    } catch {
      to = headerAddresses(opts.to).join(", ");
    }
  } else {
    to = headerAddresses(opts.to).join(", ");
  }
  const subject = cleanHeaderValue(opts.subject);
  const re = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
  const msgId = opts.inReplyTo ? cleanHeaderValue(opts.inReplyTo) : undefined;
  const mail = new MailComposer({
    from: acc.smtp.from,
    to,
    subject: re,
    text: opts.body,
    inReplyTo: msgId,
    references: opts.references ?? msgId,
    headers: opts.ai ? { "X-Tidy-Quest": "ai" } : {},
  });
  const raw = await new Promise<Buffer>((resolve, reject) => {
    mail.compile().build((err: Error | null, message: Buffer) => (err ? reject(err) : resolve(message)));
  });
  await withClient(acc, async (client) => {
    const box = await draftsMailbox(client);
    await client.append(box, raw, ["\\Draft"]);
  });
}
