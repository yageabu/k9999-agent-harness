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

---

## 0009 — The core never blocks on a human

**Status:** accepted, with the substrate corrected below.

**Context.** A kernel that asks a human by awaiting a promise has exactly one place the answer can come from. Every other channel waits for a turn that will never finish. Pi's WeChat bridge stalls for this reason: a confirmation in the terminal, nobody at the terminal, and the WeChat side waits forever. An unattended agent that blocks is also indistinguishable from one that crashed.

This record originally said `AgentHarness` already supplies the substrate and that the decision was to adopt it. **That was wrong.** `AgentHarness` is not published: `pi-agent-core` 1.0.2 and 1.0.4 each export five modules — `agent`, `agent-loop`, `proxy`, `stream-fn`, `types` — and no package under `@earendil-works` contains the name. The `harness/` subtree exists in a 0.84.2 source checkout and was gone before 1.0.x shipped.

The error was reading a repository checkout rather than the installed package. It is the same class as trusting a version number, and it is worth the ink here because it is the mistake this project keeps warning about.

**Decision.** Every human interaction is a durable record with an address, a deadline, and a default action, and the substrate that makes it durable is **built here** rather than adopted. A `Storage` seam over immutable entries and mutable registers, an operation state that is total after every transition, and a `resume()` that reads it.

**Consequences.** This is now the largest single item in the project, and it is coupled to [SPEC 0001](specs/0001-non-blocking-interaction.md), which narrows to interactions-as-records until it lands. Durable state becomes mandatory, which moves the project from a stateless single process to one that must choose and ship a store — a deployment question, not a refactor.

In exchange, three failures stop being possible once it is built: a blocked turn, a lost answer after a crash, and a redelivered message starting a second turn. Until then, an interrupted turn is lost, and the interface should say so rather than imply otherwise.

**Revisit when** something published supplies the same substrate. The check is what the installed package exports, not what a checkout contains.

**Rejected.** Fixing this inside a channel integration would leave the block in the core, where every future channel inherits it. A timeout-only fix converts a hang into a failure without ever recovering the answer.

---

## 0010 — No Plan mode; irreversibility is the axis

**Status:** accepted

**Context.** Plan mode stops an agent from making irreversible changes before it understands the situation. It does this with a mode the user must enter before anything happens, which means the agent behaves well only when someone remembered.

**Decision.** Do not build a Plan mode and do not recommend one. Two replacements cover the same ground:

1. **Planning is a profile.** `tools: ["read", "bash"]` with no write tool is a plan mode, expressed as data. The `data` profile already does this and a test asserts it cannot write.
2. **The gate is irreversibility.** A tool declares itself `read`, `reversible`, or `irreversible`, and the core gates on that. `edit` inside a repository is reversible by `git checkout`; `rm -rf` is not.

**Consequences.** The property applies whether or not anyone configured it, which a mode cannot. The cost is that someone must classify each tool, and `bash` cannot be classified statically — its command is not known until it arrives. The declaration is therefore a floor, raised by a read-only allowlist and, when available, by a decision model. An unclassifiable command falls back to the floor: irreversible.

**Revisit when** three values prove too coarse. A finer scale invites arguments about classification rather than about behavior, so it should be forced by a case, not by taste.

**Rejected.** A dry-run mode is also a mode. Diff previews before an edit are a nicety, not a gate, because an edit in a repository already is reversible.

---

## 0011 — A decision layer beside the main model

**Status:** accepted

**Context.** An agent makes many small decisions per turn, and a frontier model is the wrong instrument for all of them. Asking it whether a message is a question or an instruction spends a round trip and a large prompt to obtain one bit, and returns that bit inside prose that must be parsed and can be malformed.

Jev (TypeSafe AI, `jev-latest`, `POST /v1/systemone`) is a decision model. It does not generate text. It answers named questions of three kinds (`noul`, `choice`, `score`) and returns typed values with `confidence`, full `probabilities`, and its own token `usage`.

The third of those is decisive: it turns "the decider might be wrong" from a risk into a threshold with a measurable error rate. The second is what makes its cost accountable rather than a matter of faith.

**Decision.** Jev is called through a `Decider` interface, never imported directly, with a scripted implementation required from the start so decision paths stay testable without a network. Its rules are taken from `pi-mcp-adapter`, which already ships a Jev integration: deterministic code narrows before the decider chooses; every choice offers an escape label; the distribution is read rather than the argmax; optimizations fail open and safety fails closed; degradation is reported rather than hidden; responses are validated as untrusted input; and every call carries the sources it discloses.

