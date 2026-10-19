import webpush from "web-push";
import { listPushSubs, removePushSub } from "./db";

let configured = false;
function ensureVapid() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:flo@fims.fi",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/** Endpoints de push reconnus (FCM, Mozilla, Apple, Windows). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const h = url.hostname;
  return (
    h === "fcm.googleapis.com" ||
    h.endsWith(".push.services.mozilla.com") || h === "push.services.mozilla.com" ||
    h.endsWith(".push.apple.com") ||
    h.endsWith(".notify.windows.com") ||
    h.endsWith(".wns.windows.com")
  );
}

export async function notifyAll(title: string, body: string, tag = "tidy-quest"): Promise<void> {
  ensureVapid();
  const subs = await listPushSubs();
  await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          JSON.stringify({ title, body, icon: "/icon-192.png", tag }),
        );
      } catch (e) {
        // 404/410 = abonnement mort chez le service push → purge, sinon il
        // s'accumule et chaque cron retente indéfiniment.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await removePushSub(s.endpoint).catch(() => {});
      }
    }),
  );
}
