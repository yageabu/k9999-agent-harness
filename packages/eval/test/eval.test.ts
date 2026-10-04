import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadProfile, resolveProfilesDir } from "@k9999/core";
import {
	addUsage,
	buildReport,
	checkBudget,
	compareDeterministic,
	emptyMetrics,
	evaluateCheck,
	listTasks,
	loadTask,
	parseRecord,
	replay,
	resolveInside,
	type RunSample,
	runTask,
	serializeRecord,
	summarize,
	TaskError,
	type Task,
} from "../src/index.ts";

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tasksDir = path.join(repoRoot, "packages/eval/tasks");

async function task(id: string): Promise<Task> {
	return await loadTask(path.join(tasksDir, id));
}

async function profile(): Promise<Awaited<ReturnType<typeof loadProfile>>> {
	return await loadProfile(await resolveProfilesDir(path.join(repoRoot, "profiles")), "code");
}

function tempTaskDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), "k9999-task-"));
}

// ---------------------------------------------------------------------------
// task loading, and the predicate requirement
// ---------------------------------------------------------------------------

test("a task with no success predicate fails to load", async () => {
	const dir = await tempTaskDir();
	await writeFile(path.join(dir, "task.json"), JSON.stringify({ prompt: "do something" }), "utf8");
	await assert.rejects(async () => await loadTask(dir), (error: unknown) => {
		assert.ok(error instanceof TaskError);
		assert.match(error.message, /no "check"/);
		return true;
	});
});

test("a task with an empty prompt fails to load", async () => {
	const dir = await tempTaskDir();
	await writeFile(
		path.join(dir, "task.json"),
		JSON.stringify({ prompt: "  ", check: { kind: "command", command: "true" } }),
		"utf8",
	);
	await assert.rejects(async () => await loadTask(dir), /prompt/);
});

test("an unknown check kind fails to load", async () => {
	const dir = await tempTaskDir();
	await writeFile(
		path.join(dir, "task.json"),
		JSON.stringify({ prompt: "x", check: { kind: "vibes", command: "true" } }),
		"utf8",
	);
	await assert.rejects(async () => await loadTask(dir), /check\.kind/);
});

test("the shipped tasks load with a fixture and a predicate", async () => {
	const ids = await listTasks(tasksDir);
	assert.deepEqual(ids, ["count-errors", "fix-off-by-one", "write-sum-module"]);
	for (const id of ids) {
		const loaded = await task(id);
		assert.notEqual(loaded.prompt.trim(), "", `${id}: empty prompt`);
		assert.ok(loaded.fixture.size > 0, `${id}: no fixture`);
	}
});

test("a path that escapes the run directory is rejected", () => {
	assert.throws(() => resolveInside("/tmp/run", "../outside"), /escapes/);
	assert.throws(() => resolveInside("/tmp/run", "/etc/passwd"), /relative/);
	assert.doesNotThrow(() => resolveInside("/tmp/run", "nested/file.txt"));
});

test("a file predicate reports a missing file rather than passing", async () => {
	const dir = await tempTaskDir();
	const result = await evaluateCheck({ kind: "fileEquals", path: "absent.txt", content: "x" }, dir);
	assert.equal(result.ok, false);
	assert.match(result.detail, /does not exist/);
});

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

test("no breach while every ceiling holds", () => {
	const metrics = { ...emptyMetrics(), turns: 2, costUSD: 0.5, wallMs: 1000 };
	assert.equal(checkBudget(metrics, { maxTurns: 3, maxCostUSD: 1, maxWallMs: 2000 }), undefined);
	assert.equal(checkBudget(metrics, {}), undefined);
});

test("a ceiling is breached only when exceeded", () => {
	const metrics = { ...emptyMetrics(), turns: 3, costUSD: 1, wallMs: 2000 };
	assert.equal(checkBudget(metrics, { maxTurns: 3 }), undefined, "at the limit is not over it");
	assert.deepEqual(checkBudget(metrics, { maxTurns: 2 }), { metric: "turns", limit: 2, actual: 3 });
	assert.deepEqual(checkBudget(metrics, { maxCostUSD: 0.5 }), { metric: "costUSD", limit: 0.5, actual: 1 });
	assert.deepEqual(checkBudget(metrics, { maxWallMs: 500 }), { metric: "wallMs", limit: 500, actual: 2000 });
});

test("two breaches at once report the same one every time", () => {
	const metrics = { ...emptyMetrics(), turns: 9, costUSD: 9, wallMs: 9 };
	const first = checkBudget(metrics, { maxTurns: 1, maxCostUSD: 1, maxWallMs: 1 });
	const second = checkBudget(metrics, { maxCostUSD: 1, maxWallMs: 1, maxTurns: 1 });
	assert.deepEqual(first, second);
	assert.equal(first?.metric, "turns");
});

