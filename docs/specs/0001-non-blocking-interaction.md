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

The interaction is written durably, and the turn suspends rather than awaiting. `AgentHarness` already provides the substrate:

| Need | Provided |
|---|---|
| Suspend a turn without holding a stack frame | `RunOutcome` variant `{ kind: "suspended", reason: "deferred" }` |
| Continue after the answer arrives | `resume()` |
| Recover an outcome after the process died | `getLastResult()`, reading the `lane.lastResult` register |
| A queue with distinct semantics | `steer()`, `followUp()`, `nextRun()`, `cancelQueued()` |

This is the reason to graduate from `Agent` to `AgentHarness`. It is recorded as a decision with its own cost, not as a refactor.

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
