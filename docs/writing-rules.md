# Output rules

These rules live in the `## Response shape` section of every `profiles/<id>/system.md`. They are eight rules, not a standard, and this file records why.

## The rules

1. **Sentence length.** Maximum 20 words for instructions, 25 for descriptions. Count the three longest sentences and split any over the limit.
2. **Condition before command.** "If the test fails, read the log."
3. **One word, one meaning.** Never rotate synonyms for the same thing. Restating one idea three ways is the largest single source of avoidable length.
4. **No em-dashes and no semicolons.** An em-dash hides the relation between two statements. Name the relation, or write two sentences.
5. **Delete words that carry no fact.** simply, seamlessly, robust, powerful, comprehensive, leverage, "in order to", "it is worth noting". Replace: utilize becomes use, prior to becomes before, in the event that becomes if.
6. **A fixed delivery shape.** Prose, no headings unless there are more than three distinct parts, and never a heading first. No summary at the end.
7. **No opener or closer.** Do not restate the question, do not summarize what was just said, and do not ask whether more is wanted.
8. **Do not invent specifics.** When the source gives no number or cause, keep the general statement.

Rules 1 through 5 come from ASD-STE100. Rules 6 through 8 do not: they are where most of the reduction actually comes from, and no controlled language has anything to say about them.

## Where these come from

ASD-STE100 Simplified Technical English is a controlled natural language owned by ASD, Brussels. It was developed in the late 1970s for aircraft maintenance documentation, so that a reader with a basic command of English would not misread a procedure. Issue 9 was published on 2025-01-15. It has roughly 53 rules and a controlled dictionary of about 900 approved words.

Two facts about it matter here:

**Its goal is comprehension, not brevity.** Several rules actively add length. Contractions are banned, so "do not" replaces "don't". Semicolons are banned, so one sentence becomes two. For an agent talking to the developer who wrote the request, that is cost without benefit.

**Its core is a dictionary you cannot send.** Half the standard is the approved word list. A model cannot receive it, so "follow ASD-STE100" resolves to whatever the model remembers, which is sentence length and active voice. The instruction sounds precise and is not.

## What the measurements show

The largest study of STE as an agent instruction is `AminBlg/SimpleEnglish`. Across nine models and eight tasks, output tokens fell by roughly 19%:

| Model | Baseline | With STE skill |
|---|---|---|
| claude-opus-4-5 | 196 | 159 |
| claude-opus-4-8 | 278 | 200 |
| claude-sonnet-5 | 266 | 205 |
| claude-fable-5-1 | 348 | 236 |

So it works. The same repository's decisive experiment, on eight reply scenarios, is why it is not used here:

| Condition | Words | Sentences | Em-dashes | Bold spans | Headers | List items |
|---|---|---|---|---|---|---|
| No instruction | 249 | 18.9 | 32 | 52 | 19 | 35 |
| Full STE skill | 171 | 13.4 | 17 | 24 | 3 | 22 |
| Eight-line prompt | 150 | 5.8 | 2 | 0 | 0 | 0 |

The author's own conclusion, in a file named `WHY-USELESS-2026-09-02.md`: the skill wins only on its own linter, and more than fifty rules dilute the five that matter. The skill also carried a loophole, because STE exempts code blocks and list items from its sentence limit, and the model responded by turning everything into a list.

Two lessons are taken from this:

- **A rule with an exception will be exploited.** Do not write exceptions into these rules.
- **Never judge a rule by a metric the rule itself satisfies.** Only measure what a reader sees.

## Verify on your own tasks

Do not take the table above as evidence for your workload. Run this:

1. Fix ten real tasks and three conditions: no instruction, the full eight rules, and the eight rules with item 6 removed.
2. Run each task three times. Single generations vary enough to reverse a conclusion.
3. Measure three things, not one:
   - output tokens, for cost
   - **the number of turns until the first correct answer**, because a shorter reply that needs a follow-up question is a net cost
   - your own reading score from 1 to 5

Output tokens alone will mislead you. The study above is the proof: its linter scored full STE better, while the plain prompt won every reader-visible measure. Note also that on reasoning models the reported output tokens include reasoning tokens.

## When to use the real standard

Use ASD-STE100 in full when the deliverable is a document rather than a reply: user manuals, runbooks, release notes, pull-request descriptions, anything read by a non-native speaker. In those cases the standard is the right choice and a linter is worth writing. It is not the right choice for an agent's answer to the person who asked.
