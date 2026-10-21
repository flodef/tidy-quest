import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea qui grandit avec son contenu (1 ligne min, ~5 max + scroll).
 * Remplace les <input> mono-lignes qui écrasaient l'affichage des textes longs.
 */
export default function AutosizeTextarea({ className = "", value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      // box-sizing: border-box → style.height inclut les bordures mais pas
      // scrollHeight/clientHeight : sans compensation, le contenu déborderait
      // toujours de l'épaisseur des bordures (scrollbar jamais cachée).
      const borders = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + borders}px`;
      // Scrollbar seulement si le cap max-h bride la hauteur — sinon cachée.
      el.style.overflowY = el.scrollHeight > el.clientHeight ? "auto" : "hidden";
    }
  }, [value]);
  // rows=1 + scrollHeight → jamais moins d'une ligne de texte visible.
  return <textarea ref={ref} rows={1} className={`resize-none overflow-y-hidden max-h-36 ${className}`} value={value} {...props} />;
}
