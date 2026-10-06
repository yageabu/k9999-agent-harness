import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DEFAULT_PROFILE, LAUNCH_NAMES, launchNameFor, profileForLaunchName, sessionName } from "../src/launch.ts";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const entry = path.join(repoRoot, "packages/cli/src/index.ts");

/**
 * A file named after a launch command, so `process.argv[1]` carries the name.
 *
 * This is what the published bin is: a file whose basename is the command. A
 * subprocess running the entry by its real path cannot exercise the dispatch,
 * which is why a shim is needed rather than a shorter test.
 */
async function shims(): Promise<Record<string, string>> {
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-launch-"));
	const paths: Record<string, string> = {};
	for (const { command } of LAUNCH_NAMES) {
		const file = path.join(dir, `${command}.ts`);
		await writeFile(file, `import ${JSON.stringify(entry)};\n`, "utf8");
		paths[command] = file;
	}
	return paths;
}

/** `--show` output as a record, so resolved rows can be compared without the command rows. */
function parseShow(stdout: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of stdout.split("\n")) {
		const match = /^(\S.*?)\s{2,}(.+)$/.exec(line);
		if (match?.[1] !== undefined && match[2] !== undefined) {
			out[match[1]] = match[2];
		}
	}
	return out;
}

const RESOLVED_ROWS = ["profile", "agent", "model", "thinking", "tools", "skills"] as const;

test("each launch name maps to a distinct profile", () => {
	const profiles = LAUNCH_NAMES.map((entry_) => entry_.profileId);
	assert.equal(new Set(profiles).size, profiles.length, "two names must not select one profile");
	assert.equal(profileForLaunchName("k9999"), "code");
	assert.equal(profileForLaunchName("kula"), "data");
	assert.equal(DEFAULT_PROFILE, "code");
});

test("the launch name is read from a path, with or without an extension", () => {
	for (const argv1 of ["/usr/local/bin/kula", "kula", "./node_modules/.bin/kula", "/x/y/kula.js"]) {
		assert.equal(profileForLaunchName(argv1), "data", `failed for ${argv1}`);
	}
});

test("an unrecognized launch name falls back instead of failing", () => {
	// Running the entry by path is how the test suite and npm run invoke it. A
	// failure here would break both for a cosmetic reason.
	for (const argv1 of [undefined, "index.ts", "/repo/packages/cli/src/index.ts", "node"]) {
		assert.equal(profileForLaunchName(argv1), DEFAULT_PROFILE, `failed for ${argv1}`);
	}
});

test("the mapping is discoverable in both directions", () => {
	assert.equal(launchNameFor("code"), "k9999");
	assert.equal(launchNameFor("data"), "kula");
	assert.equal(launchNameFor("nope"), undefined);
});

test("the startup block names the command that was typed", () => {
	assert.equal(sessionName("/usr/local/bin/kula", "code"), "kula", "the typed command wins over the profile");
	assert.equal(sessionName("k9999.js", "data"), "k9999");
});

test("a session started by path introduces itself as the profile's own command", () => {
	// This is what makes `npm run kula` show KULA. The entry is run by path, so
	// nothing was typed, and the profile stands in for the missing name.
	assert.equal(sessionName("/repo/packages/cli/src/index.ts", "data"), "kula");
	assert.equal(sessionName(undefined, "code"), "k9999");
	// A profile with no launch name must not print `index.ts` as the program's name.
	assert.equal(sessionName("/repo/packages/cli/src/index.ts", "mine"), "k9999");
});

test("each launch name resolves its own profile, tools, and thinking level", async () => {
	const files = await shims();
	const code = parseShow((await run("node", [files["k9999"] as string, "--show"], { cwd: repoRoot })).stdout);
	const data = parseShow((await run("node", [files["kula"] as string, "--show"], { cwd: repoRoot })).stdout);

	assert.equal(code["profile"], "code");
	assert.equal(code["tools"], "read, bash, edit");

	assert.equal(data["profile"], "data");
	assert.equal(data["tools"], "read, bash", "the data profile must not expose the edit tool");
	assert.notEqual(code["thinking"], data["thinking"], "the two agents differ in thinking budget");
	assert.equal(code["command"], "k9999.ts");
	assert.equal(data["command"], "kula.ts");
	assert.equal(data["default from command"], "data");
});