**Consequences.** A network dependency enters the per-turn path, so its latency decides where it may be used, and that latency is currently unmeasured. A probe precedes any wiring. Fixed per-call cost also means a decision layer can lose money on a short turn while winning on a long one.

**Rules that bound it.** Anything decidable by code is not a decision. An em-dash is a regular expression, a test result is an exit code, a file's existence is a `stat`. The list of permitted questions is short and grows only by adding a row with a stated failure mode and a test.

**Revisit when** the probe shows a round trip too slow for the interactive channel, in which case the layer applies only to unattended work.

**Rejected.** A fallback to a local model when Jev is unavailable would add a third source of judgment and a third failure mode. Fail-open and fail-closed are the only two answers, and which one applies depends on whether the decision optimizes or protects.

---

## 0012 — Measurement precedes optimization

**Status:** accepted

**Context.** Every figure on the product page currently comes from somewhere else. The startup latency was measured once by hand and the output-rule table is another project's published study. Decision record 0007 exists because that study measured, and the intuition lost.

Without a harness of its own, "fewer tokens, same performance" is not a claim. It is also the claim most likely to be believed on the strength of a number that omits the turns it cost.

**Decision.** `packages/eval` is built before any optimization it would judge. Two modes: `probe` for the cost of one call, `task` for a fixed task set end to end. Every task carries a deterministic success predicate defined outside the measured configuration. Three runs minimum. Every metric recorded, including the decision layer's own tokens and whether a component degraded.

Alongside it, a budget per task: a cost, wall-time, and turn ceiling that stops the run and states the reason rather than adapting to stay inside it.

**Consequences.** No optimization merges without a before-and-after over the fixed set, which makes every change more expensive and removes the ability to ship a plausible improvement on intuition. The payoff is the same as 0007's: when the intuition is wrong, the repository says so before the page does.

**Revisit when** never, in the sense that this is a standing constraint rather than a choice. It is recorded here because a constraint nobody wrote down is the first one dropped.

**Rejected.** A model-graded rubric would let the eval judge quality without a fixture, and it is the trap 0007 describes: the grader and the graded share a bias. A leaderboard would answer a question nobody asked, since the question is whether a change to this harness helped.

---

## 0013 — The decision layer is optional, and off by default

**Status:** accepted. Narrows 0011.

**Context.** 0011 introduces Jev as a decision layer and argues for it on cost, latency, and its own reported usage. It leaves one thing unsaid: what happens without it.

A hosted decision service is a dependency. It needs a key, a network, and a vendor that keeps running, and an owner who has none of those should still get a working harness rather than a configuration error. 0011 as written reads as though the layer were the design, when it is an optimisation on top of one.

**Decision.** The decision layer is optional and off by default. Every decision point states a real off-path, and the off-path is what the harness does today:

| Decision | Off-path |
|---|---|
| Does this message need a human? | The agent asks. 0009 makes asking non-blocking, so this stays workable |
| Which tools does this turn need? | All of the profile's tools are declared |
| Is this command irreversible? | The static allowlist decides; anything else falls to the floor and is treated as irreversible |
| Does the output satisfy the goal? | The model stops or continues on its own |
| Does this task need a larger model? | The profile's model is used |

Selecting the layer without a usable key fails at load rather than falling back. A run that quietly took the off-path while its configuration promised otherwise would report numbers describing something other than the configuration under test.

**Consequences.** This is the second time a component's presence became part of what a measurement means. `degraded` was the first: a run where a component fell back describes the fallback. Now a run where a component was switched off describes the off-path. Reports already refuse to subtract across a differing `usageSource`, and the same refusal extends to a differing component set.

The important consequence is about safety rather than cost. **The reversibility gate does not depend on the decision layer.** The allowlist and the floor are local, free, and always available, so an unattended run is protected whether or not any key is configured. The decision layer improves classification for commands the allowlist cannot reach, which is quality on top of a gate that already works.

**Revisit when** a decision point cannot be given a working off-path. That would mean the point is not a decision but a required capability, and it belongs somewhere other than this layer.

