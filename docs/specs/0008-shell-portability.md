# 0008 — A shell that exists, on the platform that has it

**Status:** `accepted`

## Problem

The `bash` tool names its shell before it knows what machine it is on:

```ts
const child = spawn("/bin/bash", ["-c", params.command], { cwd, ... });
```

`packages/core/src/tools/bash.ts` and `packages/eval/src/task.ts` both do. On Linux and macOS that path exists. On native Windows it is not a slower shell or a different one — it is nothing. Measured on Windows 10 22H2 (build 19045) with Node 22.22.3:

```console
$ node -e "require('child_process').spawn('/bin/bash',['-c','echo hi']).on('error',e=>console.log(e.code))"
ENOENT
```

**The failure is quiet, and that is the part worth fixing.** The tool catches the spawn error, reports `[spawn error: spawn /bin/bash ENOENT]` to the model, and returns. So a session on native Windows starts, draws its startup block, reads files, edits files, and then cannot build, test, or check its own work — which is the property this harness is built around. Nothing rejects the session and nothing names the cause. The user finds out by watching an agent that edits without ever verifying, and concludes the agent is bad.

There is a second cost that applies on every platform. A path pinned in the source is a path a user cannot redirect. The same argument [ADR-0015](../decisions.md) makes about the model endpoint applies here, where the thing being pinned is the shell.

## Invariant

**The harness runs commands through a shell it looked for, not one it named.** A machine that has a POSIX shell runs commands through it. A machine that has none is told which machines have none, before a turn starts, in the vocabulary the harness already uses for a configuration mistake.

## The resolution

A shell is resolved once, at startup, by a function that takes everything it depends on as input — the platform, a filesystem probe, the environment, and an optional explicit path. Not one of those is read from a global.

```ts
export interface ShellConfig {
	/** Absolute path to the shell executable. */
	shell: string;
	args: string[];
	/** How the command reaches the shell. Default "argv". */
	commandTransport?: "argv" | "stdin";
}

export interface ShellLookup {
	platform: NodeJS.Platform;
	env: Record<string, string | undefined>;
	/** existsSync, so every branch is reachable from a test. */
	exists(path: string): boolean;
}

export function resolveShell(options: ShellLookup & { customPath?: string }): ShellConfig;
```

Injection is not decoration. Every branch below is a Windows branch, and the development machine is not Windows, so without injection the resolution would ship with one path tested and the rest asserted — which is how the current defect got here.

Resolution order, and the reason for each step:

| # | Source | Why |
|---|---|---|
| 1 | `customPath` | The escape hatch for a shell in a place nothing looks. A path that does not exist is an error, not a fallback — a configured value that silently does nothing is the failure this project keeps recording |
| 2 | `%ProgramFiles%\Git\bin\bash.exe`, then the `x86` equivalent | Git for Windows is the common install and its bash is a real POSIX shell. The environment variables are read, not the drive letter guessed |
| 3 | `where bash.exe` on Windows, `which bash` elsewhere | Cygwin, MSYS2, and WSL all put a `bash.exe` on `PATH`. Windows needs the result verified with `exists()` before use, because `where` reports entries that are on the search path and not on disk |
| 4 | `/bin/bash` | The Unix answer, and the only one the harness has today |
| 5 | `sh` on `PATH` | A POSIX shell that is not bash is still a POSIX shell. The tool is named `bash` and the commands it is given are POSIX; this is the weakest thing that satisfies that |
| 6 | **Refuse** | Nothing above found a shell. This is a configuration mistake with three answers, not a crash |

On Windows step 3 finds a shell that is not a shell so much as a launcher: `C:\Windows\System32\bash.exe` is the legacy WSL entry point. It does not take `-c`, because it forwards its arguments to a distribution rather than reading a command line. A path matching `[a-z]:\windows\(system32|sysnative)\bash.exe` therefore gets `args: ["-s"]` and `commandTransport: "stdin"`, and the command is written to the child's standard input instead of being passed as an argument. Confirmed on Windows 10 against a WSL distribution:

```console
C:\Windows\System32\bash.exe -s < command-file    # script read from stdin
```

