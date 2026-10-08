/**
 * One HTML document, no build step, no framework, no external request.
 *
 * "No external requests" is already a rule in this repository — `site/` is
 * checked for it, and the reason does not change with the artifact.
 *
 * The page holds two panes because it answers two different questions, and they
 * are answered by two different sources:
 *
 *   the session   what the harness has committed. `pi.usage`, `pi.live`, `pi.inbox`
 *   the request   what went to the model. `beforeRequest` and `afterResponse`
 *
 * **The numbers are labelled by their source and never merged.** `pi.usage` is a
 * committed total and counts failed and aborted attempts; `afterResponse.usage`
 * is one request. They differ legitimately, and a page that showed both as
 * "tokens" would be lying about one of them.
 *
 * The panes are also at two different layers, and the request pane says which:
 * it is what this process intended to send, not the bytes on the wire.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>K9999</title>
<style>
  :root { --bg:#12100e; --fg:#e8e2d8; --dim:#8a8076; --line:#2e2a26; --amber:#e07856; --ok:#7ea86b; --bad:#c25b4e; }
  * { box-sizing:border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; overflow:hidden; background:var(--bg); color:var(--fg); font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  header { flex:none; background:var(--bg); border-bottom:1px solid var(--line); padding:9px 14px; display:flex; gap:14px; flex-wrap:wrap; align-items:baseline; }
  header .k { color:var(--amber); font-weight:700; letter-spacing:.5px; }
  header .dim, .dim { color:var(--dim); }
  /* Tabs. One pane at a time, each owning the full height and its own scroll.
     The two panes are different lengths, so side by side they shared one scroll
     bar and reading either one meant dragging the other. */
  .tabs { flex:none; display:flex; gap:2px; padding:0 14px; border-bottom:1px solid var(--line); }
  .tab { appearance:none; background:none; border:0; border-bottom:2px solid transparent; color:var(--dim); font:inherit; padding:9px 12px 8px; cursor:pointer; margin-bottom:-1px; }
  .tab:hover { color:var(--fg); }
  .tab.active { color:var(--fg); border-bottom-color:var(--amber); }
  .tab .count { color:var(--dim); font-size:11px; }
  .tab.active .count { color:var(--amber); }
  .panes { flex:1; min-height:0; position:relative; }
  .pane { position:absolute; inset:0; overflow-y:auto; padding:14px 16px 24px; display:none; }
  .pane.active { display:block; }
  .pane h2 { font-size:11px; text-transform:uppercase; letter-spacing:.7px; color:var(--dim); margin:0 0 3px; font-weight:400; }
  .pane .sub { font-size:11px; color:var(--dim); margin:0 0 10px; }
  .entry { border-left:2px solid var(--line); margin:0 0 11px; padding:2px 0 2px 10px; white-space:pre-wrap; word-break:break-word; }
  .entry.user { border-color:var(--amber); }
  .entry.assistant { border-color:var(--ok); }
  .entry.system { border-color:var(--dim); }
  .entry.tool { border-color:var(--dim); }
  .kind { color:var(--dim); font-size:10px; text-transform:uppercase; letter-spacing:.6px; display:block; }
  .tool-name { color:var(--amber); }
  .busy { color:var(--amber); }
  .idle { color:var(--dim); }
  .metric { display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dotted var(--line); }
  .metric .v { color:var(--fg); }
  .metric .src { color:var(--dim); font-size:11px; }
  .req { border:1px solid var(--line); padding:8px 10px; margin:0 0 10px; }
  .req.newest { border-color:var(--amber); }
  .schema { max-height:200px; overflow:auto; background:#1b1815; padding:6px 8px; margin:4px 0 0; font-size:11px; color:var(--dim); }
  form { flex:none; background:var(--bg); border-top:1px solid var(--line); padding:9px 14px; display:flex; gap:8px; }
  input[type=text] { flex:1; background:#1b1815; border:1px solid var(--line); color:var(--fg); padding:7px 9px; font:inherit; }
  input[type=text]:focus { outline:1px solid var(--amber); }
  button { background:#1b1815; border:1px solid var(--line); color:var(--fg); padding:7px 12px; font:inherit; cursor:pointer; }
  button:hover { border-color:var(--amber); color:var(--amber); }
  #err { color:var(--bad); }
</style>
</head>
<body>
<header>
  <span class="k">K9999</span>
  <span id="model" class="dim">—</span>
  <span id="status" class="idle">connecting…</span>
  <span id="err"></span>
</header>

<nav class="tabs">
  <button class="tab active" data-tab="session" type="button">会话 <span class="count" id="c-session"></span></button>
  <button class="tab" data-tab="monitor" type="button">监控 <span class="count" id="c-monitor"></span></button>
</nav>

<div class="panes">
  <section class="pane active" data-pane="session">
    <h2>The session</h2>
    <p class="sub">Committed state. Persisted, so it survives a restart.</p>
    <div id="transcript"></div>
    <div id="session-metrics" style="margin-top:14px"></div>
  </section>

  <section class="pane" data-pane="monitor">
    <h2>The request</h2>
    <p class="sub" id="wire-boundary">—</p>
    <div id="wire"></div>
  </section>
</div>

<form id="composer" autocomplete="off">
  <input type="text" id="prompt" placeholder="Ask K9999 about this directory…" autofocus>
  <button type="submit">Send</button>
  <button type="button" id="abort">Stop</button>
</form>

<script>
const token = new URLSearchParams(location.search).get("t") || "";
const el = (id) => document.getElementById(id);
let view = null;
let wire = null;

function textOf(message) {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && part.type === "text" ? part.text || "" : "")).join("");
}

function metric(label, value, source) {
  const row = document.createElement("div");
  row.className = "metric";
  const l = document.createElement("span");
  l.className = "src";
  l.textContent = label;
  const r = document.createElement("span");
  r.className = "v";
  r.textContent = String(value);
  row.appendChild(l);
  row.appendChild(r);
  if (source) {
    const s = document.createElement("span");
    s.className = "src";
    s.textContent = source;
    row.appendChild(s);
  }
  return row;
}

function renderEntry(entry) {
  const div = document.createElement("div");
  const kind = String(entry.kind || "entry");
  div.className = "entry " + (kind.includes("user") ? "user" : kind.includes("assistant") ? "assistant" : kind.includes("system") ? "system" : kind.includes("tool") ? "tool" : "");
  const label = document.createElement("span");
  label.className = "kind";
  label.textContent = kind.replace(/^pi\\./, "");
  div.appendChild(label);
  for (const message of Array.isArray(entry.model) ? entry.model : []) {
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part && part.type === "tool-call") {
          const call = document.createElement("div");
          const name = document.createElement("span");
          name.className = "tool-name";
          name.textContent = "→ " + (part.name || part.toolName || "tool");
          call.appendChild(name);
          call.appendChild(document.createTextNode(" " + JSON.stringify(part.arguments ?? part.input ?? {})));
          div.appendChild(call);
        }
      }
    }
    const text = textOf(message);
    if (text) div.appendChild(document.createTextNode(text));
  }
  return div;
}

