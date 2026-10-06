# K9999 Agent Harness

**Never blocks. Measures first.**

Built on [Pi](https://github.com/earendil-works/pi) — thanks to its authors for shipping the agent kernel, the model layer, and terminal rendering as reusable libraries rather than one application. `pi-agent-core` and `pi-ai` do the work this project stands on, and without that split K9999 would not exist.

```bash
npx k9999 --print "what does this function do?"
```

[Product page](https://yageabu.github.io/k9999-agent-harness) · [npm](https://www.npmjs.com/package/k9999) · [source](https://github.com/yageabu/k9999-agent-harness)

K9999 owns everything above them: profiles, prompt assembly, the tool registry, the launch commands, and the measurement harness. It is not a fork of Pi and not a wrapper around it.

Two launch commands, one implementation:

| Command | Agent | Tools |
|---|---|---|
| `k9999` | writes and fixes code | read · bash · edit |
| `kula` | reads data and reports what it says | read · bash |

Neither blocks on a human, and neither is judged by a model's opinion of its own output.
## Status

Early. Two profiles, three tools, one CLI, one interactive TUI. Every claim in this file is verified by `npm run check`.

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
npm run check          # typecheck, the test suite, and the site check. No API key needed
npm run k9999 -- --list
npm run eval -- --scripted --verify-replay   # the measurement harness, also unauthenticated
```

`k9999 update` reports whether a newer version is published. It exists because of version drift: an installed copy from months ago, next to a repository that has moved on, looks exactly like a missing feature. That is not hypothetical — it cost a debugging session.

Then, with a key set:

```bash
npm run k9999 -- --print "what does packages/core/src/prompt.ts do?"   # code
npm run kula --show                                                   # data: the resolved config
npm run kula -- --print "how many ERROR lines are in the log?"
```

Set `DEEPSEEK_API_KEY` before a run that talks to a real model. The test suite uses a scripted provider and needs no credentials.

For development there is a `.env` instead of an export:

```bash
cp .env.example .env    # then put the key in it
npm run k9999 -- --print "hello"
```

**The published package does not read `.env`.** An agent that loads environment variables from whatever directory it runs in can be redirected by a repository it was asked to inspect. Only the development scripts load one; installed copies read the environment and nothing else.

### Install it as a package

Published as [`k9999`](https://www.npmjs.com/package/k9999):

```bash
npx k9999 --show        # no install, and no clone
npm install -g k9999    # both commands on PATH
```

GitHub Packages carries the same build under a scoped name, because that registry requires it:

```bash
npm install -g @yageabu/k9999 --registry=https://npm.pkg.github.com
```

That registry needs authentication **even for public packages**, so npmjs stays the path in the instructions above. The name is scoped only for the GitHub publish; `scripts/publish-github-packages.mjs` stages a copy and never modifies the repository manifest.

### Setting the API key

An installed copy reads its credential from the environment. There is no config file and no command that sets one once a session is running, so the two surfaces differ in when you can supply it.

**The interactive TUI is long-running**, so a variable prefixed to one command never reaches it. Export it first, or put the line in your shell profile and set it once:

```bash
export DEEPSEEK_API_KEY=sk-...
k9999 --tui
kula --tui
```

**A single command** can carry it inline, which keeps it out of every process that follows:

```bash
DEEPSEEK_API_KEY=sk-... k9999 --print "what does this function do?"
```

Both surfaces start without a key, because the model is called only when you submit a prompt. So a missing key arrives after you think the install worked:

```console
$ k9999 --tui
> hello
error Provider is not configured: deepseek
```

`--print` exits 1 on that error and writes nothing to stdout. `k9999 --show` never needs a key, so it is the fastest way to check a configuration without a credential. The development scripts are the only thing that reads a `.env`; see the note in the quickstart for why installed copies do not.

To build and publish it yourself:

```bash
npm run build --workspace k9999     # bundles to packages/cli/dist
npm pack --workspace k9999          # k9999-<version>.tgz
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

### The interactive TUI

```bash
npm run k9999 -- --tui    # the code agent
npm run kula -- --tui     # the data agent, with its own block logo
```

It starts without credentials, because the model is called only when you submit a prompt. `ctrl+o` expands the key help and the loaded resources, `escape` stops a running turn, `ctrl+c` clears and twice leaves, and `ctrl+d` leaves on an empty prompt. The help names only keys that are handled, and a test asserts both directions.

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
- [`docs/decisions.md`](docs/decisions.md) — fifteen decision records: why this shape and not the alternatives, each with its cost and a revisit trigger
- [`docs/writing-rules.md`](docs/writing-rules.md) — the eight output rules, with the measurement behind them
- [`site/index.html`](site/index.html) — the product page, live at <https://yageabu.github.io/k9999-agent-harness>. No external requests, no JavaScript. Published to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml); the workflow fails if any page or drawing under `site/` references an external resource. Open it directly, or export a PDF with `npm run pdf`.
- [`site/logo.svg`](site/logo.svg) and [`site/mark.svg`](site/mark.svg) — the logo, in two sizes of one design
- [`AGENTS.md`](AGENTS.md) — conventions for an agent working in this repository

## Status

Shipped: profiles, prompt assembly, the tool registry, skill resolution, provider registration, the CLI, the two launch commands, the rendering vocabulary with colour and diffs, and the transcript TUI with its startup block, `ctrl+o` help, and two-line footer. The published package installs and runs from an empty directory. The suite is 135 tests and needs no credentials. Which version is on npm is `npm view k9999 version`; this file does not restate it, because that claim drifted twice already.

Published to npmjs as `k9999`. GitHub Packages carries the same build as `@yageabu/k9999`, because that registry requires the name to be scoped to the owning account; the workflow asks the built-in `GITHUB_TOKEN` for `packages: write` so no personal token is involved. Note that **GitHub Packages requires authentication even for public packages**, which is why npmjs remains the install path in the README.

Building: [SPEC 0004](docs/specs/0004-measurement-and-budget.md), the measurement harness, and [SPEC 0007](docs/specs/0007-rendering-and-sinks.md), whose tier 3 is the full-screen dashboard.

Accepted and unstarted: [SPEC 0001](docs/specs/0001-non-blocking-interaction.md), [0002](docs/specs/0002-reversibility-not-modes.md), [0003](docs/specs/0003-optional-decision-layer.md). The product page marks the three states separately and gives no figures for the third.

## Support

The measurement harness is built and unproven. Every figure it can report today comes from a scripted provider, because a real run costs money this project does not have. `probe` mode and the fixed task set are both waiting on that.

**If you work at a model vendor and can give this project API quota, that is the most useful thing you can contribute.** Any provider with tool calling is useful. The harness stays provider agnostic by design, and `providerFactory()` in `packages/core/src/model.ts` is the only switch.

Email **yageabu@163.com**. Say which model, how much quota, and what you want measured.

## License

MIT
