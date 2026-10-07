/**
 * One HTML document, no build step, no framework, no external request.
 *
 * "No external requests" is already a rule in this repository — `site/` is
 * checked for it, and the reason does not change with the artifact. A page that
 * draws a list and five numbers does not need a CDN.
 *
 * The client holds one model: the newest `ConversationView` the server sent.
 * It does not apply operations, and that is deliberate — see SPEC 0009.
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
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:16px; flex-wrap:wrap; align-items:baseline; }
  header .k { color:var(--amber); font-weight:700; letter-spacing:.5px; }
  header .dim { color:var(--dim); }
  main { padding:16px; max-width:1000px; }
  .entry { border-left:2px solid var(--line); margin:0 0 14px; padding:2px 0 2px 12px; white-space:pre-wrap; word-break:break-word; }
  .entry.user { border-color:var(--amber); }
  .entry.assistant { border-color:var(--ok); }
  .entry.tool { border-color:var(--dim); }
  .kind { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.6px; display:block; margin-bottom:2px; }
  .tool-name { color:var(--amber); }
  .busy { color:var(--amber); }
  .idle { color:var(--dim); }
  form { position:fixed; bottom:0; left:0; right:0; background:var(--bg); border-top:1px solid var(--line); padding:10px 16px; display:flex; gap:8px; }
  input[type=text] { flex:1; background:#1b1815; border:1px solid var(--line); color:var(--fg); padding:8px 10px; font:inherit; }
  input[type=text]:focus { outline:1px solid var(--amber); }
  button { background:#1b1815; border:1px solid var(--line); color:var(--fg); padding:8px 14px; font:inherit; cursor:pointer; }
  button:hover { border-color:var(--amber); color:var(--amber); }
  #err { color:var(--bad); }
</style>
</head>
<body>
<header>
  <span class="k">K9999</span>
  <span id="model" class="dim">—</span>
  <span id="status" class="idle">connecting…</span>
  <span id="usage" class="dim"></span>
  <span id="err"></span>
</header>
<main id="transcript"></main>
<form id="composer" autocomplete="off">
  <input type="text" id="prompt" placeholder="Ask K9999 about this directory…" autofocus>
  <button type="submit">Send</button>
  <button type="button" id="abort">Stop</button>
</form>
<script>
const token = new URLSearchParams(location.search).get("t") || "";
const el = (id) => document.getElementById(id);
let view = null;

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content.map((part) => {
    if (part && part.type === "text") return part.text || "";
    if (part && part.type === "thinking") return "";
    return "";
  }).join("");
}

function renderEntry(entry) {
  const div = document.createElement("div");
  const kind = String(entry.kind || "entry");
  div.className = "entry " + (kind.includes("user") ? "user" : kind.includes("assistant") ? "assistant" : kind.includes("tool") ? "tool" : "");
  const label = document.createElement("span");
  label.className = "kind";
  label.textContent = kind.replace(/^pi\\./, "");
  div.appendChild(label);
  const messages = Array.isArray(entry.model) ? entry.model : [];
  for (const message of messages) {
    if (message && Array.isArray(message.content)) {
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
  if (entry.data && entry.data.diagnostics && entry.data.diagnostics.length) {
    div.appendChild(document.createTextNode(JSON.stringify(entry.data.diagnostics)));
  }
  return div;
}

function render() {
  if (!view) return;
  const live = (view.docs && view.docs["pi.live"]) || {};
  const usage = (view.docs && view.docs["pi.usage"]) || {};
  const agent = (view.docs && view.docs["pi.agent"]) || {};
  const inbox = (view.docs && view.docs["pi.inbox"]) || {};

  const model = agent.model ? agent.model.provider + "/" + agent.model.modelId : "—";
  el("model").textContent = model + (agent.thinkingLevel ? " · " + agent.thinkingLevel : "");

  const queued = Array.isArray(inbox.items) ? inbox.items.length : 0;
  const running = Boolean(live.generation) || (Array.isArray(live.tools) && live.tools.some((t) => t && t.state !== "settled"));
  el("status").className = running ? "busy" : "idle";
  el("status").textContent = running
    ? "running" + (queued ? " · " + queued + " queued" : "")
    : "idle" + (queued ? " · " + queued + " queued" : "");

  const models = usage.models || {};
  const totals = Object.keys(models).reduce((acc, key) => {
    const u = models[key] || {};
    acc.input += u.input || 0;
    acc.output += u.output || 0;
    acc.cost += (u.cost && u.cost.total) || 0;
    return acc;
  }, { input: 0, output: 0, cost: 0 });
  el("usage").textContent = totals.input || totals.output
    ? "↑" + totals.input + " ↓" + totals.output + " · $" + totals.cost.toFixed(6)
    : "";

  const transcript = el("transcript");
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  transcript.textContent = "";
  for (const entry of view.entries || []) transcript.appendChild(renderEntry(entry));
  if (atBottom) window.scrollTo(0, document.body.scrollHeight);
}

function applyFrame(payload) {
  if (payload && payload.type === "snapshot") { view = payload.value; render(); }
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