**Rejected.** Making the layer required would trade a harness that always works for one that works when a vendor does. Falling back silently from `"jev"` to `"off"` would be worse: the configuration would say one thing and the measurement would describe another, which is precisely the failure 0007 and 0012 exist to prevent.

---

## 0014 — Two launch names for two agent types

**Status:** accepted

**Context.** Two agent types ship: one writes code and is judged by a verifier, the other reads data and is judged by whether its numbers are traceable. They differ in tools, thinking budget, and response shape.

Expressing the second as `k9999 -p data` makes an identity into a flag. A name is remembered; a command line with a mode is looked up.

**Decision.** Two commands, one implementation. `k9999` defaults to the `code` profile and `kula` to `data`. Both are bins pointing at the same entry module, and the launch name only supplies a default.

The profile ids stay `code` and `data`. Renaming `profiles/code/` to `profiles/k9999/` would put the project's own name inside its lookup namespace, and a failure would read `Unknown profile "k9999"` in a repository called `k9999-agent-harness`.

**Consequences.** A test asserts `kula --profile code` resolves exactly as `k9999 --profile code`, so the equivalence is enforced rather than intended. An unrecognized launch name — the entry run by path, as the test suite does — leaves the default at `code` instead of failing, because failing there would break the suite for a cosmetic reason.

**Revisit when** a third agent type exists. Two names are a mapping; three are a pattern, and a pattern deserves a different mechanism.

**Rejected.** Two packages would duplicate argument parsing and event rendering for a shared implementation. Keeping a single command with `-p` would keep working and keep reading as one product with modes.

---

## 0015 — Borrow the observer, draw only what the wire does not carry

**Status:** accepted

**Context.** [SPEC 0007](specs/0007-rendering-and-sinks.md) specifies a tier 3 dashboard over eight rows: session/cwd/model, turns/wall time, tokens and cost, tool calls by name, skills declared and loaded, components mounted and degraded, pending interactions, and a verification verdict. The plan was to draw all eight.

Measured against an out-of-process observer, that plan is redundant in half its rows. ccglass is the working example: a local reverse proxy that sets the client's base-URL variable, so the client makes a plain HTTP hop to localhost and the proxy makes the HTTPS hop — no CA certificate and no certificate pinning, because the client's TLS is never touched. It renders the full system prompt, every tool schema, the message history, tokens, cache, cost, a turn-to-turn diff, and the agent loop, for fifteen clients, with no change to any of them.

**Two of the eight rows are on the wire. Four are not on it at all.** A proxy sees everything the model sees and nothing the harness knows: an outstanding interaction, a degraded component, and a verdict are never sent anywhere, so nothing outside the process can render them. Skills sit between the two — their text lands in the system prompt, but which ones loaded is a harness fact.

A second measurement is a defect rather than a trade-off. `pi-ai`'s deepseek provider pins its endpoint:

```js
baseUrl: "https://api.deepseek.com",
```

No pi-ai provider reads a base-URL variable except Azure OpenAI. So `DEEPSEEK_BASE_URL` does nothing and **K9999 is not observable by any proxy today**, nor is it testable with a stand-in endpoint that is not the network.

**Decision.** Tier 3 draws only what the wire does not carry — the four rows a proxy cannot fill. The model-facing rows are borrowed rather than rebuilt. In exchange, the model endpoint becomes configurable, because an observer cannot attach to a harness that pins its own endpoint.

**Consequences.** Tier 3 shrinks from eight rows to four, and the enabling change is small: `baseUrl` is a plain field on `Provider`, so an override preserves the catalog and auth. A test asserts that preservation without a network call, so it holds when the endpoint is unreachable.

The borrowing is not free of direction: it makes an external tool part of how this project is debugged, and that tool is one maintainer's side project, last pushed three months before this record. That is acceptable for a debugging aid and not acceptable for a dependency, which is why nothing imports it.

**Revisit when** an observer needs harness state to be useful, rather than only model state. That is the point at which the exchange stops being favourable, and the answer is a channel — which [SPEC 0001](specs/0001-non-blocking-interaction.md) already specifies — not a larger proxy.

**Rejected.** Building the request inspector in K9999. It is the harness observing itself, which is strictly worse at the one job that matters: it can see the bytes it intended to send, not the bytes that went out. **Doing nothing.** Leaving the endpoint pinned costs more than the dashboard: a harness that cannot be pointed at a stand-in endpoint cannot be integration-tested without the network.
