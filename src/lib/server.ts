// Thin client for the FlowPilot server (server/). Every call fails soft —
// null means "server unreachable", and callers fall back to local storage.
import type { ActivePlan, DailyUsage } from "../types";

const URL_KEY = "flowpilot-server-url";

export const DEFAULT_SERVER_URL = "http://localhost:3001";

function norm(base: string): string {
  return (base || "").trim().replace(/\/+$/, "") || DEFAULT_SERVER_URL;
}

export async function loadServerUrl(): Promise<string> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const r = await chrome.storage.local.get(URL_KEY);
      return norm((r[URL_KEY] as string | undefined) ?? DEFAULT_SERVER_URL);
    }
    return norm(localStorage.getItem(URL_KEY) ?? DEFAULT_SERVER_URL);
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

export async function saveServerUrl(url: string): Promise<void> {
  const value = norm(url);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [URL_KEY]: value });
      return;
    }
    localStorage.setItem(URL_KEY, value);
  } catch { /* non-fatal */ }
}

async function req<T>(base: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(`${norm(base)}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export function serverHealth(base: string): Promise<{ ok: boolean } | null> {
  return req(base, "/health");
}

export function serverVerify(
  base: string,
  accessToken: string,
): Promise<{ user: { sub: string; email: string; name: string; picture: string } } | null> {
  return req(base, "/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ accessToken }),
  });
}

export function serverGetUsage(base: string, sub: string): Promise<DailyUsage | null> {
  return req(base, `/api/usage/${encodeURIComponent(sub)}`);
}

export function serverConsume(base: string, sub: string, images: number): Promise<DailyUsage | null> {
  return req(base, `/api/usage/${encodeURIComponent(sub)}/consume`, {
    method: "POST",
    body: JSON.stringify({ images }),
  });
}

export interface ServerProfile {
  base: ActivePlan["base"];
  pass: { id: "p7" | "p10"; startedAt: number; expiresAt: number } | null;
}

/** Map a server profile onto the local plan shape (same fields). */
export function profileToPlan(p: ServerProfile): ActivePlan {
  const base = (["free", "p3", "p4", "p5"] as const).includes(p.base as ActivePlan["base"])
    ? (p.base as ActivePlan["base"])
    : "free";
  const pass =
    p.pass && (p.pass.id === "p7" || p.pass.id === "p10")
      ? { id: p.pass.id, startedAt: p.pass.startedAt ?? 0, expiresAt: p.pass.expiresAt ?? 0 }
      : null;
  return { base, pass };
}

export function serverGetProfile(base: string, sub: string): Promise<ServerProfile | null> {
  return req(base, `/api/billing/profile/${encodeURIComponent(sub)}`);
}

export function serverCheckout(
  base: string,
  sub: string,
  planId: string,
  kind: "buy" | "renew",
  email?: string,
): Promise<{ url: string; paymentLinkId: string | null } | null> {
  return req(base, "/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ sub, planId, kind, email: email ?? "" }),
  });
}
