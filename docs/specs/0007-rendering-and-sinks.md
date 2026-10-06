# 0007 — Rendering: a vocabulary, a sink, and a dashboard

**Status:** `building`

Tier 1 and the transcript TUI are implemented. Tier 3's dashboard is specified, re-scoped against an out-of-process observer, and not built.

## Problem

The CLI writes plain text and nothing else. Measured against a real terminal:

| | Now | Pi (for reference) |
|---|---|---|
| ANSI escape sequences | **0** | full colour |
| Rendering | `stdout.write` per event | differential, redraws only changed lines |
| Components | none | 15, including an editor, select lists, scroll views |
| Tool results | `[edit] done` | a rendered diff |

The sharpest gap is not cosmetic. Running `edit` prints:

```
[edit] src/foo.ts
[edit] done
```

**What changed is never shown.** An agent that edits code without showing the diff is an agent the user re-checks with `git diff` after every turn. That is the difference between usable and trusted.

There is a second problem underneath the first. The renderer is one function inside `index.ts` that writes to `process.stdout` directly. Every future channel — WeChat, a pipe, CI, a dashboard — would have to change that function.

## Invariant

**The agent produces a description of what happened. A sink decides how it looks.**

Nothing in the agent knows about terminals, colour, or columns. Nothing in a sink knows about agent events.

This is why the vocabulary comes before any UI work, including before [0001](0001-non-blocking-interaction.md). The sink is the seam a channel plugs into. Building the UI first would put terminal assumptions where the channel boundary belongs, which is the same mistake as awaiting a human inside the loop.

## The vocabulary

```ts
type RenderItem =
  // what the model said
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  // what it did
  | { kind: "toolCall"; id: string; name: string; summary: string }
  | { kind: "toolResult"; id: string; name: string; ok: boolean; summary: string; change?: FileChange }
  // what it cost
  | { kind: "turn"; turns: number; state: RunState }
  // how it ended
  | { kind: "error"; message: string }
  // forward-looking: produced once 0001, 0003, and 0004 land
  | { kind: "interaction"; id: string; prompt: string; deadline: string; defaultAction: string }
  | { kind: "degrade"; reason: string }
  | { kind: "check"; ok: boolean; detail: string };
```

`FileChange` is structured, not formatted. The tool knows what it changed; the sink decides whether that becomes a diff, a one-line summary, or a row in a table:

```ts
interface FileChange {
  path: string;
  /** 1-indexed line where the replacement starts. */
  line: number;
  removed: readonly string[];
  added: readonly string[];
}
```

The three forward-looking variants are declared now because a vocabulary that arrives after its consumers is a vocabulary shaped by one of them. The text sink renders them plainly; nothing else does yet.

## The sink

```ts
interface RenderSink {
  readonly name: string;
  emit(item: RenderItem): void;
  end?(state: RunState): void;
}
```

`text-sink.ts` is tier 1's only implementation. A channel in [0001](0001-non-blocking-interaction.md), a dashboard in tier 3, and a test recorder are all the same shape.

Tests use a recording sink. That is how rendering becomes testable without a terminal, and it is the practical reason the seam exists now rather than later.

## Tier 1 — the text sink, with no new dependencies

Two measurements decided the implementation:

- **`node:util` has `styleText`, and it emits no escape sequences when stdout is not a TTY.** Verified: a piped run produced zero `\x1b`. Colour costs no dependency and piped output stays clean by construction.
- **No diff library is needed.** An `edit` is an exact string replacement, so the tool already holds both sides. `oldText` and `newText` *are* the diff. A general diff algorithm would compute something already known.

What the sink does:

| | |
|---|---|
| Colour | tool names, results, errors, and the diff gutter, by severity |
| **Diffs** | removed lines red with `-`, added lines green with `+`, a `│` gutter, and the line number |
| Streaming | text streams as it arrives, and a tool call no longer starts with a hard `\n` that cuts the sentence in half |
| Per-turn line | `turn 4 · 1.8k in · 220 out · $0.0003`, dim, after each turn |
| Final summary | turns, tokens both ways, tool calls, cost, wall time |

