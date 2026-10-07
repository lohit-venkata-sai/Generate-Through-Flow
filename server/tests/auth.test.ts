import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("POST /api/auth/verify", () => {
  it("400s without an access token", async () => {
    const res = await request(app).post("/api/auth/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("accessToken is required");
  });

  it("401s on a bogus token", async () => {
    const res = await request(app)
      .post("/api/auth/verify")
      .send({ accessToken: "definitely-not-a-real-token" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid token");
  });
});
