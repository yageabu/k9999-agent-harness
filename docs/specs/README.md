# Specs

A spec is the contract for something not built yet. It states the problem, the invariant that must hold, the interface, the acceptance test, and what is explicitly out of scope.

## How a spec differs from a decision record

| | Records | Answers |
|---|---|---|
| [`../decisions.md`](../decisions.md) | What was already decided | Why not the alternative |
| This directory | What will be built | What must be true when it is done |

A decision record is edited when the decision changes. A spec is edited while it is being implemented, and is superseded by the code and its tests once it ships. Neither is deleted.

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
| 0003 | [Jev decision layer](0003-jev-decision-layer.md) | `accepted` | 0004 | Probe latency and cost before wiring it |
| 0004 | [Measurement and budget](0004-measurement-and-budget.md) | `accepted` | — | `packages/eval` skeleton and replay |

## Build order

0004 comes first, and for one reason: nothing else can be justified without it.

```
0004  measurement + budget     ── the baseline everything else is judged against
 │
 ├──▶ 0003  Jev decisions       ── needs a probe first, then a task-set comparison
 │
 └──▶ 0001  non-blocking core   ── the largest change; needs the baseline to prove no regression
       │
       └──▶ 0002  reversibility ── builds on the interaction record from 0001
```

0001 and 0003 are independent of each other. 0002 depends on 0001 because a reversibility gate is an interaction, and an interaction that blocks is the thing 0001 removes.

## Rules every spec follows

1. **State the invariant, not the feature.** "The core never blocks on a human" is checkable. "Add WeChat support" is not.
2. **Acceptance criteria must be runnable.** Each one names a test. A criterion that only a person can judge is not a criterion.
3. **Name what is out of scope.** A spec with no exclusions will grow until it stalls.
4. **No numbers for unbuilt work.** A figure on the product page must have a command that regenerates it. Planned work is described, never quantified.
5. **Prefer a property over a mode.** A mode asks the user to choose correctly before anything happens. A property applies whether or not anyone remembered it exists.
