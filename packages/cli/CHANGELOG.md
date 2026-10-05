# Changelog

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
