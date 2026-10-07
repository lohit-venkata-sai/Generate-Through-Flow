import crypto from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import "./env.js";
import request from "supertest";
import { app } from "../src/app.js";
import { getSupabase } from "../src/lib/supabase.js";

const SUB_BASE = "__vitest_bill_base__";
const SUB_PASS = "__vitest_bill_pass__";

afterAll(async () => {
  const sb = getSupabase();
  if (sb) {
    for (const sub of [SUB_BASE, SUB_PASS]) {
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

describe("webhook", () => {
  it("400s without a signature", async () => {
    const res = await request(app).post("/api/billing/webhook").send({ event: "payment_link.paid" });
    expect(res.status).toBe(400);
  });

  it("applies base upgrades and passes, idempotently", async () => {
    if (!getSupabase()) return;
    process.env.RAZORPAY_WEBHOOK_SECRET = "vitest-webhook-secret";
    const send = async (sub: string, planId: string) => {
      const payload = {
        event: "payment_link.paid",
        payload: {
          payment_link: { entity: { id: `plink_${sub}`, notes: { sub, plan_id: planId, kind: "buy" } } },
          payment: { entity: { id: `pay_${sub}` } },
        },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac("sha256", "vitest-webhook-secret").update(raw).digest("hex");
      return request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("x-razorpay-signature", sig)
        .send(raw);
    };

    const base = await send(SUB_BASE, "p4");
    expect(base.status).toBe(200);
    expect(base.body.plan.base).toBe("p4");

    // Retry of the same payment must not double-apply.
    const dup = await send(SUB_BASE, "p4");
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);

    const pass = await send(SUB_PASS, "p7");
    expect(pass.status).toBe(200);
    expect(pass.body.plan.pass?.id).toBe("p7");
    expect(pass.body.plan.pass.expiresAt).toBeGreaterThan(Date.now());

    const profile = await request(app).get(`/api/billing/profile/${SUB_BASE}`);
    expect(profile.body.base).toBe("p4");
  });
});
