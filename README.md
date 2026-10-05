# K9999 Agent Harness

**Never blocks. Measures first.**

Built on [Pi](https://github.com/earendil-works/pi) — thanks to its authors for shipping the agent kernel, the model layer, and terminal rendering as reusable libraries rather than one application. `pi-agent-core` and `pi-ai` do the work this project stands on, and without that split K9999 would not exist.

```bash
npx k9999 --print "what does this function do?"
```

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
npm run check          # typecheck, 53 tests, and the site check. No API key needed
npm run k9999 -- --list
npm run eval -- --scripted --verify-replay   # the measurement harness, also unauthenticated
```

Then, with a key set:

```bash
npm run k9999 -- --print "what does packages/core/src/prompt.ts do?"   # code
npm run kula --show                                                   # data: the resolved config
npm run kula -- --print "how many ERROR lines are in the log?"
```

Set `DEEPSEEK_API_KEY` before a run that talks to a real model. The test suite uses a scripted provider and needs no credentials.

### Install it as a package

Published as [`k9999@0.1.0`](https://www.npmjs.com/package/k9999):

```bash
npx k9999 --show        # no install, and no clone
npm install -g k9999    # both commands on PATH
```

To build and publish it yourself:

```bash
npm run build --workspace k9999     # bundles to packages/cli/dist
npm pack --workspace k9999          # k9999-0.1.0.tgz
npm --workspace k9999 publish       # prepublishOnly runs the full check first
```

The tarball ships the two profiles inside it, because an installed copy runs in a directory that has none above it. [SPEC 0006](docs/specs/0006-publish-to-npm.md) records what that costs, why the build asserts rather than reports, and the 2FA and registry traps that cost two publish attempts.

## Layout

```
packages/core/          profiles, prompt assembly, tool registry, agent wiring
packages/cli/           launch names, rendering, the REPL, and the preview script
packages/eval/          tasks, transcripts, replay, budgets, and comparison reports
profiles/<id>/          one agent type per directory
skills/<name>/SKILL.md  long-form knowledge, advertised but loaded on demand
docs/                   decisions, specs, and writing rules
scripts/                repository checks and the package build
site/                   the product page and the logo, published to GitHub Pages
```

`packages/core` never imports `packages/cli`. The CLI owns every decision about how an event looks; the core owns every decision about what an event means. `packages/eval` depends on `packages/core` and is depended on by nothing.

### Seeing the renderer without credentials

```bash
npm run preview --workspace k9999          # colour on
npm run preview --workspace k9999 -- never # plain, for piping
```

It drives the real translate-and-sink pipeline with a scripted provider in a temporary directory, so the rendered output can be looked at — and changed — without an API key or a `git diff` afterwards.

### Logo

Two drawings, one visual language:

| File | Use |
|---|---|
| `site/logo.svg` | The lockup: the square, an amber `K`, and four nines. 48px and up |
| `site/mark.svg` | The compact mark: the same square and `K`, without the numerals. The favicon and anything below 48px |

The numerals stop being read and start being texture below roughly 48px, so the mark carries the identity there and the wordmark beside it carries the name. Both share the square, the border, and the amber, so they read as one mark at two sizes.

The `.png` files beside them are 512px renders of the same two drawings, for places that will not take an SVG — an avatar, a chat client, a slide. Regenerate them by opening the `.svg` in a browser and screenshotting at 512 by 512.

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

- [`docs/specs/`](docs/specs/README.md) — the contracts for what is not built yet. Start here for direction: seven specs, two shipped and two building.
- [`docs/decisions.md`](docs/decisions.md) — fourteen decision records: why this shape and not the alternatives, each with its cost and a revisit trigger
- [`docs/writing-rules.md`](docs/writing-rules.md) — the eight output rules, with the measurement behind them
- [`site/index.html`](site/index.html) — the product page. No external requests, no JavaScript. Published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml); the workflow fails if any page or drawing under `site/` references an external resource. Open it directly, or export a PDF with `npm run pdf`.
- [`site/logo.svg`](site/logo.svg) and [`site/mark.svg`](site/mark.svg) — the logo, in two sizes of one design
- [`AGENTS.md`](AGENTS.md) — conventions for an agent working in this repository

## Status

Shipped: profiles, prompt assembly, the tool registry, skill resolution, provider registration, the CLI, the two launch commands, the rendering vocabulary with colour and diffs, and the npm package. `k9999@0.1.0` installs and runs from an empty directory. Seventy-two tests, no credentials required.

Building: [SPEC 0004](docs/specs/0004-measurement-and-budget.md), the measurement harness, and [SPEC 0007](docs/specs/0007-rendering-and-sinks.md), whose tier 1 is done and whose tier 2 waits for 0001.

Accepted and unstarted: [SPEC 0001](docs/specs/0001-non-blocking-interaction.md), [0002](docs/specs/0002-reversibility-not-modes.md), [0003](docs/specs/0003-optional-decision-layer.md). The product page marks the three states separately and gives no figures for the third.

## License

MIT
