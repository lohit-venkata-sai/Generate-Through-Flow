import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("GET /api/plans", () => {
  it("returns all six plans matching the extension catalog", async () => {
    const res = await request(app).get("/api/plans");
    expect(res.status).toBe(200);
    const ids = res.body.plans.map((p: { id: string }) => p.id);
    expect(ids).toEqual(["free", "p3", "p4", "p5", "p7", "p10"]);
    const byId = Object.fromEntries(res.body.plans.map((p: { id: string; dailyLimit: number | null }) => [p.id, p.dailyLimit]));
    expect(byId.free).toBe(50);
    expect(byId.p5).toBe(500);
    expect(byId.p7).toBeNull();
    expect(byId.p10).toBeNull();
  });
});
