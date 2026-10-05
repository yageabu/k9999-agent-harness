import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	buildSystemPrompt,
	createHarness,
	createTools,
	listProfiles,
	loadProfile,
	parseSkillDescription,
	resolveProfilesDir,
	resolveSkills,
	SkillError,
	toolNames,
} from "../src/index.ts";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const run = promisify(execFile);
const coreEntry = pathToFileURL(path.join(repoRoot, "packages/core/src/index.ts")).href;

async function profilesDir(): Promise<string> {
	return await resolveProfilesDir(path.join(repoRoot, "profiles"));
}

test("profiles directory resolves and holds the shipped profiles", async () => {
	const dir = await profilesDir();
	assert.deepEqual(await listProfiles(dir), ["code", "data"]);
});

test("every profile declares only known tools and a non-empty prompt", async () => {
	const dir = await profilesDir();
	for (const id of await listProfiles(dir)) {
		const profile = await loadProfile(dir, id);
		for (const tool of profile.config.tools) {
			assert.ok(toolNames().includes(tool), `${id}: unknown tool "${tool}"`);
		}
		assert.notEqual(profile.system.trim(), "", `${id}: empty system prompt`);
	}
});

test("the data profile cannot write files", async () => {
	const dir = await profilesDir();
	const profile = await loadProfile(dir, "data");
	for (const forbidden of ["edit", "write"]) {
		assert.ok(!profile.config.tools.includes(forbidden), `data profile must not expose ${forbidden}`);
	}
});

test("an unknown tool name fails loudly instead of being skipped", () => {
	assert.throws(() => createTools(["read", "teleport"], process.cwd()), /Unknown tool "teleport"/);
});

test("prompt assembly puts the authored text first and the cwd last", async () => {
	const dir = await profilesDir();
	const profile = await loadProfile(dir, "code");
	const tools = createTools(profile.config.tools, "/tmp");
	const prompt = buildSystemPrompt({
		profile,
		cwd: "/tmp",
		tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
		skills: [{ name: "demo", description: "A demo skill.", path: "/tmp/demo/SKILL.md" }],
	});

	assert.ok(prompt.startsWith("You are a coding agent"), "authored text must come first");
	assert.match(prompt, /## Available tools\n\n- read: /);
	assert.match(prompt, /## Skills\n\nRead a skill/);
	assert.ok(prompt.trimEnd().endsWith("Current working directory: /tmp"));
});

test("read rejects a missing file and edit refuses an ambiguous match", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-"));
	const tools = createTools(["read", "edit"], dir);
	const read = tools.find((tool) => tool.name === "read");
	const edit = tools.find((tool) => tool.name === "edit");
	assert.ok(read && edit);

	await assert.rejects(async () => {
		await read.execute("call-1", { path: "absent.txt" });
	});

	const target = path.join(dir, "sample.txt");
	await writeFile(target, "alpha\nbeta\nalpha\n", "utf8");
	await assert.rejects(async () => {
		await edit.execute("call-2", { path: "sample.txt", oldText: "alpha", newText: "gamma" });
	}, /matches 2 times/);

	const result = await edit.execute("call-3", { path: "sample.txt", oldText: "beta", newText: "gamma" });
	assert.equal(result.details.replaced, 1);
	assert.equal(await readFile(target, "utf8"), "alpha\ngamma\nalpha\n");

	// The renderer shows a diff from this data, so the real tool must produce the
	// shape it reads. A fixture in the renderer's tests cannot prove that.
	assert.equal(result.details.change.line, 2, "1-indexed line where the replacement starts");
	assert.deepEqual(result.details.change.removed, ["beta"]);
	assert.deepEqual(result.details.change.added, ["gamma"]);
	assert.equal(result.details.change.path, target);

	const multiline = await edit.execute("call-4", {
		path: "sample.txt",
		oldText: "alpha\ngamma",
		newText: "one\ntwo\nthree",
	});
	assert.equal(multiline.details.change.line, 1);
	assert.deepEqual(multiline.details.change.removed, ["alpha", "gamma"]);
	assert.deepEqual(multiline.details.change.added, ["one", "two", "three"]);
});

test("bash reports the exit code and the working directory", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-"));
	const bash = createTools(["bash"], dir).find((tool) => tool.name === "bash");
	assert.ok(bash);

	const ok = await bash.execute("call-1", { command: "pwd" });
	const text = ok.content.map((block) => ("text" in block ? block.text : "")).join("");
	assert.equal(ok.details.exitCode, 0);
	assert.ok(text.includes(dir), `expected ${dir} in ${text}`);

	const bad = await bash.execute("call-2", { command: "exit 3" });
	assert.equal(bad.details.exitCode, 3);
});

