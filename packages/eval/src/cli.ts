#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProfilesDir } from "@k9999/core";
import {
	baselineConfig,
	type Config,
	compareDeterministic,
	CONFIGS,
	findConfig,
	listTasks,
	loadTask,
	profileFor,
	recordFileName,
	replay,
	type RunRecord,
	type RunSample,
	renderReport,
	sameToolSurface,
	serializeRecord,
	buildReport,
	runTask,
} from "./index.ts";

const USAGE = `k9999 eval — measure the harness over a fixed task set

Usage:
  npm run eval -- [options]

Options:
      --tasks <ids>       Comma-separated task ids, or "all" (default: all)
      --config <ids>      Comma-separated config ids (default: the baseline)
      --runs <n>          Runs per task per config (default: 3, or 1 when --scripted)
      --scripted          Use each task's script.json. No network, no credentials
      --verify-replay     Replay each recorded transcript and compare deterministic metrics
      --record <dir>      Write transcripts here as JSONL
      --tasks-dir <dir>   Task directory (default: packages/eval/tasks)
      --profiles <dir>    Profiles directory (default: the nearest ./profiles)
      --json              Machine-readable output on stdout
  -h, --help              Show this help

Configs:
${CONFIGS.map((config) => `  ${config.id.padEnd(20)} ${config.description}`).join("\n")}

Exit codes:
  0  every run passed its predicate and every replay matched
  1  a predicate failed, or a replay disagreed with its recording
  2  the invocation was invalid

A failed predicate is one the task defines, in a command or a file, never a
model's opinion. See docs/specs/0004-measurement-and-budget.md.
`;

interface Args {
	tasks: string;
	configs: string[];
	runs?: number;
	scripted: boolean;
	verifyReplay: boolean;
	recordDir?: string;
	tasksDir?: string;
	profilesDir?: string;
	json: boolean;
	help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = {
		tasks: "all",
		configs: [],
		scripted: false,
		verifyReplay: false,
		json: false,
		help: false,
	};

	const split = (value: string): string[] =>
		value
			.split(",")
			.map((entry) => entry.trim())
			.filter((entry) => entry !== "");

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = (): string => {
			const value = argv[index + 1];
			if (value === undefined) {
				throw new UsageError(`${arg} requires a value`);
			}
			index += 1;
			return value;
		};
		switch (arg) {
			case "--tasks":
				args.tasks = next();
				break;
			case "--config":
				args.configs.push(...split(next()));
				break;
			case "--runs": {
				const raw = next();
				const parsed = Number(raw);
				if (!Number.isInteger(parsed) || parsed < 1) {
					throw new UsageError(`--runs needs a positive integer, got ${JSON.stringify(raw)}`);
				}
				args.runs = parsed;
				break;
			}
			case "--scripted":
				args.scripted = true;
				break;
			case "--verify-replay":
				args.verifyReplay = true;
				break;
			case "--record":
				args.recordDir = next();
				break;
			case "--tasks-dir":
				args.tasksDir = next();
				break;
			case "--profiles":
				args.profilesDir = next();
				break;
			case "--json":
				args.json = true;
				break;
			case "-h":
			case "--help":
				args.help = true;
				break;
			default:
				throw new UsageError(`Unknown option: ${arg}`);
		}
	}
	return args;
}

interface ReplayVerdict {
	readonly configId: string;
	readonly taskId: string;
	readonly matched: boolean;
	readonly differences: readonly { key: string; left: unknown; right: unknown }[];
}

function resolveConfigs(requested: readonly string[]): Config[] {
	if (requested.length === 0) {
		return [baselineConfig()];
	}
	const seen = new Set<string>();
	const configs: Config[] = [];
	for (const id of requested) {
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		configs.push(findConfig(id));
	}
	return configs;
}

function log(message: string): void {
	process.stderr.write(`${message}\n`);
}

