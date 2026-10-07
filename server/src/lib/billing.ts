import DodoPayments from "dodopayments";
import { Webhook } from "standardwebhooks";
import { getSupabase, requireSupabase } from "./supabase.js";

export type PaidPlanId = "p3" | "p4" | "p5" | "p7" | "p10";
export type CheckoutKind = "buy" | "renew";
export type BasePlan = "free" | "p3" | "p4" | "p5";

export const PLAN_KIND: Record<PaidPlanId, "base" | "pass"> = {
  p3: "base",
  p4: "base",
  p5: "base",
  p7: "pass",
  p10: "pass",
};

const PASS_MS: Record<string, number> = {
  p7: 182 * 86_400_000,
  p10: 365 * 86_400_000,
};

const BASE_PRICE: Record<string, number> = { free: 0, p3: 3, p4: 4, p5: 5 };

// Dodo product ids. Defaults are the dashboard products created for this
// project; env vars allow overriding without a code change.
const DEFAULT_PRODUCTS: Record<string, string> = {
  p3: "pdt_0NpCuaqmC3cAjxNMrn1aJ",
  p4: "pdt_0NpCuaqlRIYSdhmpXtcIM",
  p5: "pdt_0NpCuaqd8KcSlkXXlDrun",
  p7: "pdt_0NpCuaow6xfNQMLfRUAqw",
  p10: "pdt_0NpCuapq0i1xtyLvg7e1v",
  "p3-to-p4": "pdt_0NpCuaqcNyzLOIv4saHhI",
  "p3-to-p5": "pdt_0NpCuaqrSaD10bs3BFmx3",
  "p4-to-p5": "pdt_0NpCuarQymP2d1VC2OSRU",
  "renew-6mo": "pdt_0NpCuarDOXniQEB3rmEZH",
};

const PRODUCT_ENV: Record<string, string> = {
  p3: "DODO_PRODUCT_P3",
  p4: "DODO_PRODUCT_P4",
  p5: "DODO_PRODUCT_P5",
  p7: "DODO_PRODUCT_P7",
  p10: "DODO_PRODUCT_P10",
  "p3-to-p4": "DODO_PRODUCT_P3_TO_P4",
  "p3-to-p5": "DODO_PRODUCT_P3_TO_P5",
  "p4-to-p5": "DODO_PRODUCT_P4_TO_P5",
  "renew-6mo": "DODO_PRODUCT_RENEW_6MO",
};

function productId(key: string): string {
  const envKey = PRODUCT_ENV[key];
  return (envKey && process.env[envKey]) || DEFAULT_PRODUCTS[key] || "";
}

/** Pick the product to charge: upgrade products for paid-to-paid base moves
 *  (pay only the difference), the renew product for pass renewals. */
export function productFor(target: PaidPlanId, kind: CheckoutKind, currentBase: BasePlan): string {
  if (kind === "renew") return productId("renew-6mo");
  if (PLAN_KIND[target] === "base" && currentBase !== "free" && currentBase !== target) {
    const upgrade = productId(`${currentBase}-to-${target}`);
    if (upgrade) return upgrade;
  }
  return productId(target);
}

export function isPaidPlan(id: unknown): id is PaidPlanId {
  return typeof id === "string" && (id as string) in PLAN_KIND;
}

export function billingConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY);
}

let cached: { key: string; client: DodoPayments } | null = null;

export function dodoClient(): DodoPayments | null {
  const token = process.env.DODO_PAYMENTS_API_KEY || "";
  if (!token) return null;
  const env = process.env.DODO_PAYMENTS_ENV === "live_mode" ? "live_mode" : "test_mode";
  const cacheKey = token + ":" + env;
  if (!cached || cached.key !== cacheKey) {
    cached = { key: cacheKey, client: new DodoPayments({ bearerToken: token, environment: env }) };
  }
  return cached.client;
}

export interface ServerPlan {
  base: BasePlan;
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

  const currentBase = ((prof?.base_plan as BasePlan) ?? "free");
  const now = Date.now();

  if (PLAN_KIND[planId] === "base") {
    const nextBase = (BASE_PRICE[planId] ?? 0) > (BASE_PRICE[currentBase] ?? 0) ? planId : currentBase;
    if (nextBase !== currentBase) {
      await sb.from("profiles").update({ base_plan: nextBase }).eq("sub", sub);
    }
    return {
      base: nextBase as BasePlan,
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
    base: ((prof.base_plan as BasePlan) ?? "free"),
    pass: prof.pass_id
      ? { id: prof.pass_id, startedAt: prof.pass_started_at ?? 0, expiresAt: prof.pass_expires_at ?? 0 }
      : null,
  };
}

export interface VerifiedEvent {
  type: string;
  data: unknown;
}

/** Verify a Dodo webhook (Standard Webhooks spec) and return the parsed event,
 *  or null when the signature is missing/invalid. */
export function verifyWebhook(
  raw: Buffer,
  headers: { id?: string; signature?: string; timestamp?: string },
): VerifiedEvent | null {
  const secret = process.env.DODO_PAYMENTS_WEBHOOK_KEY || "";
  const { id, signature, timestamp } = headers;
  if (!secret || !id || !signature || !timestamp) return null;
  try {
    const wh = new Webhook(secret);
    const event = wh.verify(raw.toString("utf8"), {
      "webhook-id": id,
      "webhook-signature": signature,
      "webhook-timestamp": timestamp,
    }) as { type?: string; data?: unknown };
    if (!event || typeof event.type !== "string") return null;
    return { type: event.type, data: event.data };
  } catch {
    return null;
  }
}
