# K9999 Agent Harness

**Never blocks. Measures first.**

Built on [Pi](https://github.com/earendil-works/pi) — thanks to its authors for shipping the agent kernel, the model layer, and terminal rendering as reusable libraries rather than one application. `pi-agent-core` and `pi-ai` do the work this project stands on, and without that split K9999 would not exist.

K9999 owns everything above them: profiles, prompt assembly, the tool registry, the launch commands, and the measurement harness. It is not a fork of Pi and not a wrapper around it.

Two launch commands, one implementation:

| Command | Agent | Tools |
|---|---|---|
| `k9999` | writes and fixes code | read · bash · edit |
| `kula` | reads data and reports what it says | read · bash |

Neither blocks on a human, and neither is judged by a model's opinion of its own output.

## Status

Early. Two profiles, three tools, one CLI, eight tests. Every claim in this file is verified by `npm run check`.

## What it does

A **profile** is one agent type. It is a directory holding a declaration and a system prompt:

```
profiles/code/
├── profile.json    model, thinking level, tool list, skills
└── system.md       the authored system prompt
```

Two ship today:

| Profile | Model | Thinking | Tools |
|---|---|---|---|
| `code` | deepseek-flash | medium | read, bash, edit |
| `data` | deepseek-v4-pro | high | read, bash |

The `data` profile deliberately has no `edit`. A data agent writes scripts to files with `bash`; letting it edit your repository is a separate decision that has not been made.

## Quickstart

```bash
npm install
npm run check          # typecheck, 43 tests, and the site check. No API key needed
npm run k9999 -- --list
npm run eval -- --scripted --verify-replay   # the measurement harness, also unauthenticated
```

Then, with a key set:

```bash
npm run k9999 -- --print "what does packages/core/src/prompt.ts do?"   # code
npm run kula                                                          # data, interactive
npm run kula -- --print "how many ERROR lines are in the log?"
```

Set `DEEPSEEK_API_KEY` before a run that talks to a real model. The test suite uses a scripted provider and needs no credentials.

## Layout

```
packages/core/          profiles, prompt assembly, tool registry, agent wiring
packages/cli/           argument parsing, event rendering, REPL
packages/eval/          tasks, transcripts, replay, budgets, and comparison reports
profiles/<id>/          one agent type per directory
skills/<name>/SKILL.md  long-form knowledge, advertised but loaded on demand
docs/                   decisions, specs, and writing rules
scripts/                repository checks
site/                   the product page, published to GitHub Pages
```

`packages/core` never imports `packages/cli`. The CLI owns every decision about how an event looks; the core owns every decision about what an event means. `packages/eval` depends on `packages/core` and is depended on by nothing.

## How a run is assembled

```
profile.json ──> tools (string names -> implementations)
             └─> model reference, thinking level
system.md    ──> system prompt section 1
                  + generated "## Available tools"
                  + generated "## Skills"
                  + "Current working directory: ..."
                        │
                        └──> Agent({ initialState, streamFn })
```

Every step is one function in `packages/core/src`. There is no hidden wiring, and no configuration format beyond the two files in a profile directory.

## Documentation

- [`docs/specs/`](docs/specs/README.md) — the contracts for what is not built yet. Start here for direction: five specs, one of them building.
- [`docs/decisions.md`](docs/decisions.md) — fourteen decision records: why this shape and not the alternatives, each with its cost and a revisit trigger
- [`docs/writing-rules.md`](docs/writing-rules.md) — the eight output rules, with the measurement behind them
- [`site/index.html`](site/index.html) — the product page. One self-contained file, no external requests, no JavaScript. Published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml); the workflow fails if the page ever references an external resource. Open it directly, or export a PDF with `playwright pdf site/index.html k9999.pdf`.
- [`AGENTS.md`](AGENTS.md) — conventions for an agent working in this repository

## Status

Shipped: profiles, prompt assembly, the tool registry, skill resolution, provider registration, and the CLI. Forty-three tests, no credentials required.

Building: [SPEC 0004](docs/specs/0004-measurement-and-budget.md), the measurement harness. Task loading, deterministic predicates, JSONL transcripts, offline replay, budgets, and comparison reports all work. Missing: `probe` mode, and any figure from a real provider.

Accepted and unstarted: [SPEC 0001](docs/specs/0001-non-blocking-interaction.md), [0002](docs/specs/0002-reversibility-not-modes.md), [0003](docs/specs/0003-optional-decision-layer.md), [0005](docs/specs/0005-two-launch-commands.md). The product page marks the three states separately and gives no figures for the third.

## License

MIT
