# 0001 — Non-blocking interaction

**Status:** `accepted`

## Problem

An agent kernel that asks a human a question by awaiting a promise has exactly one place the answer can come from. Every other channel hangs until that one answers.

This is not a defect in any particular integration. It is what `await` means. Pi's WeChat bridge stalls for this reason: the agent calls a confirmation in the terminal, nobody is at the terminal, and the WeChat side waits forever for a turn that will never finish.

A second, quieter failure comes from the same root: an unattended agent that blocks on a question is indistinguishable from an agent that crashed.

## Invariant

**The core never blocks on a human.**

Every human interaction is a durable record that is addressable, has a deadline, and has a default action. Nothing in the core awaits an answer.

Three consequences follow, and each one is a separate acceptance criterion:

- an interaction survives process death, because it is a record rather than a stack frame
- any channel may answer it, because the record carries no reference to the channel that asked
- an unanswered interaction resolves anyway, because it has a deadline and a default

## Interface

### Channel

```ts
interface Channel {
  readonly id: string;
  /** Deliver an interaction request. Resolves once delivered, not once answered. */
  deliver(interaction: Interaction): Promise<DeliveryReceipt>;
  /** Register the handler that claims interactions. At most one channel may claim a given interaction. */
  onReply(handler: (reply: Reply) => Promise<ClaimResult>): Disposable;
}
```

`deliver` resolves on delivery. It must not resolve on an answer, because that reintroduces the promise the invariant removes.

### Interaction

```ts
interface Interaction {
  readonly id: string;
  readonly kind: "question" | "approval";
  readonly prompt: string;
  readonly options: readonly InteractionOption[];
  /** Absolute deadline. Required: an interaction without one can block forever by another name. */
  readonly deadline: string;
  /** Applied when the deadline passes with no reply. Required, and never "wait longer". */
  readonly defaultAction: InteractionOption["id"];
  /** Set by the first channel to answer. Later replies are rejected, not merged. */
  readonly claimedBy?: string;
}

interface Reply {
  readonly interactionId: string;
  /** Channel-side message identity, used for deduplication. Required. */
  readonly channelMessageId: string;
  readonly optionId: string;
}

type ClaimResult =
  | { status: "claimed" }
  | { status: "already_answered"; by: string }
  | { status: "expired" }
  | { status: "duplicate" }
  | { status: "unknown_interaction" };
```

`channelMessageId` is required, not optional. WeChat redelivers messages. Without an identity to deduplicate on, a redelivered message starts a second turn.

### Suspension

The interaction is written durably, and the turn suspends rather than awaiting.

> **Correction, and it changes the plan.** This section previously said to
graduate from `Agent` to `AgentHarness`, and listed the primitives it would
provide: a durable `suspended` run outcome, `resume()`, `getLastResult()`, and an
inbox with distinct `steer`/`followUp`/`nextRun` semantics.
>
> **`AgentHarness` is not published.** `pi-agent-core` 1.0.2 and 1.0.4 both
> export exactly five modules — `agent`, `agent-loop`, `proxy`, `stream-fn`,
> `types` — and no package under `@earendil-works` contains the name. The
> `harness/` subtree with `agent-harness.ts` and `compaction/` exists in the
> 0.84.2 source checkout and was removed before 1.0.x shipped. The table above
> described a source tree this project does not depend on.
>
> The reading was taken from a repository checkout rather than from the
> installed package, which is the same mistake as assuming a feature from a
> version number. `packages/cli/src/context.ts` carries the smaller version of
> it: a context-token helper written locally because 1.0.2 publishes none.

> **Second correction, and it resolves the question.** The paragraph above
> checked one package and one name, and concluded that the capability was
> unpublished. It is published. **`@earendil-works/pi-durable`** — "a durable
> agent harness. Conversations, model turns, tool calls, and your own state are
> committed to storage before anything is shown. If the process dies mid-turn,
> reopening the storage picks the work up where it stopped" — ships every
> primitive this spec needs, under `harness/`:
>
> - `harness/inbox` — `steer` / `followUp` / `write` modes, placed at
>   `postTools` or `final` boundaries, with withdrawal settling `aborted`
> - typed immutable entries with `head: "self"` resets and compaction
> - a `Storage` seam with memory, JSONL, and SQLite backends, and
>   `prepareCommit` carrying a sequence number
> - idempotent submissions by `requestId`, and `resume()`
>
> The name `AgentHarness` was never the thing to look for. The capability was,
> and it was one package over. [ADR-0017](../decisions.md) records the decision
> to adopt it and its cost.

The substrate has to come from somewhere, and there are three answers:

| Option | Cost |
|---|---|
| **Build the durable layer here.** A `Storage` seam over entries and registers, an operation state that is total after every transition, and a `resume()` that reads it. This is the work `AgentHarness` was going to do for us: the largest item in the project so far | Weeks, and it is the part every harness gets wrong the first time |
| **Depend on a version that has it.** Nothing published does. `0.74`–`0.80` are on npm; whether any carries `harness/` is unchecked and would be a step backwards in the model layer | A version pin against the rest of the project, for an unverified asset |
| **Narrow the spec.** Suspension survives process death only if the durable layer exists. Without it, the honest version is: interactions are records with deadlines and defaults, answered from any channel, and a turn that is interrupted is **lost** rather than resumed — with that stated in the interface rather than implied | Loses the property the WeChat case actually needed |

**Resolved.** The substrate is adopted rather than built, and the table above is kept because its second row is now the interesting one: the answer was published, in a package this project had not opened, and the option it rejected — "depend on a version that has it" — was the right shape with the wrong target. It is not a version pin to an old release; it is `pi-durable` `1.0.4`, which requires `pi-ai` `^1.0.4` and brings `chord` with it. [ADR-0017](../decisions.md) takes that trade knowingly.

What this removes from the spec is not the design, it is the implementation. Interactions are still records with an address, a deadline, and a default action, and the section below still describes them. What changes is that the record is committed to storage by `pi-durable` before it is shown, and `resume()` is its function rather than ours.

## Default actions

A default is not a guess. It is the answer the agent is allowed to give itself.

| Interaction | Default | Why |
|---|---|---|
| Approval of an irreversible operation | `deny` | Failing closed on an unattended destructive action is the only safe default |
| A question the agent could have answered from context | `proceed_with_assumption` | The turn continues and the assumption is logged in the trace |
| A question only a human can answer | `stop_and_report` | Ends the turn cleanly with the reason stated |

`proceed_with_assumption` and `stop_and_report` both require the reason to be recorded. A default that acts silently is worse than a block, because it is invisible.

## Acceptance criteria

1. A test asserts every `Interaction` constructed by the core carries a `deadline` and a `defaultAction`. Any path that constructs one without both fails the type check or the test.
2. A test drives an interaction through a fake channel, kills the process before replying, restarts, replies, and asserts the turn resumes and the reply is attributed to the answering channel.
3. A test delivers the same `channelMessageId` three times and asserts exactly one turn runs.
4. A test has two channels reply to one interaction and asserts the first wins and the second receives `already_answered`.
5. A test advances time past a deadline with no reply and asserts the `defaultAction` is applied and appears in the trace.
6. No test in the suite can hang: every await has a deadline. A test that times out is a failure, not a slow pass.

## Out of scope

- A web UI. The channel interface admits one later; building it now adds a third surface before the first two are stable.
- Rich interaction types beyond `question` and `approval`. A third kind is added when a real case needs it.
- Human-to-human handoff, or any notion of who a human is. Channels identify themselves; identity is not modelled.
