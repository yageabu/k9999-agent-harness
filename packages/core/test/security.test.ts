import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { createHarness } from "../src/harness.ts";
import { resolveCredentials } from "../src/model.ts";
import { createRedactor, NO_REDACTOR } from "../src/redact.ts";
import { createBashTool } from "../src/tools/bash.ts";
import { DEFAULT_TOOL_ENV, missingFromEnvironment, toolEnvironment } from "../src/tools/env.ts";
import { guardedEnv } from "../src/tools/guarded-env.ts";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { loadProfile } from "../src/profile.ts";
import type { Profile } from "../src/profile.ts";

/**
 * SPEC 0011, link 1 — credential isolation.
 *
 * The criteria are asserted by running the tool and reading what came back,
 * not by reading the allowlist. An allowlist that is correct and unused is the
 * defect this file exists to catch, and a test that asserts on it would pass
 * while the child kept inheriting everything.
 */

const DEMO_SECRET = "sk-demo-DO-NOT-USE-1234567890";

async function run(command: string, options: Parameters<typeof createBashTool>[1] = {}): Promise<string> {
	const tool = createBashTool(process.cwd(), options);
	const result = await tool.execute("call-1", { command }, undefined);
	const first = result.content[0];
	return first && first.type === "text" ? first.text : "";
}

describe("the tool subprocess environment", () => {
	it("cannot read a credential that is in the host environment", async () => {
		// The measured defect: this returned 36 before the fix.
		const text = await run("printenv DEEPSEEK_API_KEY | wc -c", {
			source: { ...process.env, DEEPSEEK_API_KEY: DEMO_SECRET },
		});
		const bytes = Number(text.split("\n")[1]?.trim());
		assert.equal(bytes, 0, "the child must not see the provider credential");
	});

	it("cannot read a variable added to the host after the allowlist was written", () => {
		// This is what makes it an allowlist. A denylist would grant this.
		const env = toolEnvironment({ PATH: "/usr/bin", SOMETHING_NEW_LAST_TUESDAY: "value" });
		assert.equal(env["SOMETHING_NEW_LAST_TUESDAY"], undefined);
		assert.equal(env["PATH"], "/usr/bin");
	});

	it("keeps the variables a shell needs, so the fix is not a broken tool", async () => {
		const text = await run("echo $PATH | wc -c");
		assert.ok(Number(text.split("\n")[1]?.trim()) > 1, "a shell with no PATH cannot find anything");
	});

	it("matches names case-insensitively, because Windows spells PATH three ways", () => {
		// Node looks for the last of Path/PATH/path it finds, so comparing exactly
		// would drop the variable on a machine that spells it `Path`.
		const env = toolEnvironment({ Path: "C:\\Windows" }, ["PATH"]);
		assert.deepEqual(env, { Path: "C:\\Windows" });
	});

	it("reports a declared name the host does not have", () => {
		const missing = missingFromEnvironment({ PATH: "/usr/bin" }, ["PATH", "SSH_AUTH_SOCK"]);
		assert.deepEqual(missing, ["SSH_AUTH_SOCK"]);
	});

	it("does not include the ssh agent socket by default", () => {
		// It is what `git push` needs and it is also a live socket to the user's
		// keys. Granting it has to be a line someone wrote.
		assert.ok(!DEFAULT_TOOL_ENV.includes("SSH_AUTH_SOCK"));
	});
});

