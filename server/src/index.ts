import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { plansRouter } from "./routes/plans.js";
import { usageRouter } from "./routes/usage.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "";

app.use(helmet());
app.use(morgan("tiny"));
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    // Chrome extensions send no Origin on some calls; allow requests with
    // no origin while restricting browser origins to the configured one.
    origin: (origin, cb) => {
      if (!origin || !CLIENT_ORIGIN || origin === CLIENT_ORIGIN) cb(null, true);
      else cb(new Error("cors blocked"));
    },
  }),
);

app.use("/health", healthRouter);
app.use("/api/plans", plansRouter);
app.use("/api/auth", authRouter);
app.use("/api/usage", usageRouter);

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

app.listen(PORT, () => {
  console.log(`flowpilot-server listening on :${PORT}`);
});
