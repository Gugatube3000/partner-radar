// Load local configuration before provider modules initialize their model defaults.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const file = process.env.PARTNER_RADAR_ENV_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match && process.env[match[1]] == null) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
}
