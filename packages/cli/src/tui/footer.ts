import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { compactNumber, formatCost, shortenHome, type Styler } from "../render/format.ts";
import type { RunState } from "../render/vocabulary.ts";

/**
 * Context as `91.3%/1.0M`: what is left of the window, then the window.
 *
 * The window keeps one decimal where a token count would drop it. `1.0M` is a
 * specification, and the figure beside it is a measurement.
 */
export function contextLabel(state: RunState): string {
	if (state.contextWindow <= 0) {
		return "—";
	}
	const window =
		state.contextWindow >= 1_000_000
			? `${(state.contextWindow / 1_000_000).toFixed(1)}M`
			: `${Math.round(state.contextWindow / 1000)}k`;
	return `${contextPercent(state).toFixed(1)}%/${window}`;
}

/** How much of the window is left, for colouring the label. Negative values read as zero. */
export function contextPercent(state: RunState): number {
	if (state.contextWindow <= 0) {
		return 0;
	}
	const remaining = Math.max(0, state.contextWindow - state.contextTokens);
	return (remaining / state.contextWindow) * 100;
}

/**
 * Cache reads as a share of the prompt.
 *
 * `inputTokens` already counts cache reads and writes, so this is the share of
 * everything the provider was sent that it served from cache. Only meaningful
 * for providers that report cache reads at all. When they do not, the figure is
 * absent rather than zero, because zero would read as "no cache hits" when it
 * means "not reported".
 */
export function cacheLabel(state: RunState): string | undefined {
	if (state.cacheRead === 0 || state.inputTokens === 0) {
		return undefined;
	}
	return `c ${((state.cacheRead / state.inputTokens) * 100).toFixed(1)}%`;
}

export interface FooterOptions {
	readonly state: RunState;
	readonly style: Styler;
	/**
	 * The branch, read at render time rather than captured once.
	 *
	 * A session that creates a branch should say so, and reading `.git/HEAD` is
	 * cheap enough to do on each draw.
	 */
	readonly branch?: () => string | undefined;
	readonly home?: string;
}

/**
 * The two lines under the editor: where the session is, and what it has spent.
 *
 * It replaces the three-line status header that used to sit above the
 * transcript. Pi keeps the model and the totals at the bottom, where the eye
 * already is when the prompt is, and the transcript gets the rows back.
 */
export class Footer implements Component {
	private state: RunState;
	private readonly style: Styler;
	private readonly branch: (() => string | undefined) | undefined;
	private readonly home: string | undefined;

	constructor(options: FooterOptions) {
		this.state = options.state;
		this.style = options.style;
		this.branch = options.branch;
		this.home = options.home;
	}

	setState(state: RunState): void {
		this.state = state;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const usable = Math.max(1, width);
		return [this.locationLine(usable), this.statsLine(usable)];
	}

	/** `~/code/project (main)`, with the branch dropped when there is not one. */
	private locationLine(width: number): string {
		const s = this.style;
		const folder = shortenHome(this.state.cwd, this.home);
		const branch = this.branch?.();
		const place = branch === undefined || branch === "" ? folder : `${folder} (${branch})`;
		return truncateToWidth(s("dim")(place), width, s("dim")("…"));
	}

	private statsLine(width: number): string {
		const s = this.style;
		const state = this.state;
		const dim = s("dim");

		const percent = contextPercent(state);
		const context = contextLabel(state);
		// The figure is what is left, so the warning is a small number rather than
		// a large one. Pi reads the complement; the label here does not.
		const contextStyled =
			percent < 10 ? s("red")(context) : percent < 30 ? s("yellow")(context) : dim(context);

		const left: string[] = [
			contextStyled,
			dim(`↑${compactNumber(state.inputTokens)} ↓${compactNumber(state.outputTokens)}`),
		];
		const cache = cacheLabel(state);
		if (cache !== undefined) {
			left.push(dim(cache));
		}
		if (state.reasoningTokens > 0) {
			left.push(dim(`R${compactNumber(state.reasoningTokens)}`));
		}
		if (state.costUSD > 0) {
			left.push(dim(formatCost(state.costUSD)));
		}

		const leftText = left.join(dim("  "));
		const right = dim(`${state.modelName} • ${state.thinking}`);

		const available = width - visibleWidth(right) - 2;
		if (available < 8) {
			return truncateToWidth(leftText, width, s("dim")("…"));
		}
		const trimmed = truncateToWidth(leftText, available, s("dim")("…"));
		return `${trimmed}${" ".repeat(Math.max(2, width - visibleWidth(trimmed) - visibleWidth(right)))}${right}`;
	}
}
