import type { RunMetrics } from "./metrics.ts";
import type { UsageSource } from "./record.ts";

/** One run's result, reduced to what a comparison needs. */
export interface RunSample {
	readonly configId: string;
	readonly taskId: string;
	readonly metrics: RunMetrics;
	/** Whether these token figures were reported by a provider or estimated. */
	readonly usageSource: UsageSource;
}

/**
 * Metrics averaged over a set of runs.
 *
 * Separate from `RunMetrics` on purpose. `success` and `degraded` are per-run
 * facts; across runs they become a rate and a count, and averaging a boolean
 * into a number is how a report starts hiding the thing it should surface.
 */
export interface Aggregate {
	readonly runs: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly deciderTokens: number;
	readonly turns: number;
	readonly toolCalls: number;
	readonly wallMs: number;
	readonly costUSD: number;
	/** Fraction of runs whose predicate passed, 0 to 1. */
	readonly successRate: number;
	readonly degradedRuns: number;
}

/** Aggregate metrics that can be subtracted from one another. */
export type Delta = {
	readonly [K in Exclude<keyof Aggregate, "runs" | "degradedRuns">]: number;
};

export interface ConfigSummary {
	readonly configId: string;
	readonly aggregate: Aggregate;
	/** Absent for the baseline configuration. */
	readonly delta?: Delta;
	/** Tasks this config's aggregate is computed over. */
	readonly tasks: number;
}

export interface ExcludedCell {
	readonly configId: string;
	readonly taskId: string;
	readonly reasons: readonly string[];
}

export interface Report {
	readonly baselineId: string;
	readonly configIds: readonly string[];
	/** Every task in the run set, whether or not it ended up comparable. */
	readonly allTasks: readonly string[];
	/** Tasks where every compared configuration produced only healthy runs. */
	readonly comparableTasks: readonly string[];
	readonly summaries: readonly ConfigSummary[];
	readonly excluded: readonly ExcludedCell[];
	readonly warnings: readonly string[];
	/** The distinct token-figure sources present in the samples. */
	readonly usageSources: readonly UsageSource[];
	/**
	 * True when the samples mix reported and estimated token figures.
	 *
	 * A provider-reported figure and a character-count estimate are different
	 * quantities. Their difference is not a saving, so no delta is computed from
	 * them together.
	 */
	readonly mixedUsageSource: boolean;
	/**
	 * True when no task was comparable, so no delta was computed.
	 *
	 * A report in this state still prints absolute totals, because they are
	 * still facts. It prints no delta, because there is no valid one to print.
	 */
	readonly refused: boolean;
}

export class ReportError extends Error {
	override readonly name = "ReportError";
}

const AGGREGATE_KEYS = [
	"inputTokens",
	"outputTokens",
	"deciderTokens",
	"turns",
	"toolCalls",
	"wallMs",
	"costUSD",
] as const;

export function aggregate(metrics: readonly RunMetrics[]): Aggregate {
	if (metrics.length === 0) {
		throw new ReportError("cannot aggregate zero runs");
	}
	const total = {
		runs: metrics.length,
		inputTokens: 0,
		outputTokens: 0,
		deciderTokens: 0,
		turns: 0,
		toolCalls: 0,
		wallMs: 0,
		costUSD: 0,
		success: 0,
		degradedRuns: 0,
	};
	for (const entry of metrics) {
		for (const key of AGGREGATE_KEYS) {
			total[key] += entry[key];
		}
		if (entry.success) {
			total.success += 1;
		}
		if (entry.degraded) {
			total.degradedRuns += 1;
		}
	}
	return {
		runs: total.runs,
		inputTokens: total.inputTokens / total.runs,
		outputTokens: total.outputTokens / total.runs,
		deciderTokens: total.deciderTokens / total.runs,
		turns: total.turns / total.runs,
		toolCalls: total.toolCalls / total.runs,
		wallMs: total.wallMs / total.runs,
		costUSD: total.costUSD / total.runs,
		successRate: total.success / total.runs,
		degradedRuns: total.degradedRuns,
	};
}

