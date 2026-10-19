"use client";

import { IconCalendar, IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

const navBtn =
  "p-1 min-w-6 min-h-6 flex items-center justify-center text-[var(--gold)] hover:bg-[var(--shadow)] transition-colors cursor-pointer";

/**
 * Grille calendrier standalone (navigation mois/année + cases jour), version
 * Tidy Quest du CalendarPicker de job-conciergerie : thème sombre pixel.
 * `key={...}` côté parent pour resynchroniser le mois affiché quand `value`
 * change de mois/année depuis l'extérieur (saisie clavier, reset…).
 */
export default function CalendarPicker({
  value,
  onSelect,
  min,
}: {
  /** Jour surligné — choisir un jour conserve ses heures/minutes. */
  value: Date;
  onSelect: (date: Date) => void;
  min?: Date;
}) {
  const [year, setYear] = useState(value.getFullYear());
  const [month, setMonth] = useState(value.getMonth());

  const monthDelta = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 11) { m = 0; y++; } else if (m < 0) { m = 11; y--; }
    if (min && new Date(y, m + 1, 0) < min) return; // pas de mois entièrement avant min
    setMonth(m);
    setYear(y);
  };

  const yearDelta = (delta: number) => {
    const y = year + delta;
    if (min && new Date(y, month + 1, 0) < min) return;
    setYear(y);
  };

  const canBackMonth = () => {
    if (!min) return true;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    return new Date(py, pm + 1, 0) >= min;
  };

  const canBackYear = () => !min || new Date(year - 1, month + 1, 0) >= min;

  const days: React.ReactNode[] = [];
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // lundi = 0
  for (let i = 0; i < startOffset; i++) days.push(<div key={`e${i}`} />);
  for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
    const isSel = day === value.getDate() && month === value.getMonth() && year === value.getFullYear();
    const dayDate = new Date(year, month, day);
    const isBeforeMin = !!min && dayDate < new Date(min.getFullYear(), min.getMonth(), min.getDate());
    days.push(
      <button
        key={day}
        type="button"
        disabled={isBeforeMin}
        onClick={() => onSelect(new Date(year, month, day, value.getHours(), value.getMinutes()))}
        className={`min-h-8 text-base border-2 transition-colors ${
          isBeforeMin
            ? "opacity-20 cursor-not-allowed border-transparent"
            : isSel
              ? "bg-[var(--gold)] text-[var(--shadow)] border-[var(--gold-bright)]"
              : "border-transparent hover:border-[var(--gold)] hover:bg-[var(--shadow)] cursor-pointer"
        }`}
      >
        {day}
      </button>,
    );
  }

  return (
    <div>
      {/* Navigation mois / aujourd'hui / année */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => monthDelta(-1)} aria-label="Mois précédent" className={`${navBtn} ${canBackMonth() ? "" : "invisible"}`}>
            <IconChevronDown size={16} className="rotate-90" />
          </button>
          <span className="font-pixel text-[8px] w-12 text-center text-[var(--gold-bright)]">{MONTHS[month]}</span>
          <button type="button" onClick={() => monthDelta(1)} aria-label="Mois suivant" className={navBtn}>
            <IconChevronDown size={16} className="-rotate-90" />
          </button>
        </div>
        <button type="button" onClick={() => onSelect(new Date())} className={navBtn} aria-label="Aujourd'hui" title="Aujourd'hui">
          <IconCalendar size={20} />
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => yearDelta(-1)} aria-label="Année précédente" className={`${navBtn} ${canBackYear() ? "" : "invisible"}`}>
            <IconChevronDown size={16} className="rotate-90" />
          </button>
          <span className="font-pixel text-[8px] text-center text-[var(--gold-bright)]">{year}</span>
          <button type="button" onClick={() => yearDelta(1)} aria-label="Année suivante" className={navBtn}>
            <IconChevronDown size={16} className="-rotate-90" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div key={d} className="font-pixel text-[6px] opacity-50 text-center py-1">{d}</div>
        ))}
        {days}
      </div>
    </div>
  );
}
