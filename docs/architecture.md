# Architecture

What the pieces are, what each one owns, and where the seams are. Written because
[ADR-0017](decisions.md) moved the harness layer and the repository now carries
two of them at once.

## The stack

```text
  surfaces            what a person looks at
  ────────────────────────────────────────────────────────────────────────
    web (packages/web)     TUI (packages/cli/src/tui)     print / eval
         │                            │                        │
  ───────┴────────────────────────────┴────────────────────────┴──────────
  K9999               what this project is for
  ────────────────────────────────────────────────────────────────────────
    profiles/          one agent type per directory: a declaration + a prompt
    prompt assembly    authored text + generated tool and skill sections
    the sink seam      RenderItem vocabulary; a sink decides how it looks
    measurement        tasks, verdict predicates, transcripts, replay, budgets
    launch identity    two names, two agent types, one implementation
         │
  ───────┴────────────────────────────────────────────────────────────────
  harness             durable operation of an agent
  ────────────────────────────────────────────────────────────────────────
    pi-durable         sessions, storage, the inbox, task graph, compaction,
                       usage, resume. 13,979 lines
         │                    │
         │                    └──▶ chord     composition runtime, transitively
         │
  ───────┴────────────────────────────────────────────────────────────────
  model boundary      a list of messages becomes a stream of tokens
  ────────────────────────────────────────────────────────────────────────
    pi-ai              providers, models, streaming, tool-argument validation
         │
  ───────┴────────────────────────────────────────────────────────────────
    the model          HTTP, credentials, tokens, cost
```

**The harness manages what is above `pi-ai`, and not the model.** That is the
right way to state it, and it is worth being exact about what "above" contains:
not the model, and not the prompt — **state and policy**. Which turns happened,
which tool calls are outstanding, what has been spent, what happens when the
process dies, and what a queued input does when the conversation is busy. `pi-ai`
has no opinion about any of that; it turns messages into tokens and reports
usage.

## The fork, which is temporary and is the current state

`pi-durable` **does not depend on `pi-agent-core`**. It imports `chord` and
`pi-ai` and builds its own generation and tool loops. So the two are siblings,
not layers, and today they both sit under K9999:

```text
                    K9999
                      │
        ┌─────────────┴─────────────┐
        │                           │
   pi-durable                  pi-agent-core
        │                           │
     chord ──▶ pi-ai ◀──────────────┘
```

| Path | Used by | Status |
|---|---|---|
| `pi-durable` | `packages/web` | the destination |
| `pi-agent-core` | `packages/core`, `packages/cli`, `packages/eval` | what is being replaced |

`packages/core/src/harness.ts` builds a `pi-agent-core` `Agent`.
`packages/core/src/tools/*.ts` import its `AgentTool` type.
`packages/cli/src/render/translate.ts` imports its `AgentEvent`.
`packages/web` uses `pi-durable`'s `Conversation` and never touches
`pi-agent-core`.

Two harness layers in one repository is the transition [ADR-0017](decisions.md)
describes, and it is not a resting state. When `packages/core` moves, the lower
half of that diagram has one branch:

```text
   pi-durable ──▶ chord
        └────────▶ pi-ai
```

`pi-agent-core` then has no remaining role. Three of the four things K9999 takes
from it today have an equivalent in `pi-durable` — `AgentEvent` exists there in a
different shape (`harness/events.ts`), `Agent` exists as the per-conversation
resolution, and a tool is `defineTool` rather than `AgentTool` — so the move is a
port rather than a rewrite of the ideas.

## Where each thing lives

| Concern | Owns it | Why there |
|---|---|---|
| What a token costs, and how many there were | `pi-ai`, reported upward | only the provider knows |
| What has been spent this conversation, and per tool | `pi-durable` (`pi.usage`) | it is committed state |
| Which turns happened, and what is outstanding | `pi-durable` (`entries`, `pi.live`, `pi.inbox`) | same |
| Surviving a crash mid-turn | `pi-durable` (`resume()`) | it owns the storage |
| Which agent type is running, and what its prompt says | K9999 (`profiles/`) | a product decision |
| What a person sees, and in what shape | K9999 (the sink seam) | `pi-durable` has no rendering opinion |
| Whether a result was any good | K9999 (verdict predicates) | a model's opinion of itself is not evidence |
| When a question expires and what happens then | K9999 ([SPEC 0001](specs/0001-non-blocking-interaction.md)) | `pi-durable` has a queue, not a deadline |

The last two rows are the point. `pi-durable` has an inbox with `steer` and
`followUp`; it has no concept of an interaction that expires and carries a
default action. It has `usage`; it has no concept of a budget or of a task whose
verdict is a predicate rather than a model's summary. Those are the theses, and
none of them moved.

## The surfaces, and what a plugin would mean

A surface is anything that reads the harness and, sometimes, writes to it.
There are three ways to add one, and they are not variations of each other.

**1. A sink, in process.** `RenderSink` from [SPEC 0007](specs/0007-rendering-and-sinks.md):
`emit(item)` and `end(state)`. This is what the text renderer is. One-way, no
transport, no lifecycle. The right shape when the surface *is* the process.

**2. A consumer of the view, out of process.** What `packages/web` is:
`Conversation.watch()` for state, `submit()` and `abort()` for writes, over
whatever carries bytes. The server is a program, not a plugin — it opens its own
`Harness` and owns its own port, token, and threat model. The seam is the
`Conversation` interface.

**3. A chord facet, if the surface must share a process boundary with the host.**
Chord's stated motivating case is exactly this — "an agent worker, a terminal UI,
and a remote WebUI" — and its mechanism is: a host runs facets, facets declare
typed services, and a service can be exposed to another environment through
`services/provider` and `services/consumer` over an application-supplied adapter,
with `state-codec` and `wire` carrying it.

Option 3 is what "make the Web a plugin" means in this stack, and it is a real
option with a real cost. Chord has no browser-ready entry point: its exports are
`.`, `./context`, `./delta`, `./bundler`, `./node`. A browser facet means
shipping `./delta`, `services/consumer`, and `state-codec` to the browser and
writing the adapter — and it reverses the part of [ADR-0017](decisions.md) that
says K9999 writes no facets.

**The test for which one applies.** Option 3 buys one thing: surface state that
must be *replicated* and *remotely callable* rather than merely *sent*. Today's
web surface sends a view and posts three things, so option 2 is enough. If a
second surface ever needs to watch and drive the same conversation at the same
time — a TUI and a browser on one run — that is the case chord exists for, and
the answer is a facet rather than a second server.

## Rules that hold across the diagram

1. **`packages/core` never imports `packages/cli`, `render/`, or `tui/`.** Checked
   by a test that reads the module graph.
2. **Nothing above the sink knows about terminals, columns, or colour.**
3. **Nothing below the sink knows about a surface.** `pi-durable` does not know a
   browser exists; `packages/web` is where that knowledge lives.
4. **A surface holds no authority.** Everything it draws was committed before it
   was sent, and everything it sends is a submission the harness may queue,
   reject, or refuse.