export function subtract(baseline: Aggregate, candidate: Aggregate): Delta {
	return {
		inputTokens: candidate.inputTokens - baseline.inputTokens,
		outputTokens: candidate.outputTokens - baseline.outputTokens,
		deciderTokens: candidate.deciderTokens - baseline.deciderTokens,
		turns: candidate.turns - baseline.turns,
		toolCalls: candidate.toolCalls - baseline.toolCalls,
		wallMs: candidate.wallMs - baseline.wallMs,
		costUSD: candidate.costUSD - baseline.costUSD,
		successRate: candidate.successRate - baseline.successRate,
	};
}

function group(samples: readonly RunSample[]): Map<string, Map<string, RunMetrics[]>> {
	const byConfig = new Map<string, Map<string, RunMetrics[]>>();
	for (const sample of samples) {
		let tasks = byConfig.get(sample.configId);
		if (!tasks) {
			tasks = new Map();
			byConfig.set(sample.configId, tasks);
		}
		const runs = tasks.get(sample.taskId);
		if (runs) {
			runs.push(sample.metrics);
		} else {
			tasks.set(sample.taskId, [sample.metrics]);
		}
	}
	return byConfig;
}

export interface BuildReportOptions {
	readonly samples: readonly RunSample[];
	/** Configuration every delta is measured against. Defaults to the first present. */
	readonly baselineId?: string;
}

/**
 * Compare configurations over a task set.
 *
 * A cell is one configuration on one task: its runs, averaged. A task is
 * comparable only when every compared configuration produced a healthy cell
 * for it. A degraded cell means the component under test did not operate, so
 * that task's numbers describe the fallback rather than the configuration, and
 * subtracting them from a healthy run's is not a comparison.
 *
 * The excluded tasks are named rather than dropped quietly. A delta over three
 * of four tasks is useful; a delta presented as covering four is a lie.
 */
export function buildReport(options: BuildReportOptions): Report {
	const { samples } = options;
	if (samples.length === 0) {
		throw new ReportError("no samples");
	}

	const byConfig = group(samples);
	const configIds = [...byConfig.keys()];
	const allTasks = [...new Set(samples.map((sample) => sample.taskId))].sort();

	const baselineId = options.baselineId ?? configIds[0];
	if (baselineId === undefined) {
		throw new ReportError("no configurations in the samples");
	}
	if (!byConfig.has(baselineId)) {
		throw new ReportError(`baseline "${baselineId}" has no samples`);
	}

	const excluded: ExcludedCell[] = [];
	const dropped = new Set<string>();
	const warnings: string[] = [];

	const cellOf = (configId: string, taskId: string): RunMetrics[] | undefined => byConfig.get(configId)?.get(taskId);

	for (const taskId of allTasks) {
		const unhealthy: string[] = [];
		for (const configId of configIds) {
			const runs = cellOf(configId, taskId);
			if (!runs) {
				unhealthy.push(`${configId} (no runs)`);
				continue;
			}
			const reasons = [...new Set(runs.filter((run) => run.degraded).flatMap((run) => run.degradeReasons))];
			if (reasons.length === 0) {
				continue;
			}
			excluded.push({ configId, taskId, reasons });
			unhealthy.push(`${configId} (${reasons.join("; ")})`);
		}
		if (unhealthy.length > 0) {
			dropped.add(taskId);
			warnings.push(`task "${taskId}" excluded from every delta: ${unhealthy.join(", ")}`);
		}
	}

	const comparableTasks = allTasks.filter((taskId) => !dropped.has(taskId));

	const usageSources = [...new Set(samples.map((sample) => sample.usageSource))].sort();
	const mixedUsageSource = usageSources.length > 1;
	if (mixedUsageSource) {
		warnings.push(
			`samples mix ${usageSources.join(" and ")} token figures. Estimated figures are character counts, not provider reports, so no delta is reported between them.`,
		);
	}

	const refused = comparableTasks.length === 0 || mixedUsageSource;
	if (comparableTasks.length === 0) {
		warnings.push(
			"no task was comparable across every configuration, so no delta is reported. Absolute totals below are still facts.",
		);
	}

	const summaries: ConfigSummary[] = configIds.map((configId) => {
		// Absolute totals cover every task the configuration ran, including the
		// ones left out of the delta. Dropping them would understate the cost.
		const own = [...(byConfig.get(configId)?.values() ?? [])].flat();
		const aggregateAll = aggregate(own);

		if (configId === baselineId) {
			return { configId, aggregate: aggregateAll, tasks: allTasks.length };
		}
		if (refused) {
			return { configId, aggregate: aggregateAll, tasks: allTasks.length };
		}

		const baselineRuns: RunMetrics[] = [];
		const candidateRuns: RunMetrics[] = [];
		for (const taskId of comparableTasks) {
			baselineRuns.push(...(cellOf(baselineId, taskId) ?? []));
			candidateRuns.push(...(cellOf(configId, taskId) ?? []));
		}
		const baseline = aggregate(baselineRuns);
		const candidate = aggregate(candidateRuns);
		return {
			configId,
			aggregate: candidate,
			delta: subtract(baseline, candidate),
			tasks: comparableTasks.length,
		};
	});

	return {
		baselineId,
		configIds,
		allTasks,
		comparableTasks,
		summaries,
		excluded,
		warnings,
		usageSources,
		mixedUsageSource,
		refused,
	};
}

