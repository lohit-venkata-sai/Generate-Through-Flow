// Load server/.env regardless of which directory vitest runs from.
// (dotenv defaults to process.cwd(), which is the repo root for `npm test`.)
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });
