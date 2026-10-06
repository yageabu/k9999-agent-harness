import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * The name as a block logo, one entry per launch command.
 *
 * Rendered with figlet's `ANSI Shadow` font, the one the OpenCode-style banner
 * uses, rather than drawn by hand. The rows carry no trailing whitespace, so
 * the version can be placed after the last row without measuring each one.
 *
 * A command with no entry here falls back to the one-line name, which is also
 * what happens when a terminal is too narrow or too short for the block.
 */
const LOGOS: Readonly<Record<string, readonly string[]>> = {
	k9999: [
		"██╗  ██╗ █████╗  █████╗  █████╗  █████╗",
		"██║ ██╔╝██╔══██╗██╔══██╗██╔══██╗██╔══██╗",
		"█████╔╝ ╚██████║╚██████║╚██████║╚██████║",
		"██╔═██╗  ╚═══██║ ╚═══██║ ╚═══██║ ╚═══██║",
		"██║  ██╗ █████╔╝ █████╔╝ █████╔╝ █████╔╝",
		"╚═╝  ╚═╝ ╚════╝  ╚════╝  ╚════╝  ╚════╝",
	],
	kula: [
		"██╗  ██╗██╗   ██╗██╗      █████╗",
		"██║ ██╔╝██║   ██║██║     ██╔══██╗",
		"█████╔╝ ██║   ██║██║     ███████║",
		"██╔═██╗ ██║   ██║██║     ██╔══██║",
		"██║  ██╗╚██████╔╝███████╗██║  ██║",
		"╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝",
	],
};

export function logoLines(appName: string): readonly string[] | undefined {
	return LOGOS[appName];
}

/** The widest row, which is what a terminal has to have room for. */
export function logoWidth(lines: readonly string[]): number {
	return Math.max(0, ...lines.map((line) => visibleWidth(line)));
}