test("a run over its turn budget stops, records the breach, and is never a success", async () => {
	const loaded = await task("fix-off-by-one");
	const { record, check } = await runTask({
		task: loaded,
		profile: await profile(),
		configId: "budget-test",
		script: loaded.script ?? [],
		budget: { maxTurns: 1 },
	});

	const breaches = record.entries.filter((entry) => entry.type === "breach");
	assert.equal(breaches.length, 1, "exactly one breach is recorded");
	assert.equal(record.metrics.breached, true);

	// The ceiling is checked at turn boundaries, so a run stops at most one turn
	// after the turn that broke it, and never runs the whole script.
	const breach = breaches[0];
	assert.ok(breach?.type === "breach");
	assert.ok(
		record.metrics.turns <= breach.breach.actual + 1,
		`stopped at ${record.metrics.turns} turns, breach was at ${breach.breach.actual}`,
	);
	assert.ok(record.metrics.turns < (loaded.script?.length ?? 0), "it did not finish the script");

	// The predicate passes here, because the edit landed before the stop. A run
	// cut short after its side effects landed is exactly the case that must not
	// be reported as a cheap win.
	assert.equal(check.ok, true, "the fixture happens to be in a passing state");
	assert.equal(record.metrics.success, false, "a breached run is not a success");
});

// ---------------------------------------------------------------------------
// replay determinism
// ---------------------------------------------------------------------------

test("replay reproduces every deterministic metric and only differs on wall time", async () => {
	const loaded = await task("fix-off-by-one");
	const spec = {
		task: loaded,
		profile: await profile(),
		configId: "replay-test",
		script: loaded.script ?? [],
	};
	const first = await runTask(spec);
	const second = await replay(first.record, { task: loaded, profile: await profile() });

	assert.deepEqual(compareDeterministic(first.record.metrics, second.record.metrics), []);
	assert.equal(second.record.metrics.success, true);
	assert.equal(second.record.metrics.turns, first.record.metrics.turns);
});

test("compareDeterministic ignores wall time and catches a token difference", () => {
	const base = emptyMetrics();
	assert.deepEqual(compareDeterministic({ ...base, wallMs: 1 }, { ...base, wallMs: 9999 }), []);
	const differences = compareDeterministic({ ...base, inputTokens: 10 }, { ...base, inputTokens: 11 });
	assert.deepEqual(differences, [{ key: "inputTokens", left: 10, right: 11 }]);
});

// ---------------------------------------------------------------------------
// usage accounting
// ---------------------------------------------------------------------------

test("usage folds cache reads and writes into input tokens and adds the cost", () => {
	const metrics = addUsage(emptyMetrics(), {
		input: 100,
		output: 20,
		cacheRead: 30,
		cacheWrite: 5,
		totalTokens: 155,
		cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
	});
	assert.equal(metrics.inputTokens, 135);
	assert.equal(metrics.outputTokens, 20);
	assert.equal(metrics.costUSD, 0.3);
});

test("a decider's tokens land in the cost total, not only in its own bucket", async () => {
	const loaded = await task("write-sum-module");
	const { record } = await runTask({
		task: loaded,
		profile: await profile(),
		configId: "decider-test",
		script: loaded.script ?? [],
		install: (_agent, context) => {
			context.accountTokens({
				input: 40,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 50,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
			});
			context.degrade("decider unavailable");
		},
	});
	assert.equal(record.metrics.deciderTokens, 50);
	assert.equal(record.metrics.costUSD, 0.02, "a decider's cost is inside the reported total");
	assert.equal(record.metrics.degraded, true);
	assert.deepEqual(record.metrics.degradeReasons, ["decider unavailable"]);
});

// ---------------------------------------------------------------------------
// record round trip
// ---------------------------------------------------------------------------

test("a transcript survives a JSONL round trip", async () => {
	const loaded = await task("count-errors");
	const { record } = await runTask({
		task: loaded,
		profile: await profile(),
		configId: "round-trip",
		script: loaded.script ?? [],
	});
	const reparsed = summarize(parseRecord(serializeRecord(record.entries)));
	assert.equal(reparsed.taskId, "count-errors");
	assert.equal(reparsed.usageSource, "estimated");
	assert.deepEqual(compareDeterministic(reparsed.metrics, record.metrics), []);
});

test("a transcript with no metrics entry is rejected", () => {
	const text = `${JSON.stringify({
		type: "run",
		taskId: "t",
		configId: "c",
		modelRef: "m",
		startedAt: "now",
		scripted: true,
		usageSource: "estimated",
	})}\n`;
	assert.throws(() => summarize(parseRecord(text)), /no metrics entry/);
});

test("a scripted run labels its figures as estimated", async () => {
	const loaded = await task("fix-off-by-one");
	const scripted = await runTask({
		task: loaded,
		profile: await profile(),
		configId: "source-test",
		script: loaded.script ?? [],
	});
	assert.equal(scripted.record.usageSource, "estimated");

	const failed = await runTask({
		task: { ...loaded, check: { kind: "command", command: "false" } },
		profile: await profile(),
		configId: "source-test",
		script: loaded.script ?? [],
	});
	assert.equal(failed.record.metrics.success, false, "a failing predicate is recorded as failure");
});

// ---------------------------------------------------------------------------
// the report refuses comparisons it cannot make
// ---------------------------------------------------------------------------

