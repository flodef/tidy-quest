import { useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

/**
 * Textarea qui grandit avec son contenu (1 ligne min, ~8 max + scroll).
 * Remplace les <input> mono-lignes qui écrasaient l'affichage des textes longs.
 */
export default function AutosizeTextarea({ className = "", value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return <textarea ref={ref} rows={1} className={`resize-none overflow-y-auto max-h-40 ${className}`} value={value} {...props} />;
}
