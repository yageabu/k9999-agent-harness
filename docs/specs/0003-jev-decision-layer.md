# 0003 — Jev decision layer

**Status:** `accepted`

Depends on [0004](0004-measurement-and-budget.md). The first task is not wiring it in; it is measuring what a call costs.

## Problem

An agent makes many small decisions per turn, and the main model is the wrong instrument for all of them. Asking a frontier model whether this message is a question or an instruction spends a full round trip and a large prompt to obtain one bit, and it returns that bit inside prose that has to be parsed and can be malformed.

Jev (TypeSafe AI, `jev-latest`, `POST /v1/systemone`) is a decision model: it does not generate text, and it returns a typed answer per named question. Three question kinds:

| Kind | Returns | Note |
|---|---|---|
| `noul` | `{ noul: number }` | A probability, not a boolean. The threshold is ours |
| `choice` | `{ choice, confidence, probabilities }` | The full distribution, not only the argmax |
| `score` | `{ score, confidence, probabilities, legend }` | `score` is an expected value and may fall between levels |

Every response carries `usage: { input_tokens, output_tokens }`.

## Why this beats a general judging model

| Concern with a judging LLM | What Jev provides |
|---|---|
| Its own cost is unknown, so savings cannot be proven | `usage` on every response |
| The answer must be parsed out of prose | A typed value, no parsing step |
| A wrong judgment has no remedy | `confidence` and `probabilities`, so a threshold can escalate to the main model |

The third point is the important one. It turns "the decider might be wrong" from a risk into a tunable threshold with a measurable error rate.

## Interface

Jev is one implementation of an interface, never a direct import:

```ts
interface Decider {
  /** The decision, with the confidence that produced it and what it cost. */
  decide<Q extends Questions>(request: DecisionRequest<Q>, options?: { signal?: AbortSignal }): Promise<DecisionResult<Q>>;
}

type DecisionResult<Q> =
  | { status: "decided"; answers: Answers<Q>; model: string; usage: Usage; source: "jev" }
  | { status: "degraded"; reason: DegradeReason; fallback: string; source: "jev" }
  | { status: "unavailable"; reason: DegradeReason };
```

A second implementation is required from the start: a scripted `Decider` for tests. Without it, every test of a decision path needs a network call, and the decision paths stop being tested.

`DecisionResult` has three shapes because there are three real outcomes. Collapsing `degraded` into `decided` is how a measurement silently becomes wrong.

## Six rules, taken from a shipped implementation

`pi-mcp-adapter` already uses Jev for tool search. These rules come from its code rather than from first principles.

1. **Deterministic code narrows; the decider chooses.** Its lexical ranker reduces the candidate set before Jev sees anything. Never send every tool. This bounds cost and keeps facts out of the model.
2. **Always include an escape label.** Its choice criteria end with `none`. A forced choice returns a wrong answer, not no answer.
3. **Read the distribution, not the argmax.** It ranks by `probabilities[id]`, so a near-tie is visible instead of hidden behind a label.
4. **Optimizations fail open, safety fails closed.** On timeout, rate limit, or outage it falls back to lexical search and reports the degradation. The same outage on a reversibility decision must deny.
5. **Report degradation, never hide it.** It returns `{ requested: "semantic", used: "lexical", degraded: true, reason }`. The eval records this, because a degraded run's numbers are not comparable to a healthy run's.
6. **Treat the response as untrusted.** It validates exact key sets, probability ranges, and that `choice` names a supplied label. An external service's answer is input.

Plus one it does and any harness must: **a data policy gate.** It sends nothing from an MCP server the operator has not allowed, and carries `sources` on every call. An external decision API receives agent context; every call must be accountable for what it disclosed.

## Where decisions are made

| Decision | Kind | Failure mode | Justified by |
|---|---|---|---|
| Is this message a question needing a human, or an instruction to act on? | `noul` | fail open: ask | 0001 — reduces blocking at the source |
| Which tools does this turn need? | one `noul` per tool | fail open: declare all | 0004 — the token saving |
| Is this command irreversible? | `noul` | **fail closed: refuse** | 0002 |
| Does the tool output satisfy the goal, or is another step owed? | `score` | fail open: continue | 0001 |
| Is this task hard enough to warrant a larger model? | `score` | fail open: use the configured model | 0004 |

## Rules about what may not be asked

**Anything decidable by code is not a decision.** Whether a reply contains an em-dash is a regular expression. Whether tests passed is an exit code. Whether a file exists is a `stat`. Sending a decidable fact to a model buys variance and latency in exchange for nothing.

The list of things the decider may be asked is short, and it grows only by adding a row to the table above with a stated failure mode and a test.

## Acceptance criteria

1. A probe reports p50 and p95 round-trip latency and the token cost of a one-question call, before any decision path depends on it. The probe is committed; the numbers it produces are cited on the product page with the command that regenerates them.
2. A test asserts a `decision` below its configured confidence threshold escalates to the main model rather than acting.
3. A test asserts a `degraded` result appears in the run record, and that a report refuses to compare a degraded run against a healthy one without saying so.
4. A test asserts a response naming a label outside the supplied criteria is rejected, not clamped.
5. A test asserts a call whose `sources` include a disallowed origin is refused before the request is sent.
6. A test asserts that with the decider unreachable, the reversibility path denies and the tool-routing path declares every tool.

## Out of scope

- Deciding anything decidable by code. See above.
- Training or fine-tuning. Jev is called, not modified.
- Using Jev to grade output quality for the eval. The eval's success predicate must be defined outside the thing being measured, and a model grader is inside it.
- A fallback to a local model when Jev is unavailable. Fail-open and fail-closed are the two available answers; a third source of judgment is a third failure mode.
