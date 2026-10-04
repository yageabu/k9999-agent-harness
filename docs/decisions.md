# Decisions

Each decision records what was chosen, what was rejected, and what it costs. When a decision changes, edit the record instead of deleting it.

---

## 0001 — Build on `pi-agent-core`, do not fork Pi

**Status:** accepted

**Context.** Pi ships as one application package (`@earendil-works/pi-coding-agent`) with the kernel split into libraries beneath it: `pi-agent-core` (agent loop, sessions, compaction), `pi-ai` (models and providers), `pi-tui` (rendering), and `pi-protocol`/`pi-client`/`pi-server` (out-of-process control). A separate fork of the application already exists and would need maintenance.

**Decision.** Depend on `pi-agent-core` and `pi-ai`. Own everything above them.

**Consequences.** Upstream work on the agent loop, tool-call protocol, compaction, and provider coverage arrives through `npm update`. In exchange, every application-level feature is ours to write: there is no `ExtensionAPI` to borrow, and no extension ecosystem to inherit. A Pi extension is not a K9999 extension.

**Rejected.** A thin layer that depends on the full Pi application would ship in a week, but the harness would then be a configuration of someone else's CLI rather than a harness. Copying the whole fork would mean maintaining two Pi trees.

---

## 0002 — Do not adopt Cordis

**Status:** accepted