function renderSession() {
  if (!view) return;
  const docs = view.docs || {};
  const live = docs["pi.live"] || {};
  const usage = docs["pi.usage"] || {};
  const agent = docs["pi.agent"] || {};
  const inbox = docs["pi.inbox"] || {};

  el("model").textContent = agent.model ? agent.model.provider + "/" + agent.model.modelId : "—";
  const queued = Array.isArray(inbox.items) ? inbox.items.length : 0;
  const running = Boolean(live.generation) || (Array.isArray(live.tools) && live.tools.some((t) => t && t.state !== "settled"));
  el("status").className = running ? "busy" : "idle";
  el("status").textContent = (running ? "running" : "idle") + (queued ? " · " + queued + " queued" : "");

  const transcript = el("transcript");
  // The pane scrolls, not the window. Reading the window here would always say
  // "at the bottom" because the window never scrolls under this layout, and every
  // frame would yank the view down while someone was reading the top.
  const pane = transcript.parentElement;
  const atBottom = pane === null ? true : pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80;
  transcript.textContent = "";
  for (const entry of view.entries || []) transcript.appendChild(renderEntry(entry));

  // Labelled by source. These totals include failed and aborted attempts, which a
  // per-request number does not, so the two must never be shown as one figure.
  const models = usage.models || {};
  const totals = Object.keys(models).reduce((acc, key) => {
    const u = models[key] || {};
    acc.input += u.input || 0;
    acc.output += u.output || 0;
    acc.cacheRead += u.cacheRead || 0;
    acc.cost += (u.cost && u.cost.total) || 0;
    return acc;
  }, { input: 0, output: 0, cacheRead: 0, cost: 0 });
  const m = el("session-metrics");
  m.textContent = "";
  m.appendChild(metric("tokens in", totals.input, "pi.usage · committed total"));
  m.appendChild(metric("tokens out", totals.output, "pi.usage · committed total"));
  m.appendChild(metric("cache read", totals.cacheRead, "pi.usage · committed total"));
  m.appendChild(metric("cost", "$" + totals.cost.toFixed(6), "pi.usage · committed total"));

  if (atBottom && pane !== null) pane.scrollTop = pane.scrollHeight;
}

