import { NextResponse } from "next/server";
import { dbReady } from "@/lib/db";
import { checkReminders } from "@/lib/reminders";
import { checkCronAuth } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Endpoint de rappels agenda — pingé toutes les 5 min par cron-job.org
// (job « tidy-quest reminders » — désactivé : /api/cron fait les rappels).
export async function GET(req: Request) {
  const auth = checkCronAuth(req);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  if (!dbReady()) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured" },
      { status: 503 },
    );
  }
  const sent = await checkReminders(true);
  return NextResponse.json({ ok: true, sent });
}