**Context.** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is built on [Cordis](https://github.com/cordiverse/cordis), a dependency-injection and plugin framework. Cordis itself is small: nine source files, about 106 KB of TypeScript, an npm tarball of 69 KB, and two runtime dependencies. DSH around it is not small: 328 packages, 34 MB of TypeScript, nine vendored framework packages carrying a 23-entry local divergence log.

Cordis buys four things, of which two are hard to retrofit:

| Cordis feature | Value here |
|---|---|
| Service keys plus `inject` for load ordering | Low. There is one wiring site, `createHarness`. |
| Typed events with five dispatch modes | Low. One subscriber today. |
| Reversible effects and per-plugin teardown | High to retrofit, low value now. Nothing unloads. |
| Config-grammar plugin trees with hot reload | High to retrofit, and the reason to reconsider later. |

**Decision.** No Cordis. Plain functions and explicit construction.

**Consequences.** `createHarness` is the whole composition. Adding a capability means adding a module and one line in that function. This stays workable while the composition fits in one readable function, roughly under twenty moving parts.

**Revisit when** a profile must change which provider implements a capability, or the agent must mount code at runtime. That is a real scenario for a self-modifying harness, and Cordis is the strongest available answer to it.

**Rejected.** Adopting Cordis now would spend the first month on container discipline rather than on the agent, for two of four features that nothing yet needs.

---

## 0003 — Rust as a leaf, not as a core

**Status:** accepted

**Context.** Codex ships a 258 MB Rust binary containing the agent and the TUI, with a 7 KB Node shim for npm distribution and a 79 KB TypeScript SDK that spawns the binary over a protocol. Measured on this machine:

| Invocation | Wall time |
|---|---|
| Raw Rust `codex --version` | 10 ms |
| `codex --version` through the npm shim | 465 ms |
| `pi --version` (Node) | 415 ms |
| `node dist/bundle/cli.js --version` (Node) | 320 ms |

The npm distribution path erases the kernel's advantage. Codex installs at 309 MB against Pi's 21 MB.

**Decision.** Stay in one process and one language. If Rust is needed, it arrives as a native addon for one specific job, not as a second core with a wire protocol.

**Consequences.** No cross-language protocol, no generated types, no cross-compilation matrix, and extensions stay in one language. Rust remains available for the three jobs it is actually better at: OS-level sandboxing, process-tree and PTY control, and CPU-bound work.

**Rejected.** A Rust core with a TypeScript UI would be slower to launch under npm than the current single-process design, while adding a protocol boundary. The same layering is achievable with package boundaries, which is what `packages/core` and `packages/cli` are.

**Revisit when** startup latency is measured as the bottleneck, in a path that spawns many short-lived processes. Measure before deciding: strip heavy imports from the CLI entry before writing any Rust.

---

## 0004 — A profile is the only agent-type mechanism

**Status:** accepted

**Context.** A code agent and a data-analysis agent differ in model, thinking level, available tools, and behavior. Those differences could live in CLI flags, in one prompt with conditional sections, or in separate directories.

**Decision.** One directory per agent type, holding `profile.json` and `system.md`. Nothing else selects agent behavior.

**Consequences.** `k9999 -p data` is the entire invocation. A profile is reviewable as two files in a diff. The cost is that a new agent type is a new directory, and that the profile cannot express conditional behavior within one prompt.

**Rejected.** Conditional sections inside one prompt make it impossible to read what a given agent actually receives. CLI flags scatter an agent's definition across shell history.

---

## 0005 — Prompt assembly order is a contract

**Status:** accepted

**Context.** `buildSystemPrompt` produces four sections in a fixed order: the authored `system.md` with `{{cwd}}` interpolated, then `## Available tools`, then `## Skills`, then the working directory.

**Decision.** The generated sections come after the authored text, and the order is documented and tested rather than incidental.

**Consequences.** A profile author never maintains a tool list by hand, and cannot accidentally reorder the prompt. Moving a boundary later is a documented change with a test, not a silent one.

**Note.** Text placed earlier in a prompt carries more weight and is more stable for provider-side prompt caching. Authored behavior rules come first for both reasons. Generated lists, which change when a profile's tool list changes, come after.

**Rejected.** Interpolating `{{tools}}` into the authored text would let the author place the list anywhere, at the cost of every profile needing a marker and validation for its absence.

---

## 0006 — Tools are addressed by name through one registry

**Status:** accepted

**Context.** A profile declares `"tools": ["read", "bash", "edit"]` as strings, but a tool is a TypeScript object closed over a working directory.

**Decision.** `TOOL_FACTORIES` in `packages/core/src/tools/index.ts` is the only mapping from name to implementation. An unknown name throws at load time.

**Consequences.** Adding a tool is one module and one row. A typo in a profile fails immediately with the list of valid names, instead of silently running an agent with fewer tools than intended.

**Rejected.** Treating an unknown name as a warning would let a profile claim capabilities it does not have, which is the failure mode most likely to go unnoticed.

---

## 0007 — Eight output rules, not ASD-STE100

**Status:** accepted

**Context.** ASD-STE100 is a controlled natural language for aerospace documentation, maintained by ASD and published as Issue 9 in January 2025. It is a copyright and trademark of ASD. It has roughly 53 rules and a controlled dictionary of about 900 approved words.

The largest measured study of STE as an agent instruction reports that the full rule set reduces output tokens by roughly 19% across nine models. The same study's own headline finding is that an eight-line prompt beats it:

| Condition | Words | Sentences | Em-dashes | Bold spans | Headers | List items |
|---|---|---|---|---|---|---|
| No instruction | 249 | 18.9 | 32 | 52 | 19 | 35 |
| Full STE skill | 171 | 13.4 | 17 | 24 | 3 | 22 |
| Eight-line prompt | 150 | 5.8 | 2 | 0 | 0 | 0 |

The author's conclusion: the skill wins only on its own linter, and more than fifty rules dilute the five that matter.

**Decision.** Extract the rules that carry the effect and write them directly. Do not cite the standard, and do not ship its dictionary. See [`writing-rules.md`](writing-rules.md).

**Consequences.** The rules fit in a profile's `## Response shape` section and are individually checkable. The rules lose STE's status as a defensible external standard, which matters if the output is a regulated document.

**Revisit when** the harness produces user-facing documentation for a non-native-English audience. That is the case STE was designed for.

---

## 0008 — No MCP support yet

**Status:** accepted, deferred

**Context.** MCP servers reach the model in one of two ways: every server's tools are declared directly, which spends context on tools that a given session never calls, or tools are discovered on demand. Pi 1.x implements the second through a `codemode` sandbox and an `exposure` setting, plus a built-in `mcp` extension.

**Decision.** Defer. Register MCP tools as ordinary tools through `TOOL_FACTORIES` when the need is concrete, and write the discovery layer only once the context cost is measured on real servers rather than assumed.

**Consequences.** Connecting one MCP server today means writing one module. That is cheap and honest.

**Rejected.** Declaring every MCP tool directly would spend context on every session. Building a sandboxed discovery layer is a project of its own and should not precede the evidence that it is needed.
