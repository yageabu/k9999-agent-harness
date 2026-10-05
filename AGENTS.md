# Working in this repository

Notes for an agent making changes here. Read `docs/decisions.md` before changing a boundary.

## Working on this repository

### Getting a key into the development environment

The provider reads `DEEPSEEK_API_KEY` from the environment. There is no config file, and **the published CLI does not read `.env`**: an agent that loads environment variables from whatever directory it runs in can be redirected by a repository it was asked to inspect. Only the development scripts load one.

```bash
cp .env.example .env
# put the key in it, then:
npm run k9999 -- --show          # no network needed
npm run k9999 -- --print "hello" # a real call
```

`.env` is gitignored; `.env.example` is not, so what is needed is documented without carrying a secret. If you already use Pi, its `~/.pi/agent/auth.json` holds a deepseek key:

```bash
printf 'DEEPSEEK_API_KEY=%s\n' \
  "$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.pi/agent/auth.json')))['deepseek']['key'])")" > .env
```

`npm run k9999` and `npm run eval` pass `--env-file-if-exists=.env`, which prints one line to stderr when the file is absent and continues. That line is expected on a fresh clone.

## Commands

```bash
npm install
npm run check        # tsc --noEmit, node --test, and the site check
npm run typecheck
npm run test
npm run k9999 -- --help
npm run eval -- --scripted --verify-replay
```

`npm run test` uses a scripted provider. It needs no API key and no network. Keep it that way: a test that needs credentials will stop being run.

## Layout rules

- `packages/core` must not import `packages/cli`. The dependency runs one way.
- Nothing in `packages/core` may import from `profiles/` or `skills/` by hardcoded path. Paths are resolved at runtime from the working directory, `K9999_PROFILES`, or an explicit argument.
- A profile is data, not code. If a change needs a new behavior per profile, add a field to `ProfileConfig` and validate it in `parseProfileConfig`.
- Tool names are strings. The only place a name becomes an implementation is `TOOL_FACTORIES` in `packages/core/src/tools/index.ts`.

## Conventions

- ESM only. Relative imports carry the `.ts` extension, because Node 22 runs TypeScript directly and `allowImportingTsExtensions` is on.
- `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess` are on. Build optional properties conditionally rather than assigning `undefined`.
- A tool throws on failure. It does not encode an error into its `content`.
- An unknown tool name, an unknown provider, or an unknown profile is a loud failure at load time, never a silent skip.
- Prefer a separate module over a new branch in an existing one.

## Adding a tool

1. Add `packages/core/src/tools/<name>.ts` exporting `create<Name>Tool(cwd: string)`.
2. Add one row to `TOOL_FACTORIES`.
3. Add the name to the `tools` array of every profile that should have it.
4. Add a test in `packages/core/test/`.

## Adding a profile

1. Create `profiles/<id>/profile.json` and `profiles/<id>/system.md`.
2. Follow `docs/writing-rules.md` for the prompt's `## Response shape` section.
3. Run `npm run check`. The suite fails on an unknown tool name or an empty prompt.

## Adding a provider

`providerFactory()` in `packages/core/src/model.ts` is the only switch. Import the factory, add one case, add a test.

## Publishing the package

`packages/cli` is the publishable package and its `name` is `k9999`, not `@k9999/cli`. `packages/core` is a `devDependency` because the build inlines it; `packages/eval` is not published at all.

```bash
npm run build --workspace k9999    # bundle + copy profiles and skills
npm pack --workspace k9999         # k9999-<version>.tgz
```

Two registries, one manifest. npmjs gets the unscoped `k9999`. GitHub Packages requires the name to be scoped to the owning account, so `scripts/publish-github-packages.mjs` stages a copy as `@yageabu/k9999` and publishes that; it never modifies the repository manifest, so a failure part way through leaves the workspace as it was. The workflow asks the built-in `GITHUB_TOKEN` for `packages: write`, which is why no personal token appears in the docs.

Two traps, both of which the build script now fails on rather than logging:

- **`packages: "external"` in esbuild marks every bare specifier external, and `@k9999/core` is a bare specifier.** The bundle came out at 8 KB with core still imported and would have failed on install. List the runtime dependencies explicitly; the build fails if the output imports anything else.
- **`dependencies` and the external list must agree.** If they drift, the package installs without a module it imports.

Anything the build declares must be true of the artifact. `scripts/build-package.mjs` asserts the shebang, that a symbol unique to core is present, that no undeclared import remains, that the manifest matches, and that profiles were copied.

