# Specs

A spec is the contract for something not built yet. It states the problem, the invariant that must hold, the interface, the acceptance test, and what is explicitly out of scope.

## How a spec differs from a decision record

| | Records | Answers |
|---|---|---|
| [`../decisions.md`](../decisions.md) | What was already decided | Why not the alternative |
| This directory | What will be built | What must be true when it is done |

A decision record is edited when the decision changes. A spec is edited while it is being implemented, and is superseded by the code and its tests once it ships. Neither is deleted.

Implementation lives in `packages/`. A spec's status moves to `building` as soon as code exists, even when most of it does not, because a status that lags the repository is worse than no status.

## Status

| Status | Meaning |
|---|---|
| `draft` | Written, not agreed |
| `accepted` | Agreed, not started |
| `building` | Partially implemented; the spec is the source of truth |
| `shipped` | Implemented and covered by tests; the spec is now history |

## The specs

| # | Spec | Status | Depends on | First move |
|---|---|---|---|---|
| 0001 | [Non-blocking interaction](0001-non-blocking-interaction.md) | `accepted` | — | `Agent` → `AgentHarness` on one channel |
| 0002 | [Reversibility, not modes](0002-reversibility-not-modes.md) | `accepted` | 0001 | `reversibility` on the tool registry |
| 0003 | [An optional decision layer](0003-optional-decision-layer.md) | `accepted` | 0004 | Probe latency and cost before wiring it in |
| 0004 | [Measurement and budget](0004-measurement-and-budget.md) | `building` | — | Done: task loading, predicates, transcripts, replay, budget, report. Left: `probe` mode, and figures from a real provider |
| 0005 | [Two launch commands](0005-two-launch-commands.md) | `shipped` | — | Done: a second bin and a mapping table, both covered by tests |
| 0006 | [Publish to npm](0006-publish-to-npm.md) | `shipped` | 0005 | Done: `k9999@0.1.0` is live and installs into an empty directory |
| 0007 | [Rendering and sinks](0007-rendering-and-sinks.md) | `building` | — | Done: the vocabulary, the sink seam, and the text sink with diffs. Left: tier 2 with 0001, tier 3 as a dashboard |

## Build order

0004 comes first, and for one reason: nothing else can be justified without it.

```
0004  measurement + budget     ── the baseline everything else is judged against
 │
 ├──▶ 0003  decision layer     ── needs a probe first, then a task-set comparison
 │
 ├──▶ 0001  non-blocking core  ── the largest change; needs the baseline to prove no regression
 │     │
 │     ├──▶ 0002  reversibility ── builds on the interaction record from 0001
 │     │
 │     └──▶ 0007  tier 2        ── the sink becomes a channel, which needs 0001's interface
 │
 ├──▶ 0005  launch commands    ── shipped
 │
 ├──▶ 0006  publish to npm     ── shipped: k9999@0.1.0
 │
 └──▶ 0007  tier 1             ── building: the vocabulary and the text sink
```

0001, 0003, and 0005 are independent of each other. 0002 depends on 0001 because a reversibility gate is an interaction, and an interaction that blocks is the thing 0001 removes. 0006 depends on 0005, because a package manifest lists the bins the package provides.

0007 is the one spec that runs in two stages on purpose. Its tier 1 — the vocabulary and the text sink — has no dependencies and is the work. Its tier 2 makes the sink a channel, which needs 0001's interface to exist first. Doing tier 2 early would write "the terminal is where answers come from" into the UI, which is the bug 0001 exists to remove.

## Rules every spec follows

1. **State the invariant, not the feature.** "The core never blocks on a human" is checkable. "Add WeChat support" is not.
2. **Acceptance criteria must be runnable.** Each one names a test. A criterion that only a person can judge is not a criterion.
3. **Name what is out of scope.** A spec with no exclusions will grow until it stalls.
4. **No numbers for unbuilt work.** A figure on the product page must have a command that regenerates it. Planned work is described, never quantified.
5. **Prefer a property over a mode.** A mode asks the user to choose correctly before anything happens. A property applies whether or not anyone remembered it exists.
6. **Every optional component has a defined off-path.** Not a null, not a fallback: a real behavior with a test. A component whose absence breaks a decision is required whether or not the configuration says so.
