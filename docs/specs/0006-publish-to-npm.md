# 0006 — Publish to npm

**Status:** `shipped`

Published as `k9999@0.1.0` on 2026-10-05. Kept as the record of what the four constraints cost and how the build asserts.

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

The package is live. `k9999@0.1.0`, published 2026-10-05.

```bash
npm login --registry=https://registry.npmjs.org
npm --workspace k9999 publish
npm view k9999 --registry=https://registry.npmjs.org
```

### The 2FA trap, because it cost two attempts

A granular access token authenticates and appears in `npm token list` as a **Publish token**, and still cannot publish:

```
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/k9999
  Two-factor authentication or granular access token with bypass 2fa
  enabled is required to publish packages.
```

npm's documentation is explicit, and the default is the reason:

> The Bypass 2FA capability applies to tokens with write access and is **set to false by default at token creation**.

`npm token list` does not show the flag, so a write-capable token that cannot publish looks identical to one that can. **Check "Bypass 2FA" when creating it, and remember it cannot be edited afterwards** — a token's permissions are fixed at creation, so a token made without it must be replaced rather than fixed.

### The registry trap

This repository's `~/.npmrc` points at a read-only mirror, so `npm login` without `--registry=https://registry.npmjs.org` authenticates somewhere that cannot accept a publish. `publishConfig.registry` in the manifest keeps the *publish target* correct regardless, but the *credential* has to be issued for the right registry. The token is stored under `//registry.npmjs.org/:_authToken`, and that key is what to check afterwards.

### What `prepublishOnly` guarantees

It runs the build and the full check, so a version failing its own tests cannot be published by accident. Verified: the failed 2FA attempts still ran all 53 tests and produced the tarball before being rejected at the upload.

### Verified after publishing

| Check | Result |
|---|---|
| Registry metadata | `k9999@0.1.0`, MIT, 3 dependencies, bins `k9999` and `kula` |
| Artifact identity | Registry `shasum` `80ea5a74580a3007da235edfcc61db8495dc9732` matches the local build byte for byte |
| npm signature | Present |
| Install from the registry | Both bins resolve from a clean prefix |
| Run from an empty directory | `kula --show` resolves the `data` profile and names `node_modules/k9999/dist/profiles` as the directory it used |
