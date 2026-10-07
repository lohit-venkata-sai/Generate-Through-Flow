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
  if (event.type !== "payment.succeeded") {
    res.json({ received: true, ignored: event.type });
    return;
  }
  const data = (event.data ?? {}) as {
    payment_id?: string;
    metadata?: { sub?: string; plan_id?: string; kind?: string };
  };
  const sub = data.metadata?.sub;
  const planId = data.metadata?.plan_id;
  const kind = (data.metadata?.kind || "buy") as CheckoutKind;
  if (!sub || !isPaidPlan(planId)) {
    res.status(400).json({ error: "bad metadata" });
    return;
  }
  const eventKey = `payment.succeeded:${data.payment_id || ""}`;
  try {
    const sb = getSupabase();
    if (!sb) throw new Error("supabase not configured");
    // Idempotency: Dodo retries events; apply each payment once.
    const { error: seenErr } = await sb
      .from("billing_events")
      .insert({ event_key: eventKey, sub, plan_id: planId });
    if (seenErr) {
      // Duplicate key = already processed.
      res.json({ received: true, duplicate: true });
      return;
    }
    const plan = await applyPaidPlan(sub, planId, kind);
    res.json({ received: true, plan });
  } catch {
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
