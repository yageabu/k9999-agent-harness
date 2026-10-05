import type { FileChange } from "@k9999/core";
import { compactNumber, createStyler, formatCost, formatDuration, shorten, type Styler } from "./format.ts";
import type { RunState } from "./vocabulary.ts";

/** Longest diff line before it is clipped. Terminals wrap; a gutter plus wrap reads badly. */
const MAX_DIFF_LINE = 200;

/**
 * How a surface renders a line.
 *
 * The text sink and the TUI must produce the same transcript, so the lines are
 * built here and both consume them. Two renderings of the same event would
 * drift, and the drift would show up as a diff that looks right in one surface
 * and wrong in the other.
 */
export interface LineStyle {
	readonly style: Styler;
	/** Used to shorten paths for display. Tools report absolute paths. */
	readonly cwd: string | undefined;
	readonly maxDiffLines: number | undefined;
}

export function lineStyle(styler: Styler, cwd?: string, maxDiffLines?: number): LineStyle {
	return { style: styler, cwd, maxDiffLines };
}

export { createStyler };

function clip(text: string): string {
	return text.length > MAX_DIFF_LINE ? `${text.slice(0, MAX_DIFF_LINE - 1)}…` : text;
}

/**
 * A unified-diff-shaped block for one replacement.
 *
 * An edit is an exact string replacement, so both sides are already known and
 * nothing is computed. The budget is shared between the two sides rather than
 * given to each, so a lopsided change cannot print twice the intended lines.
 */
export function diffLines(change: FileChange, style: LineStyle): string[] {
	const { style: s, cwd } = style;
	const dim = s("dim");
	const red = s("red");
	const green = s("green");

	const budget = Math.max(2, style.maxDiffLines ?? 24);
	const keepRemoved = Math.min(change.removed.length, Math.ceil(budget / 2));
	const keepAdded = Math.min(change.added.length, budget - keepRemoved);

	const lines = [`${dim("  │")} ${dim(`${shorten(change.path, cwd)}:${change.line}`)}`];
	for (const line of change.removed.slice(0, keepRemoved)) {
		lines.push(`${dim("  │")} ${red(`- ${clip(line)}`)}`);
	}
	for (const line of change.added.slice(0, keepAdded)) {
		lines.push(`${dim("  │")} ${green(`+ ${clip(line)}`)}`);
	}

	const hidden = change.removed.length - keepRemoved + (change.added.length - keepAdded);
	if (hidden > 0) {
		lines.push(`${dim(`  │ … ${hidden} more line(s)`)}`);
	}
	return lines;
}

export function toolCallLines(name: string, summary: string, style: LineStyle): string[] {
	const { style: s } = style;
	return [`${s("cyan")("→")} ${s("bold")(name)}${summary === "" ? "" : `  ${summary}`}`];
}

export function toolResultLines(
	ok: boolean,
	summary: string,
	change: FileChange | undefined,
	style: LineStyle,
): string[] {
	const { style: s } = style;
	const mark = ok ? s("green")("✓") : s("red")("✗");
	const lines = [`  ${mark} ${summary}`];
	if (change) {
		lines.push(...diffLines(change, style));
	}
	return lines;
}

/** The per-turn cost line. The "measures first" claim appearing in the interface. */
export function turnLine(state: RunState, style: LineStyle): string {
	const parts = [
		`turn ${state.turns}`,
		`${compactNumber(state.inputTokens)} in`,
		`${compactNumber(state.outputTokens)} out`,
	];
	if (state.toolCalls > 0) {
		parts.push(`${state.toolCalls} tool${state.toolCalls === 1 ? "" : "s"}`);
	}
	if (state.costUSD > 0) {
		parts.push(formatCost(state.costUSD));
	}
	return style.style("dim")(`  · ${parts.join(" · ")}`);
}

export function errorLines(message: string, style: LineStyle): string[] {
	return [`${style.style("red")("error")} ${message}`];
}

export function summaryLine(state: RunState, style: LineStyle, now = Date.now()): string {
	const parts = [
		`${state.turns} turn${state.turns === 1 ? "" : "s"}`,
		`${state.toolCalls} tool call${state.toolCalls === 1 ? "" : "s"}`,
		`${compactNumber(state.inputTokens)} in / ${compactNumber(state.outputTokens)} out`,
	];
	if (state.costUSD > 0) {
		parts.push(formatCost(state.costUSD));
	}
	parts.push(formatDuration(now - state.startedAt));
	return style.style("dim")(`  ${parts.join(" · ")}`);
}
