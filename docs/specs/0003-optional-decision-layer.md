# 0003 — An optional decision layer

**Status:** `accepted`

Depends on [0004](0004-measurement-and-budget.md). The first task is not wiring it in; it is measuring what a call costs.

## Problem

An agent makes many small decisions per turn, and the main model is the wrong instrument for all of them. Asking a frontier model whether this message is a question or an instruction spends a full round trip and a large prompt to obtain one bit, and it returns that bit inside prose that has to be parsed and can be malformed.

A decision model is the right instrument. Jev (TypeSafe AI, `jev-latest`, `POST /v1/systemone`) does not generate text; it answers named questions and returns a typed answer per question:

| Kind | Returns | Note |
|---|---|---|
| `noul` | `{ noul: number }` | A probability, not a boolean. The threshold is ours |
| `choice` | `{ choice, confidence, probabilities }` | The full distribution, not only the argmax |
| `score` | `{ score, confidence, probabilities, legend }` | `score` is an expected value and may fall between levels |

Every response carries `usage: { input_tokens, output_tokens }`.

There is a second problem, and it constrains the answer to the first. A hosted decision service is a dependency: it needs a key, a network, and a vendor that keeps running. A harness that only works with it is a harness that stops working without it. And an owner who has no TypeSafe key should still get a harness, not a configuration error.

## Invariant

**Every decision point has a working path with the decider switched off.**

The decider is an optimisation and a classifier. It is never the only way a decision gets made. Any decision point that cannot be expressed without it is a design error, not a configuration requirement.

Two more follow from that:

- The decider is **off by default**. No key is presumed to exist.
- Turning it off changes how a decision is reached, never whether a decision is reached safely.

## Optional, and honest about it

`profiles/<id>/profile.json` declares the decision layer:

```json
{
	"name": "Code Agent",
	"tools": ["read", "bash", "edit"],
	"decider": "off"
}
```

| Value | Behavior |
|---|---|
| `"off"` (default) | Every decision point takes its off-path. No network, no key |
| `"jev"` | Decision points that benefit from it call Jev; the rest keep their off-path |

`K9999_DECIDER` overrides the profile. `TYPESAFE_API_KEY` or `SYSTEMONE_API_KEY` supplies the credential.

**Selecting `"jev"` without a usable key fails at load, loudly.** It does not fall back to `"off"`. A run that quietly used the off-path while its configuration said otherwise would report numbers that describe something other than the configuration under test, which is the failure this whole spec exists to prevent. Runtime failures are different and are handled per decision point below.

## The off-path, per decision point

"Off" is not a null. Each point states what happens without a decider, and the answer is a real behavior that a test can drive.

| Decision | With `"jev"` | With `"off"` |
|---|---|---|
| Is this message a question needing a human, or an instruction to act on? | `noul`, fail open: ask | The agent asks, as it does today. [0001](0001-non-blocking-interaction.md) makes asking non-blocking, so this stays workable without a decider |
| Which tools does this turn need? | one `noul` per tool | The profile's declared tools are all used. No saving, no risk |
| Is this command irreversible? | `noul`, **fail closed: refuse** | The static allowlist ([0002](0002-reversibility-not-modes.md)) decides; anything it cannot classify falls to the floor and is treated as irreversible |
| Does the tool output satisfy the goal, or is another step owed? | `score`, fail open: continue | The model decides by stopping or asking for another step, which is its normal behavior |
| Is this task hard enough to warrant a larger model? | `score`, fail open: use the configured model | The profile's model is used |

The reversibility row is the one that matters most. **Safety does not depend on the decider.** The allowlist and the floor are local and free, and they are what protect an unattended run. The decider only improves the classification of commands the allowlist cannot reach, which is a quality improvement on top of a gate that already works.

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

Three result shapes, because there are three real outcomes, and `off` is not one of them: with the decider off, no call is made and no result is produced. Collapsing `degraded` into `decided` is how a measurement silently becomes wrong.

Two non-production implementations are required from the start:

- `scriptedDecider`, so decision paths are testable without a network.
- `offDecider`, which is the default and makes the off-paths explicit rather than the absence of a call.

## Six rules, taken from a shipped implementation

`pi-mcp-adapter` already uses Jev for tool search. These come from its code rather than from first principles.

1. **Deterministic code narrows; the decider chooses.** Its lexical ranker reduces the candidate set before Jev sees anything. Never send every tool. This bounds cost and keeps facts out of the model.
2. **Always include an escape label.** Its choice criteria end with `none`. A forced choice returns a wrong answer, not no answer.
3. **Read the distribution, not the argmax.** It ranks by `probabilities[id]`, so a near-tie is visible instead of hidden behind a label.
4. **Optimizations fail open, safety fails closed.** On timeout, rate limit, or outage it falls back to lexical search and reports the degradation. The same outage on a reversibility decision denies.
5. **Report degradation, never hide it.** It returns `{ requested: "semantic", used: "lexical", degraded: true, reason }`.
6. **Treat the response as untrusted.** It validates exact key sets, probability ranges, and that `choice` names a supplied label. An external service's answer is input.

Plus one it does and any harness must: **a data policy gate.** It sends nothing from an MCP server the operator has not allowed, and carries `sources` on every call. An external decision API receives agent context; every call must be accountable for what it disclosed.

## What may not be asked

**Anything decidable by code is not a decision.** Whether a reply contains an em-dash is a regular expression. Whether tests passed is an exit code. Whether a file exists is a `stat`. Sending a decidable fact to a model buys variance and latency in exchange for nothing.

The permitted list is the table above. It grows only by adding a row with a stated off-path, a failure mode, and a test.

## Provenance

A run records which decider was active, beside the `reported`/`estimated` label from [0004](0004-measurement-and-budget.md).

Turning the decider on and off is the A/B that justifies the dependency, so runs with different component sets must not be subtracted from one another. `buildReport` treats a differing component set the way it treats a degraded run: it names the difference, prints the absolute totals, and computes no delta.

## Acceptance criteria

1. A probe reports p50 and p95 round-trip latency and the token cost of a one-question call, before any decision path depends on it.
2. A test asserts the default configuration makes no network call: every task in the scripted suite runs with the decider off and succeeds.
3. A test asserts each decision point's off-path is exercised and reaches a decision. A point whose off-path is unreachable has not been implemented.
4. A test asserts selecting `"jev"` without a key fails at load rather than running with the off-path.
5. A test asserts a decision below its configured confidence threshold escalates to the main model rather than acting.
6. A test asserts a `degraded` result appears in the run record, and that a report refuses to compare a degraded run against a healthy one without saying so.
7. A test asserts a response naming a label outside the supplied criteria is rejected, not clamped.
8. A test asserts a call whose `sources` include a disallowed origin is refused before the request is sent.
9. A test asserts that with the decider unreachable at runtime, the reversibility path denies and the tool-routing path declares every tool.
10. A test asserts a report mixing decider-on and decider-off runs computes no delta.

## Out of scope

- Deciding anything decidable by code. See above.
- Training or fine-tuning. Jev is called, not modified.
- Using a decider to grade output quality for the eval. The success predicate must be defined outside the thing being measured, and a model grader is inside it.
- A fallback to a local model when Jev is unavailable. Off-paths already exist for exactly this situation; adding a third source of judgment adds a third failure mode.
- Making the decider required anywhere. See the invariant.
