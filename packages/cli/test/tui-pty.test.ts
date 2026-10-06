import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const entry = path.join(repoRoot, "packages/cli/src/index.ts");

/**
 * Whether a pseudo-terminal can be allocated.
 *
 * Rendering, key handling, and the block logo are asserted through the headless
 * `Terminal` in `tui.test.ts`, which has no timing to lose. What is left for a
 * real pty is the one thing the headless terminal cannot show: that `--tui`
 * passes its TTY check and that leaving it is neither a traceback nor a hang.
 *
 * The assertions are deliberately about absence. Under load the CLI can still
 * be loading when the keystrokes arrive, so nothing may be assumed about what
 * was drawn by the time it exits.
 */
const hasPty = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;

/** Feed one keystroke per step, so each arrives as its own read rather than a paste. */
function pty(steps: readonly (readonly [string, number])[], command: string): string {
	const script = `${steps.map(([keys, wait]) => `sleep ${wait}; printf "${keys}"`).join("; ")}; sleep 2`;
	const result = spawnSync(
		"bash",
		["-c", `bash -c ${JSON.stringify(script)} | script -qec ${JSON.stringify(command)} /dev/null`],
		{ encoding: "utf8", timeout: 30_000 },
	);
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("--tui accepts a real terminal and leaves on ctrl+c twice", { skip: !hasPty && "needs a pty" }, () => {
	const output = pty([["\\003\\003", 3]], `node ${entry} --tui`);
	assert.equal(output.includes("needs a terminal"), false, `the TTY check must pass under a pty:\n${output}`);
	assert.equal(output.includes("    at "), false, `no traceback:\n${output}`);
	assert.equal(output.includes("Detected unsettled top-level await"), false, `the process must exit:\n${output}`);
});
