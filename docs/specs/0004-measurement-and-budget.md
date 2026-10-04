# 0004 — Measurement and budget

**Status:** `accepted`

This is built first. Nothing else in the roadmap can be justified without it.

## Problem

"Fewer tokens, same performance" is not a claim until both halves are measurable. Right now neither is:

- Every figure on the product page comes from somewhere else. The startup latency was measured once by hand, and the output-rule table is another project's published study.
- A change that shortens a prompt can increase total cost, because a shorter unstable prefix breaks provider-side prompt caching while a longer stable one does not. Nothing in the repository can currently detect that.
- The cheapest failure mode to miss is the one where a saving is real and the task takes two more turns to finish. Token count alone reports that as a win.

There is a precedent in this repository. Decision record 0007 rejects ASD-STE100 as an instruction because a study measured it and the intuition lost. That outcome was available only because someone had a harness. Without one, the same intuition would still be in the prompts.

## Invariant

**No optimisation is merged without a before-and-after measurement over a fixed task set, and success is defined outside the thing being measured.**

## Two modes

| Mode | Answers | Runs |
|---|---|---|
| `probe` | What does one call cost in latency and tokens? | A micro-benchmark of one component, no task semantics |
| `task` | Did the work get done, and at what cost? | A fixed task set end to end |

The Jev latency probe in [0003](0003-optional-decision-layer.md) is a `probe`. Comparing tool routing against declaring every tool is a `task` run.

## Layout

```
packages/eval/
├── src/
│   ├── task.ts       a task: prompt, fixture, success predicate
│   ├── runner.ts     runs one configuration over the task set
│   ├── record.ts     the JSONL transcript of one run
│   ├── replay.ts     re-runs a recorded transcript with no network
│   ├── metrics.ts    input/output/decider tokens, turns, wall time, cost
│   └── report.ts     compares configurations, with deltas
├── tasks/<name>/     task.json + fixture/
└── probes/<name>/    a micro-benchmark
```

## Metrics

Recorded per run, all of them. A report that shows one is not a report.

| Metric | Why it is here |
|---|---|
| `inputTokens` | The axis most optimisations target |
| `outputTokens` | The axis the output rules target |
| `deciderTokens` | A decision layer's own cost; excluding it makes savings unfalsifiable |
| `turnsToComplete` | **Where "same performance" lives.** A saving that costs a turn is a loss |
| `wallMs` | Interactive and unattended channels value this differently |
| `costUSD` | The only figure that combines the above without hiding a trade |
| `success` | The predicate below |
| `degraded` | Whether the component under test actually operated |

`degraded` deserves its own line. When a decision layer degrades to a fallback, the run measured the fallback. Reporting its cost as the decision layer's cost is the easiest way for an eval to lie to its author, and the easiest way to notice is to record the flag and refuse to compare across it.

## The success predicate

Every task carries a deterministic predicate, defined outside the evaluated configuration: a process exit code, a file's contents, a test that passes. Not a model's judgment of a transcript.

The reason is decision record 0007. In that study the instruction set scored better on its own linter and lost on every measure a reader could see. A model-graded rubric is the same trap with more steps: the grader and the graded share the bias.

A task whose outcome only a person can judge is not a task. It is a note, and it stays out of the set.

## Repetition

Three runs per task per configuration, minimum. Single generations vary enough to reverse a conclusion, and the study cited in 0007 admits to one generation per cell. Reporting a delta without variance is reporting noise.

## Budget

Measurement implies a ceiling, because a number nobody bounds is a number that grows.

```ts
interface Budget {
  readonly maxCostUSD?: number;
  readonly maxWallMs?: number;
  readonly maxTurns?: number;
}
```

Configured per task and per run. On breach the run stops and reports the reason. It does not continue and does not silently pick a cheaper path, because a budget that changes behavior measures something other than the thing under test.

The ceiling is checked at turn boundaries, so a run stops at most one turn after the turn that broke it. The turn already in flight when the breach is detected completes; it cannot be un-run.

A breached run is never a success, even when its predicate passes. A run cut short after its side effects landed can leave the fixture in a passing state while the work that would have followed never happened. `test/eval.test.ts` covers exactly that case: the edit succeeds, the verifier passes, and the run is still reported as a failure with `breached: true`.

This is also the answer to an unattended agent spending without limit: **when nobody is watching, the only safe default action is to stop and state why.** That sentence is the budget's whole design.

## Provenance of the numbers

A run records whether its token figures were `reported` by a provider or `estimated`. The scripted provider estimates from character counts and reports every cost as zero, which makes its figures useful for comparing harness changes against each other and useless for comparing against a real provider.

The report refuses to subtract one from the other: mixing sources sets `mixedUsageSource` and suppresses every delta, the same way a degraded run does. The absolute totals are still printed, because they are still facts about their own kind.

## Acceptance criteria

1. `npm run eval -- --tasks <set>` produces a report with every metric above, from a single command, with no manual steps.
2. A test asserts a task without a success predicate fails to load. A task with no way to fail is not a measurement.
3. A test asserts a report containing a `degraded` run marks it and refuses to present its delta as a like-for-like comparison.
4. A test asserts a run exceeding its budget stops and reports the breach rather than completing, and that the breached run is not counted as a success even when its predicate passes.
5. Replay re-runs a recorded transcript with the network disabled and produces identical metrics on every deterministic key, proving the harness is deterministic apart from the model.
6. A test asserts a report mixing estimated and reported token figures computes no delta.
7. The product page cites no figure without a committed command that regenerates it.

## Out of scope

- A leaderboard, or comparing models against each other. The question is whether a change to *this* harness helped, not which vendor is ahead.
- A model-graded rubric. See above.
- CI cost tracking over time. Useful later; it needs a history to be useful, and there is none yet.
