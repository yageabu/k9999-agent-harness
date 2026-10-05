# Changelog

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
