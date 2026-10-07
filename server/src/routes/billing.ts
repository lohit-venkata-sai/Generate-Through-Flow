import express, { Router } from "express";
import {
  applyPaidPlan,
  billingConfigured,
  billingCurrency,
  isPaidPlan,
  PAID_PLANS,
  razorpayClient,
  readProfile,
  verifyWebhookSignature,
  type CheckoutKind,
  type PaidPlanId,
} from "../lib/billing.js";
import { getSupabase } from "../lib/supabase.js";

export const billingRouter = Router();

function validKind(planId: PaidPlanId, kind: unknown): kind is CheckoutKind {
  if (kind === "buy") return true;
  // Renew only makes sense for time-boxed passes.
  return kind === "renew" && PAID_PLANS[planId].kind === "pass";
}

// Create a Razorpay payment link and hand its URL to the extension, which
// opens it in a real browser tab (MV3 blocks remote checkout.js in-panel).
billingRouter.post("/checkout", async (req, res) => {
  const { sub, planId, kind = "buy", email } = (req.body as { sub?: unknown; planId?: unknown; kind?: unknown; email?: unknown }) ?? {};
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
  const client = razorpayClient();
  if (!client) {
    res.status(503).json({ error: "billing not configured" });
    return;
  }
  try {
    const link = (await client.paymentLink.create({
      amount: PAID_PLANS[planId].amount,
      currency: billingCurrency(),
      description: `FlowPilot ${PAID_PLANS[planId].label}`,
      customer: typeof email === "string" && email ? { email } : {},
      notes: { sub, plan_id: planId, kind },
      expire_by: Math.floor(Date.now() / 1000) + 2 * 3600,
    })) as { id?: string; short_url?: string };
    if (!link?.short_url) throw new Error("no payment url returned");
    res.json({ url: link.short_url, paymentLinkId: link.id ?? null });
  } catch {
    res.status(502).json({ error: "checkout creation failed" });
  }
});

// Razorpay webhook: MUST receive the raw body for signature verification,
// so this route uses express.raw (the global json parser skips this path).
billingRouter.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const raw = req.body as Buffer;
  const signature = req.header("x-razorpay-signature") ?? undefined;
  if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, signature)) {
    res.status(400).json({ error: "bad signature" });
    return;
  }
  let body: { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: Record<string, string> } }; payment?: { entity?: { id?: string } } } };
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "bad payload" });
    return;
  }
  if (body.event !== "payment_link.paid") {
    res.json({ received: true, ignored: body.event ?? null });
    return;
  }
  const entity = body.payload?.payment_link?.entity;
  const notes = entity?.notes ?? {};
  const sub = notes.sub;
  const planId = notes.plan_id;
  const kind = (notes.kind || "buy") as CheckoutKind;
  if (!sub || !isPaidPlan(planId)) {
    res.status(400).json({ error: "bad notes" });
    return;
  }
  const paymentId = body.payload?.payment?.entity?.id || entity?.id || "";
  const eventKey = `payment_link.paid:${paymentId}`;
  try {
    const sb = getSupabase();
    if (!sb) throw new Error("supabase not configured");
    // Idempotency: Razorpay retries events; apply each payment once.
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
