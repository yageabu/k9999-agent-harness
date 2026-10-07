# 0011 — The security chain

**Status:** `building`

**Link 1 is implemented.** `toolEnvironment` builds a subprocess environment from
an allowlist, `resolveCredentials` asks the provider for the value it should scan
for rather than hardcoding a variable name, and tool output is redacted before it
is truncated. Measured on this repository, before and after:

```console
$ printenv DEEPSEEK_API_KEY | wc -c    # 36 before, 0 after
$ env | wc -l                          # 49 before, 10 after
```

**The allowlist belongs to the execution environment, not to a tool.** That was
not obvious and it cost a measurement to find out. `NodeExecutionEnv` takes a
`shellEnv`, which looks like the place for it, and is not:

```js
function getShellEnv(baseEnv, extraEnv, inheritEnv = true) {
    if (!inheritEnv) return { ...extraEnv };
    return { ...process.env, ...baseEnv, ...extraEnv };   // process.env is underneath
}
```

`process.env` is spread **under** `shellEnv`, so a `shellEnv` allowlist is an
override layer rather than a filter — and pi-durable's own `bash` tool passes
`inheritEnv: true`, so the migrated harness had the same leak in the same shape.
Measured through `NodeExecutionEnv` with the allowlist set:

```console
shellEnv + inheritEnv: true    -> 36 bytes, 48 variables   # the leak
shellEnv + inheritEnv: false   ->  0 bytes,  3 variables
```

So `guardedEnv` wraps an `ExecutionEnv` and refuses an inherited environment
whatever the caller asks for. A wrapper rather than a flag because it protects
every tool that goes through the environment — pi-durable's own, K9999's, and any
extension added later. **A tool that forgets to ask is the normal case, and this
is what makes forgetting safe.**

It does not redact, deliberately: a credential split across two `onOutput`
chunks does not match the value being looked for, so per-chunk redaction would
look like protection and miss the case that matters. Redaction stays in the tool,
on the assembled result.

Links 2, 3, and 4 are not built.

## Problem

K9999 runs a command the model wrote. That is the product, and it is also four
openings, three of which are unaddressed and one of which is a confirmed hole.

**The confirmed hole.** `packages/core/src/tools/bash.ts` spawns with no `env`
option, so the child inherits the entire process environment:

```ts
const child = spawn("/bin/bash", ["-c", params.command], { cwd, stdio: [...] });
//                                       ^ no env: the key is in here
```

`printenv DEEPSEEK_API_KEY` returns the key. The result is a tool result, tool
results are committed entries, and entries are sent to the provider on the next
turn. The key does not leak once; it is stored, in the clear, in a file the
project keeps, and it is redelivered to a third party every turn until the
session ends. Nothing rejects it and nothing reports it.

The other three are absences rather than defects: nothing decides whether a
command may run, nothing decides where it may connect, and nothing records that
it ran.

**This is not a hardening pass on a finished feature.** It is the difference
between a harness a person can leave running and one they must watch. That
distinction is the whole reason `bash` is a tool rather than a suggestion.

## Invariant

**The agent cannot read a credential it was not given, cannot take an action the
operator did not allow, cannot send what it read to somewhere it was not told to,
and what it did can be read back afterwards.**

Each clause is one link, each link is a separate mechanism, and each has a test.
They are ordered by how much they cost to leave open.

## Link 1 — Credential isolation

**The child gets an environment that was constructed, not inherited.**

```ts
/** An allowlist, so a variable added to the host later is not silently granted. */
function toolEnvironment(base: Record<string, string>, allow: readonly string[]): Record<string, string>
```

Three rules, and the third is the one that is usually missed:

1. **The provider credential never enters a child.** Not by name and not by
   prefix — an allowlist of names, not a denylist of patterns.
2. **The environment is built per call** from the documented set the tools need:
   `PATH`, `HOME`, `LANG`, `TERM`, and whatever the profile declares. A tool that
   needs more says so and it is a reviewable line.
3. **Output is scanned before it is committed.** A credential that reached a
   child some other way — a file, a `.env`, `git config` — arrives in stdout. The
   scan is against the values of the credentials this process holds, so it does
   not need to guess a format. A match is redacted and the turn is marked
   degraded, because a redaction that is not reported is a silent edit to a tool
   result the model is reasoning about.

Rule 3 is a backstop, not the mechanism, and the spec says so: it cannot catch a
credential the process never held, and a scan that is trusted as the primary
defense is how rule 1 gets relaxed later.

## Link 2 — A permission gate

`pi-durable` already has the seam. A hook on `ToolTask` can refuse a call:

```ts
hook(ToolTask, { beforeTool: (call) => (isDangerous(call) ? { block: "Needs approval" } : undefined) })
```

What this spec adds is what `isDangerous` means, and the honest answer is that a
pattern list is not a boundary. `rm -rf`, `git push --force`, `curl | sh`, writes
outside the working directory, and a `sudo` are the obvious members; the
interesting ones are composed, and a list that pretends to be complete is worse
than one that says what it covers.

**So the gate is a policy with a stated default, not a filter:**

