"use client";

import AutosizeTextarea from "@/components/AutosizeTextarea";
import { IconMailOpened, IconPackage, IconPaperclip, IconSword, IconWand } from "@tabler/icons-react";
import EmailBody from "@/components/EmailBody";
import { useBackdropClose } from "@/components/Sheet";
import type { Draft, DraftBody, MsgBody } from "@/lib/types";

/** Overlay de lecture d'une missive reçue (INBOX). */
export function MessageReader({
  msg,
  ctx,
  improveText,
  busy,
  onImproveText,
  onClose,
  onImprove,
  onGenerate,
}: {
  msg: MsgBody;
  ctx: Draft | null;
  improveText: string | null;
  busy: boolean;
  onImproveText: (t: string | null) => void;
  onClose: () => void;
  onImprove: () => void;
  onGenerate: (m: MsgBody) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4" {...backdrop}>
      <div className="card-parchment max-w-md w-full max-h-[80dvh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-pixel text-[8px] text-[#8a6d3b] mb-1 break-all">DE : {msg.from}</div>
        <div className="font-pixel text-[8px] text-[#8a6d3b] mb-3 break-words">SUJET : {msg.subject}</div>
        {msg.html ? <EmailBody html={msg.html} htmlNoImg={msg.htmlNoImg} /> : <pre className="whitespace-pre-wrap text-lg leading-snug">{msg.text ?? "(vide)"}</pre>}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {msg.attachments.map((a) => (
              <a
                key={a.index}
                href={`/api/message?account=${encodeURIComponent(msg.account)}&uid=${msg.uid}&part=${a.index}`}
                download={a.filename}
                className="flex items-center gap-2 bg-[#f7ecc9] text-[#2a1c0e] border-2 border-[#8a6d3b] px-3 py-2 text-sm hover:bg-[#fff5d6]"
              >
                <IconPaperclip size={16} className="shrink-0" />
                <span className="flex-1 min-w-0 truncate">{a.filename}</span>
                <span className="font-pixel text-[6px] opacity-60 shrink-0">{(a.size / 1024).toFixed(0)} KO</span>
              </a>
            ))}
          </div>
        )}
        {ctx ? (
          <div className="flex flex-col gap-3 mt-5">
            {improveText !== null ? (
              <>
                <AutosizeTextarea
                  className="panel w-full p-3 text-base min-h-[90px] text-[#2a1c0e] bg-[#f7ecc9]"
                  placeholder="Tes ordres, héros ? (ex : souhaite-lui bon anniversaire, plus court, ton plus formel…)"
                  autoFocus
                  value={improveText}
                  onChange={(e) => onImproveText(e.target.value)}
                />
                <div className="flex gap-3">
                  <button className="btn-pixel ghost flex-1" onClick={() => onImproveText(null)}>Annuler</button>
                  <button className="btn-pixel flex-1 flex items-center justify-center gap-2" disabled={busy || !improveText.trim()} onClick={onImprove}>
                    <IconWand size={18} /> Reforger
                  </button>
                </div>
              </>
            ) : (
              <div className="flex gap-3">
                <button className="btn-pixel flex-1 flex items-center justify-center gap-2" disabled={busy} onClick={() => onImproveText("")}>
                  <IconWand size={18} /> Reforger la missive
                </button>
                <button className="btn-pixel ghost flex-1" onClick={onClose}>Fermer</button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-3 mt-5">
            <button className="btn-pixel flex-1" disabled={busy} onClick={() => onGenerate(msg)}>
              <IconWand size={16} className="inline mr-1" /> Forger une missive
            </button>
            <button className="btn-pixel ghost flex-1" onClick={onClose}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Overlay de lecture d'un brouillon (carte missive). */
export function DraftReader({
  draft,
  busy,
  onClose,
  onReadOriginal,
  onAside,
  onSend,
}: {
  draft: DraftBody;
  busy: boolean;
  onClose: () => void;
  onReadOriginal: (d: DraftBody) => void;
  onAside: (d: DraftBody) => void;
  onSend: (d: DraftBody) => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4" {...backdrop}>
      <div className="card-parchment max-w-md w-full max-h-[80dvh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-pixel text-[8px] text-[#8a6d3b] mb-1 break-all">À : {draft.to}</div>
        <div className="font-pixel text-[8px] text-[#8a6d3b] mb-3 break-words flex items-center gap-2">
          SUJET : {draft.subject}
          {draft.ai && <span className="text-[6px] border border-[#8a6d3b] px-1 py-0.5" title="Brouillon forgé par l'IA — relis avant d'envoyer">🤖 IA</span>}
        </div>
        {draft.html ? <EmailBody html={draft.html} htmlNoImg={draft.htmlNoImg} /> : <pre className="whitespace-pre-wrap text-lg leading-snug">{draft.text ?? "(vide)"}</pre>}
        <div className="flex flex-col gap-3 mt-5">
          <button className="btn-pixel ghost !text-[9px] flex items-center justify-center gap-2" disabled={busy} onClick={() => onReadOriginal(draft)}>
            <IconMailOpened size={18} /> Lire le parchemin
          </button>
          <div className="flex gap-3">
            <button className="btn-pixel danger flex-1 flex items-center justify-center gap-2" onClick={() => onAside(draft)}>
              <IconPackage size={22} /> Jarre
            </button>
            <button className="btn-pixel flex-1 flex items-center justify-center gap-2" disabled={busy} onClick={() => onSend(draft)}>
              <IconSword size={22} /> Expédier
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
