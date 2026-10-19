import nodemailer from "nodemailer";
import type { MailAccount } from "./accounts";
import { getDraftRaw, moveDraft } from "./imap";

// Timeouts bornés : un SMTP qui pend ne doit pas faire tuer la fonction à
// maxDuration=60s en ayant déjà envoyé le mail (double envoi au retry).
function transport(acc: MailAccount) {
  return nodemailer.createTransport({
    host: acc.smtp.host,
    port: acc.smtp.port,
    secure: acc.smtp.secure,
    auth: { user: acc.smtp.user, pass: acc.smtp.password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 25_000,
  });
}

export async function sendMail(acc: MailAccount, opts: { to: string; subject: string; text?: string; html?: string; cc?: string }): Promise<void> {
  await transport(acc).sendMail({
    from: acc.smtp.from,
    to: opts.to,
    cc: opts.cc || undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

// En-têtes retirés du MIME brut avant envoi :
// - Bcc / Resent-Bcc : exposeraient la liste aux destinataires ;
// - X-Tidy-Quest/X-Mail-Quest : marqueur interne « généré par l'IA » — ne doit pas partir ;
// - DKIM-Signature : signe le brouillon original — après modification (Bcc
//   retiré…) la vérif échouerait → risque de spam ;
// - Received / Return-Path : un mail reçu déplacé en brouillon révélerait
//   la chaîne serveur interne.
const STRIP_HEADERS = [/^(resent-)?bcc\s*:/i, /^x-(tidy|mail)-quest\s*:/i, /^dkim-signature\s*:/i, /^received\s*:/i, /^return-path\s*:/i];
// Une ligne qui n'est ni "Nom: valeur", ni continuation (espace/tab), ni
// vide clôt la zone d'en-têtes — même sans ligne vide séparatrice.
const HEADER_LINE = /^[A-Za-z][A-Za-z0-9-]*\s*:/;

/** Retire les en-têtes listés (et leurs continuations repliées) d'un MIME brut. */
export function stripOutboundHeaders(raw: Buffer): Buffer {
  const text = raw.toString("latin1");
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inHeaders = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // La ligne VIDE clôt la zone d'en-têtes — les motifs Bcc/DKIM/etc. dans
    // le corps sont du contenu, pas des en-têtes (ne jamais les supprimer).
    if (l === "") inHeaders = false;
    if (inHeaders && STRIP_HEADERS.some((re) => re.test(l))) {
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) i++;
      continue;
    }
    if (inHeaders && !HEADER_LINE.test(l) && !/^[ \t]/.test(l)) inHeaders = false;
    out.push(l);
  }
  return Buffer.from(out.join("\r\n"), "latin1");
}

/**
 * Envoie le brouillon TEL QUEL (MIME brut : HTML original, pièces jointes,
 * en-têtes) puis le déplace à la corbeille. Décision assumée : From/Date/
 * Message-ID du brouillon sont préservés (comportement « redirect » — le
 * MAIL FROM d'enveloppe reste correct ; un mail reçu déplacé en Drafts
 * partirait avec le From de l'expéditeur original, le provider rejettera
 * ou réécrira — acceptable pour usage personnel).
 * `moved=false` signale que le
 * mail est parti mais que le brouillon n'a pas pu être déplacé — le client
 * avertit au lieu de renvoyer en boucle.
 */
export async function sendDraft(acc: MailAccount, uid: number): Promise<{ to: string; subject: string; moved: boolean }> {
  const draft = await getDraftRaw(acc, uid);
  if (!draft) throw new Error("Draft not found");
  if (draft.envelopeTo.length === 0) throw new Error("Draft has no recipient");

  await transport(acc).sendMail({
    envelope: { from: acc.smtp.from, to: draft.envelopeTo },
    raw: stripOutboundHeaders(draft.raw),
  });
  const moved = await moveDraft(acc, uid).then(() => true, () => false);
  return { to: draft.to || draft.envelopeTo.join(", "), subject: draft.subject, moved };
}
