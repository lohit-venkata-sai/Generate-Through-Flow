import crypto from "node:crypto";
import Razorpay from "razorpay";
import { getSupabase, requireSupabase } from "./supabase.js";

export type PaidPlanId = "p3" | "p4" | "p5" | "p7" | "p10";
export type CheckoutKind = "buy" | "renew";

export const PAID_PLANS: Record<PaidPlanId, { amount: number; label: string; kind: "base" | "pass" }> = {
  // amount = smallest currency unit (cents for USD, paise for INR).
  p3: { amount: 300, label: "Starter lifetime · 100 images/day", kind: "base" },
  p4: { amount: 400, label: "Plus lifetime · 300 images/day", kind: "base" },
  p5: { amount: 500, label: "Pro lifetime · 500 images/day", kind: "base" },
  p7: { amount: 700, label: "Unlimited pass · 6 months", kind: "pass" },
  p10: { amount: 1000, label: "Unlimited pass · 1 year", kind: "pass" },
};

const PASS_MS: Record<string, number> = {
  p7: 182 * 86_400_000,
  p10: 365 * 86_400_000,
};

const BASE_PRICE: Record<string, number> = { free: 0, p3: 3, p4: 4, p5: 5 };

export function isPaidPlan(id: unknown): id is PaidPlanId {
  return typeof id === "string" && id in PAID_PLANS;
}

export function billingConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function billingCurrency(): string {
  return process.env.BILLING_CURRENCY || "USD";
}

let cached: { key: string; client: Razorpay } | null = null;

export function razorpayClient(): Razorpay | null {
  const id = process.env.RAZORPAY_KEY_ID || "";
  const secret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!id || !secret) return null;
  if (!cached || cached.key !== id + ":" + secret) {
    cached = { key: id + ":" + secret, client: new Razorpay({ key_id: id, key_secret: secret }) };
  }
  return cached.client;
}

export interface ServerPlan {
  base: "free" | "p3" | "p4" | "p5";
  pass: { id: "p7" | "p10"; startedAt: number; expiresAt: number } | null;
}

/** Apply a paid plan to a profile. Base upgrades only (never downgrades);
 *  renew extends an active same-id pass, buy starts it fresh. */
export async function applyPaidPlan(sub: string, planId: PaidPlanId, kind: CheckoutKind): Promise<ServerPlan> {
  const sb = requireSupabase();
  await sb.from("profiles").upsert({ sub }, { onConflict: "sub" });
  const { data: prof } = await sb
    .from("profiles")
    .select("base_plan, pass_id, pass_started_at, pass_expires_at")
    .eq("sub", sub)
    .maybeSingle();

  const currentBase = (prof?.base_plan as ServerPlan["base"]) ?? "free";
  const now = Date.now();

  if (PAID_PLANS[planId].kind === "base") {
    const nextBase = (BASE_PRICE[planId] ?? 0) > (BASE_PRICE[currentBase] ?? 0) ? planId : currentBase;
    if (nextBase !== currentBase) {
      await sb.from("profiles").update({ base_plan: nextBase }).eq("sub", sub);
    }
    return {
      base: nextBase as ServerPlan["base"],
      pass: prof?.pass_id ? { id: prof.pass_id, startedAt: prof.pass_started_at ?? 0, expiresAt: prof.pass_expires_at ?? 0 } : null,
    };
  }

  const dur = PASS_MS[planId] ?? 0;
  const activeSame = prof?.pass_id === planId && (prof?.pass_expires_at ?? 0) > now;
  const pass =
    kind === "renew" && activeSame
      ? { id: planId as "p7" | "p10", startedAt: prof?.pass_started_at ?? now, expiresAt: (prof?.pass_expires_at ?? now) + dur }
      : { id: planId as "p7" | "p10", startedAt: now, expiresAt: now + dur };
  await sb
    .from("profiles")
    .update({ pass_id: pass.id, pass_started_at: pass.startedAt, pass_expires_at: pass.expiresAt })
    .eq("sub", sub);
  return { base: currentBase, pass };
}

export async function readProfile(sub: string): Promise<ServerPlan> {
  const sb = requireSupabase();
  const { data: prof } = await sb
    .from("profiles")
    .select("base_plan, pass_id, pass_started_at, pass_expires_at")
    .eq("sub", sub)
    .maybeSingle();
  if (!prof) return { base: "free", pass: null };
  return {
    base: (prof.base_plan as ServerPlan["base"]) ?? "free",
    pass: prof.pass_id
      ? { id: prof.pass_id, startedAt: prof.pass_started_at ?? 0, expiresAt: prof.pass_expires_at ?? 0 }
      : null,
  };
}

/** Verify a Razorpay webhook signature (HMAC-SHA256 of the raw body). */
export function verifyWebhookSignature(raw: Buffer, signature: string | undefined): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret || !signature) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
