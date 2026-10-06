# Changelog

## 0.5.0

### Added

- **A startup banner.** The mark — the square, the K, the rule, the four nines —
  beside the version, profile, model, and working directory. It goes into the
  transcript rather than the header, so it scrolls away: a five-line logo that
  never leaves costs five lines of a terminal forever. The mark is dropped when
  the text beside it would not fit, decided from the longest line rather than a
  threshold, because how much room the text needs depends on the directory.
- **A status header.** The model, provider, and thinking level, a rule, then one
  line of live figures:

  ```
   deepseek-flash  Deepseek  high
  ────────────────────────────────────────────────────
   upstream | 91.3%/1.0M | ↑323k ↓678k c 87.3% | $0.0001
  ```

  Context is what is *left*, against the ceiling. The cache share is absent when
  the provider reports no cache reads, rather than zero, because zero reads as
  "no cache hits" when it means "not reported". Reasoning tokens appear only when
  a provider reports the split. Cost appears once anything has been spent.

### Notes

- The context figure prefers the last assistant message's reported usage, which
  is the prompt size the provider actually counted, and estimates only what came
  after it. That helper is written here because `pi-agent-core@1.0.2` — the
  version this depends on — does not publish one. Its `dist` holds `agent`,
  `agent-loop`, `proxy`, `stream-fn`, and `types`, and nothing about sessions,
  compaction, or context accounting.
- Deliberately not shown: a channel indicator and an `(auto)` compaction marker.
  Neither exists yet, and a status line that reports what is not built is a
  status line nobody trusts.

## 0.4.1

### Fixed

- **Ctrl+C no longer prints a traceback.** At the prompt it printed
  `fatal: AbortError: Aborted with Ctrl+C` followed by six stack frames, because
  an interrupt arrived as a rejected promise and hit the handler meant for
  defects. An interrupt is not a defect.
- **Ctrl+C during a turn stops the turn and returns to the prompt**, rather than
  leaving, and no longer counts as a failure. Interrupting your own run was
  reporting an error and setting a non-zero exit code.
- **The prompt loop exits when its interface closes.** `question()` does not
  settle when the interface is closed, so a plain await outlived the interrupt
  and left the process waiting on a promise nothing would resolve — Node
  reported an unsettled top-level await and the exit code was whatever the
  warning produced.

## 0.4.0

### Added

- **`--version` / `-v`.** Its absence was an oversight: every command line has
  one, and `k9999 --version` answered `Unknown option`.
- `--show` reports the working directory, and the model *after* every override,
  so `K9999_MODEL` or `--model` are visible rather than the profile's value
  sitting on screen while a different model is called.

### Fixed

- **`--show` now validates the profile instead of reading it.** A profile naming
  a tool that does not exist looked fine and then threw on the way into the first
  prompt. It builds the harness now, so every load-time mistake a run would hit
  surfaces there — with no network and no credential.
- **A configuration mistake prints its message, not a stack trace.** A typo in a
  `profile.json` printed `fatal: ConfigurationError: …` followed by a traceback
  that buried the one useful line. Configuration errors are now a distinct class
  from defects, and they exit 2 rather than 1: `2` means what you asked for is
  missing or misconfigured, `1` means the run started and failed.

## 0.3.0

### Added

- **`k9999 update`** reports whether a newer version is published. It reads the
  registry npm would install from — so on a machine with a mirror it reports
  what the mirror has, and names it — and prints the command rather than
  running it. Replacing the binary that is currently running is
  platform-dependent and can half-finish, and copying one command is cheap.
- **The flags someone arriving from Pi reaches for are answered, not rejected.**
  `k9999 update --extensions` explains that there are no installed packages to
  update and why, instead of `Unknown option: --extensions`. `--models`, `--all`,
  and `--self` get the same treatment.

### Fixed

- `k9999 update the readme` — extra words — says so, and prints the quoting that
  would send them as a prompt instead.

## 0.2.0

### Added

- **A transcript TUI.** `--tui` renders the session with a multi-line editor, a
  scrollback that keeps the newest lines, and a status line. Opt-in rather than
  the default until it has been used on a real terminal. `--no-tui` forces the
  line-based prompt.
- **Diffs.** `edit` reports the lines it replaced as data, and the output shows
  them with a line number: removed lines red, added lines green. Previously an
  edit printed `[edit] done` and never showed what changed.
- **Colour and a per-turn cost line.** `turn 4 · 1.8k in · 220 out · $0.0003`
  after each turn, and a summary at the end. The output rules now show up in the
  interface rather than only in the docs.
- `--show` reports the profiles directory it resolved, which is the first thing
  to look at when a run uses the wrong profile.

### Changed

- **Answers go to stdout, progress to stderr.** `k9999 --print "..." > out.txt`
  now leaves only the answer in the file; tool calls, diffs, and cost lines stay
  on the terminal.
- `edit` summarises in line counts (`+1 -1`) rather than byte counts, which is
  what the result actually means.

## 0.1.0

Initial release.

Two commands, one implementation: `k9999` for code and `kula` for data analysis.
Each is a profile — a directory with a `profile.json` and a `system.md` — and the
two shipped here travel inside the package, so an installed copy runs in a
directory that has none above it.

Three tools: `read`, `bash`, `edit`. No MCP, no sandbox, no session persistence,
and the decision layer does not exist yet. See the README for the current state.
