import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { authRouter } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { healthRouter } from "./routes/health.js";
import { plansRouter } from "./routes/plans.js";
import { usageRouter } from "./routes/usage.js";

dotenv.config();

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "";
const allowedOrigins = CLIENT_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);

export const app = express();

app.use(helmet());
app.use(morgan("tiny"));
// The billing webhook needs the raw body for HMAC verification, so the
// global json parser skips that path (the route parses raw itself).
const json = express.json({ limit: "64kb" });
app.use((req, res, next) => {
  if (req.path === "/api/billing/webhook") next();
  else json(req, res, next);
});
app.use(
  cors({
    // Chrome extensions send their own origin (chrome-extension://<id>);
    // empty allow-list means allow all (local dev only).
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) cb(null, true);
      else cb(new Error("cors blocked"));
    },
  }),
);

app.use("/health", healthRouter);
app.use("/api/plans", plansRouter);
app.use("/api/auth", authRouter);
app.use("/api/usage", usageRouter);
app.use("/api/billing", billingRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.message === "cors blocked") {
    res.status(403).json({ error: "forbidden origin" });
    return;
  }
  res.status(500).json({ error: "internal error" });
});
