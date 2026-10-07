import { Router } from "express";
import { getSupabase } from "../lib/supabase.js";

export const authRouter = Router();

interface GoogleUserInfo {
  id?: string;
  email?: string;
  name?: string;
  picture?: string;
}

// Verifies the extension's Google access token against Google's userinfo
// endpoint. Returns the profile on success, 401 otherwise.
authRouter.post("/verify", async (req, res) => {
  const accessToken = (req.body as { accessToken?: unknown }).accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    res.status(400).json({ error: "accessToken is required" });
    return;
  }
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    const info = (await r.json()) as GoogleUserInfo;
    if (!info.id) {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    const user = {
      sub: info.id,
      email: (info.email || "").toLowerCase(),
      name: info.name || "",
      picture: info.picture || "",
    };
    // Upsert profile so usage/plans have a row to attach to. Best-effort:
    // verification still succeeds if Supabase is not configured yet.
    try {
      const sb = getSupabase();
      if (sb) {
        await sb.from("profiles").upsert(
          {
            sub: user.sub,
            email: user.email,
            name: user.name,
            picture: user.picture,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "sub" },
        );
      }
    } catch {
      /* profile sync best-effort — ignore */
    }
    res.json({ user });
  } catch {
    res.status(502).json({ error: "google verification failed" });
  }
});
