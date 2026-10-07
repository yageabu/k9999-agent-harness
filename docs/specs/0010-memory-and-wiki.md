# 0010 — Memory and the project wiki

**Status:** `accepted`

## Problem

Nothing survives a session. A conversation's transcript ends with the process,
and the next one starts from the same prompt it started from the first time. An
agent that fixed a subtle bug in this repository last week does not know it, and
an agent that was told "use pnpm here" will ask again tomorrow.

The two failures are different in kind and are usually conflated:

- **The agent does not remember.** It repeats questions, repeats mistakes, and
  re-derives conclusions it already reached.
- **The project has no memory either.** The architecture, the decisions, and the
  traps are in `docs/` for a person to read and in no form the agent consults.
  `skills/` is the closest thing and it is a directory holding one README.

Writing both into one store is the tempting move and it is wrong: they have
different scopes, different lifetimes, and different audiences, and merging them
means a preference about prompt style is retrieved when the question was about
how the build works.

## Invariant

**What the agent learned is a durable, scoped, revisable record. What it recalls
is bounded and ranked by relevance. Every claim it makes about the project points
at something checkable, and a claim whose evidence is gone is marked stale rather
than believed.**

Three sentences because there are three separate failures to prevent: forgetting,
recalling too much, and recalling something that was never true.

## Two scopes, one mechanism

| | Memory | The wiki |
|---|---|---|
| Kind | `k9999.memory` | `k9999.wiki` |
| Scope | session | conversation, keyed by project |
| Subject | what this agent learned | what this project is |
| Travels with | the agent | the working directory |
| Selected by | every profile | profiles that declare it — coding, not data |
| Recall | ranked, capped, injected | advertised, loaded on demand |
| Written by | the agent, at the end of a turn | the agent, during a turn |

Both are `pi-durable` documents. That is the whole reason this is one spec:
`defineDoc` already provides the four things this needs and none of them are
worth writing again.

- **`version` and `migrate()`** make the store evolvable. A memory written by
  0.7 is read by 0.8 without a migration script per install, which is what makes
  this *dynamic* rather than merely persistent.
- **`scope: "session"`** keeps memory across conversations, which is the
  definition of remembering.
- **`history: "rewindable"` and `snapshotAsOf()`** make the record attributable:
  you can read what the agent believed at any earlier entry.
- **`checkpointWhen`** keeps a full base at chosen points instead of an unbounded
  delta chain.

## What is recalled, and how much

The cost of memory is attention, and it is paid on every turn. A store that
grows without a retrieval policy makes the agent worse, not better.

Recall follows the shape [ECC](../decisions.md) uses for its instincts, because the
parameters there were arrived at by someone shipping this to users:

| Rule | Value | Why |
|---|---|---|
| A confidence floor | a memory below it is not injected | an observation that was wrong once should not reach every prompt |
| A cap per turn | a small fixed number | the marginal memory is worth less than the marginal instruction, and the model does not tell you when it stopped reading |
| Ranking by relevance and scope | project-scoped and stack-matching entries above unrelated higher-confidence ones | a true fact about a different project is noise here |
| Nothing injected twice in a row | an entry recalled this turn is not recalled next turn unless it is referenced | otherwise the cap is spent on the same three facts forever |

**The cap is the point.** `settings.progress` in `pi-durable` commits partials on
an interval because a crash should lose at most that window; this is the same
trade in the other direction — a memory that is not recalled is not lost, it is
deferred.

## Evidence, and what happens when it disappears

An agent writing its own knowledge is the model asserting things about the world.
That is the failure [SPEC 0004](0004-measurement-and-budget.md) rules out for
verdicts, arriving through a different door, and it gets the same treatment.

A wiki claim is stored with its evidence:

```ts
interface WikiClaim {
	readonly text: string;
	/** What makes this checkable. Absent means it is a note, not a claim. */
	readonly evidence?: {
		/** Repo-relative paths this claim is about. */
		readonly paths: readonly string[];
		/** A command whose output supported it, when there was one. */
		readonly command?: string;
		/** The entry that recorded it, so a reader can see the context. */
		readonly entryId: string;
	};
	/** Set when a path or revision in `evidence` is gone. */
	readonly stale?: { readonly reason: string; readonly at: string };
}
```

