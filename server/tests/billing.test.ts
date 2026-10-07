import { Webhook } from "standardwebhooks";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import "./env.js";
import { app } from "../src/app.js";
import { productFor } from "../src/lib/billing.js";
import { getSupabase } from "../src/lib/supabase.js";

const SUB_BASE = "__vitest_dodo_base__";
const SUB_PASS = "__vitest_dodo_pass__";
const SUB_REFUND_A = "__vitest_dodo_refa__";
const SUB_REFUND_B = "__vitest_dodo_refb__";

afterAll(async () => {
  const sb = getSupabase();
  if (sb) {
    for (const sub of [SUB_BASE, SUB_PASS, SUB_REFUND_A, SUB_REFUND_B]) {
      await sb.from("billing_events").delete().eq("sub", sub);
      await sb.from("daily_usage").delete().eq("sub", sub);
      await sb.from("profiles").delete().eq("sub", sub);
    }
  }
});

describe("checkout validation (no payment created)", () => {
  it("400s on unknown planId", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ sub: "x", planId: "nope" });
    expect(res.status).toBe(400);
  });

  it("400s on missing sub", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ sub: "", planId: "p3" });
    expect(res.status).toBe(400);
  });

  it("400s on renew for a lifetime base plan", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ sub: "x", planId: "p4", kind: "renew" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/billing/profile/:sub", () => {
  it.runIf(getSupabase())("returns the free plan for unknown users", async () => {
    const res = await request(app).get("/api/billing/profile/__vitest_unknown__");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ base: "free", pass: null });
  });
});

describe("productFor (upgrade mapping)", () => {
  it("charges only the difference for paid base moves", () => {
    expect(productFor("p4", "buy", "p3")).toBe("pdt_0NpCuaqcNyzLOIv4saHhI");
    expect(productFor("p5", "buy", "p3")).toBe("pdt_0NpCuaqrSaD10bs3BFmx3");
    expect(productFor("p5", "buy", "p4")).toBe("pdt_0NpCuarQymP2d1VC2OSRU");
  });

  it("charges full price from free and for passes", () => {
    expect(productFor("p4", "buy", "free")).toBe("pdt_0NpCuaqlRIYSdhmpXtcIM");
    expect(productFor("p7", "buy", "free")).toBe("pdt_0NpCuaow6xfNQMLfRUAqw");
  });

  it("uses the renew product for renewals", () => {
    expect(productFor("p7", "renew", "free")).toBe("pdt_0NpCuarDOXniQEB3rmEZH");
    expect(productFor("p10", "renew", "p7")).toBe("pdt_0NpCuarDOXniQEB3rmEZH");
  });
});

describe("webhook", () => {
  it("400s without signature headers", async () => {
    const res = await request(app).post("/api/billing/webhook").send({ type: "payment.succeeded" });
    expect(res.status).toBe(400);
  });

  it("200-ignores signed but unusable payloads instead of retrying", async () => {
    if (!getSupabase()) return;
    const secret = Buffer.from("vitest-webhook-secret-32bytes!").toString("base64");
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = secret;
    const payload = { business_id: "biz_test", timestamp: new Date().toISOString(), type: "payment.succeeded", data: { payment_id: "pay_nowhere", metadata: {} } };
    const raw = JSON.stringify(payload);
    const id = "msg_badmeta";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = new Webhook(secret).sign(id, new Date(Number(timestamp) * 1000), raw);
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("webhook-id", id)
      .set("webhook-signature", signature)
      .set("webhook-timestamp", timestamp)
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe("bad metadata");
  });

  it("revokes the refunded plan, but never touches later buys", async () => {
    if (!getSupabase()) return;
    const secret = Buffer.from("vitest-webhook-secret-32bytes!").toString("base64");
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = secret;
    const sign = (type: string, data: unknown, msgId: string) => {
      const raw = JSON.stringify({ business_id: "biz_test", timestamp: new Date().toISOString(), type, data });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = new Webhook(secret).sign(msgId, new Date(Number(timestamp) * 1000), raw);
      return request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("webhook-id", msgId)
        .set("webhook-signature", signature)
        .set("webhook-timestamp", timestamp)
        .send(raw);
    };
    // Case 1: buy p4, refund it → back to free.
    const paid = await sign("payment.succeeded", {
      payment_id: "pay_refund_case1", metadata: { sub: SUB_REFUND_A, plan_id: "p4", kind: "buy" },
    }, "msg_pay_case1");
    expect(paid.status).toBe(200);
    const refunded = await sign("refund.succeeded", { payment_id: "pay_refund_case1" }, "msg_refund_case1");
    expect(refunded.status).toBe(200);
    expect(refunded.body.revoked).toBe("p4");
    const backToFree = await request(app).get(`/api/billing/profile/${SUB_REFUND_A}`);
    expect(backToFree.body.base).toBe("free");
    // Case 2: buy p3, then upgrade to p5, then refund the p3 payment →
    // user holds p5 (not the refunded plan), so nothing is revoked.
    await sign("payment.succeeded", {
      payment_id: "pay_refund_case2a", metadata: { sub: SUB_REFUND_B, plan_id: "p3", kind: "buy" },
    }, "msg_pay_case2a");
    await sign("payment.succeeded", {
      payment_id: "pay_refund_case2b", metadata: { sub: SUB_REFUND_B, plan_id: "p5", kind: "buy" },
    }, "msg_pay_case2b");
    await sign("refund.succeeded", { payment_id: "pay_refund_case2a" }, "msg_refund_case2");
    const untouched = await request(app).get(`/api/billing/profile/${SUB_REFUND_B}`);
    expect(untouched.body.base).toBe("p5");
  });

  it("applies base upgrades and passes, idempotently", async () => {
    if (!getSupabase()) return;
    // Standard Webhooks secrets are base64-encoded.
    const secret = Buffer.from("vitest-webhook-secret-32bytes!").toString("base64");
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = secret;
    const send = async (sub: string, planId: string, paymentId: string) => {
      const payload = {
        business_id: "biz_test",
        timestamp: new Date().toISOString(),
        type: "payment.succeeded",
        data: {
          payload_type: "Payment",
          payment_id: paymentId,
          metadata: { sub, plan_id: planId, kind: "buy" },
        },
      };
      const raw = JSON.stringify(payload);
      const id = `msg_${paymentId}`;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = new Webhook(secret).sign(id, new Date(Number(timestamp) * 1000), raw);
      return request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("webhook-id", id)
        .set("webhook-signature", signature)
        .set("webhook-timestamp", timestamp)
        .send(raw);
    };

    const base = await send(SUB_BASE, "p4", "pay_test_base_1");
    expect(base.status).toBe(200);
    expect(base.body.plan.base).toBe("p4");

    // Retry of the same payment must not double-apply.
    const dup = await send(SUB_BASE, "p4", "pay_test_base_1");
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);

    const pass = await send(SUB_PASS, "p7", "pay_test_pass_1");
    expect(pass.status).toBe(200);
    expect(pass.body.plan.pass?.id).toBe("p7");
    expect(pass.body.plan.pass.expiresAt).toBeGreaterThan(Date.now());

    const profile = await request(app).get(`/api/billing/profile/${SUB_BASE}`);
    expect(profile.body.base).toBe("p4");
  });
});
