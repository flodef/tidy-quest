"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import CalendarPicker from "@/components/CalendarPicker";
import { ceilToQuarter, setSegment, type DateSegment } from "@/lib/dates";

type Seg = DateSegment;
const SEGMENTS: Seg[] = ["day", "month", "year", "hour", "minute"];
const pad = (n: number) => String(n).padStart(2, "0");

// Surbrillance par fond seul : un border-2 autour du segment affichait des
// traits haut/bas qui ressemblaient à des underscore/retraits bizarres.
const segCls = (active: boolean) =>
  `px-0.5 rounded transition-colors cursor-pointer ${active ? "bg-[var(--gold)]/40 text-[var(--gold-bright)]" : ""}`;

/**
 * Champ date+heure « JJ/MM/AAAA à HH:MM » — version mail-quest du
 * CustomDateTimeInput de job-conciergerie : segments cliquables et saisissables
 * (↑↓ incrémente, ←→ change de segment, chiffres saisissent), popover avec
 * grille calendrier + selects heure/minute. `value` null = rien choisi.
 * Minutes toujours alignées sur le quart d'heure SUIVANT (00/15/30/45).
 */
export default function DateTimeInput({
  value,
  onChange,
  disabled = false,
  min,
  className = "",
}: {
  value: Date | null;
  onChange: (d: Date) => void;
  disabled?: boolean;
  min?: Date;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [seg, setSeg] = useState<Seg | null>(null);
  const [digits, setDigits] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Rien de choisi : à l'ouverture du popover, l'heure proposée (maintenant,
  // arrondie au quart d'heure suivant — 14:54 → 15:00) devient la VALEUR.
  // Calculée à l'ouverture et non au montage (le champ reste monté des
  // heures), et engagée tout de suite : sinon le popover affichait 15:00
  // sans valeur réelle, et re-choisir l'heure affichée ne déclenchait rien.
  const openPopover = () => {
    if (!value) apply(new Date());
    setOpen(true);
  };
  const togglePopover = () => (open ? setOpen(false) : openPopover());

  // Ferme le popover au clic hors du champ — l'écouteur n'existe que tant
  // que le popover est ouvert (le composant reste monté quand le panneau
  // agenda est caché).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const clickSeg = (s: Seg) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    if (!value) {
      openPopover();
      return;
    }
    setSeg(s);
    setIsFocused(true);
    setOpen(false);
    setDigits("");
  };

  // Point de passage unique de toutes les saisies (calendrier, selects,
  // flèches, clavier) : l'alignement au quart d'heure est garanti partout.
  const apply = (d: Date) => {
    const q = ceilToQuarter(d);
    if (min && q < min) return;
    onChange(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      setSeg(null);
      setDigits("");
      return;
    }
    if (e.key === "ArrowDown" && !open && (!isFocused || !seg)) {
      e.preventDefault();
      openPopover();
      return;
    }
    if (!isFocused || open || !seg || !value) return;

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const nd = digits + e.key;
      setDigits(nd);
      const maxDigits = seg === "year" ? 4 : 2;
      if (nd.length < maxDigits) return;
      // Minute tapée posée telle quelle : apply() l'aligne au quart SUIVANT.
      const d = setSegment(value, seg, parseInt(nd));
      if (d) apply(d);
      setDigits("");
      setSeg(SEGMENTS[(SEGMENTS.indexOf(seg) + 1) % SEGMENTS.length]);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setDigits("");
      const i = SEGMENTS.indexOf(seg);
      setSeg(SEGMENTS[(i + (e.key === "ArrowRight" ? 1 : SEGMENTS.length - 1)) % SEGMENTS.length]);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setDigits("");
      const delta = e.key === "ArrowUp" ? 1 : -1;
      const d = new Date(value);
      if (seg === "day") d.setDate(d.getDate() + delta);
      else if (seg === "month") d.setMonth(d.getMonth() + delta);
      else if (seg === "year") d.setFullYear(d.getFullYear() + delta);
      else if (seg === "hour") d.setHours(d.getHours() + delta);
      else d.setMinutes(d.getMinutes() + delta * 15); // minutes par quart d'heure
      apply(d);
    }
  };

  const setTime = (hours: number, minutes: number) => {
    const base = value ?? ceilToQuarter(new Date());
    apply(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes));
  };

  const segValue = (s: Seg): string => {
    if (!value) return s === "year" ? "----" : "--";
    if (s === "day") return pad(value.getDate());
    if (s === "month") return pad(value.getMonth() + 1);
    if (s === "year") return String(value.getFullYear());
    if (s === "hour") return pad(value.getHours());
    return pad(value.getMinutes());
  };

  const renderSeg = (s: Seg) => (
    <span key={s} className={`${segCls(seg === s && isFocused)}${!value ? " opacity-40" : ""}`} onClick={clickSeg(s)}>
      {segValue(s)}
    </span>
  );

  return (
    <div className={`relative min-w-0 ${className || "flex-1"}`} ref={ref}>
      <div
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onClick={() => {
          if (disabled) return;
          setIsFocused(true);
          setSeg(null);
          togglePopover();
        }}
        onFocus={() => {
          if (!disabled) setIsFocused(true);
        }}
        onBlur={(e) => {
          if (!e.relatedTarget || !ref.current?.contains(e.relatedTarget as Node)) {
            setIsFocused(false);
            setSeg(null);
            setDigits("");
          }
        }}
        className={`flex items-center gap-0.5 bg-[var(--shadow)] border-2 px-3 py-2 pr-9 text-lg w-fit max-w-full cursor-text outline-none ${
          isFocused ? "border-[var(--gold-bright)]" : "border-[var(--gold)]"
        }${disabled ? " opacity-40" : ""}`}
      >
        {renderSeg("day")}/{renderSeg("month")}/{renderSeg("year")}
        <span className="opacity-50 px-1">à</span>
        {renderSeg("hour")}:{renderSeg("minute")}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { togglePopover(); setSeg(null); }}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--gold)] opacity-70 hover:opacity-100 cursor-pointer"
        aria-label="Ouvrir le calendrier"
      >
        <IconChevronDown size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !disabled && value && (
        <div
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] max-w-[calc(100vw-2rem)] panel p-3"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault(); // ferme le popover, pas le panneau dessous
            setOpen(false);
          }}
        >
          {/* Remount par mois/année de `value` : la navigation interne reste
              libre, une saisie clavier resynchronise l'affichage. */}
          <CalendarPicker
            key={value ? `${value.getFullYear()}-${value.getMonth()}` : "empty"}
            value={value}
            min={min}
            onSelect={(d) => {
              apply(d);
              // On reste ouvert : l'utilisateur ajuste ensuite l'heure.
            }}
          />
          <div className="flex gap-2 mt-3">
            <div className="flex-1">
              <label className="font-pixel text-[6px] opacity-50">HEURES</label>
              <select
                value={value.getHours()}
                onChange={(e) => setTime(parseInt(e.target.value), value.getMinutes())}
                className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-2 py-1.5 text-base outline-none focus:border-[var(--gold-bright)] [color-scheme:dark]"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{pad(i)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="font-pixel text-[6px] opacity-50">MINUTES</label>
              <select
                value={value.getMinutes()}
                onChange={(e) => setTime(value.getHours(), parseInt(e.target.value))}
                className="w-full bg-[var(--shadow)] border-2 border-[var(--gold)] px-2 py-1.5 text-base outline-none focus:border-[var(--gold-bright)] [color-scheme:dark]"
              >
                {/* apply() garantit l'alignement : la valeur est toujours une option. */}
                {[0, 15, 30, 45].map((i) => (
                  <option key={i} value={i}>{pad(i)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