function renderWire() {
  const host = el("wire");
  host.textContent = "";
  if (!wire) { el("wire-boundary").textContent = "Not enabled on this server."; return; }
  el("wire-boundary").textContent = wire.boundary;

  const requests = wire.requests || [];
  if (!requests.length) {
    const p = document.createElement("p");
    p.className = "dim";
    p.textContent = "No request yet. Send a prompt and this fills in.";
    host.appendChild(p);
  }

  for (let i = requests.length - 1; i >= 0; i--) {
    const r = requests[i];
    const box = document.createElement("div");
    box.className = "req" + (i === requests.length - 1 ? " newest" : "");
    const head = document.createElement("div");
    head.className = "kind";
    head.textContent = "request " + (i + 1) + " of " + requests.length + (r.attempt > 1 ? " · attempt " + r.attempt : "") + " · " + r.at.replace("T", " ").slice(0, 19);
    box.appendChild(head);

    const msgs = document.createElement("div");
    msgs.className = "dim";
    msgs.textContent = r.messages.map((m) => m.role + " " + m.bytes + "B").join("  ·  ");
    box.appendChild(msgs);

    if (r.response) {
      box.appendChild(metric("in / out", r.response.input + " / " + r.response.output, "this request"));
      if (r.response.cacheRead) box.appendChild(metric("cache read", r.response.cacheRead, "this request"));
      box.appendChild(metric("cost", "$" + r.response.cost.toFixed(6), "this request"));
      box.appendChild(metric("stop", r.response.stopReason || "—", "this request"));
    }
    host.appendChild(box);
  }

  // The tool schemas and the prompt digest: what was offered, and whether it moved.
  if (wire.tools && wire.tools.length) {
    const box = document.createElement("div");
    box.className = "req";
    const head = document.createElement("div");
    head.className = "kind";
    head.textContent = "tool schemas offered (" + wire.tools.length + ")";
    box.appendChild(head);
    const list = document.createElement("div");
    list.className = "dim";
    list.textContent = wire.tools.map((t) => t.name).join(", ");
    box.appendChild(list);
    const pre = document.createElement("pre");
    pre.className = "schema";
    pre.textContent = JSON.stringify(wire.tools.map((t) => ({ name: t.name, parameters: t.parameters })), null, 1);
    box.appendChild(pre);
    host.appendChild(box);
  }

  const prompt = document.createElement("div");
  prompt.className = "req";
  const ph = document.createElement("div");
  ph.className = "kind";
  ph.textContent = "system prompt" + (wire.systemSource === "sections" ? " · rendered from sections" : wire.systemSource === "message" ? " · as a message" : "");
  prompt.appendChild(ph);
  const body = document.createElement("div");
  body.className = "dim";
  body.textContent = wire.hasSystem && wire.system
    ? wire.system.slice(0, 8000)
    : "None. This profile declares no prompt and no extension contributed a section.";
  body.style.whiteSpace = "pre-wrap";
  prompt.appendChild(body);
  host.appendChild(prompt);
}

function applyFrame(payload) {
  if (!payload) return;
  if (payload.view) view = payload.view;
  if ("wire" in payload) wire = payload.wire;
  renderSession();
  renderWire();
  renderTabCounts();
}

// ── Tabs ───────────────────────────────────────────────────────────────
// Each pane keeps its own scroll position because both stay in the DOM; only
// visibility changes. Re-rendering on every frame would otherwise reset the
// scroll of the tab the reader is not looking at.
let activeTab = "session";
function selectTab(name) {
  activeTab = name;
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.tab === name);
  }
  for (const pane of document.querySelectorAll(".pane")) {
    pane.classList.toggle("active", pane.dataset.pane === name);
  }
  // The composer sends prompts, so it belongs to the conversation.
  el("composer").style.display = name === "session" ? "flex" : "none";
}
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => selectTab(tab.dataset.tab));
}

/** Counts on the tab labels, so the other pane can be judged without switching. */
function renderTabCounts() {
  const entries = (view && view.entries) || [];
  const requests = (wire && wire.requests) || [];
  el("c-session").textContent = entries.length ? String(entries.length) : "";
  el("c-monitor").textContent = requests.length ? String(requests.length) : "";
}

function connect() {
  const stream = new EventSource("/events?t=" + encodeURIComponent(token));
  stream.onmessage = (event) => { el("err").textContent = ""; applyFrame(JSON.parse(event.data)); };
  stream.onerror = () => { el("err").textContent = "stream lost, reconnecting…"; };
}
connect();

async function post(path, body) {
  const response = await fetch(path + "?t=" + encodeURIComponent(token), {
    method: "POST",
    headers: { "content-type": "application/json", "x-k9999-token": token },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    el("err").textContent = detail.error || ("HTTP " + response.status);
    return;
  }
  el("err").textContent = "";
}

el("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = el("prompt");
  const content = input.value.trim();
  if (!content) return;
  input.value = "";
  post("/prompt", { content, requestId: crypto.randomUUID() });
});
el("abort").addEventListener("click", () => post("/abort", {}));
</script>
</body>
</html>
`;