That a Windows machine can have a `bash.exe` that is not usable the ordinary way is the single detail this spec exists to preserve. It was found by running the resolution on a machine that has one, and it is not derivable from the name.

## Failing, and failing when

When no shell is found the tool does not return an error to the model. It raises `ConfigurationError` with the three answers — install Git for Windows, put a bash on `PATH`, or set `shellPath` — and the CLI's existing handling does the rest: the message on stderr, exit 2, no stack trace.

That is the existing split in `packages/core/src/errors.ts`, applied to a case it was written for and has never had: a machine without a shell is not a defect in the harness and not a bad command from the model. It is a configuration the harness cannot work with, and the harness knows exactly what to say about it.

**It fails at startup, not on the first tool call.** `createBashTool` is called while the session is assembled, so resolving there means the user is told before they type anything. The alternative — resolving inside `execute` — spends a turn and a model call to produce a message the user could have had immediately, and the model cannot act on it anyway. An agent that cannot run anything should refuse to start, not start and disappoint.

## Acceptance criteria

Every branch is tested by constructing a `ShellLookup`, so the suite runs on one platform and covers all of them.

1. A test asserts `resolveShell` returns `/bin/bash` with `-c` when the platform is linux and `/bin/bash` exists.
2. A test asserts `resolveShell` returns the Git-for-Windows path with `-c` when the platform is win32, the environment has `ProgramFiles`, and `exists()` is true only for that path.
3. A test asserts the `x86` path is tried when the `ProgramFiles` path is absent.
4. A test asserts a `bash.exe` found by the `PATH` lookup is used only after `exists()` confirms it, and that a reported-but-absent path falls through to the next step.
5. A test asserts `C:\Windows\System32\bash.exe` and `C:\Windows\Sysnative\bash.exe` each resolve to `args: ["-s"]` with `commandTransport: "stdin"`, and that a Git-for-Windows bash at any other path does not.
6. A test asserts `customPath` wins over every discovered path, and that a `customPath` that does not exist raises `ConfigurationError` rather than falling back.
7. A test asserts no shell found raises `ConfigurationError`, that the message names three ways to fix it, and that the CLI exits 2 with no stack trace.
8. A test asserts the bash tool resolves its shell when it is created, so an unusable `shellPath` fails before any tool call is made.
9. A test asserts that when the transport is `stdin` the command is written to the child's stdin and not passed as an argument.
10. A test asserts the eval task runner and the bash tool resolve their shell through the same function, by reading the module graph rather than by convention.

## Out of scope

- **A PowerShell tool.** Not because it cannot be done — Pi ships one, and [ADR-0016](../decisions.md) describes its shape so that the next reader can copy it. It is out of scope because this spec's subject is a defect: the harness names a shell instead of finding one, and a second tool does not fix that. Every skill, profile prompt, and eval task in this repository is written in POSIX, so a PowerShell tool is a capability to add deliberately for commands whose interface is a PowerShell module, not a platform to fall back on when a machine has no bash. The first version of this section argued that Pi had no such tool. It does — `pi-coding-agent` 0.87.1, `dist/core/tools/powershell.js` — and the claim came from a source checkout that predates it. See [ADR-0016](../decisions.md) for the measurement, and for why the error is left visible.
- **A Windows CI job.** It would catch this class of defect and it is the obvious next step, but it is a separate change with its own cost, and this spec should not be blocked on it. Until it exists, the injection in the interface is what stands in for a second platform.
- **The `PATH` translation warning.** A Windows `PATH` containing drives WSL cannot map produces `wsl: Failed to translate 'J:\...'` on stderr, which the tool merges into its output, so the model reads a few lines of noise before every result. It is a real annoyance, it is unrelated to finding the shell, and fixing it means deciding what to do with a `PATH` the harness did not build.
- **Detaching, `windowsHide`, and killing a process tree on Windows.** `detached` cannot be set the same way on win32 and a process tree is killed with `taskkill /F /T` rather than a process-group signal. Both matter for a Windows session that runs a server, and neither is needed to run a command and read its output, which is what the tool does today.
