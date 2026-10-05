import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const entry = path.join(repoRoot, "packages/cli/src/index.ts");

/**
 * Whether a pseudo-terminal can be allocated.
 *
 * These tests are about a terminal, so they need one. `script` from util-linux
 * provides it on Linux and is present on macOS under the same name; on Windows
 * there is nothing to attach and the tests are skipped rather than faked.
 */
const hasPty = spawnSync("script", ["--version"], { encoding: "utf8" }).status === 0;

/** Feed keystrokes to a command on a real pty, after a delay so it is listening. */
function pty(keystrokes: string, command: string, waitSeconds = 1.5): string {
	const script = `sleep ${waitSeconds}; printf "${keystrokes}"; sleep 1\n`;
	const result = spawnSync("bash", ["-c", `bash -c ${JSON.stringify(script)} | script -qec ${JSON.stringify(command)} /dev/null`], {
		encoding: "utf8",
		timeout: 30_000,
	});
	return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

test("Ctrl+C at an idle prompt leaves without a traceback", { skip: !hasPty && "needs a pty" }, () => {
	// The first version printed `fatal: AbortError: Aborted with Ctrl+C` and six
	// stack frames, because an interrupt arrived as a rejected promise and hit
	// the handler meant for defects.
	const output = pty("\\003", `node ${entry}`);
	assert.equal(output.includes("AbortError"), false, `an interrupt is not an error:\n${output}`);
	assert.equal(output.includes("    at "), false, `no traceback for an interrupt:\n${output}`);
	assert.equal(
		output.includes("Detected unsettled top-level await"),
		false,
		`the process must actually exit:\n${output}`,
	);
});

test("/exit leaves without a traceback", { skip: !hasPty && "needs a pty" }, () => {
	// Two chunks, because text and Enter in one is treated as a paste.
	const output = pty("/exit\\r", `node ${entry}`);
	assert.equal(output.includes("    at "), false, `no traceback:\n${output}`);
	assert.equal(output.includes("Detected unsettled top-level await"), false, `must exit:\n${output}`);
});

test("a closed stdin leaves without a traceback", { skip: !hasPty && "needs a pty" }, () => {
	// `question()` does not settle when the interface closes, so the loop races it
	// against the close. Without that race the process waits on a promise nothing
	// resolves and Node reports an unsettled top-level await.
	const output = pty("", `node ${entry} < /dev/null`, 0.2);
	assert.equal(output.includes("Detected unsettled top-level await"), false, `must exit:\n${output}`);
});
