import { Router } from "express";

export interface PlanDef {
  id: string;
  price: number;
  dailyLimit: number | null;
  term: string;
  blurb: string;
}

// Mirrors PLANS in src/lib/store.ts — keep in sync when pricing changes.
const PLANS: PlanDef[] = [
  { id: "free", price: 0, dailyLimit: 50, term: "Free forever", blurb: "50 images per day" },
  { id: "p3", price: 3, dailyLimit: 100, term: "Lifetime", blurb: "100 images per day, forever" },
  { id: "p4", price: 4, dailyLimit: 300, term: "Lifetime", blurb: "300 images per day, forever" },
  { id: "p5", price: 5, dailyLimit: 500, term: "Lifetime", blurb: "500 images per day, forever" },
  { id: "p7", price: 7, dailyLimit: null, term: "6 months", blurb: "Unlimited images per day for 6 months" },
  { id: "p10", price: 10, dailyLimit: null, term: "1 year", blurb: "Unlimited images per day for 1 year" },
];

export const plansRouter = Router();

plansRouter.get("/", (_req, res) => {
  res.json({ plans: PLANS });
});
