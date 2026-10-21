import { useCallback, useEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea qui grandit avec son contenu (1 ligne min, ~5 max + scroll).
 * Remplace les <input> mono-lignes qui écrasaient l'affichage des textes longs.
 * ResizeObserver : les panneaux sont montés sous `hidden` — scrollHeight vaut
 * 0 au montage ; le fit se rejoue dès que l'élément devient visible.
 */
export default function AutosizeTextarea({ className = "", value, onFocus, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || el.offsetParent === null) return; // caché → on réessaiera à l'affichage
    el.style.height = "auto";
    // box-sizing: border-box → style.height inclut les bordures mais pas
    // scrollHeight/clientHeight : sans compensation, le contenu déborderait
    // toujours de l'épaisseur des bordures (scrollbar jamais cachée).
    const borders = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + borders}px`;
    // Scrollbar seulement si le cap max-h bride la hauteur — sinon cachée.
    el.style.overflowY = el.scrollHeight > el.clientHeight ? "auto" : "hidden";
  }, []);
  useEffect(fit, [fit, value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  // rows=1 + scrollHeight → jamais moins d'une ligne de texte visible.
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`resize-none overflow-y-hidden max-h-36 ${className}`}
      value={value}
      onFocus={(e) => { fit(); onFocus?.(e); }}
      {...props}
    />
  );
}