| Class | Default | Why |
|---|---|---|
| Reads inside the working directory | allow | this is the job |
| Writes inside the working directory | allow, and recorded | the diff is the record |
| Network access | deny unless the profile asks | see link 3 |
| Process and package management, `sudo`, destructive filesystem operations | ask | these are the ones a person wants to see first |
| Anything outside the working directory | ask | the boundary is the directory, so crossing it is the event |

**An approval is an interaction with a deadline and a default action**, which is
[SPEC 0001](0001-non-blocking-interaction.md)'s record, not a blocking prompt.
That is not a coincidence and it is the reason this spec depends on it: a gate
that blocks a turn reintroduces the failure that spec exists to remove, and the
default when nobody answers must be *deny*, because the alternative is an agent
that proceeds by nobody objecting.

## Link 3 — Network egress

**The hard one, and this spec scopes it honestly rather than solving it.**

A build needs the network. `npm install` is not optional, so "deny by default"
is a harness that cannot do its job, and a proxy that inspects traffic is a
project of its own.

So the scope is:

1. **Make it visible.** Every tool call records whether it opened a socket, and
   to where. This is inferable from the execution environment and does not need
   packet capture.
2. **Make it refusable.** A profile can declare network off, and a call that
   needs it becomes an interaction. For a repository being reviewed rather than
   built — the untrusted-repo case this project already reasons about — that is
   the configuration that matters.
3. **Do not claim more than that.** A shell command can reach the network in ways
   a wrapper does not see. Stating the limit is the difference between a control
   and a comfort.

**The strongest available form is not in this spec.** Running the whole agent in
a container with a network policy is a stronger boundary than anything
implementable inside the process, and `pi-durable` hands the environment to a
function per call precisely so this is possible — `env: ({ cwd }) =>
new ContainerEnv(...)`. When that ships it supersedes link 3 rather than extending
it.

## Link 4 — Audit

An append-only record, one row per tool call:

```ts
interface ToolAudit {
	readonly at: string;
	readonly conversation: string;
	readonly call: string;
	readonly tool: string;
	/** The command or the edit, as the model wrote it, before any rewriting. */
	readonly intent: string;
	/** What the gate decided, and why. */
	readonly decision: "allowed" | "denied" | "asked" | "defaulted";
	/** The revision the working directory was at, so a result can be reproduced. */
	readonly revision: string;
	readonly exitCode: number | null;
}
```

Two rules that make it an audit rather than a log:

- **`intent` is recorded before the gate runs**, so a denied command is in the
  record. A trail that only contains what was permitted cannot answer what was
  attempted.
- **`revision` is recorded**, so a result can be reproduced. Without it the trail
  says a command ran and cannot say what it ran against.

**Written on the same commit line as the entry it describes.** A separate file is
a second source of truth for when something happened, which is the failure
[ADR-0012](../decisions.md) records.

## Acceptance criteria

1. A test asserts a tool subprocess cannot read `DEEPSEEK_API_KEY`, by running
   the tool and asserting the environment does not contain it — not by reading
   the allowlist.
2. A test asserts a tool subprocess cannot read a variable that was added to the
   host environment after the allowlist was written, which is what makes it an
   allowlist.
3. A test asserts a credential's value appearing in tool output is redacted and
   the turn is marked degraded, and that the stored entry does not contain the
   value.
4. A test asserts a denied call is refused with the gate's reason, that the
   conversation continues, and that the audit row records the intent and the
   decision.
5. A test asserts a call classified as *ask* produces an interaction record with
   a deadline and a default of deny, and that the run does not block while it is
   outstanding.
6. A test asserts a call that is neither answered nor defaulted within its
   deadline is denied rather than allowed.
7. A test asserts a profile with network off turns a socket-opening call into an
   interaction, and that a profile with network on does not.
8. A test asserts the audit row's `revision` matches the working directory's
   revision at the time of the call, so a result can be reproduced.
9. A test asserts the audit trail contains a denied call, which is what
   distinguishes it from a log of what happened.
10. A test asserts the four links can each be exercised with the others disabled,
    so a failure names the link rather than the chain.

## Out of scope

- **A sandbox.** Running the agent in a container with its own filesystem and
  network namespace is a stronger boundary than any of the four links and it
  supersedes link 3. It is a deployment question with its own spec, and
  `pi-durable`'s per-call `env` is the seam it will arrive through.
- **Encrypting the transcript.** The session database holds the conversation.
  Encrypting it at rest is worth doing and is not isolation: the leak above is a
  tool result reaching the model during a live turn, which encryption of stored
  bytes does not touch.
- **A secret store.** Reading credentials from a keychain, a vault, or a file
  with a mode is a better mechanism than an environment variable and it is the
  natural follow-on to link 1. It changes where the credential comes from, not
  whether a child can read it, so link 1 lands first and link 1 is what makes it
  safe to add later.
- **Scanning the harness's own configuration as an attack surface.** A profile, a
  skill, and an extension are all instructions the agent will follow, and a
  repository can ship all three. That is a real class of attack with prior art
  and it deserves its own spec rather than a paragraph here.
