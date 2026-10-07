import { Router } from "express";
import { getSupabase } from "../lib/supabase.js";

export const usageRouter = Router();

function todayKey(d = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Local fallback when Supabase env is not set (dev without DB).
const mem = new Map<string, { date: string; used: number }>();

usageRouter.get("/:sub", async (req, res) => {
  const sub = req.params.sub;
  const today = todayKey();
  try {
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb
        .from("daily_usage")
        .select("date, used")
        .eq("sub", sub)
        .eq("date", today)
        .maybeSingle();
      if (error) throw error;
      res.json(data ?? { date: today, used: 0 });
      return;
    }
  } catch {
    res.status(502).json({ error: "usage read failed" });
    return;
  }
  const entry = mem.get(sub);
  res.json(entry && entry.date === today ? entry : { date: today, used: 0 });
});

usageRouter.post("/:sub/consume", async (req, res) => {
  const sub = req.params.sub;
  const images = Number((req.body as { images?: unknown }).images);
  if (!Number.isInteger(images) || images <= 0 || images > 1000) {
    res.status(400).json({ error: "images must be an integer 1-1000" });
    return;
  }
  const today = todayKey();
  try {
    const sb = getSupabase();
    if (sb) {
      // daily_usage.sub references profiles(sub) — ensure the parent row
      // exists so consume works even if /verify never ran for this sub.
      await sb.from("profiles").upsert({ sub }, { onConflict: "sub" });
      const { data: prev } = await sb
        .from("daily_usage")
        .select("used")
        .eq("sub", sub)
        .eq("date", today)
        .maybeSingle();
      const used = (prev?.used ?? 0) + images;
      const { data, error } = await sb
        .from("daily_usage")
        .upsert({ sub, date: today, used }, { onConflict: "sub,date" })
        .select("date, used")
        .single();
      if (error) throw error;
      res.json(data);
      return;
    }
  } catch {
    res.status(502).json({ error: "usage write failed" });
    return;
  }
  const prev = mem.get(sub);
  const next =
    prev && prev.date === today
      ? { date: today, used: prev.used + images }
      : { date: today, used: images };
  mem.set(sub, next);
  res.json(next);
});
