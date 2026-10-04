# Working in this repository

Notes for an agent making changes here. Read `docs/decisions.md` before changing a boundary.

## Commands

```bash
npm install
npm run check        # tsc --noEmit, then node --test
npm run typecheck
npm run test
npm run k9999 -- --help
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

## Writing style

Code comments explain why, not what. A comment that restates the line below it should be deleted. Docs are prose, and they follow `docs/writing-rules.md` like anything else the model reads.
