# Product plan (v2)

These documents describe a product this repository does not build yet: a
from-scratch Bun multi-agent orchestrator, distributed as a paid binary. They are
kept separate from [`../decisions.md`](../decisions.md) and
[`../specs/`](../specs/) because neither is the record of a decision or a
contract for code.

| # | Document | What it is |
|---|---|---|
| 0001 | [Proposal](0001-proposal.md) | Why the project exists, the milestones, and the conclusion to start |
| 0002 | [Commercial feasibility](0002-commercial-feasibility.md) | Market, competition, revenue model, cost, risk |
| 0003 | [PRD](0003-prd.md) | Modules, tiers, the demo flow, the acceptance criteria |
| 0004 | [README draft](0004-readme-draft.md) | The public page, as drafted. It is not the repository README |
| 0005 | [Pseudocode](0005-pseudocode.md) | Scheduler, PTC engine, entry point |
| 0070 | [Review](0070-review.md) | What does not hold, with the evidence, and what to do about it |
| 0071 | [Suite feasibility](0071-suite-feasibility.md) | Per-team customisation as a pluggable package: three tiers, precedence, MCP trust, and why it beats the closed kernel |
| 0080 | [v2 bootstrap](0080-v2-bootstrap.md) | **accepted, revised same day**: the rebuild moved to `lokyu-agent-harness` with no `pi` dependency; K9999 frozen as the Pi-line experiment. Records what was built and four new measurements |

**Status: proposal, not accepted.** The review's findings are open. Nothing here
authorises a change to `packages/`.

Two rules from [`../specs/README.md`](../specs/README.md) apply to this directory
even though these are not specs. A figure for work that does not exist must name
the command that regenerates it. A criterion that only a person can judge is not
an acceptance criterion. Several documents below break both, and the review says
where.
