"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Comportement commun des overlays (à étaler sur le backdrop) :
 * - fermeture au clic sur le backdrop, honorée seulement si le press a
 *   commencé dessus — un swipe/drag relâché hors du panneau produit sinon un
 *   click backdrop qui fermerait l'overlay par accident ;
 * - Échap ferme la couche VISIBLE LA PLUS HAUTE uniquement (`data-layer`,
 *   ordre DOM) : les panneaux toujours montés mais cachés sont ignorés, et un
 *   ConfirmDialog ouvert par-dessus un panneau se ferme seul. Un champ qui
 *   gère lui-même Échap doit appeler preventDefault().
 */
export function useBackdropClose(onClose: () => void) {
  const down = useRef(false);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const visible = (l: Element) => l.getClientRects().length > 0;
      const layers = Array.from(document.querySelectorAll("[data-layer]")).filter(visible);
      if (layers[layers.length - 1] !== el) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [el]);
  return {
    ref: setEl,
    "data-layer": "",
    onPointerDown: (e: React.PointerEvent) => (down.current = e.target === e.currentTarget),
    onClick: (e: React.MouseEvent) => {
      if (down.current && e.target === e.currentTarget) onClose();
    },
  };
}

/** Bottom-sheet partagé : backdrop + panneau parchemin sombre.
    `panelClass` remplace la classe max-h par défaut (max-h-[80dvh]) —
    deux max-h concurrentes ne se résolvent pas par ordre d'attributs. */
export default function Sheet({
  onClose,
  children,
  panelClass = "max-h-[80dvh]",
  onPanelClick,
}: {
  onClose: () => void;
  children: ReactNode;
  panelClass?: string;
  onPanelClick?: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-end" {...backdrop}>
      <div
        className={`panel w-full max-w-md mx-auto p-4 overflow-y-auto flex flex-col gap-3 ${panelClass}`}
        onClick={(e) => {
          e.stopPropagation();
          onPanelClick?.();
        }}
      >
        {children}
      </div>
    </div>
  );
}
