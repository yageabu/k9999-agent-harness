import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { compactNumber, formatCost, type Styler } from "../render/format.ts";
import type { RunState } from "../render/vocabulary.ts";

/** The mark, in the terminal. The square, the K, the rule, the four nines. */
const MARK = ["┌────────┐", "│   K    │", "│  ────  │", "│  9999  │", "└────────┘"];

/** Width of the mark plus the two spaces before the text beside it. */
const MARK_WIDTH = 12;

export interface BannerInput {
	readonly version: string;
	readonly profile: string;
	readonly model: string;
	readonly thinking: string;
	readonly cwd: string;
}

/**
 * The startup banner: the mark beside four facts, then a blank line.
 *
 * It goes into the transcript rather than the header so it scrolls away. A
 * five-line logo that never leaves costs five lines of a terminal forever.
 *
 * The mark is dropped when the text beside it would not fit. That is decided
 * from the actual longest line rather than a threshold, because how much room
 * the text needs depends on the working directory.
 */
export function bannerLines(input: BannerInput, style: Styler, width: number): string[] {
	const text = [
		`${style("bold")("K9999 Agent Harness")}  ${style("dim")(input.version)}`,
		style("dim")(input.profile),
		style("dim")(`${input.model} · ${input.thinking}`),
		style("dim")(input.cwd),
	];

	const widest = Math.max(...text.map((line) => visibleWidth(line)));
	if (width < MARK_WIDTH + widest) {
		return [...text, ""];
	}

	const lines: string[] = [];
	for (let index = 0; index < MARK.length; index += 1) {
		const mark = style("dim")(MARK[index] ?? "");
		const padding = " ".repeat(MARK_WIDTH - visibleWidth(MARK[index] ?? ""));
		lines.push(`${mark}${padding}${text[index] ?? ""}`.trimEnd());
	}
	lines.push("");
	return lines;
}

/**
 * `1834` -> `1.8k`, and a context figure as `91.3%/1.0M`.
 *
 * The window keeps one decimal where a token count would drop it: `1.0M` is a
 * specification, and the figures beside it are measurements.
 */
export function contextLabel(state: RunState): string {
	if (state.contextWindow <= 0) {
		return "—";
	}
	const remaining = Math.max(0, state.contextWindow - state.contextTokens);
	const percent = (remaining / state.contextWindow) * 100;
	const window =
		state.contextWindow >= 1_000_000
			? `${(state.contextWindow / 1_000_000).toFixed(1)}M`
			: `${Math.round(state.contextWindow / 1000)}k`;
	return `${percent.toFixed(1)}%/${window}`;
}

/**
 * Cache reads as a share of the prompt.
 *
 * Only meaningful for providers that report cache reads at all. When they do
 * not, the figure is absent rather than zero, because zero would read as "no
 * cache hits" when it means "not reported".
 */
export function cacheLabel(state: RunState): string | undefined {
	if (state.cacheRead === 0) {
		return undefined;
	}
	const share = (state.cacheRead / state.inputTokens) * 100;
	return `c ${share.toFixed(1)}%`;
}

/**
 * The status: model, then a rule, then one line of live facts.
 *
 * Two lines and a rule rather than one long line, because the facts do not fit
 * one line at eighty columns and a status that wraps is a status nobody reads.
 */
export class StatusHeader implements Component {
	private state: RunState;
	private readonly style: Styler;

	constructor(state: RunState, style: Styler) {
		this.state = state;
		this.style = style;
	}

	setState(state: RunState): void {
		this.state = state;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const s = this.style;
		const state = this.state;
		const provider = state.provider.charAt(0).toUpperCase() + state.provider.slice(1);
		const folder = state.cwd.split("/").filter((part) => part !== "").pop() ?? "/";

		const parts = [folder, contextLabel(state), `↑${compactNumber(state.inputTokens)} ↓${compactNumber(state.outputTokens)}`];
		const cache = cacheLabel(state);
		if (cache !== undefined) {
			parts.push(cache);
		}
		if (state.reasoningTokens > 0) {
			parts.push(`R${compactNumber(state.reasoningTokens)}`);
		}
		if (state.costUSD > 0) {
			parts.push(formatCost(state.costUSD));
		}

		const lines = [
			` ${s("bold")(state.modelName)}  ${s("dim")(provider)}  ${s("dim")(state.thinking)}`,
			s("dim")("─".repeat(Math.max(1, width))),
			` ${s("dim")(parts.join(" | "))}`,
		];
		return lines.map((line) => (visibleWidth(line) > width ? line.slice(0, width) : line));
	}
}
