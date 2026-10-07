import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { getSupabase } from "../src/lib/supabase.js";

const SUB = "__vitest_usage__";

function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

afterAll(async () => {
  // Keep the test project clean: remove rows created by the round-trip.
  const sb = getSupabase();
  if (sb) {
    await sb.from("daily_usage").delete().eq("sub", SUB);
    await sb.from("profiles").delete().eq("sub", SUB);
  }
});

describe("usage validation (no DB writes)", () => {
  it("400s on non-positive image counts", async () => {
    for (const images of [0, -1, 1.5, "x", 1001]) {
      const res = await request(app).post(`/api/usage/${SUB}/consume`).send({ images });
      expect(res.status).toBe(400);
    }
  });

  it("400s on missing body", async () => {
    const res = await request(app).post(`/api/usage/${SUB}/consume`).send({});
    expect(res.status).toBe(400);
  });
});

describe("usage round-trip (live Supabase)", () => {
  it("starts at zero for a fresh sub", async () => {
    const res = await request(app).get(`/api/usage/${SUB}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ date: todayKey(), used: 0 });
  });

  it("consume accumulates across calls", async () => {
    const first = await request(app).post(`/api/usage/${SUB}/consume`).send({ images: 2 });
    expect(first.status).toBe(200);
    expect(first.body.used).toBe(2);

    const second = await request(app).post(`/api/usage/${SUB}/consume`).send({ images: 3 });
    expect(second.status).toBe(200);
    expect(second.body.used).toBe(5);

    const read = await request(app).get(`/api/usage/${SUB}`);
    expect(read.status).toBe(200);
    expect(read.body.used).toBe(5);
  });
});
