import express, { Router } from "express";
import {
  applyPaidPlan,
  billingConfigured,
  dodoClient,
  isPaidPlan,
  PLAN_KIND,
  productFor,
  readProfile,
  verifyWebhook,
  type BasePlan,
  type CheckoutKind,
  type PaidPlanId,
} from "../lib/billing.js";
import { getSupabase } from "../lib/supabase.js";

export const billingRouter = Router();

function validKind(planId: PaidPlanId, kind: unknown): kind is CheckoutKind {
  if (kind === "buy") return true;
  // Renew only makes sense for time-boxed passes.
  return kind === "renew" && PLAN_KIND[planId] === "pass";
}

// Create a Dodo checkout session and hand its URL to the extension, which
// opens it in a real browser tab (MV3 blocks remote checkout.js in-panel).
billingRouter.post("/checkout", async (req, res) => {
  const { sub, planId, kind = "buy" } = (req.body as { sub?: unknown; planId?: unknown; kind?: unknown }) ?? {};
  if (typeof sub !== "string" || !sub) {
    res.status(400).json({ error: "sub is required" });
    return;
  }
  if (!isPaidPlan(planId)) {
    res.status(400).json({ error: "unknown planId" });
    return;
  }
  if (!validKind(planId, kind)) {
    res.status(400).json({ error: "invalid kind for this plan" });
    return;
  }
  const client = dodoClient();
  if (!client) {
    res.status(503).json({ error: "billing not configured" });
    return;
  }
  try {
    // Charge the upgrade product for paid-to-paid base moves so buyers pay
    // only the difference (the webhook grants the full target plan).
    let currentBase: BasePlan = "free";
    try {
      currentBase = (await readProfile(sub)).base;
    } catch { /* profile read best-effort — fall back to full price */ }
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productFor(planId, kind, currentBase), quantity: 1 }],
      metadata: { sub, plan_id: planId, kind },
    });
    if (!session?.checkout_url) throw new Error("no checkout url returned");
    res.json({ url: session.checkout_url, paymentLinkId: session.session_id ?? null });
  } catch {
    res.status(502).json({ error: "checkout creation failed" });
  }
});

// Dodo webhook (Standard Webhooks spec): MUST receive the raw body for
// signature verification, so this route uses express.raw (the global json
// parser skips this path in app.ts).
billingRouter.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const raw = req.body as Buffer;
  const event = Buffer.isBuffer(raw)
    ? verifyWebhook(raw, {
      id: req.header("webhook-id") ?? undefined,
      signature: req.header("webhook-signature") ?? undefined,
      timestamp: req.header("webhook-timestamp") ?? undefined,
    })
    : null;
  if (!event) {
    res.status(400).json({ error: "bad signature" });
    return;
  }
  if (event.type !== "payment.succeeded" && event.type !== "refund.succeeded") {
    res.json({ received: true, ignored: event.type });
    return;
  }
  const data = (event.data ?? {}) as {
    payment_id?: string;
    metadata?: { sub?: string; plan_id?: string; kind?: string };
  };
  if (event.type === "refund.succeeded") {
    // Money went back — revoke the granted plan, but only if the user
    // still holds exactly what the payment bought (never nuke later buys).
    const refundPaymentId = data.payment_id || "";
    try {
      const sb = getSupabase();
      if (!sb) throw new Error("supabase not configured");
      const { data: original } = await sb
        .from("billing_events")
        .select("sub, plan_id")
        .eq("event_key", `payment.succeeded:${refundPaymentId}`)
        .maybeSingle();
      if (!original) {
        res.json({ received: true, ignored: "unknown payment" });
        return;
      }
      const profile = await readProfile(original.sub);
      // Another surviving payment for the same plan still covers the user
      // (e.g. double-paid, one refunded) — revoke only the last cover.
      const { data: sibling } = await sb
        .from("billing_events")
        .select("event_key")
        .eq("sub", original.sub)
        .eq("plan_id", original.plan_id)
        .neq("event_key", `payment.succeeded:${refundPaymentId}`)
        .limit(1)
        .maybeSingle();
      if (sibling) {
        res.json({ received: true, revoked: null, covered: true });
        return;
      }
      if (PLAN_KIND[original.plan_id as PaidPlanId] === "base" && profile.base === original.plan_id) {
        await sb.from("profiles").update({ base_plan: "free" }).eq("sub", original.sub);
      }
      if (PLAN_KIND[original.plan_id as PaidPlanId] === "pass" && profile.pass?.id === original.plan_id) {
        await sb.from("profiles").update({ pass_id: null, pass_started_at: null, pass_expires_at: null }).eq("sub", original.sub);
      }
      res.json({ received: true, revoked: original.plan_id });
    } catch {
      res.status(502).json({ error: "revoke failed" });
    }
    return;
  }
  const sub = data.metadata?.sub;
  const planId = data.metadata?.plan_id;
  const kind = (data.metadata?.kind || "buy") as CheckoutKind;
  if (!sub || !isPaidPlan(planId)) {
    // Valid signature but unusable payload — 200 so Dodo stops retrying.
    res.json({ received: true, ignored: "bad metadata" });
    return;
  }
  const eventKey = `payment.succeeded:${data.payment_id || ""}`;
  const sb = getSupabase();
  if (!sb) {
    res.status(502).json({ error: "supabase not configured" });
    return;
  }
  // Idempotency: Dodo retries events; apply each payment once. The row is
  // removed again if applying fails, so a retry can still succeed.
  const { error: seenErr } = await sb
    .from("billing_events")
    .insert({ event_key: eventKey, sub, plan_id: planId });
  if (seenErr) {
    // Duplicate key = already processed.
    res.json({ received: true, duplicate: true });
    return;
  }
  try {
    const plan = await applyPaidPlan(sub, planId, kind);
    res.json({ received: true, plan });
  } catch {
    await sb.from("billing_events").delete().eq("event_key", eventKey);
    res.status(502).json({ error: "plan update failed" });
  }
});

// Current server-side plan for a user (the extension polls this after payment).
billingRouter.get("/profile/:sub", async (req, res) => {
  try {
    res.json(await readProfile(req.params.sub));
  } catch {
    res.status(502).json({ error: "profile read failed" });
  }
});

export { billingConfigured };
