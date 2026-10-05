import { styleText } from "node:util";

/**
 * Style helpers over `node:util`'s `styleText`.
 *
 * `styleText` already suppresses escape sequences when the stream is not a TTY,
 * so colour costs no dependency. An explicit mode is still threaded through
 * because a test needs a deterministic answer, and because "always" is useful
 * when piping into a pager that renders colour.
 */
export type ColorMode = "auto" | "always" | "never";

export function resolveColor(mode: ColorMode, stream: { isTTY?: boolean }): boolean {
	if (mode === "always") {
		return true;
	}
	if (mode === "never") {
		return false;
	}
	if (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "") {
		return false;
	}
	return stream.isTTY === true;
}

/**
 * The style names this file uses.
 *
 * Listed explicitly rather than taken from `node:util`'s internal union so a
 * typo is a compile error at the call site. The cast in `createStyler` is the
 * only place the two meet.
 */
export type StyleName = "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "gray" | "dim" | "bold" | "underline";

export interface Styler {
	(...styles: StyleName[]): (text: string) => string;
	readonly enabled: boolean;
}

/**
 * Build a styler that returns its input unchanged when colour is off.
 *
 * Returning the input unchanged rather than calling `styleText` and relying on
 * its own TTY check keeps the disabled path free of escape-sequence handling
 * entirely, which a test can assert byte for byte.
 */
export function createStyler(enabled: boolean): Styler {
	const styler = (...styles: StyleName[]): ((text: string) => string) => {
		if (!enabled || styles.length === 0) {
			return (text: string) => text;
		}
		const format = styles.length === 1 ? styles[0] : styles;
		// `validateStream` defaults to true, which makes `styleText` suppress colour
		// on its own when the stream is not a TTY. That check has already been made
		// here, and leaving it on would silently disable the explicit "always" mode.
		return (text: string) =>
			styleText(format as Parameters<typeof styleText>[0], text, { validateStream: false });
	};
	return Object.assign(styler, { enabled });
}

/** `1834` -> `1.8k`. Token counts are read at a glance, not audited. */
export function compactNumber(value: number): string {
	if (value < 1000) {
		return String(Math.round(value));
	}
	if (value < 1_000_000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Sub-cent costs are the normal case, so three significant digits, not two decimals. */
export function formatCost(value: number): string {
	if (value === 0) {
		return "$0";
	}
	if (value < 0.01) {
		return `$${value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
	}
	return `$${value.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${Math.round(ms)}ms`;
	}
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${Math.round(seconds - minutes * 60)}s`;
}

/**
 * `cwd`-relative when the path is inside it, absolute otherwise.
 *
 * Tools report absolute paths because that is the fact. A terminal wants the
 * short form. Shortening happens on the way to a reader and never rewrites
 * what a tool reported.
 */
export function shorten(filePath: string, cwd: string | undefined): string {
	if (cwd === undefined || cwd === "") {
		return filePath;
	}
	const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
	return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}
