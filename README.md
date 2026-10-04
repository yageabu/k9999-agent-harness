# K9999 Agent Harness

An agent harness assembled on top of [`@earendil-works/pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core).

K9999 is not a fork of Pi and not a wrapper around it. It takes the agent kernel and the model layer from Pi, and owns everything above them: profiles, prompt assembly, the tool registry, the CLI, and session policy. The point of the split is that the kernel is a library, not an application.

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
npm run check          # typecheck + tests, no API key needed
npm run k9999 -- --list
npm run k9999                          # interactive, code profile
npm run k9999 -- -p data
npm run k9999 -- --print "what does packages/core/src/prompt.ts do?"
```

Set `DEEPSEEK_API_KEY` before a run that talks to a real model. The test suite uses a scripted provider and needs no credentials.

## Layout

```
packages/core/          profiles, prompt assembly, tool registry, agent wiring
packages/cli/           argument parsing, event rendering, REPL
profiles/<id>/          one agent type per directory
skills/<name>/SKILL.md  long-form knowledge, advertised but loaded on demand
docs/                   decisions and writing rules
```

`packages/core` never imports `packages/cli`. The CLI owns every decision about how an event looks; the core owns every decision about what an event means.

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

- [`docs/specs/`](docs/specs/README.md) — the contracts for what is not built yet. Start here for direction: four specs, none implemented.
- [`docs/decisions.md`](docs/decisions.md) — twelve decision records: why this shape and not the alternatives, each with its cost and a revisit trigger
- [`docs/writing-rules.md`](docs/writing-rules.md) — the eight output rules, with the measurement behind them
- [`site/index.html`](site/index.html) — the product page. One self-contained file, no external requests, no JavaScript. Published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml); the workflow fails if the page ever references an external resource. Open it directly, or export a PDF with `playwright pdf site/index.html k9999.pdf`.
- [`AGENTS.md`](AGENTS.md) — conventions for an agent working in this repository

## Status

Shipped: profiles, prompt assembly, the tool registry, skill resolution, provider registration, and the CLI. Eighteen tests, no credentials required.

Accepted and unimplemented: [SPEC 0001](docs/specs/0001-non-blocking-interaction.md), [0002](docs/specs/0002-reversibility-not-modes.md), [0003](docs/specs/0003-jev-decision-layer.md), [0004](docs/specs/0004-measurement-and-budget.md). The product page marks the two states separately and gives no figures for the second.

## License

MIT
