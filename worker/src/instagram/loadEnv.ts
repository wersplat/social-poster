import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/instagram → worker package root
const root = resolve(__dirname, "..", "..");

config({ path: resolve(root, ".env") });
config({ path: resolve(root, ".env.local") });