describe("redaction of tool output", () => {
	it("removes a credential that reached the child some other way", async () => {
		const redactor = createRedactor([{ value: DEMO_SECRET, label: "the provider key" }]);
		const text = await run(`echo leaked=${DEMO_SECRET}`, {
			source: { ...process.env, LEAKED: DEMO_SECRET },
			redactor,
		});
		assert.ok(!text.includes(DEMO_SECRET), "the value must not survive into the result");
		assert.match(text, /\[redacted: the provider key\]/);
	});

	it("says that it edited the result, rather than editing it silently", async () => {
		// A silent edit to a result the model is reasoning about is worse than the
		// credential: the model cannot tell it is reading a different world.
		const redactor = createRedactor([{ value: DEMO_SECRET, label: "the provider key" }]);
		const text = await run(`echo ${DEMO_SECRET}`, { redactor });
		assert.match(text, /redacted the provider key/);
		assert.match(text, /edited before you saw it/);
	});

	it("reports the hit in the tool details, so a turn can be marked degraded", async () => {
		const redactor = createRedactor([{ value: DEMO_SECRET, label: "the provider key" }]);
		const tool = createBashTool(process.cwd(), { redactor });
		const result = await tool.execute("call-1", { command: `echo ${DEMO_SECRET}` }, undefined);
		const details = result.details as { redacted?: readonly string[] };
		assert.deepEqual(details.redacted, ["the provider key"]);
	});

	it("redacts the command it was asked to run, because that is stored too", async () => {
		const redactor = createRedactor([{ value: DEMO_SECRET, label: "the provider key" }]);
		const tool = createBashTool(process.cwd(), { redactor });
		const result = await tool.execute("call-1", { command: `echo ${DEMO_SECRET}` }, undefined);
		const details = result.details as { command?: string };
		assert.ok(!String(details.command).includes(DEMO_SECRET));
	});

	it("redacts before truncating, so a cut credential cannot survive", async () => {
		// Redacting after a 50KB cap would miss a value split across the boundary.
		const redactor = createRedactor([{ value: DEMO_SECRET, label: "the provider key" }]);
		const padding = "x".repeat(60 * 1024);
		const text = await run(`printf '%s' '${padding}'; printf '%s' '${DEMO_SECRET}'`, { redactor });
		assert.ok(!text.includes(DEMO_SECRET));
	});

	it("refuses to treat a short value as a secret", () => {
		// A one-character "credential" would match nearly every result and destroy
		// the output the model is reasoning about.
		const redactor = createRedactor([{ value: "a", label: "too short" }]);
		assert.equal(redactor.active, false);
		assert.equal(redactor.redact("banana").text, "banana");
	});

	it("replaces the longest value first, so a contained one is not left partly legible", () => {
		const redactor = createRedactor([
			{ value: "abcdefgh", label: "short" },
			{ value: "abcdefghijkl", label: "long" },
		]);
		const out = redactor.redact("value=abcdefghijkl").text;
		assert.equal(out, "value=[redacted: long]");
	});

	it("is a no-op when there is nothing to protect", () => {
		const result = NO_REDACTOR.redact("nothing to see");
		assert.deepEqual(result, { text: "nothing to see", hits: [] });
	});
});

describe("the guarded environment, which is where the allowlist has to live", () => {
	async function run(
		env: ReturnType<typeof guardedEnv>,
		command: string,
		options: { inheritEnv?: boolean } = {},
	): Promise<string> {
		let out = "";
		await env.exec(command, { ...options, onOutput: (text: string) => { out += text; } }, BACKGROUND_CONTEXT);
		return out.trim();
	}

	it("refuses an inherited environment even when the caller asks for one", async () => {
		// This is the whole reason it is a wrapper. pi-durable's own bash tool passes
		// `inheritEnv: true`, and `getShellEnv` spreads `process.env` *underneath*
		// `shellEnv` — so a `shellEnv` allowlist is an override layer, not a filter.
		// Measured through NodeExecutionEnv with the allowlist set: 36 bytes.
		process.env.K9999_DEMO_SECRET = DEMO_SECRET;
		const env = guardedEnv({ inner: new NodeExecutionEnv({ cwd: process.cwd() }), allow: DEFAULT_TOOL_ENV });
		assert.equal(await run(env, "printenv DEEPSEEK_API_KEY | wc -c", { inheritEnv: true }), "0");
		assert.equal(await run(env, "printenv K9999_DEMO_SECRET | wc -c", { inheritEnv: true }), "0");
		delete process.env.K9999_DEMO_SECRET;
	});

	it("keeps a shell that works, so the fix is not a broken environment", async () => {
		const env = guardedEnv({ inner: new NodeExecutionEnv({ cwd: process.cwd() }), allow: DEFAULT_TOOL_ENV });
		assert.ok(Number(await run(env, "echo $PATH | wc -c")) > 1);
		assert.ok(Number(await run(env, "printenv HOME | wc -c")) > 1);
	});

	it("delegates everything it does not override", async () => {
		// ExecutionEnv is wide. A wrapper that dropped a method would look like a
		// broken tool rather than a broken wrapper.
		const inner = new NodeExecutionEnv({ cwd: process.cwd() });
		const env = guardedEnv({ inner, allow: DEFAULT_TOOL_ENV });
		assert.equal(env.id, inner.id);
		assert.equal(env.cwd, inner.cwd);
		const read = await env.readTextFile("package.json", BACKGROUND_CONTEXT);
		assert.equal(read.ok, true);
	});

	it("does not redact, because a credential split across chunks would survive it", () => {
		// Redaction belongs to the tool, on the assembled result. An environment that
		// redacted per chunk would look like protection and miss the case that
		// matters — the same failure as truncating before redacting.
		const source = guardedEnv.toString();
		assert.doesNotMatch(source, /redact/i);
	});
});

