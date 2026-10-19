// Types partagés client/serveur (miroir des interfaces de lib/mail/imap.ts).

export interface Draft {
  account: string;
  mailbox: string;
  uid: number;
  to: string;
  subject: string;
  date: string | null;
  preview: string;
  /** Brouillon forgé par l'IA (en-tête X-Tidy-Quest). */
  ai?: boolean;
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

export interface MsgBody extends InboxItem {
  to: string;
  /** HTML nettoyé (scripts/handlers retirés). */
  html: string | null;
  /** Variante sans images distantes. */
  htmlNoImg: string | null;
  text: string | null;
  attachments?: AttachmentMeta[];
  replyTo?: string;
  replyToEmail?: string;
  messageId?: string;
  ai?: boolean;
}

export interface DraftBody extends Draft {
  html: string | null;
  htmlNoImg: string | null;
  text: string | null;
  cc: string;
}

export interface AccountBadge {
  id: string;
  label: string;
  color: string;
  unseen?: number;
  draftCount?: number;
  asideCount?: number;
  error?: string;
  /** Compte à relevé manuel — pas de polling, chargé via /api/account au tap. */
  manual?: boolean;
}

export interface OverviewAccount extends AccountBadge {
  latest?: InboxItem[];
  /** Quêtes actives (brouillons non mis de côté) — aplaties en `pile`. */
  active?: Draft[];
  /** Brouillons rangés dans la jarre. */
  aside?: Draft[];
}

export interface MutedEntry {
  account: string;
  sender: string;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
