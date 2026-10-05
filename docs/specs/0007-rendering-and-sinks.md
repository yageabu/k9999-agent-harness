# 0007 — Rendering: a vocabulary, a sink, and a dashboard

**Status:** `accepted`

Tiers 1 and 2 are the work. Tier 3 is a direction, recorded so it is not rediscovered.

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

Tier 1 produces the seam. Tier 2 uses it, and lands with [0001](0001-non-blocking-interaction.md) rather than before it:

- an `interaction` renders as a **pending record** with its deadline and default action, not as a blocking prompt
- the text sink becomes one channel among peers, not the only place an answer can come from
- unrelated output moves off `stdout` so a piped run carries only the answer

Doing this before 0001 would write "the terminal is where answers come from" into the UI, which is the bug 0001 exists to remove.

## Tier 3 — a dashboard, not a chat TUI

Direction, not a plan. The goal is stated here so that tier 1 and 2 do not foreclose it.

**A surface that shows what a session is doing, per turn:**

| Column | Source |
|---|---|
| turn number, wall time | agent events |
| tokens up and down, cost | `usage` per assistant message |
| tool calls, by name, success or failure | tool events |
| skills declared and loaded | the profile |
| plugins mounted, and which are degraded | 0003's component provenance |
| pending interactions and their deadlines | 0001 |
| verification result | 0004's predicate |

The last four are the reason this is worth building rather than borrowing someone else's UI. No other harness has those concepts, so no other harness's interface can show them:

- **where it is stuck** — an outstanding interaction with a deadline, instead of a prompt that looks like a hang
- **what it has spent** — against a ceiling, not a number with no denominator
- **whether it is honest right now** — which components are on a fallback path
- **whether it worked** — the predicate's verdict, not the model's opinion

Which rendering technology serves that is deliberately undecided. Reusing `@earendil-works/pi-tui` (verified usable standalone: it imports cleanly from npm and measures terminal width correctly for wide characters) is one option; a browser surface over the existing JSON event stream is another, and needs no terminal at all. The choice should be made when 0001's channel interface exists, so the answer can be "whichever implements that interface cleanly".

## Acceptance criteria

1. A test asserts a recording sink receives one `toolResult` with a `change` whose `removed` and `added` are the exact lines the edit replaced. The data reaches the sink; the sink is not where the change is computed.
2. A test asserts `text-sink` writes zero `\x1b` bytes when stdout is not a TTY.
3. A test asserts a tool call that follows streamed text does not break the text's sentence — no leading newline is written when the cursor is already at the start of a line, and one is written when it is not.
4. A test asserts the diff rendering marks removed lines and added lines distinguishably, and carries the line number.
5. A test asserts a per-turn line is emitted once per turn with the token counts the events carried.
6. A test asserts `end()` prints a summary whose totals equal the sum of the per-turn values.
7. The agent layer imports nothing from `render/`. Checked by a test that reads the module graph, not by convention.

## Out of scope

- **A chat TUI.** Tier 3 is a dashboard. A general-purpose conversational TUI is a different product, and building one is what would make this look like a Pi reskin.
- **Themes.** One dark palette, matching `site/index.html`. A theme system before a second user exists is speculative.
- **Mouse input, overlays, images in the terminal.** None are needed by any of the four concepts tier 3 exists to show.
- **Moving the dashboard into the package.** It is an interface over a session, and it is served from `site/` or a separate app until there is a reason otherwise.
