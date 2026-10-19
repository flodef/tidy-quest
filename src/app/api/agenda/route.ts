import { NextResponse } from "next/server";
import {
  addAgenda,
  dbReady,
  deleteAgenda,
  listAgenda,
  setAgendaDone,
  updateAgendaSchedule,
  updateAgendaText,
} from "@/lib/db";
import { internalError, isUuid, parseJson } from "@/lib/api";
import { ceilToQuarter } from "@/lib/dates";

export const dynamic = "force-dynamic";

const isDate = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
// Échéances alignées au quart d'heure suivant, aussi côté serveur (bot,
// vieux clients) — idempotent pour une date déjà alignée par l'UI.
const quarterIso = (v: string) => ceilToQuarter(new Date(v)).toISOString();
const TEXT_MAX = 1000;
const WHO_MAX = 200;
// who : string non vide cappée, sinon null (champ optionnel).
const whoOf = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, WHO_MAX) : null;
const REMIND_MAX_MIN = 30 * 24 * 60; // 30 jours
const remindOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= REMIND_MAX_MIN;

export async function GET() {
  if (!dbReady()) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  try {
    return NextResponse.json({ events: await listAgenda() });
  } catch (e) {
    return internalError(e, "agenda");
  }
}

export async function POST(req: Request) {
  if (!dbReady()) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const body = await parseJson(req);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  if (text.length > TEXT_MAX) return NextResponse.json({ error: "text too long" }, { status: 400 });
  if (!isDate(body?.dueAt)) return NextResponse.json({ error: "dueAt required" }, { status: 400 });
  const remind = remindOk(body.remindMinutes) ? body.remindMinutes : 30;
  try {
    const event = await addAgenda(text, quarterIso(body.dueAt), remind, isUuid(body.id) ? body.id : undefined, whoOf(body.who));
    return NextResponse.json({ ok: true, event });
  } catch (e) {
    return internalError(e, "agenda");
  }
}

export async function PATCH(req: Request) {
  if (!dbReady()) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const body = await parseJson(req);
  if (!isUuid(body?.id)) return NextResponse.json({ error: "valid id required" }, { status: 400 });
  try {
    if (typeof body.done === "boolean") {
      await setAgendaDone(body.id, body.done);
    } else if (isDate(body.dueAt)) {
      const remind = remindOk(body.remindMinutes) ? body.remindMinutes : 30;
      await updateAgendaSchedule(body.id, quarterIso(body.dueAt), remind);
    } else if (typeof body.text === "string" && body.text.trim() && body.text.length <= TEXT_MAX) {
      await updateAgendaText(body.id, body.text.trim(), whoOf(body.who));
    } else {
      return NextResponse.json({ error: "nothing to do" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return internalError(e, "agenda");
  }
}

export async function DELETE(req: Request) {
  if (!dbReady()) return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 503 });
  const id = new URL(req.url).searchParams.get("id");
  if (!isUuid(id)) return NextResponse.json({ error: "valid id required" }, { status: 400 });
  try {
    await deleteAgenda(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return internalError(e, "agenda");
  }
}
