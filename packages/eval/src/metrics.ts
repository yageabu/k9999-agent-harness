import type { Usage } from "@earendil-works/pi-ai";

/**
 * Everything a run reports.
 *
 * All of it is recorded, every time. A report that shows one metric is not a
 * report, because every optimisation worth making trades one metric for another.
 */
export interface RunMetrics {
	/** Prompt tokens summed over every model call in the run. */
	inputTokens: number;
	/** Completion tokens summed over every model call. */
	outputTokens: number;
	/**
	 * Tokens spent outside the main model, such as a decision layer.
	 *
	 * Recorded separately and never folded into `inputTokens`. Leaving it out is
	 * how a saving becomes unfalsifiable: the cost moves out of the number being
	 * reported rather than disappearing.
	 */
	deciderTokens: number;
	/** Model calls that produced an assistant message. */
	turns: number;
	toolCalls: number;
	/** Wall time for the turn loop. Excluded from determinism comparisons. */
	wallMs: number;
	costUSD: number;
	/** The task's own predicate, evaluated after the run. */
	success: boolean;
	/**
	 * True when the run was stopped by a ceiling.
	 *
	 * A breached run is never a success, even when the predicate happens to pass.
	 * A run cut short after its side effects landed can leave the fixture in a
	 * passing state while the work that would have followed never happened, and
	 * reporting that as a cheap win is the most flattering possible lie.
	 */
	breached: boolean;
	/** True when any component reported that it was not operating normally. */
	degraded: boolean;
	/** Why. Non-empty whenever `degraded` is true. */
	degradeReasons: readonly string[];
}

/** A ceiling on a run. On breach the run stops and states the reason. */
export interface Budget {
	readonly maxCostUSD?: number;
	readonly maxWallMs?: number;
	readonly maxTurns?: number;
}

export interface BudgetBreach {
	readonly metric: "costUSD" | "wallMs" | "turns";
	readonly limit: number;
	readonly actual: number;
}

export function emptyMetrics(): RunMetrics {
	return {
		inputTokens: 0,
		outputTokens: 0,
		deciderTokens: 0,
		turns: 0,
		toolCalls: 0,
		wallMs: 0,
		costUSD: 0,
		success: false,
		breached: false,
		degraded: false,
		degradeReasons: [],
	};
}

/** Fold one model call's usage into the running totals. */
export function addUsage(metrics: RunMetrics, usage: Usage | undefined): RunMetrics {
	if (!usage) {
		return metrics;
	}
	return {
		...metrics,
		inputTokens: metrics.inputTokens + usage.input + usage.cacheRead + usage.cacheWrite,
		outputTokens: metrics.outputTokens + usage.output,
		costUSD: metrics.costUSD + usage.cost.total,
	};
}

/**
 * The first breach, if any.
 *
 * Pure, so the rule is testable without a clock or a provider. Checked in a
 * fixed order because a run that breaks two ceilings at once should report the
 * same one every time.
 */
export function checkBudget(metrics: RunMetrics, budget: Budget): BudgetBreach | undefined {
	const { maxTurns, maxCostUSD, maxWallMs } = budget;

	if (maxTurns !== undefined && metrics.turns > maxTurns) {
		return { metric: "turns", limit: maxTurns, actual: metrics.turns };
	}
	if (maxCostUSD !== undefined && metrics.costUSD > maxCostUSD) {
		return { metric: "costUSD", limit: maxCostUSD, actual: metrics.costUSD };
	}
	if (maxWallMs !== undefined && metrics.wallMs > maxWallMs) {
		return { metric: "wallMs", limit: maxWallMs, actual: metrics.wallMs };
	}
	return undefined;
}

/**
 * Metric keys that must reproduce exactly on replay.
 *
 * `wallMs` is absent because it cannot: it measures the machine, not the
 * harness. Every other key derives from the transcript and the fixture, so a
 * difference in any of them means the harness is not deterministic and replay
 * is not a valid regression check.
 */
export const DETERMINISTIC_METRIC_KEYS = [
	"inputTokens",
	"outputTokens",
	"deciderTokens",
	"turns",
	"toolCalls",
	"costUSD",
	"success",
	"breached",
	"degraded",
] as const satisfies readonly (keyof RunMetrics)[];

export interface MetricDifference {
	readonly key: keyof RunMetrics;
	readonly left: unknown;
	readonly right: unknown;
}

/** Field-by-field comparison over the deterministic keys only. */
export function compareDeterministic(left: RunMetrics, right: RunMetrics): MetricDifference[] {
	const differences: MetricDifference[] = [];
	for (const key of DETERMINISTIC_METRIC_KEYS) {
		const a = left[key];
		const b = right[key];
		if (Array.isArray(a) && Array.isArray(b)) {
			if (a.length !== b.length || a.some((value, index) => value !== b[index])) {
				differences.push({ key, left: a, right: b });
			}
			continue;
		}
		if (a !== b) {
			differences.push({ key, left: a, right: b });
		}
	}
	return differences;
}
