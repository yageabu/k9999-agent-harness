# 0012 — Continuous iteration

**Status:** `accepted`

Depends on [0010](0010-memory-and-wiki.md) for the store and
[0004](0004-measurement-and-budget.md) for the measurement. Without the second it
is not iteration; it is accumulation.

## Problem

An agent with memory accumulates. Whether it improves is a separate question, and
nothing in the previous spec answers it.

The failure is easy to produce and hard to notice. A memory is written because a
turn went well, or because a model said the lesson was worth keeping. It is
recalled on later turns. It costs attention every time. Nothing ever checks
whether the turns that recalled it went better than the turns that did not — so a
store that makes the agent worse is indistinguishable from one that makes it
better, and both grow.

**The specific trap is that the model is the one proposing what to remember.**
That is a verdict about its own output, which
[SPEC 0004](0004-measurement-and-budget.md) already rules out for results. It is
not less of a verdict when it is about a lesson instead of a fix.

## Invariant

**Each session's outcome changes the next session's inputs, and the effect of the
change is measured rather than assumed. What is recalled earns its place by
outcomes, not by confidence in the telling.**

## The loop

```text
  task set ──▶ run ──▶ verdict (a predicate, not a summary)
                 │            │
                 │            └──▶ outcome: pass / fail / cost / turns
                 │
                 └──▶ what the run learned, written with evidence  (SPEC 0010)
                              │
                              ▼
                      recall on the next run, within a cap
                              │
                              ▼
              the same task set again, with recall on and off
                              │
                              ▼
        entries whose presence correlates with worse outcomes are demoted
```

**The last arrow is the one that makes it iteration.** Everything above it is
what every agent with a memory file does.

## Confidence is empirical

`pi-durable` stores a document; it does not score it. The score this spec adds is
computed from outcomes, not written by the model:

```ts
interface LearnedEntry {
	readonly text: string;
	/** How many measured runs recalled this entry. */
	readonly recalls: number;
	/** Of those, how many met the verdict. */
	readonly helped: number;
	/** Outcome rate with the entry recalled, against the task set's baseline. */
	readonly lift: number;
	/** Set when `lift` is negative across enough runs to mean it. */
	readonly demoted?: { readonly reason: string; readonly at: string };
}
```

Three consequences, and each is a rejection of a simpler design:

1. **A new entry starts with no score, not a high one.** A model writing "this
   worked" is a hint about where to look, not evidence that it did. An entry with
   no measured runs is recalled rarely and never as a rule.
2. **`lift` is measured against the task set's baseline**, which is why this
   depends on 0004. A memory that appears in every run has no lift by
   construction, and a memory whose runs all failed is not a lesson.
3. **Demotion is a state, not a deletion.** An entry that made things worse is
   worth keeping and worth not recalling — the same reasoning
   [SPEC 0010](0010-memory-and-wiki.md) applies to a stale claim.

**A model may still write an entry.** It may not write its own score. The field
that decides whether it is recalled is one the model cannot touch, and that
separation is the entire mechanism.

## Measuring it is cheap, because the harness exists

`packages/eval` already runs a task set against a configuration, records
transcripts, and replays them offline. Comparing memory on against memory off is
a configuration difference, which is what a report is for.

Two rules the report already enforces apply unchanged, and one is new:

- A delta across runs whose budgets or usage sources differ is refused. This is
  existing behavior.
- **The task set is fixed across a comparison.** A comparison against a changed
  task set measures the tasks, not the memory.
- **New: the comparison names which entries were recalled**, so a result is
  attributable to a set of memories rather than to "memory". A report that says
  memory helped is not actionable; one that says these four entries were present
  is.

## What this is not

**It is not learning in the model sense.** No weights change. What changes is
which sentences appear in a prompt and how often.

**It is not self-improvement without a judge.** The judge is a predicate written
by a person, which is the same judge results already face. An agent that scores
its own lessons and acts on the score has removed the only thing that made the
verdict mean something.

**It is not fast.** A week of turns may not be enough runs to move `lift` outside
noise, and the honest response is to say so rather than to lower the threshold
until the number looks like progress. This is [ADR-0012](../decisions.md)'s subject
in its most tempting form: an improvement curve is the figure most likely to be
drawn from three data points.

## Acceptance criteria

1. A test asserts a newly written entry has no score and is not recalled as a
   rule, by asserting it does not appear in the prompt on a turn that does not
   match it.
2. A test asserts recall counts and verdict outcomes are recorded per entry
   across runs, from the transcript rather than from what the model reported.
3. A test asserts `lift` is computed against the task set's baseline, and that an
   entry recalled on every run computes a lift of zero rather than a positive
   one.
4. A test asserts a demoted entry is not recalled and is still readable, so the
   demotion is visible rather than a disappearance.
5. A test asserts the report refuses a memory-on/memory-off comparison whose task
   sets differ, in the same way it refuses a comparison across budgets that
   differ.
6. A test asserts the report names the entries recalled during each run of a
   comparison.
7. A test asserts a run's recorded outcome comes from the task's predicate and
   not from text in the transcript, so an agent cannot pass by saying it did.
8. A test asserts two runs of the same configuration on the same task set produce
   reports comparable under the existing rules, so the baseline is not a special
   case.

## Out of scope

- **Rewriting a skill or a rule from what was learned.** Memory and the wiki are
  recalled as text; a learned pattern does not become a profile's system prompt.
  That is a change to a file a person owns, and the mechanism for it is a diff a
  person reviews — see [SPEC 0010](0010-memory-and-wiki.md)'s wiki diff, which is
  the sanctioned path.
- **Adaptive caps.** Raising the recall cap when outcomes improve is a control
  loop over a noisy signal with a cost paid in attention. The cap is a setting
  until the measurement is good enough to tune it, which is not yet.
- **Cross-agent transfer.** Two agents learning from each other's outcomes would
  need a shared judge for tasks they do not share.
- **An improvement figure on the product page.** This spec produces the
  measurement and not a number. A figure needs a command that regenerates it on
  demand, and a task set that costs nothing to run is a task set that does not
  measure anything.
