import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PUSH_SUBSCRIPTIONS_KEY } from "@/modules/push-notify";

async function getSubscriptions(): Promise<object[]> {
  const setting = await prisma.systemSetting
    .findUnique({ where: { key: PUSH_SUBSCRIPTIONS_KEY } })
    .catch(() => null);
  if (!setting?.value) return [];
  try {
    return JSON.parse(setting.value);
  } catch {
    return [];
  }
}

async function saveSubscriptions(subs: object[]) {
  await prisma.systemSetting
    .upsert({
      where: { key: PUSH_SUBSCRIPTIONS_KEY },
      create: { key: PUSH_SUBSCRIPTIONS_KEY, value: JSON.stringify(subs) },
      update: { value: JSON.stringify(subs) },
    })
    .catch(() => {});
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sub = await req.json();
  if (!sub?.endpoint) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  const subs = await getSubscriptions();
  const deduped = subs.filter((s: any) => s.endpoint !== sub.endpoint);
  deduped.push(sub);
  await saveSubscriptions(deduped);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint } = await req.json();
  if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });

  const subs = await getSubscriptions();
  await saveSubscriptions(subs.filter((s: any) => s.endpoint !== endpoint));

  return NextResponse.json({ ok: true });
}
