import { describe, expect, it } from "vitest";
import { AGENT_EXPERIMENTS, extractFlowImageUrls, FLOW_RPC, mineAgentToken } from "./flowRpc";

describe("agentInit builder", () => {
  it("builds the PROMPT_BOX_SUBMISSION envelope", () => {
    const built = FLOW_RPC.agentInit.build({
      projectId: "pid-123",
      userAgent: "TestAgent/1.0",
    }) as unknown[][][];
    expect(built[0][0][0]).toBe("PROMPT_BOX_SUBMISSION");
    const params = built[0][0][1] as unknown[];
    expect(typeof params[0]).toBe("string"); // request uuid
    expect((params[1] as number[]).length).toBe(2); // [sec, nanos]
    expect(params[2]).toBeNull();
    const env = params[3] as unknown[][];
    const get = (k: string) => (env.find((e) => e[0] === k)?.[1] ?? []) as [string, unknown[]];
    expect(get("TOOL_NAME")[1]).toEqual(["PINHOLE"]);
    expect(get("SOURCE")[1]).toEqual(["CREATIVE_AGENT"]);
    expect(get("PROJECT_ID")[1]).toEqual(["pid-123"]);
    expect(get("USER_AGENT")[1]).toEqual(["TestAgent/1.0"]);
    expect(get("IS_DESKTOP")[1]).toEqual([1]);
    expect(params[4]).toBe(AGENT_EXPERIMENTS);
  });
});

describe("agentChat builder", () => {
  it("wraps the message text with project + token", () => {
    const built = FLOW_RPC.agentChat.build({
      projectId: "pid-123",
      token: "tok-abc",
      messageText: "hello agent",
    }) as unknown[];
    expect(built[0]).toBeNull();
    const inner = JSON.parse(built[1] as string) as unknown[];
    expect(typeof inner[0]).toBe("string"); // request id
    expect(inner[1]).toEqual([[[["hello agent"]]]]);
    expect(inner[2]).toEqual(["projects/pid-123", null, ["tok-abc", 1], null, null, 1]);
  });
});

describe("mineAgentToken", () => {
  it("returns the longest opaque string", () => {
    const token = "0cAF" + "x".repeat(200);
    const data = { a: ["short", { b: token }], c: "y".repeat(50) };
    expect(mineAgentToken(data)).toBe(token);
  });

  it("returns null when nothing qualifies", () => {
    expect(mineAgentToken({ a: ["short", 42] })).toBeNull();
    expect(mineAgentToken(null)).toBeNull();
  });
});

describe("extractFlowImageUrls", () => {
  it("finds and dedupes image urls", () => {
    const u1 = "https://flow-content.google/image/abc-123";
    const u2 = "https://flow-content.google/image/def-456?x=1";
    const text = `here ${u1} and ${u1} plus ${u2} done`;
    expect(extractFlowImageUrls(text)).toEqual([u1, u2]);
  });

  it("returns empty for plain text", () => {
    expect(extractFlowImageUrls("no urls here")).toEqual([]);
  });
});
