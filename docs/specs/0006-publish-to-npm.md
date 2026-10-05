# 0006 — Publish to npm

**Status:** `accepted`

## Problem

The harness runs from a source checkout. Anyone else cannot install it, and three things stand in the way rather than one.

Each was measured before this spec was written, because each changes the design:

**1. Node refuses to strip types under `node_modules`.**

```console
$ node runner.mjs
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]:
Stripping types is currently unsupported for files under node_modules
```

Running the `.ts` sources directly works only because the repository is not inside `node_modules`. An installed package always is. A published package therefore has to be JavaScript, and no amount of `engines` changes that.

**2. The profiles live outside the packages.**

```console
$ cd /tmp/noprofiles && k9999 --list
No profiles directory at or above /tmp/noprofiles. Pass --profiles or set K9999_PROFILES.
```

`resolveProfilesDir` searches upward from the working directory. An installed `k9999` runs in someone else's project, which has no `profiles/` above it, so the copy inside the package is the only one it can reach. A package that installs cleanly and fails on first run is worse than one that does not install.

**3. A published scope is a promise the repository cannot keep.** `@k9999/core` requires owning the `k9999` npm organization. An unscoped name requires nothing.

## Invariant

**`npx k9999` works in an empty directory with no configuration.**

Not "the package publishes". Not "it installs". The artifact must run where a stranger would run it, which is a directory that knows nothing about this project.

## The package

One package, `k9999`, bundling the core workspace package.

| Field | Value |
|---|---|
| `name` | `k9999` (unscoped, verified available) |
| `bin` | `k9999` and `kula`, both pointing at `dist/index.js` |
| `dependencies` | `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `typebox` |
| `files` | `dist`, `README.md`, `LICENSE` |
| `engines` | `node >=22.19.0` |

`packages/core` stays a workspace package for development and is **inlined into the bundle**, so it is a `devDependency` of the CLI and not a runtime one. One package means one version to bump and no skew between the CLI and the core it was built against.

`packages/eval` is not published. It is development tooling, and its tasks assert things about this repository rather than about the package.

### `kula` as a bin name

The npm package `kula` is taken. That does not matter: npm requires *package* names to be unique, while a bin name only conflicts when two installed packages provide the same one.

## The build

`scripts/build-package.mjs` bundles with esbuild and copies the data.

Two things it must get right, both of which were wrong at least once:

- **`packages: "external"` cannot be used.** It marks every bare specifier external, and `@k9999/core` is a bare specifier. The first version of this script produced an 8 KB bundle that still imported core and would have failed on install. The runtime dependencies are listed explicitly instead, and the build fails if the output imports anything not on the list.
- **The build asserts, rather than reports.** It fails when the shebang is missing, when a symbol unique to core is absent from the output, when an undeclared import appears, when `package.json` dependencies and the external list disagree, or when no profiles were copied. Reporting those as log lines would have let the broken bundle through.

## Acceptance criteria

1. `npm pack` then installing the tarball into an empty project provides both `k9999` and `kula` on `node_modules/.bin`.
2. From a directory with no `profiles/` at or above it, `npx k9999 --show` prints the resolved profile and names the shipped profiles directory as the one it used.
3. `npx kula --show` resolves the `data` profile: its own model, its own thinking level, and no `edit` tool.
4. A run with no credential exits 1 and prints the reason, rather than exiting 0 with no output.
5. A project that provides its own `profiles/` takes precedence over the shipped copy, in every command.
6. The build fails if the bundle imports an undeclared dependency, if the shebang is lost, or if core is not inlined.
7. The published `README.md` states the Node version, the credential, and both commands.

## Out of scope

- **Publishing `core` separately.** It is inlined. Extracting it later is a change to this spec, not a detail of it.
- **Release automation.** A `v*` tag that publishes from CI is worth adding once the manual path has been used twice.
- **A versioning policy.** The package is `0.x` and will break.
- **npm provenance or signing.** Worth doing; not before there is a release to sign.
- **Publishing to any registry other than `registry.npmjs.org`.** The repository's `.npmrc` points at a read-only mirror, so `publishConfig.registry` is set explicitly and a publish without it will fail loudly rather than silently succeed somewhere unexpected.

## Publishing

Not yet done. The steps, once a credential exists:

```bash
npm login --registry=https://registry.npmjs.org
npm run build --workspace k9999
npm --workspace k9999 publish
```

`prepublishOnly` runs the build and the full check, so a version that fails its own tests cannot be published by accident. The account needs two-factor authentication, and npm asks for a one-time password on publish.