test("a packaged install falls back to the profiles it ships", async () => {
	// A subprocess with its working directory outside the repository, because
	// the walk-up is relative to the working directory and this test process is
	// inside the repository, where the walk-up succeeds first.
	const empty = await mkdtemp(path.join(tmpdir(), "k9999-empty-"));
	const shipped = path.join(repoRoot, "profiles");
	const probe = [
		`import { resolveProfilesDir } from ${JSON.stringify(coreEntry)};`,
		`console.log(await resolveProfilesDir(undefined, [${JSON.stringify(shipped)}]));`,
	].join("\n");

	const { stdout } = await run("node", ["--input-type=module", "-e", probe], { cwd: empty });
	assert.equal(stdout.trim(), shipped, "the shipped copy is the only reachable one");
});

test("without a fallback, an unsearchable working directory names what it searched", async () => {
	const empty = await mkdtemp(path.join(tmpdir(), "k9999-empty-"));
	const probe = [
		`import { resolveProfilesDir } from ${JSON.stringify(coreEntry)};`,
		`await resolveProfilesDir(undefined, ["/nonexistent/profiles"]).catch((error) => {`,
		`  console.error(error.message);`,
		`  process.exit(1);`,
		`});`,
	].join("\n");

	const failure = await run("node", ["--input-type=module", "-e", probe], { cwd: empty }).then(
		() => undefined,
		(error: { stderr?: string }) => error,
	);
	assert.match(failure?.stderr ?? "", /\/nonexistent\/profiles/, "the error must name every directory searched");
});

test("a skill description comes from frontmatter, then from the first paragraph", () => {
	assert.equal(parseSkillDescription('---\ndescription: "From frontmatter."\n---\n# Title\n'), "From frontmatter.");
	assert.equal(parseSkillDescription("# Title\n\ndescription: A bare description.\n"), "A bare description.");
	assert.equal(parseSkillDescription("# Title\n\nFrom the first paragraph.\nSecond line.\n"), "From the first paragraph.");
	assert.equal(parseSkillDescription("# Title\n\n# Another heading\n"), undefined);
});

test("a declared skill with no SKILL.md fails instead of being skipped", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-skills-"));
	await assert.rejects(async () => {
		await resolveSkills(dir, ["absent"]);
	}, SkillError);
});

test("declared skills reach the system prompt", async () => {
	const skillsDir = await mkdtemp(path.join(tmpdir(), "k9999-skills-"));
	await mkdir(path.join(skillsDir, "demo"), { recursive: true });
	await writeFile(path.join(skillsDir, "demo", "SKILL.md"), "description: A demo skill.\n", "utf8");

	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);

	const base = await loadProfile(await profilesDir(), "code");
	const profile = { ...base, config: { ...base.config, skills: ["demo"] } };
	const harness = await createHarness({
		profile,
		cwd: process.cwd(),
		skillsDir,
		resolvedModel: { models, model: faux.getModel(), provider: "faux", id: "faux-1" },
	});

	assert.match(harness.systemPrompt, /- demo: A demo skill\. \(.*demo\/SKILL\.md\)/);
});

test("a scripted provider drives one full turn through the assembled harness", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "k9999-"));
	await writeFile(path.join(dir, "notes.txt"), "first line\nsecond line\n", "utf8");

	const faux = fauxProvider();
	faux.setResponses([
		fauxAssistantMessage([
			fauxToolCall("read", { path: "notes.txt" }),
		]),
		fauxAssistantMessage("The file has two lines."),
	]);

	const models = createModels();
	models.setProvider(faux.provider);

	const profile = await loadProfile(await profilesDir(), "code");
	const harness = await createHarness({
		profile,
		cwd: dir,
		resolvedModel: { models, model: faux.getModel(), provider: "faux", id: "faux-1" },
	});

	const seen: string[] = [];
	harness.agent.subscribe((event) => {
		seen.push(event.type);
	});

	await harness.agent.prompt("How many lines are in notes.txt?");

	assert.ok(seen.includes("tool_execution_start"), "the model's tool call must execute");
	assert.ok(seen.includes("tool_execution_end"));
	assert.ok(seen.includes("agent_end"));
	assert.equal(faux.state.callCount, 2, "one call for the tool request, one for the answer");
});