- **Credentials come from the environment only.** Never add a `.env` loader to `packages/` — a published CLI that reads a file from the current directory can have its own key, and its `NODE_OPTIONS`, chosen by whatever repository it was pointed at. The development scripts load `.env` because they only ever run here.
- **An answer goes to stdout, progress to stderr.** `k9999 --print "..." > out.txt` must leave only the answer in the file. `createTextSink` takes two writers for this.

## Working on the renderer

Two surfaces share one transcript, so the formatting lives in one place:

- `packages/cli/src/render/vocabulary.ts` — `RenderItem` and `RunState`. The agent produces these; no terminal concepts appear in them.
- `packages/cli/src/render/translate.ts` — `AgentEvent` to `RenderItem`.
- `packages/cli/src/render/layout.ts` — **the lines themselves**. Both the text sink and the TUI consume this, because two renderings of one event would drift.
- `packages/cli/src/render/text-sink.ts` — streamed, incremental, one item at a time. What it adds is a cursor across two streams.
- `packages/cli/src/tui/` — `TranscriptView` (accumulates items, returns the *last* N lines), `StatusBar`, and the app.

Rules that are easy to break:

- **`packages/core` must not import from `render/` or `tui/`.** The description flows one way.
- **Colour comes from `node:util`'s `styleText`, with `validateStream: false`.** `styleText` suppresses colour itself when the stream is not a TTY, which would silently disable the explicit `"always"` mode.
- **One logical cursor across two streams.** Print mode sends the answer to stdout and activity to stderr, so a newline must follow whichever stream was written to last.
- **`closeInline` uses `breakLine`, never a bare `\n`.** Text that already ended its line must not gain a blank one.
- **The transcript returns the newest lines.** `VStack` slices children from the start, so returning the whole history would show the oldest and hide the newest.
- **A VStack does not allocate height.** Each child returns its natural size, so the transcript reads the terminal to fit itself.
- **The editor needs `tui.setFocus(editor)`.** Without it, typing does nothing and nothing reports why.
- **Paths are absolute in the data and short on screen.** Tools report facts; `shorten()` is display only.
- **No diff library.** An edit is an exact string replacement, so the tool already holds both sides.

### Node runs these `.ts` files directly, with limits

There is no build step for development: Node strips the types. Stripping removes types without generating code, so:

- **Parameter properties are a syntax error at runtime.** `constructor(private readonly x: T)` throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Declare the field and assign it.
- Enums, namespaces, and decorators are also unavailable.

And one behaviour worth knowing rather than fixing: the editor treats a chunk containing text *and* `\r` as a paste and does not submit it. A real terminal delivers keys separately, so this only bites a coalescing transport. `packages/cli/test/tui.test.ts` asserts both forms so the difference is recorded.

Look at the output rather than imagining it: `npm run preview --workspace k9999`. The TUI has no such script — its tests drive it through a headless `Terminal` and assert on the captured frames.

## Working on the measurement harness

`packages/eval` has conventions that are easy to break without noticing, because every one of them exists to stop a report from lying to its author.

- **Every task needs a deterministic success predicate.** A `task.json` without `check` fails to load. A predicate lives in a command or a file, never in a model's opinion, because a model grader and the thing being graded share a bias.
- **A breached run is never a success**, even when the predicate happens to pass. A run cut short after its side effects landed can leave the fixture passing while the unfinished work goes unnoticed.
- **Never subtract estimated figures from reported ones.** The scripted provider estimates tokens from character counts and reports every cost as zero. `buildReport` refuses a delta across mixed sources, the same way it refuses one across a degraded run.
- **A degraded run's task leaves every delta.** When a component fell back, the numbers describe the fallback. The task is named in `report.warnings`, not dropped quietly.
- **Replay must reproduce every deterministic metric.** `DETERMINISTIC_METRIC_KEYS` excludes `wallMs` and nothing else. A difference on any other key means the harness is not deterministic, and that is a bug, not a tolerance to widen.
- **Do not compare tool surfaces from a recording.** A transcript is a recording of the model, so replaying it under a different tool set feeds the agent calls to tools it does not have. The CLI refuses this.

Run `npm run eval -- --scripted --verify-replay` after touching anything in `packages/eval`. It needs no credentials.

## Writing style

Code comments explain why, not what. A comment that restates the line below it should be deleted. Docs are prose, and they follow `docs/writing-rules.md` like anything else the model reads.