async function main(): Promise<number> {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
		return 2;
	}
	if (args.help) {
		process.stdout.write(USAGE);
		return 0;
	}

	const tasksDir = args.tasksDir ?? path.resolve(import.meta.dirname, "../tasks");
	const profilesDir = await resolveProfilesDir(args.profilesDir);
	const configs = resolveConfigs(args.configs);

	const allTaskIds = await listTasks(tasksDir);
	const wanted = args.tasks === "all" ? allTaskIds : args.tasks.split(",").map((id) => id.trim());
	const unknown = wanted.filter((id) => !allTaskIds.includes(id));
	if (unknown.length > 0) {
		throw new UsageError(`Unknown task(s): ${unknown.join(", ")}. Available: ${allTaskIds.join(", ")}`);
	}
	const tasks = await Promise.all(wanted.map(async (id) => await loadTask(path.join(tasksDir, id))));
	if (tasks.length === 0) {
		throw new UsageError(`No tasks in ${tasksDir}`);
	}

	if (args.scripted) {
		const missing = tasks.filter((task) => task.script === undefined).map((task) => task.id);
		if (missing.length > 0) {
			throw new UsageError(
				`--scripted needs a script.json in every task. Missing: ${missing.join(", ")}. Run without --scripted, or generate them with "npm run eval:scripts".`,
			);
		}
		const baseline = configs[0];
		if (baseline !== undefined) {
			for (const config of configs.slice(1)) {
				if (!(await sameToolSurface(baseline, config, profilesDir))) {
					throw new UsageError(
						`--scripted cannot compare "${baseline.id}" with "${config.id}": their tool surfaces differ. A recorded transcript is a recording of the model, so replaying it against a different tool set measures an error path. Compare tool sets with a real model.`,
					);
				}
			}
		}
	}

	const runs = args.runs ?? (args.scripted ? 1 : 3);
	if (args.recordDir !== undefined) {
		await mkdir(args.recordDir, { recursive: true });
	}

	const samples: RunSample[] = [];
	const failures: { configId: string; taskId: string; run: number; detail: string }[] = [];
	const breaches: { configId: string; taskId: string; metric: string; limit: number; actual: number }[] = [];
	const verdicts: ReplayVerdict[] = [];

	for (const config of configs) {
		const profile = await profileFor(config, profilesDir);
		for (const task of tasks) {
			for (let run = 1; run <= runs; run += 1) {
				log(`[${config.id}] ${task.id} run ${run}/${runs}${args.scripted ? " (scripted)" : ""}`);
				const result = await runTask({
					task,
					profile,
					configId: config.id,
					...(args.scripted && task.script ? { script: task.script } : {}),
					...(config.model === undefined ? {} : { model: config.model }),
				});
				const record: RunRecord = result.record;
				samples.push({
					configId: config.id,
					taskId: task.id,
					metrics: record.metrics,
					usageSource: record.usageSource,
				});

				if (!result.check.ok) {
					failures.push({ configId: config.id, taskId: task.id, run, detail: result.check.detail });
				}
				for (const entry of record.entries) {
					if (entry.type === "breach") {
						breaches.push({
							configId: config.id,
							taskId: task.id,
							metric: entry.breach.metric,
							limit: entry.breach.limit,
							actual: entry.breach.actual,
						});
					}
				}

				if (args.recordDir !== undefined) {
					const file = path.join(args.recordDir, recordFileName(task.id, config.id, run));
					await writeFile(file, serializeRecord(record.entries), "utf8");
				}

				if (args.verifyReplay && run === 1) {
					const replayed = await replay(record, { task, profile });
					const differences = compareDeterministic(record.metrics, replayed.record.metrics);
					verdicts.push({
						configId: config.id,
						taskId: task.id,
						matched: differences.length === 0,
						differences: differences.map((difference) => ({
							key: difference.key,
							left: difference.left,
							right: difference.right,
						})),
					});
				}
			}
		}
	}

	const baselineId = configs[0]?.id;
	const report = buildReport({
		samples,
		...(baselineId === undefined ? {} : { baselineId }),
	});

	const replayFailed = verdicts.some((verdict) => !verdict.matched);

	if (args.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					baseline: report.baselineId,
					configs: report.configIds,
					tasks: report.allTasks,
					comparableTasks: report.comparableTasks,
					runs,
					scripted: args.scripted,
					summaries: report.summaries,
					excluded: report.excluded,
					warnings: report.warnings,
					refused: report.refused,
					usageSources: report.usageSources,
					mixedUsageSource: report.mixedUsageSource,
					failures,
					breaches,
					replay: verdicts,
				},
				null,
				2,
			)}\n`,
		);
	} else {
		process.stdout.write(`\n${report.allTasks.length} task(s), ${configs.length} config(s), ${runs} run(s) each\n\n`);
		process.stdout.write(renderReport(report));

		if (report.usageSources.includes("estimated")) {
			process.stdout.write(
				"\nestimated token figures. The scripted provider counts characters, not tokens, and\nreports every cost as zero. These numbers describe the harness, not a model, and\nare not comparable to a run against a real provider.\n",
			);
		}

		if (failures.length > 0) {
			process.stdout.write(`\nfailed predicates (${failures.length})\n`);
			for (const failure of failures) {
				process.stdout.write(`  ${failure.configId} / ${failure.taskId} run ${failure.run}: ${failure.detail}\n`);
			}
		}
		if (breaches.length > 0) {
			process.stdout.write(`\nbudget breaches (${breaches.length})\n`);
			for (const breach of breaches) {
				process.stdout.write(
					`  ${breach.configId} / ${breach.taskId}: ${breach.metric} ${breach.actual.toFixed(4)} exceeded ${breach.limit}\n`,
				);
			}
		}
		if (verdicts.length > 0) {
			const matched = verdicts.filter((verdict) => verdict.matched).length;
			process.stdout.write(`\nreplay: ${matched}/${verdicts.length} matched on every deterministic metric\n`);
			for (const verdict of verdicts.filter((entry) => !entry.matched)) {
				process.stdout.write(`  ${verdict.configId} / ${verdict.taskId}:\n`);
				for (const difference of verdict.differences) {
					process.stdout.write(
						`    ${difference.key}: recorded ${JSON.stringify(difference.left)} vs replayed ${JSON.stringify(difference.right)}\n`,
					);
				}
			}
		}
	}

	return failures.length > 0 || replayFailed ? 1 : 0;
}

try {
	process.exitCode = await main();
} catch (error) {
	if (error instanceof UsageError) {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 2;
	} else {
		process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
		process.exitCode = 1;
	}
}