Three behaviors follow, and each has a test:

1. **A claim whose evidence is gone is marked stale**, not deleted and not
   trusted. Deletion would hide that the agent once believed it; silence would
   let it be re-asserted.
2. **A stale claim is shown as stale** when the wiki is read, so the agent knows
   to re-derive rather than repeat.
3. **A claim with no evidence is stored as a note** and is not presented as a
   fact about the project. This is the difference between "the build needs
   `--no-verify`" and "I had trouble with the build".

## The wiki is advertised like a skill, not injected like a rule

`skills/` already has the right shape and it should not be duplicated: a name, a
description, and a path, listed in a generated prompt section, with the
instruction "read a skill's file when the task matches its description".

The wiki is a second index of the same kind. Injecting it wholesale would be
paying for every page on every turn to save reading one, which is the mistake
the rules section of this repository already identifies.

**So the change is what is behind the index, not the index.** `skills/` is
authored by a person and never changes. `k9999.wiki` is written by the agent,
changes between sessions, and carries the diff below.

## The diff a person reads

An agent that maintains the project's documentation across sessions needs its
edits to be reviewable in the shape the project already reviews changes.

`history: "rewindable"` makes this cheap: the wiki's value as of the previous
session and as of now are both readable, so the page renders a diff rather than a
document. What changed, on what evidence, in which session — with the ability to
revert, because reverting a document is a commit like any other.

This is also the answer to "should a person approve wiki writes". They are not
approved at write time, because an approval queue nobody drains produces a wiki
that lags what the agent knows. They are reviewable after the fact, with the
evidence attached, which is what `git` already taught this project works.

## Acceptance criteria

1. A test asserts a memory written in one conversation is readable in the next,
   on session-scoped storage that outlives the `Harness` handle.
2. A test asserts a memory below the confidence floor is not recalled, and one at
   or above it is.
3. A test asserts no more than the cap is recalled in one turn, and that the
   entries chosen are the highest-ranked by the documented rule.
4. A test asserts an entry recalled in the previous turn is not recalled again
   without being referenced, so the cap cannot be spent on the same entries
   repeatedly.
5. A test asserts a wiki claim with a missing path is marked stale and is
   presented as stale, rather than being dropped or presented as current.
6. A test asserts a claim with no evidence is stored as a note and is not
   returned by the query that lists claims about the project.
7. A test asserts the wiki's diff between two sessions names the entries added,
   changed, and staled, by reading two `snapshotAsOf` values rather than by
   replaying.
8. A test asserts a document written at `version: 1` is readable after the
   definition moves to `version: 2`, through `migrate()`, with no manual step.
9. A test asserts the wiki index is advertised in the prompt section and its
   contents are not, by asserting the rendered prompt contains the name and not
   the body.
10. A test asserts a data profile declares no wiki, so the mechanism is selected
    rather than assumed.

## Out of scope

- **Embeddings and a vector store.** Recall by relevance is ranking over
  structured fields — scope, stack, recency, confidence — and that is checkable.
  A similarity search is a dependency, a second store, and a recall path that
  cannot explain why it recalled something. Revisit when ranking demonstrably
  fails to surface entries a person would have chosen, and with the failing cases
  in hand.
- **Training, fine-tuning, or weight changes.** Nothing in this spec modifies a
  model. What carries forward is text.
- **A wiki editor.** The wiki is read through the agent and reviewed as a diff
  against a repository that already has a review process. A web editor is a
  product with its own spec, and [SPEC 0009](0009-web-interface.md) does not
  grow one by implication.
- **Memory shared across agents.** Memory belongs to an agent and travels with
  it. A store shared between the coding and data agents would make
  `profiles/` a suggestion rather than a boundary, and the first thing it would
  leak is that the data agent has no `edit` tool.
- **Automatic forgetting on a schedule.** Decay by time is easy to write and
  impossible to justify: an entry that is stale because it was wrong and one that
  is stale because it is old look identical to a clock. Staleness here is
  evidence-driven, and confidence is the ranking input.