describe("credentials are asked of the provider, not hardcoded", () => {
	it("resolves the value and names the variable it came from", async () => {
		process.env.DEEPSEEK_API_KEY = DEMO_SECRET;
		const secrets = await resolveCredentials(deepseekProvider());
		assert.equal(secrets.length, 1);
		assert.equal(secrets[0]?.value, DEMO_SECRET);
		assert.equal(secrets[0]?.label, "DEEPSEEK_API_KEY");
	});

	it("returns nothing rather than throwing when the provider cannot resolve", async () => {
		// A run without a credential fails later with a better message. Redaction
		// must not be the first thing to complain, or a configuration problem
		// would be reported as a security one.
		const saved = process.env.DEEPSEEK_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;
		try {
			assert.deepEqual(await resolveCredentials(deepseekProvider()), []);
		} finally {
			if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
		}
	});
});

describe("a profile can widen the allowlist deliberately", () => {
	function profile(config: object): Profile {
		return {
			id: "test",
			dir: "/tmp/test",
			config: { name: "Test", tools: ["bash"], ...config } as Profile["config"],
			system: "",
		};
	}

	/** A harness with no provider: the scripted one the rest of the suite uses. */
	function scripted(): { models: ReturnType<typeof createModels>; model: ReturnType<ReturnType<typeof fauxProvider>["getModel"]> } {
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		return { models, model: faux.getModel() };
	}

	it("replaces the default list rather than adding to it", async () => {
		const { models, model } = scripted();
		const harness = await createHarness({
			profile: profile({ env: ["PATH", "SSH_AUTH_SOCK"] }),
			cwd: process.cwd(),
			resolvedModel: { models, model, provider: "faux", id: "faux-1" },
			secrets: [],
			environment: { PATH: "/usr/bin", SSH_AUTH_SOCK: "/tmp/agent.sock", HOME: "/root" },
		});
		const bash = harness.tools.find((tool) => tool.name === "bash");
		assert.ok(bash);
		const result = await bash.execute("call-1", { command: "printenv SSH_AUTH_SOCK; printenv HOME | wc -c" }, undefined);
		const text = result.content[0]?.type === "text" ? result.content[0].text : "";
		assert.match(text, /\/tmp\/agent\.sock/, "the declared name must be granted");
		assert.equal(Number(text.split("\n")[2]?.trim()), 0, "HOME must not be, because the list was replaced");
	});

	it("reports a declared name the host lacks, instead of looking configured", async () => {
		const { models, model } = scripted();
		const harness = await createHarness({
			profile: profile({ env: ["PATH", "SSH_AUTH_SOCK"] }),
			cwd: process.cwd(),
			resolvedModel: { models, model, provider: "faux", id: "faux-1" },
			secrets: [],
			environment: { PATH: "/usr/bin" },
		});
		assert.deepEqual(harness.envMissing, ["SSH_AUTH_SOCK"]);
	});

	it("reports what it is scanning for, so an empty list is visible", async () => {
		const { models, model } = scripted();
		const harness = await createHarness({
			profile: profile({}),
			cwd: process.cwd(),
			resolvedModel: { models, model, provider: "faux", id: "faux-1" },
			secrets: [{ value: DEMO_SECRET, label: "DEEPSEEK_API_KEY" }],
		});
		assert.deepEqual(harness.redacting, ["DEEPSEEK_API_KEY"]);
	});

	it("rejects a malformed env list at load time rather than granting nothing", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "k9999-profile-"));
		await mkdir(path.join(dir, "bad"), { recursive: true });
		await writeFile(
			path.join(dir, "bad", "profile.json"),
			JSON.stringify({ name: "Bad", tools: ["bash"], env: ["PATH", 2] }),
		);
		await assert.rejects(() => loadProfile(dir, "bad"), /"env" must be an array of non-empty strings/);
	});
});
