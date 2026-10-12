// Event-driven activity records: bounded, searchable, and safe to render as text.
export function sourceUrl(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; }
}
export function activityRecord(event, firmName = "") {
  const type = event.type, agent = event.agent || (type === "firm" ? "scout" : "pipeline");
  let text = "", kind = "progress", status = "info";
  if (type === "activity") { text = String(event.text || ""); kind = /^search/i.test(text) ? "search" : /^(read|public page)/i.test(text) ? "read" : /^(warning|error)/i.test(text) ? "issue" : "progress"; }
  else if (type === "task") { text = String(event.label || "Research task"); status = event.state; kind = event.state === "error" ? "issue" : "task"; if (event.state === "error") text += `: ${event.error || "Task failed"}`; }
  else if (type === "log") { text = String(event.text || ""); status = event.level; kind = ["warn", "err"].includes(event.level) ? "issue" : "progress"; }
  else if (type === "firm") { text = `Found ${event.firm?.name || "a firm"}`; kind = "result"; status = "done"; firmName = event.firm?.name || firmName; }
  else if (type === "judge") { text = `${firmName || "Firm"}: partnership fit ${event.fit}/5`; kind = "result"; status = "done"; }
  else if (type === "done") { const summary = event.summary || event; text = summary.failed ? "Research failed; review the issues" : summary.stopped ? "Research stopped; partial results saved" : summary.partial ? "Partial results ready" : "Research complete; results ready"; kind = summary.failed ? "issue" : "result"; status = summary.failed ? "error" : summary.stopped ? "stopped" : "done"; }
  if (!text) return null;
  const explicit = event.url || (text.match(/https?:\/\/[^\s<>"']+/)?.[0] || "");
  return { id: event.seq ? `event-${event.seq}` : `${type}:${event.task || event.id || ""}:${event.state || ""}:${event.t || 0}:${text}`, t: Math.max(0, Number(event.t) || 0), agent, firm: String(firmName), text: text.slice(0, 900), kind, status, url: sourceUrl(explicit) };
}
export class ActivityStore {
  constructor(limit = 180) { this.limit = Math.max(10, Math.min(300, limit)); this.records = []; this.ids = new Set(); this.total = 0; this.follow = true; }
  clear() { this.records = []; this.ids.clear(); this.total = 0; this.follow = true; }
  add(record) {
    if (!record || this.ids.has(record.id)) return false;
    this.records.push(record); this.ids.add(record.id); this.total++;
    while (this.records.length > this.limit) this.ids.delete(this.records.shift().id);
    return true;
  }
  filtered(kind = "all", query = "") { const needle = query.trim().toLowerCase(); return this.records.filter((record) => (kind === "all" || record.kind === kind) && `${record.agent} ${record.firm} ${record.text}`.toLowerCase().includes(needle)); }
}
export function taskState(tasks, event) {
  const next = new Map(tasks);
  if (event.state === "running") next.set(event.id, { agent: event.agent, label: event.label, firmId: event.firmId, t: event.t || 0 });
  else next.delete(event.id);
  return next;
}