test("an explicit --profile beats the launch name, so the two are equivalent", async () => {
	const files = await shims();
	const viaKula = parseShow(
		(await run("node", [files["kula"] as string, "--profile", "code", "--show"], { cwd: repoRoot })).stdout,
	);
	const viaK9999 = parseShow(
		(await run("node", [files["k9999"] as string, "--profile", "code", "--show"], { cwd: repoRoot })).stdout,
	);

	for (const row of RESOLVED_ROWS) {
		assert.equal(viaKula[row], viaK9999[row], `row "${row}" differs between the two commands`);
	}
	// The command rows legitimately differ; nothing else may.
	assert.notEqual(viaKula["command"], viaK9999["command"]);
});

test("both launch names produce identical --list output", async () => {
	const files = await shims();
	const a = await run("node", [files["k9999"] as string, "--list"], { cwd: repoRoot });
	const b = await run("node", [files["kula"] as string, "--list"], { cwd: repoRoot });
	assert.equal(a.stdout, b.stdout);
	assert.match(a.stdout, /^code\s+Code Agent\s+\(k9999\)$/m);
	assert.match(a.stdout, /^data\s+Data Analysis Agent\s+\(kula\)$/m);
});

test("the help text names both commands and their defaults", async () => {
	const { stdout } = await run("node", [entry, "--help"], { cwd: repoRoot });
	assert.match(stdout, /k9999 \[options\] \[prompt\.\.\.\]\s+the code agent/);
	assert.match(stdout, /kula\s+\[options\] \[prompt\.\.\.\]\s+the data analysis agent/);
	assert.match(stdout, /k9999 → code, kula → data/);
	assert.match(stdout, /--tui/);
	assert.match(stdout, /-v, --version/);
});

test("--version and -v print the version and exit zero", async () => {
	const packageJson = await import("../package.json", { with: { type: "json" } });
	for (const flag of ["--version", "-v"]) {
		const { stdout } = await run("node", [entry, flag], { cwd: repoRoot });
		assert.equal(stdout.trim(), packageJson.default.version, `failed for ${flag}`);
	}
});

test("--show validates the profile, not just reads it", async () => {
	// A profile naming a tool that does not exist must fail here. Reading the
	// manifest and printing it meant `read, reed, teleport` looked fine and then
	// threw on the way into the first prompt.
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-bad-"));
	await mkdir(path.join(dir, "mine"), { recursive: true });
	await writeFile(
		path.join(dir, "mine", "profile.json"),
		JSON.stringify({ name: "Broken", tools: ["read", "reed"] }),
		"utf8",
	);
	await writeFile(path.join(dir, "mine", "system.md"), "You are a test profile.\n", "utf8");

	const failure = await run("node", [entry, "--profiles", dir, "--profile", "mine", "--show"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /Unknown tool "reed"\. Known tools: read, bash, edit/);
});

test("a configuration mistake prints its message, not a stack trace", async () => {
	const failure = await run("node", [entry, "--profile", "nope", "--show"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /Unknown profile "nope"/);
	assert.equal((failure?.stderr ?? "").includes("    at "), false, "a typo is not a defect, so no traceback");
});

test("--show reports the model that will actually be used", async () => {
	// The resolved reference, so an environment override is visible rather than
	// leaving the profile's value on screen while a different model is called.
	const { stdout } = await run("node", [entry, "--show"], {
		cwd: repoRoot,
		env: { ...process.env, K9999_MODEL: "deepseek/deepseek-v4-pro" },
	});
	const model = parseShow(stdout)["model"];
	assert.equal(model, "deepseek/deepseek-v4-pro");
});

test("--tui outside a terminal is refused rather than rendering into a pipe", async () => {
	// A fallback would answer a different question than the one asked, and the
	// TUI would write escape sequences into the pipe and then wait for input a
	// pipe will not send.
	const failure = await run("node", [entry, "--tui"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /--tui needs a terminal/);
});
