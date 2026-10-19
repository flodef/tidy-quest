"use client";

import { useBackdropClose } from "@/components/Sheet";

// Modale de confirmation (destructif) — style parchemin sombre.
// Échap = Non (couche la plus haute), focus initial sur « Non » (un Entrée
// réflexe ne détruit rien), Tab reste piégé entre les deux boutons.
export default function ConfirmDialog({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const backdrop = useBackdropClose(onCancel);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" {...backdrop}>
      <div
        className="panel max-w-sm w-full p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const btns = Array.from(e.currentTarget.querySelectorAll("button"));
          const i = btns.indexOf(document.activeElement as HTMLButtonElement);
          e.preventDefault();
          btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length]?.focus();
        }}
      >
        <div className="font-pixel text-[9px] text-[var(--ruby)]">⚠ ATTENTION, VOYAGEUR</div>
        <div className="text-lg leading-snug">{label}</div>
        <div className="flex gap-3">
          <button className="btn-pixel ghost flex-1" autoFocus onClick={onCancel}>Non</button>
          <button className="btn-pixel danger flex-1" onClick={onConfirm}>Oui</button>
        </div>
      </div>
    </div>
  );
}
