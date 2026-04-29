import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/prisma";
import { PUSH_SUBSCRIPTIONS_KEY, VAPID_SUBJECT } from "./config";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function sendPushNotification(payload: PushPayload): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);

  const setting = await prisma.systemSetting
    .findUnique({ where: { key: PUSH_SUBSCRIPTIONS_KEY } })
    .catch(() => null);
  if (!setting?.value) return;

  let subs: webpush.PushSubscription[] = [];
  try {
    subs = JSON.parse(setting.value);
  } catch {
    return;
  }
  if (!subs.length) return;

  const results = await Promise.allSettled(
    subs.map((sub) => webpush.sendNotification(sub, JSON.stringify(payload)))
  );

  // Remove subscriptions that have expired (410 = unsubscribed, 404 = gone)
  const alive = subs.filter((_, i) => {
    const r = results[i];
    if (r.status === "rejected") {
      const code = (r.reason as { statusCode?: number })?.statusCode;
      return code !== 410 && code !== 404;
    }
    return true;
  });

  if (alive.length !== subs.length) {
    await prisma.systemSetting
      .upsert({
        where: { key: PUSH_SUBSCRIPTIONS_KEY },
        create: { key: PUSH_SUBSCRIPTIONS_KEY, value: JSON.stringify(alive) },
        update: { value: JSON.stringify(alive) },
      })
      .catch(() => {});
  }
}
