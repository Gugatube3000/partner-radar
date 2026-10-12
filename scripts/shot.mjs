// Screenshots of the dashboard via headless Chrome (CDP).
// node scripts/shot.mjs <url> <outPrefix> <sec1,sec2,...> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [url, out, times = "10", W = "1600", H = "900", SCALE = "1", TRANSPARENT = ""] = process.argv.slice(2);
const chrome = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pr-chrome-"));
const proc = spawn(chrome, [`--headless=new`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ver;
for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: Number(W), height: Number(H), deviceScaleFactor: Number(SCALE), mobile: false });
if (TRANSPARENT) await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
await send("Page.navigate", { url });
const t0 = Date.now();
for (const t of times.split(",").map(Number)) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`${out}-${String(t).padStart(3, "0")}.png`, Buffer.from(r.result.data, "base64"));
  console.log(`${out}-${String(t).padStart(3, "0")}.png`);
}
const errs = await send("Runtime.evaluate", { expression: "window.__errs || ''", returnByValue: true });
ws.close(); proc.kill();
setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(0); }, 500);