The per-turn line is the "measures first" claim appearing in the interface rather than only in the docs. It is also the smallest honest version of what tier 3 is for.

## Tier 2 — the renderer becomes a channel

Tier 1 produces the seam. Tier 2 uses it for the part that genuinely depends on [0001](0001-non-blocking-interaction.md):

- an `interaction` renders as a **pending record** with its deadline and default action, not as a blocking prompt
- the surface stops being the only place an answer can come from
- unrelated output moves off `stdout` so a piped run carries only the answer — **done**, in tier 1, because print mode needed it anyway

Only that first point waits. The rest of the interface does not, and this spec previously claimed otherwise: it said building a UI before 0001 would put terminal assumptions where the channel boundary belongs. That was overstated.

The risk is real but it cannot materialise yet, because **the harness has no interaction point today.** The tools are `read`, `bash`, and `edit`; none of them asks a human anything. A surface built now has nothing to block on. The constraint binds at the moment 0001 introduces interactions, and the rule for that moment is the one above: the surface renders a pending record and does not own the answer path.

## Tier 3 — a dashboard, not a chat TUI

Direction, not a plan. The goal is stated here so that tiers 1 and 2 do not foreclose it.

**A surface that shows what a session is doing, per turn.** Chosen shape: a **full-screen panel toggled by a key**, rather than a side panel or a status line. It is the only one of the three that can show all four of the concepts below at once, and the cost — one keystroke to see it — is the price of that.

| Row | Source | On the wire? |
|---|---|---|
| session, cwd, model | the profile | model only |
| turns, wall time | agent events | no — a turn is not a request |
| tokens up and down, cost | `usage` per assistant message | **yes** |
| tool calls, by name, success or failure | tool events | **yes** |
| skills declared and loaded | the profile | their text only, inside the system prompt |
| components mounted, and which are degraded | 0003's provenance | **no** |
| pending interactions and their deadlines | 0001 | **no** |
| verification result | 0004's predicate | **no** |

The last four are the reason this is worth building rather than borrowing someone else's UI. No other harness has those concepts, so no other harness's interface can show them:

- **where it is stuck** — an outstanding interaction with a deadline, instead of a prompt that looks like a hang
- **what it has spent** — against a ceiling, not a number with no denominator
- **whether it is honest right now** — which components are on a fallback path
- **whether it worked** — the predicate's verdict, not the model's opinion

Which rendering technology serves that stays undecided, and the tier 1 work has narrowed it. `@earendil-works/pi-tui` is verified usable: it takes its terminal by injection, which makes the whole surface testable through a headless implementation, and `Component` is `render(width) => string[]`, a pure function. Its limits are equally clear — it has no border component, its component constructors take positional arguments so a wrong call fails silently, and nothing is themed until a theme is injected.

### The observer outside the process

Before building any of that, one alternative was measured, and it moved the boundary.