function sample(configId: string, taskId: string, overrides: Partial<RunSample["metrics"]> = {}): RunSample {
	return {
		configId,
		taskId,
		usageSource: "reported",
		metrics: { ...emptyMetrics(), success: true, ...overrides },
	};
}

function degraded(configId: string, taskId: string, reason: string): RunSample {
	return {
		configId,
		taskId,
		usageSource: "reported",
		metrics: { ...emptyMetrics(), success: true, degraded: true, degradeReasons: [reason] },
	};
}

test("a degraded run is named and its task leaves every delta", () => {
	const report = buildReport({
		baselineId: "a",
		samples: [
			sample("a", "t1", { inputTokens: 100 }),
			sample("b", "t1", { inputTokens: 50 }),
			degraded("a", "t2", "decider timeout"),
			sample("b", "t2", { inputTokens: 50 }),
		],
	});

	assert.deepEqual(report.comparableTasks, ["t1"]);
	assert.deepEqual(report.allTasks, ["t1", "t2"]);
	assert.equal(report.excluded.length, 1);
	assert.deepEqual(report.excluded[0], { configId: "a", taskId: "t2", reasons: ["decider timeout"] });
	assert.ok(report.warnings.some((warning) => warning.includes("t2") && warning.includes("decider timeout")));

	const candidate = report.summaries.find((summary) => summary.configId === "b");
	assert.equal(candidate?.tasks, 1, "the delta covers only the comparable task");
	assert.equal(candidate?.delta?.inputTokens, -50);
});

test("when every task is degraded, absolute totals survive and no delta is printed", () => {
	const report = buildReport({
		baselineId: "a",
		samples: [sample("a", "t1", { inputTokens: 100 }), degraded("b", "t1", "outage")],
	});

	assert.equal(report.comparableTasks.length, 0);
	assert.equal(report.refused, true);
	assert.equal(report.summaries.find((summary) => summary.configId === "b")?.delta, undefined);
	assert.equal(report.summaries.find((summary) => summary.configId === "b")?.aggregate.inputTokens, 0);
});

test("estimated and reported figures are never subtracted from each other", () => {
	const report = buildReport({
		baselineId: "a",
		samples: [
			sample("a", "t1", { inputTokens: 100 }),
			{ ...sample("b", "t1", { inputTokens: 40 }), usageSource: "estimated" },
		],
	});

	assert.deepEqual(report.usageSources, ["estimated", "reported"]);
	assert.equal(report.mixedUsageSource, true);
	assert.equal(report.refused, true);
	assert.equal(report.summaries.find((summary) => summary.configId === "b")?.delta, undefined);
	assert.ok(report.warnings.some((warning) => warning.includes("estimated")));
});

test("a delta averages runs rather than summing them", () => {
	const report = buildReport({
		baselineId: "a",
		samples: [
			sample("a", "t1", { inputTokens: 100, success: true }),
			sample("a", "t1", { inputTokens: 200, success: true }),
			sample("b", "t1", { inputTokens: 60, success: true }),
			sample("b", "t1", { inputTokens: 40, success: false }),
		],
	});

	const candidate = report.summaries.find((summary) => summary.configId === "b");
	assert.equal(candidate?.aggregate.inputTokens, 50);
	assert.equal(candidate?.aggregate.successRate, 0.5);
	assert.equal(candidate?.delta?.inputTokens, -100);
	assert.equal(candidate?.delta?.successRate, -0.5);
	assert.equal(candidate?.aggregate.runs, 2);
});

test("an unknown baseline is an error, not an empty report", () => {
	assert.throws(() => buildReport({ baselineId: "nope", samples: [sample("a", "t1")] }), /baseline/);
});

// ---------------------------------------------------------------------------
// the command
// ---------------------------------------------------------------------------

test("one command produces a report with every metric and a clean replay", async () => {
	const { stdout } = await run("node", ["packages/eval/src/cli.ts", "--scripted", "--verify-replay"], {
		cwd: repoRoot,
	});
	for (const column of ["in", "out", "decider", "turns", "cost", "success"]) {
		assert.ok(stdout.includes(column), `the report has no "${column}" column`);
	}
	assert.match(stdout, /usage figures: estimated/);
	assert.match(stdout, /estimated token figures/);
	assert.match(stdout, /replay: 3\/3 matched on every deterministic metric/);
	assert.match(stdout, /100%/);
});

test("comparing different tool surfaces from a recording is refused", async () => {
	const failure = await run("node", ["packages/eval/src/cli.ts", "--scripted", "--config", "code,code-no-edit"], {
		cwd: repoRoot,
	}).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /tool surfaces differ/);
});

test("an unusable invocation exits 2 with the available tasks named", async () => {
	const failure = await run("node", ["packages/eval/src/cli.ts", "--tasks", "nope"], { cwd: repoRoot }).then(
		() => undefined,
		(error: { code?: number; stderr?: string }) => error,
	);
	assert.equal(failure?.code, 2);
	assert.match(failure?.stderr ?? "", /Available: count-errors, fix-off-by-one, write-sum-module/);
});
