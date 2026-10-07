# k9999

**Never blocks. Measures first.**

[Product page](https://yageabu.github.io/k9999-agent-harness) · [source](https://github.com/yageabu/k9999-agent-harness)

An agent harness that runs two agents from one install:

| Command | Agent | Tools |
|---|---|---|
| `k9999` | writes and fixes code | read · bash · edit |
| `kula` | reads data and reports what it says | read · bash |

```bash
npx k9999 --print "what does this function do?"
npx kula                                  # interactive
```

## Install

```bash
npm install -g k9999      # both commands on PATH
npx k9999 --list          # or without installing
```

## Update

```bash
k9999 update
```

Reports the running version, the registry it asked, and the latest it found — then prints the install command rather than running it. It reads the registry npm would install from, so on a machine with a mirror it says which one, and a lagging mirror is visible rather than confusing.

Flags from other harnesses are answered rather than rejected: `k9999 update --extensions` explains that there are no installed packages to update, and why.

Node 22.19 or newer.

## Set the API key

The default provider reads `DEEPSEEK_API_KEY` from the environment. There is no config file and no command that sets one once a session is running, so two things decide what you type: the surface you are starting, and the shell you are typing in.

**A single command** can carry the variable inline. **The interactive TUI is long-running**, so an inline prefix never reaches it; set the variable for the session first.

| Shell | For one command | For this session | Persistently |
|---|---|---|---|
| bash, zsh | `DEEPSEEK_API_KEY=sk-... k9999 --print "hello"` | `export DEEPSEEK_API_KEY=sk-...` | the export, in `~/.bashrc` |
| PowerShell | `$env:DEEPSEEK_API_KEY="sk-..."; k9999 --print "hello"` | `$env:DEEPSEEK_API_KEY="sk-..."` | `[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY","sk-...","User")` |
| cmd.exe | `set DEEPSEEK_API_KEY=sk-... && k9999 --print "hello"` | `set DEEPSEEK_API_KEY=sk-...` | `setx DEEPSEEK_API_KEY "sk-..."` |

`export` is a shell builtin and exists only in bash, zsh, and their relatives — PowerShell and cmd reject it with `CommandNotFoundException` and `'export' is not recognized` respectively. The persistent forms apply to terminals opened afterwards, not the one you are in.

Either way the session starts without a key, because the model is called only when you submit a prompt. The error therefore arrives a few seconds after the install looks like it worked:

```console
$ k9999
> hello
error Provider is not configured: deepseek
```

`--print` exits 1 on that error and writes nothing to stdout. `k9999 --show` never needs a key, which makes it the quickest way to check a configuration without a credential.

**An installed copy does not read `.env`.** An agent that loads environment variables from whatever directory it runs in can be redirected by a repository it was asked to inspect, so the published package reads the environment and nothing else.

## Platform

**On Windows, run this under WSL.** The `bash` tool spawns `/bin/bash` unconditionally, so on native Windows it never reaches your command:

```console
$ node -e "require('child_process').spawn('/bin/bash',['-c','echo hi']).on('error',e=>console.log(e.code))"
ENOENT
```

Measured on Windows 10 22H2 (build 19045) with Node 22.22.3: `process.platform` is `win32` and the spawn fails with `ENOENT` before anything runs. Git Bash does not help — its `/bin` is an MSYS mount that Node does not translate, so `/bin/bash` still resolves against the drive root.

`read` and `edit` work, and the TUI renders, because the terminal library handles `win32`. But `bash` is the tool that runs builds, tests, and git, so an agent on native Windows can change files and never check its own work — which is the property this harness is built around. WSL is a real Linux, so everything works there.

macOS and Linux need nothing special.

## Configure a model

Pick a different model with `--model provider/modelId`, or set `K9999_MODEL`. The provider must be one the harness knows; run any command and the error names the ones that exist.

## The two agents

`k9999 --show` prints the configuration a launch name resolves to, without running anything:

```console
$ kula --show
command               kula
default from command  data
profile               data
agent                 Data Analysis Agent
model                 deepseek/deepseek-v4-pro
thinking              high
tools                 read, bash
skills                (none)
profiles dir          .../node_modules/k9999/dist/profiles
```

The `data` agent has no `edit` tool. It writes scripts to files and runs them with `bash`; changing your repository is a separate decision that has not been made.

## Your own agent

A profile is a directory with two files:

```
profiles/mine/
├── profile.json    model, thinking level, tool list
└── system.md       the system prompt
```

Put it in `./profiles/mine/` and run `k9999 --profile mine`. A `profiles/` directory at or above your working directory takes precedence over the two shipped here, in every command. `k9999 --show` tells you which one was used.

`profile.json`:

```json
{
	"name": "My Agent",
	"model": "deepseek/deepseek-flash",
	"thinkingLevel": "medium",
	"tools": ["read", "bash", "edit"]
}
```

### What a tool subprocess may read

`bash` runs commands in a child process, and that child gets a constructed
environment rather than yours. The default list is small — `PATH`, `HOME`,
locale, `TERM`, `USER`, `TMPDIR` — and **the provider credential is not in it**,
which is the point: before this, `printenv DEEPSEEK_API_KEY` in a tool call
returned the key, the result became part of the transcript, and the transcript
was sent to the provider on every later turn.

A profile that needs more declares the **whole list**, replacing the default
rather than adding to it:

```json
{
	"name": "My Agent",
	"tools": ["read", "bash", "edit"],
	"env": ["PATH", "HOME", "LANG", "TERM", "SSH_AUTH_SOCK"]
}
```

Replacing matters. An `envExtra` field would accumulate a line per profile and
nobody would remove one; the file that decides what a subprocess can read should
be readable in one screen. `SSH_AUTH_SOCK` is the usual reason — `git push` over
SSH needs it — and it is also a live socket to your keys, so granting it is a
line someone wrote on purpose.

A name in the list that your host does not have is reported rather than silently
granting nothing, so a profile that asked for something absent is visible.

As a second line of defense, tool output is scanned for the values of the
credentials this process holds and matches are replaced with
`[redacted: NAME]` — with the removal stated in the output, because an edit the
model cannot see is worse than the credential it removed. The values come from
asking the provider to resolve its own credential, so this does not carry a list
of variable names that would drift when a provider changes one.

The available tools are `read`, `bash`, and `edit`. An unknown name is a load-time error listing the valid ones, rather than a run with fewer tools than you asked for.

## Environment

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | Credential for the default provider |
| `K9999_MODEL` | Model as `provider/modelId`, overriding the profile |
| `K9999_PROFILES` | Profiles directory, overriding the search |
| `K9999_SKILLS` | Skills directory, overriding the search |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The run finished and the predicate, if any, passed |
| 1 | A provider or tool failure, or an unknown profile |
| 2 | The invocation was invalid |

A failure prints the reason. A run that cannot reach a provider exits 1 rather than printing nothing and reporting success.

## Built on Pi

Thanks to the authors of [Pi](https://github.com/earendil-works/pi) for shipping the agent kernel, the model layer, and terminal rendering as reusable libraries rather than one application. `pi-agent-core` and `pi-ai` do the work this package stands on.

## License

MIT