A reverse proxy in front of the model endpoint observes a session without the harness knowing it exists. [ccglass](https://github.com/jianshuo/ccglass) is the working example of the shape, and its design is the interesting part: these CLIs ignore `HTTP_PROXY`, so TLS interception is the obvious approach and the wrong one. ccglass instead **sets the client's base-URL variable**, so the client makes a plain HTTP hop to localhost and the proxy makes the HTTPS hop. No CA certificate, no certificate pinning, and nothing that breaks when the client updates, because the client's own TLS is never touched.

It renders the full system prompt, every tool schema, the message history, token/cache/cost, a turn-to-turn diff, and the agent loop — for fifteen clients, with no change to any of them.

**What it can and cannot fill is the whole point.** Reading the table above by its third column: **two rows of eight are on the wire, and four are not on it at all.** A proxy sees everything the model sees and nothing the harness knows. The concepts this spec exists for — an outstanding interaction, a degraded component, a verdict — never leave the process, because they are not sent anywhere. So the observer is not a substitute for tier 3. It is the part of tier 3 that costs nothing, and the rest is the part worth building.

There is a second measurement in the same direction, and it is a defect rather than a choice.

```js
// node_modules/@earendil-works/pi-ai/dist/providers/deepseek.js:9
baseUrl: "https://api.deepseek.com",
```

No pi-ai provider reads a base-URL variable; the only one that does is Azure OpenAI. `DEEPSEEK_BASE_URL` does nothing, so **K9999 is not observable by a proxy today**, and neither is any test that wants to stand between the harness and the network. An endpoint pinned in the provider is a harness that cannot be debugged from outside — a cost paid whether or not anyone ever runs a proxy.

The fix is measured, and small. `baseUrl` is a plain field on `Provider`, so an override preserves the rest:

```
  before:          https://api.deepseek.com
  after:           http://127.0.0.1:57633
  getModels():     still a function, 2 models
  models:          deepseek-flash, deepseek-v4-pro
  auth:            present
```

**Decision.** Tier 3 draws only what the wire does not carry. The four rows with **no** in the third column are the surface; the other four are borrowed from an observer that is better at them, because it is not the thing being observed. This is not a reduction in ambition, it is the same claim the invariant at the top already makes — the agent describes what happened, and a surface decides how it looks — applied one level out, where the description is an HTTP request.

**Consequence.** Tier 3 shrinks from eight rows to four, and the enabling change is a configurable endpoint, which is worth having on its own. Until it lands, the two rows marked **yes** are invisible to everything except the harness itself.

## Acceptance criteria

1. A test asserts a recording sink receives one `toolResult` with a `change` whose `removed` and `added` are the exact lines the edit replaced. The data reaches the sink; the sink is not where the change is computed.
2. A test asserts `text-sink` writes zero `\x1b` bytes when stdout is not a TTY.
3. A test asserts a tool call that follows streamed text does not break the text's sentence — no leading newline is written when the cursor is already at the start of a line, and one is written when it is not.
4. A test asserts the diff rendering marks removed lines and added lines distinguishably, and carries the line number.
5. A test asserts a per-turn line is emitted once per turn with the token counts the events carried.
6. A test asserts `end()` prints a summary whose totals equal the sum of the per-turn values.
7. The agent layer imports nothing from `render/`. Checked by a test that reads the module graph, not by convention.
8. A test asserts the model endpoint can be overridden, and that an override preserves the provider's model catalog and auth. The test asserts this without a network call, so it holds when the endpoint is unreachable.
9. Tier 3 renders no row whose data crossed the wire. Checked by review against the third column of the table above, because a dashboard that redraws what a proxy already shows is the duplication this section exists to prevent.

## Out of scope

- **A chat TUI.** Tier 3 is a dashboard. A general-purpose conversational TUI is a different product.

  The transcript TUI that exists borrows Pi's presentation, and the startup block, the `ctrl+o` help, and the two-line footer are Pi's shapes. The reason is that Pi is the interface its users already know, so matching it costs nothing to learn. It borrows nothing else. There is no extension host, no slash-command menu, no shell passthrough, and no update notice. The help names only the keys `tui/keys.ts` defines and the app handles, so every hint it prints is true of this harness.
- **Themes.** One dark palette, matching `site/index.html`. A theme system before a second user exists is speculative.
- **Mouse input, overlays, images in the terminal.** None are needed by any of the four concepts tier 3 exists to show.
- **Moving the dashboard into the package.** It is an interface over a session, and it is served from `site/` or a separate app until there is a reason otherwise.
- **A request inspector.** The system prompt, the tool schemas, the message history, and the turn-to-turn diff are what ccglass exists to show, and it shows them for fifteen harnesses. Rebuilding that in K9999 would be the harness observing itself, which is strictly worse at the one job — it cannot see the bytes on the wire, only the bytes it intended to send. The configurable endpoint is in scope so that the observer can attach; the observer is not.
