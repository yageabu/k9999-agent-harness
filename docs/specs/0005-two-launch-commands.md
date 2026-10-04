# 0005 — Two launch commands: `k9999` and `kula`

**Status:** `accepted`

## Problem

One binary with `-p data` makes an agent's identity a flag. `k9999 -p data` is not a name, it is a command line someone has to remember, and it reads as one product with a mode rather than two agents with different jobs.

The two agents are not modes of each other. One writes code and is judged by a verifier; the other reads data and is judged by whether its numbers are traceable. They have different tools, different thinking budgets, and different response shapes. They deserve different names.

## Invariant

**One implementation, two names. A launch name changes only a default.**

There is no behavior reachable through `kula` that is not reachable through `k9999 --profile data`. A second entry point that grows its own behavior is a second product, and this is not that. A test asserts the equivalence directly.

## Interface

| Command | Default profile | Agent |
|---|---|---|
| `k9999` | `code` | Writes and fixes code |
| `kula` | `data` | Reads data and reports what it says |

Both are bins in `packages/cli`, pointing at the same entry module:

```json
"bin": {
	"k9999": "./src/index.ts",
	"kula": "./src/index.ts"
}
```

Profile resolution, highest precedence first:

1. `--profile <id>`, explicit
2. the launch name's default
3. `code`

The launch name is the basename of `argv[1]`. A name that is neither `k9999` nor `kula` — running the entry directly, for instance — leaves the default at `code` and is not an error, because the test suite and `npm run` invoke the entry by its path.

`--list` names both, so the mapping is discoverable rather than documented:

```
$ kula --list
code   Code Agent            (k9999)
data   Data Analysis Agent   (kula)
```

## Why the profile ids stay `code` and `data`

The launch names are the brand. The profile ids are directory names.

Renaming `profiles/code/` to `profiles/k9999/` would put the project's own name inside its profile namespace, so a failure would read `Unknown profile "k9999"` in a repository called `k9999-agent-harness`. A name that appears on both sides of a lookup is a name that will be misread, and the error will arrive at the worst moment.

The mapping is one table in one file, so a future rename is one edit.

## Acceptance criteria

1. A test asserts `kula --list` and `k9999 --list` print identical output.
2. A test asserts `kula --print <prompt>` uses the `data` profile's tool list and thinking level, and `k9999 --print <prompt>` uses the `code` profile's.
3. A test asserts `kula --profile code` resolves exactly as `k9999 --profile code`, proving a launch name is only a default.
4. A test asserts an unrecognized launch name — the entry run by path — defaults to `code` and does not fail.
5. The help text names both commands and the profile each defaults to, so the mapping is readable without the docs.

## Out of scope

- A third command. Two agent types exist; a third is added when a third exists.
- Per-command configuration files. Both read the same `profiles/` and `skills/`.
- Shell completions, aliases, or wrapper scripts.
