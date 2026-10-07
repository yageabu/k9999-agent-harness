# What K9999 is

**An agent application that is evaluatable, observable, safely bounded, and
continuously iterating — with memory that outlives a session, including a project
wiki it maintains itself.**

That sentence is the product. Everything below says what each part means, what
exists today, and what does not. It is written in that order on purpose: the
repository's rule is that unbuilt work is described and never quantified, and a
positioning statement is the easiest place in a project to break that rule
without noticing.

## Why these four, and where they sit

[ADR-0017](decisions.md) moved the harness layer to `pi-durable`. That raised the
question this page answers — if something else owns durability, sessions, the
agent loop, and the inbox, what is K9999?

The answer is that all four properties live **above** the harness, and
`pi-durable` is deliberately opinion-free about every one of them:

| Property | `pi-durable` has | Which is why it is K9999's |
|---|---|---|
| Evaluatable | `usage`: tokens and cost | It has no verdict, no budget, and no task set. A number is not a judgment |
| Observable | `viewState()`, `watchEvents()` | It has no rendering opinion at all. A state stream is not a surface |
| Safely bounded | whatever `env` you hand it | It asks you to build the execution environment. It does not ask who may use it |
| Continuously iterating | documents and compaction | It has no concept of remembering, only of storing |

So the definition is not a list of features bolted onto a library. It is the
answer to what layer this project occupies, and why it is not a configuration of
the thing underneath it.

## The four properties

### Evaluatable

**What it means.** A result is judged by something that is not the model's
opinion of itself.

**What exists.** `packages/eval`: task loading, verdict predicates, JSONL
transcripts, offline replay, budgets, and comparison reports that refuse to
report a delta across runs whose conditions differ. Per-turn and per-run cost
come from `pi.usage`. [SPEC 0004](specs/0004-measurement-and-budget.md) is
`building`.

**What does not.** `probe` mode, and every figure from a real provider. Today the
suite runs against a scripted provider, so the harness is built and unproven —
which is stated in the README rather than papered over.

### Observable

**What it means.** What a session is doing is legible while it runs, from more
than one place, and without changing the agent.

**What exists.** [SPEC 0007](specs/0007-rendering-and-sinks.md)'s vocabulary and
sink seam, the terminal surface with its header and transcript, and
[SPEC 0009](specs/0009-web-interface.md)'s browser surface with its view stream.

**What does not.** The rendering vocabulary still speaks `RenderItem`, produced
by a translator listening to `pi-agent-core` events. `pi-durable` has a
`ConversationView` and an `AgentEvent` stream instead, so the translator is on
the list of things to port rather than to keep.

### Safely bounded

**What it means.** The agent cannot read a credential it was not given, cannot
take an action the operator did not allow, cannot send what it read to somewhere
it was not told to, and what it did can be read back afterwards.

**What exists.** One link: the browser surface binds loopback, requires a token,
checks `Origin`, and serves no write route unless asked.

**What does not exist is the rest of the chain, and one link is a confirmed
hole.** The bash tool spawns with no `env` option, so the child inherits the
whole process environment — which means `printenv DEEPSEEK_API_KEY` returns the
key, the result is committed to the transcript, and the transcript is sent to
the provider on the next turn. It is not a hypothetical: it is one command away,
and the storage keeps it.

| Link | State |
|---|---|
| Credential isolation | **Open** — tool subprocesses see every environment variable |
| A permission gate | **Open** — `rm -rf` runs |
| Network egress | **Open** — nothing restricts where a command may connect |
| An audit trail | **Open** — no record of which command ran against which revision |

### Continuously iterating

**What it means.** A session's outcome changes the next session's inputs, and the
change is attributable — you can say what the agent believed, when it started
believing it, and on what evidence.

**What exists.** Nothing. There is no memory beyond the transcript of one
session, and the transcript ends with the session.

**Why it is not "learning" in the model sense.** Nothing is trained. What carries
forward is text: observations that were written down, scored, and recalled by
relevance.

## Memory and the wiki

Two scopes, one mechanism, and the distinction matters because getting it wrong
produces two stores that disagree about the same facts — the failure
[ADR-0012](decisions.md) records.

| | Memory | The wiki |
|---|---|---|
| **Scope** | the agent | the project |
| **Subject** | what this agent has learned: what the user prefers, what worked, what failed and why | what this project is: how it is built, what was decided, where the traps are |
| **Travels with** | the agent, across projects | the project directory |
| **Profile** | every agent | coding agents; a data agent has no architecture to document |
| **Shape** | ranked observations recalled by relevance | readable documents, advertised and loaded on demand, like a skill |
| **Written by** | the agent | the agent |

Both are `pi-durable` documents, which is what makes this one mechanism rather
than two. `version` and `migrate()` are what make them *dynamic*: the stored
shape can change without a migration script per install. `history: "rewindable"`
and `snapshotAsOf()` are what make them *attributable*: you can read what the
agent believed at any earlier entry, which is the difference between memory and
an undated pile of assertions.

### The problem with an agent that writes its own wiki

It will write things that are wrong, and a wrong wiki is worse than no wiki,
because it is loaded into context and believed.

This is the same failure [SPEC 0004](specs/0004-measurement-and-budget.md) exists
to prevent — a verdict that is the model's opinion of its own output — arriving
through a different door. The answer is the same shape as that spec's:

**A claim carries its evidence.** A wiki statement points at something checkable:
a path, a revision, a command that was run, an entry that recorded the decision.
A claim whose evidence no longer exists is marked stale rather than trusted, and
stale claims are shown to the agent as stale. An entry that cannot point at
anything is not a fact about the project; it is a note, and it is stored as one.

A second consequence follows from `history: "rewindable"`: because the agent
maintains the wiki across sessions, the wiki needs a *diff* a person can read.
Not a rendered document — a list of what changed, on what evidence, in which
session.

## What is built, in one table

| | Exists | Does not |
|---|---|---|
| Evaluatable | the harness, predicates, replay, budgets | `probe`, real-provider figures |
| Observable | the vocabulary, the sink seam, TUI, browser | the port to `pi-durable`'s view |
| Safely bounded | the browser surface's four rules | credential isolation, a permission gate, egress, audit |
| Continuously iterating | — | all of it |
| Memory | — | all of it |
| The wiki | a `skills/` directory holding one README | the mechanism, the authoring, the diffs |

Three of six have code. The other three are specifications first, which is the
order this repository works in: a spec states the invariant, the acceptance test,
and what is out of scope, and code follows. A positioning statement that read as
though all six existed would be the twelfth instance of the mistake
[ADR-0012](decisions.md) is about.
