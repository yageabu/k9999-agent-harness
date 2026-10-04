import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, createModels, fauxProvider, type Usage } from "@earendil-works/pi-ai";
import { createHarness, type Profile, type ResolvedModel } from "@k9999/core";
import { addUsage, type Budget, type BudgetBreach, checkBudget, emptyMetrics, type RunMetrics } from "./metrics.ts";
import { type RecordEntry, type RunRecord, summarize } from "./record.ts";
import { type CheckResult, evaluateCheck, resolveInside, type Task } from "./task.ts";

/**
 * What a component gets while a run is in progress.
 *
 * Both methods exist so that a component's effect on the measurement is
 * recorded rather than estimated. A decision layer that spends tokens without
 * calling `accountTokens` makes every reported saving unverifiable, and a
 * component that silently falls back without calling `degrade` makes its
 * numbers silently incomparable to a healthy run's.
 */
export interface RunContext {
	readonly cwd: string;
	readonly task: Task;
	/** Mark this run as degraded. Repeat calls accumulate. */
	degrade(reason: string): void;
	/** Account tokens spent outside the main model. */
	accountTokens(usage: Usage): void;
}

export interface RunSpec {
	readonly task: Task;
	readonly profile: Profile;
	readonly configId: string;
	/** Model override. Ignored when `script` is set, which needs no provider. */
	readonly model?: string;
	/** Scripted model responses. When set, the run uses a faux provider and no network. */
	readonly script?: readonly AssistantMessage[];
	/** Run-level ceiling. A task's own budget overrides these. */
	readonly budget?: Budget;
	/** Install components that observe or extend the run, such as a decision layer. */
	readonly install?: (agent: Agent, context: RunContext) => void;
}

export interface RunOptions {
	/** Reuse a directory instead of a temporary one. It is not removed afterwards. */
	readonly workDir?: string;
}

export interface RunResult {
	readonly record: RunRecord;
	readonly workDir: string;
	readonly check: CheckResult;
}

async function materialize(workDir: string, fixture: ReadonlyMap<string, string>): Promise<void> {
	for (const [relative, content] of fixture) {
		const target = resolveInside(workDir, relative);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, "utf8");
	}
}

/**
 * Run one task under one configuration.
 *
 * The fixture is copied into a fresh directory per run, so a task's starting
 * state is exactly what `task.json` declares and two runs cannot interfere.
 * The task manifest itself stays outside that directory, which is what keeps a
 * run from reading the predicate it is being judged by.
 */
export async function runTask(spec: RunSpec, options: RunOptions = {}): Promise<RunResult> {
	const workDir = options.workDir ?? (await mkdtemp(path.join(tmpdir(), "k9999-eval-")));
	const startedAt = new Date().toISOString();
	await materialize(workDir, spec.task.fixture);

	const budget: Budget = { ...(spec.budget ?? {}), ...(spec.task.budget ?? {}) };

	const entries: RecordEntry[] = [
		{
			type: "run",
			taskId: spec.task.id,
			configId: spec.configId,
			modelRef: spec.model ?? spec.profile.config.model ?? "",
			startedAt,
			scripted: spec.script !== undefined,
			// The scripted provider estimates tokens from character counts and
			// reports zero cost. Labelling it here is what stops an estimate from
			// being compared against a provider's reported figures later.
			usageSource: spec.script === undefined ? "reported" : "estimated",
		},
	];

	let metrics = emptyMetrics();
	let breach: BudgetBreach | undefined;
	let assistantIndex = 0;
	const degradeReasons: string[] = [];
	const started = Date.now();

	let resolvedModel: ResolvedModel | undefined;
	let faux: ReturnType<typeof fauxProvider> | undefined;
	if (spec.script) {
		faux = fauxProvider();
		faux.setResponses([...spec.script]);
		const models = createModels();
		models.setProvider(faux.provider);
		resolvedModel = { models, model: faux.getModel(), provider: "faux", id: "faux-1" };
	}

	const harness = await createHarness({
		profile: spec.profile,
		cwd: workDir,
		...(spec.model === undefined ? {} : { model: spec.model }),
		...(resolvedModel === undefined ? {} : { resolvedModel }),
	});
	if (faux !== undefined) {
		// Record the reference the faux run actually used; the profile's model is not consulted.
		entries[0] = { ...(entries[0] as Extract<RecordEntry, { type: "run" }>), modelRef: "faux/faux-1" };
	}

	const context: RunContext = {
		cwd: workDir,
		task: spec.task,
		degrade(reason: string): void {
			degradeReasons.push(reason);
			entries.push({ type: "degrade", reason });
		},
		accountTokens(usage: Usage): void {
			// The decider's cost lands in costUSD, not only in deciderTokens. A
			// decision layer whose cost sits outside the reported total is how a
			// saving becomes unverifiable.
			metrics = {
				...metrics,
				deciderTokens: metrics.deciderTokens + usage.input + usage.output,
				costUSD: metrics.costUSD + usage.cost.total,
			};
		},
	};

	harness.agent.subscribe((event) => {
		switch (event.type) {
			case "message_end": {
				const message = event.message;
				if (message.role !== "assistant") {
					break;
				}
				metrics = addUsage(metrics, message.usage);
				assistantIndex += 1;
				entries.push({ type: "assistant", index: assistantIndex, message });
				break;
			}
			case "tool_execution_end": {
				metrics = { ...metrics, toolCalls: metrics.toolCalls + 1 };
				entries.push({
					type: "tool",
					index: metrics.toolCalls,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					isError: event.isError,
				});
				break;
			}
			case "turn_end": {
				metrics = { ...metrics, turns: metrics.turns + 1, wallMs: Date.now() - started };
				const hit = checkBudget(metrics, budget);
				if (hit && breach === undefined) {
					breach = hit;
					entries.push({ type: "breach", breach: hit });
					// Stop rather than adapt. A budget that changes behavior measures
					// something other than the thing under test.
					harness.agent.abort();
				}
				break;
			}
			default:
				break;
		}
	});

	if (spec.install) {
		spec.install(harness.agent, context);
	}

	try {
		await harness.agent.prompt(spec.task.prompt);
	} catch (error) {
		entries.push({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
	await harness.agent.waitForIdle();

	const check = await evaluateCheck(spec.task.check, workDir);
	entries.push({ type: "check", ok: check.ok, detail: check.detail });

	metrics = {
		...metrics,
		wallMs: Date.now() - started,
		// A breached run is not a success even when the predicate passes. The run
		// stopped somewhere in the middle, so the fixture's state describes a
		// partly finished job.
		success: check.ok && breach === undefined,
		breached: breach !== undefined,
		degraded: degradeReasons.length > 0,
		degradeReasons: [...degradeReasons],
	};
	entries.push({ type: "metrics", metrics });

	if (options.workDir === undefined) {
		await rm(workDir, { recursive: true, force: true });
	}

	return { record: summarize(entries), workDir, check };
}

/** Where a run's transcript is written under a records directory. */
export function recordFileName(taskId: string, configId: string, run: number): string {
	return `${configId}__${taskId}__${String(run).padStart(2, "0")}.jsonl`;
}

export type { RunMetrics };
