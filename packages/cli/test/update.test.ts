import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { check, currentVersion, isNewer, PI_FLAGS, render } from "../src/update.ts";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const entry = path.join(repoRoot, "packages/cli/src/index.ts");

/** A fetch that answers with a packument, so the check is tested without a network. */
function packument(latest: string | undefined, status = 200): typeof fetch {
	return (async () =>
		({
			ok: status >= 200 && status < 300,
			status,
			json: async () => (latest === undefined ? { "dist-tags": {} } : { "dist-tags": { latest } }),
		}) as Response) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// comparing versions
// ---------------------------------------------------------------------------

test("a newer version is newer, whatever the component counts", () => {
	assert.equal(isNewer("0.3.0", "0.2.0"), true);
	assert.equal(isNewer("0.2.1", "0.2.0"), true);
	assert.equal(isNewer("1.0.0", "0.9.9"), true);
	assert.equal(isNewer("1.0.0", "0.10.0"), true, "numeric, not lexicographic");
	assert.equal(isNewer("0.2.0", "0.2.0"), false);
	assert.equal(isNewer("0.2.0", "0.3.0"), false);
	assert.equal(isNewer("0.2.0", "1.0.0"), false);
});

test("prerelease and missing components do not reverse the answer", () => {
	assert.equal(isNewer("0.2.0", "0.2.0-rc.1"), true);
	assert.equal(isNewer("0.2", "0.2.0"), false);
	assert.equal(isNewer("0.2.1", "0.2"), true);
});

// ---------------------------------------------------------------------------
// checking
// ---------------------------------------------------------------------------

test("the check reports the latest tag from the registry it was given", async () => {
	const report = await check({
		current: "0.2.0",
		registry: "https://example.test/",
		fetchImpl: packument("0.3.0"),
	});
	assert.equal(report.latest, "0.3.0");
	assert.equal(report.problem, undefined);
	assert.equal(report.registry, "https://example.test/");
});

test("the trailing slash is not doubled", async () => {
	let asked = "";
	const spy = (async (url: string) => {
		asked = url;
		return { ok: true, status: 200, json: async () => ({ "dist-tags": { latest: "1.0.0" } }) };
	}) as unknown as typeof fetch;
	await check({ current: "0.2.0", registry: "https://example.test", fetchImpl: spy });
	assert.equal(asked, "https://example.test/k9999");
});

test("a registry that answers badly becomes a stated problem, not a throw", async () => {
	const notFound = await check({ current: "0.2.0", registry: "https://example.test", fetchImpl: packument("1.0.0", 404) });
	assert.equal(notFound.latest, undefined);
	assert.match(notFound.problem ?? "", /404/);

	const empty = await check({ current: "0.2.0", registry: "https://example.test", fetchImpl: packument(undefined) });
	assert.equal(empty.latest, undefined);
	assert.match(empty.problem ?? "", /no latest tag/);

	const unreachable = await check({
		current: "0.2.0",
		registry: "https://example.test",
		fetchImpl: (async () => {
			throw new Error("getaddrinfo ENOTFOUND");
		}) as unknown as typeof fetch,
	});
	assert.equal(unreachable.latest, undefined);
	assert.match(unreachable.problem ?? "", /ENOTFOUND/);
});

test("being unable to check is not a failure to report", async () => {
	const lines = render({ current: "0.2.0", registry: "https://example.test", latest: undefined, problem: "boom" });
	const text = lines.join("\n");
	assert.match(text, /current\s+0\.2\.0/);
	assert.match(text, /latest\s+unknown/);
	assert.match(text, /Could not check: boom/);
	assert.match(text, /To update anyway/, "the command is still offered");
});

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

test("an outdated copy is told the command, an current one is told nothing", () => {
	const outdated = render({ current: "0.2.0", registry: "https://example.test", latest: "0.3.0", problem: undefined }).join("\n");
	assert.match(outdated, /latest\s+0\.3\.0/);
	assert.match(outdated, /npm i -g k9999@latest/);

	const current = render({ current: "0.2.0", registry: "https://example.test", latest: "0.2.0", problem: undefined }).join("\n");
	assert.match(current, /You are up to date/);
	assert.equal(current.includes("npm i -g"), false, "no command when there is nothing to run");
});

test("a copy ahead of the published release says so, rather than claiming to be current", () => {
	// The normal state for anyone running a build from source. "You are up to
	// date" would be true and misleading, which is worse than being wrong.
	const ahead = render({ current: "0.3.0", registry: "https://example.test", latest: "0.2.0", problem: undefined }).join("\n");
	assert.match(ahead, /ahead of the published release/);
	assert.equal(ahead.includes("You are up to date"), false);
	assert.equal(ahead.includes("npm i -g"), false, "downgrading is not offered");
});

test("every Pi flag has an answer that names the reason", () => {
	for (const [flag, why] of Object.entries(PI_FLAGS)) {
		assert.ok(why.length > 40, `${flag} needs an explanation, not a one-liner`);
	}
	assert.match(PI_FLAGS["--extensions"] ?? "", /ADR-0001/, "the reason points at the decision record");
});

// ---------------------------------------------------------------------------
// the command
// ---------------------------------------------------------------------------

test("the running version is read from the manifest beside the bundle", async () => {
	const manifest = await import("../package.json", { with: { type: "json" } });
	assert.equal(await currentVersion(), manifest.default.version);
});

test("update reports the current version and the registry it asked", async () => {
	const { stdout } = await run("node", [entry, "update"], { cwd: repoRoot });
	assert.match(stdout, /current\s+\d+\.\d+\.\d+/);
	assert.match(stdout, /registry\s+https?:\/\//);
	// Either a version came back or the reason it did not. Both are honest.
	assert.match(stdout, /latest\s+(\d+\.\d+\.\d+|unknown)/);
});

test("an unreachable registry still exits zero and says why", async () => {
	// Deterministic: no network is involved, so this does not depend on the
	// state of a real registry.
	const { stdout } = await run("node", [entry, "update"], {
		cwd: repoRoot,
		env: { ...process.env, npm_config_registry: "http://127.0.0.1:1/" },
	});
	assert.match(stdout, /registry\s+http:\/\/127\.0\.0\.1:1\//);
	assert.match(stdout, /latest\s+unknown/);
	assert.match(stdout, /Could not check/);
});

test("a Pi flag is answered rather than rejected", async () => {
	const { stdout } = await run("node", [entry, "update", "--extensions"], { cwd: repoRoot });
	assert.match(stdout, /--extensions/);
	assert.match(stdout, /no installed packages to update/);
	assert.equal(stdout.includes("Unknown option"), false);
});

test("update with extra words explains how to send them as a prompt", async () => {
	const failure = await run("node", [entry, "update", "the", "readme"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /update takes no arguments/);
	assert.match(failure?.stderr ?? "", /k9999 "update the readme"/);
});

test("a Pi flag outside update is refused", async () => {
	const failure = await run("node", [entry, "--models"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /only applies to `k9999 update`/);
});

test("the help text lists update as a command", async () => {
	const { stdout } = await run("node", [entry, "--help"], { cwd: repoRoot });
	assert.match(stdout, /Commands:/);
	assert.match(stdout, /update\s+Report whether a newer version is published/);
});