function signed(value: number, digits = 1): string {
	const rounded = Number(value.toFixed(digits));
	const text = Math.abs(rounded).toFixed(digits);
	return `${rounded > 0 ? "+" : rounded < 0 ? "-" : " "}${text}`;
}

/** Render a report as plain text. Every line here is a fact the caller can check. */
export function renderReport(report: Report): string {
	const lines: string[] = [];

	lines.push(`baseline: ${report.baselineId}`);
	lines.push(`tasks: ${report.comparableTasks.length} comparable of ${report.allTasks.length}`);
	lines.push(`usage figures: ${report.usageSources.join(", ")}`);
	lines.push("");
	lines.push("config                       tasks        in       out    decider     turns      cost   success");
	lines.push("-".repeat(102));

	for (const summary of report.summaries) {
		const { aggregate: a, delta, configId } = summary;
		lines.push(
			[
				configId.padEnd(26),
				`${summary.tasks}/${report.allTasks.length}`.padStart(5),
				a.inputTokens.toFixed(0).padStart(9),
				a.outputTokens.toFixed(0).padStart(9),
				a.deciderTokens.toFixed(0).padStart(10),
				a.turns.toFixed(2).padStart(9),
				a.costUSD.toFixed(4).padStart(9),
				`${(a.successRate * 100).toFixed(0)}%`.padStart(8),
			].join(" "),
		);
		if (delta && summary.tasks === report.comparableTasks.length) {
			lines.push(
				[
					`${"delta vs " + report.baselineId}`.padEnd(26),
					"".padStart(5),
					signed(delta.inputTokens, 0).padStart(9),
					signed(delta.outputTokens, 0).padStart(9),
					signed(delta.deciderTokens, 0).padStart(10),
					signed(delta.turns, 2).padStart(9),
					signed(delta.costUSD, 4).padStart(9),
					`${signed(delta.successRate * 100, 0)}pt`.padStart(8),
				].join(" "),
			);
		}
	}

	if (report.refused) {
		lines.push("");
		lines.push(
			report.mixedUsageSource
				? "NO DELTA REPORTED. The samples mix estimated and reported token figures."
				: "NO DELTA REPORTED. No task was comparable across every configuration.",
		);
	}

	if (report.warnings.length > 0) {
		lines.push("");
		lines.push("warnings");
		for (const warning of report.warnings) {
			lines.push(`  - ${warning}`);
		}
	}

	return `${lines.join("\n")}\n`;
}
