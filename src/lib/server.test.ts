import { describe, expect, it } from "vitest";
import { profileToPlan } from "./server";

describe("profileToPlan", () => {
  it("maps a full profile onto the plan shape", () => {
    expect(
      profileToPlan({ base: "p4", pass: { id: "p7", startedAt: 1, expiresAt: 2 } }),
    ).toEqual({ base: "p4", pass: { id: "p7", startedAt: 1, expiresAt: 2 } });
  });

  it("defaults unknown users to free without a pass", () => {
    expect(profileToPlan({ base: "free", pass: null })).toEqual({ base: "free", pass: null });
  });

  it("sanitizes unknown base and pass ids", () => {
    expect(
      profileToPlan({ base: "hacker", pass: { id: "px", startedAt: 0, expiresAt: 0 } } as never),
    ).toEqual({ base: "free", pass: null });
  });
});
