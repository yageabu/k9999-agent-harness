# 0002 — Reversibility, not modes

**Status:** `accepted`

Depends on [0001](0001-non-blocking-interaction.md): a reversibility gate is an interaction, and an interaction that blocks is what 0001 removes.

## Problem

Plan mode exists to stop an agent from making irreversible changes before it understands the situation. It does this by adding a mode the user must enter, a phase the agent must respect, and a confirmation before the phase ends.

Two costs come with it. A mode requires the user to choose correctly *before* anything happens, and the choice is invisible to the code that actually performs the change. The agent behaves well only when someone remembered to turn the mode on.

The requirement Plan mode serves does not go away when the mode does. Something still has to distinguish "change a file in a git repository" from "drop a production table".

## Decision

Do not build a Plan mode. Do not recommend one.

- **Planning is already a profile.** `tools: ["read", "bash"]` with no write tool is a plan mode: no write capability exists to gate. The `data` profile does this today, and a test asserts it cannot write. No new code path is needed to express it.
- **The real axis is irreversibility.** A tool declares how its effects can be undone. The core gates on that declaration, whether or not anyone chose a mode.

## Interface

The registry row gains the declaration:

```ts
type Reversibility =
  | "read"          // no effect outside the process
  | "reversible"    // an effect that a recorded, runnable command undoes
  | "irreversible"; // an effect nothing undoes

interface ToolFactory {
  readonly name: string;
  readonly reversibility: Reversibility;
  /** For "reversible": the command that undoes a call, when one can be constructed. */
  readonly undo?: (input: unknown, cwd: string) => string | undefined;
  build(cwd: string): AnyTool;
}
```

`Reversibility` is coarse on purpose. Three values are enough to place a gate, and a finer scale invites arguments about classification instead of about behavior.

For the shipped tools:

| Tool | Declaration | Reasoning |
|---|---|---|
| `read` | `read` | Touches nothing |
| `edit` | `reversible` | `git checkout -- <path>` restores it when the file is tracked |
| `bash` | `irreversible` | The command is not known until it arrives |

## `bash` is the honest case

Declaring `bash` irreversible means every shell command needs authorization, which is unusable. The declaration is therefore the *floor*, not the verdict, and two things raise or lower it:

1. **A static allowlist** for commands that are obviously read-only: `grep`, `git status`, `ls`, `cat`. Deterministic, no model, no cost.
2. **A dynamic decision** for everything else, when the decision layer is switched on ([0003](0003-optional-decision-layer.md)). `noul` on "would running this command destroy or publish something that cannot be recovered or recalled?" The layer is optional, so this step is skipped entirely when it is off, and the floor applies instead.

The static allowlist runs first because it is free and exact. The dynamic decision runs only on what the allowlist cannot classify. When neither can classify a command, the floor applies: it is irreversible.

## Policy

An irreversible operation requires authorization for that specific call.

- Authorization is **per call, never standing**. A standing authorization in an unattended system is a permission that outlives the situation that justified it.
- The authorization request is an `Interaction` with kind `approval` under [0001](0001-non-blocking-interaction.md), so it can be answered from any channel and its default is `deny`.
- The decision, the deciding source (`allowlist` | `decider` | `floor` | `human`), and the reason are written to the trace. A gate whose reasoning is invisible cannot be audited or improved.

## Acceptance criteria

1. A test asserts the registry has no row without a `reversibility` value, and that an unknown value is a load-time error.
2. A test asserts `edit` on a tracked file proceeds without authorization, and that the declared `undo` command restores the file.
3. A test asserts `bash` running `rm -rf` on a fixture directory refuses without authorization, and that an unanswered approval defaults to `deny`.
4. A test asserts `git status` and `grep` proceed with no decider configured, proving the allowlist path is free.
5. A test asserts that with the decider unavailable, an unrecognized command is treated as irreversible rather than allowed. Failure of the classifier fails closed.
6. A test asserts each gate decision records its source, so the acceptance criterion does not pass by accident of a different path classifying the same command.

## Out of scope

- A dry-run mode. It is a mode, and the reasoning above applies to it.
- Diff previews before an edit. An edit inside a repository is reversible; previewing it is a nicety, not a gate.
- A permission syntax in the profile. The profile chooses tools; it does not negotiate permissions.
- Undoing an irreversible action. The point of the gate is that the action does not happen.
