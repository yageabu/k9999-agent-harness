import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { shortenHome, type Styler } from "../render/format.ts";
import { EXIT_COMMANDS, KEYS } from "./keys.ts";
import { logoLines, logoWidth } from "./logo.ts";

export interface ToolFact {
	readonly name: string;
	readonly description: string;
}

export interface SkillFact {
	readonly name: string;
	readonly description: string;
}

/**
 * What the startup block reports about the session.
 *
 * This is not a `RenderItem`. Nothing that happened produced it, and the
 * vocabulary exists to keep presentation out of the agent's description of
 * what happened.
 */
export interface StartupFacts {
	readonly appName: string;
	readonly version: string;
	readonly profileId: string;
	readonly profileName: string;
	readonly profileDir: string;
	readonly model: string;
	readonly thinking: string;
	readonly tools: readonly ToolFact[];
	readonly skills: readonly SkillFact[];
	readonly home?: string;
}

function hint(style: Styler, key: string, description: string): string {
	return `${style("dim")(key)} ${description}`;
}

/** Columns the logo block occupies beyond its own art: one of inset, three before the version. */
const LOGO_INSET = 1;
const LOGO_GUTTER = 3;

/** `k9999 v0.5.0`, with the version carrying less weight than the name. */
export function logoLine(facts: StartupFacts, style: Styler): string {
	return `${style("bold", "yellow")(facts.appName)}${style("dim")(` v${facts.version}`)}`;
}

/**
 * The name as a block of art, or the one-line name when a block is not wanted.
 *
 * The version rides the last row, where the glyphs have already left empty
 * cells beside them.
 */
function logoBlock(facts: StartupFacts, style: Styler, logo: readonly string[]): string[] {
	const painted = logo.map((line) => style("bold", "yellow")(line));
	const last = painted[painted.length - 1] ?? "";
	return [
		...painted.slice(0, -1),
		`${last}${" ".repeat(LOGO_GUTTER)}${style("dim")(`v${facts.version}`)}`,
	];
}

/** The one line shown before the help is asked for. */
export function compactHints(style: Styler): string {
	return [
		hint(style, KEYS.interrupt, "interrupt"),
		hint(style, `${KEYS.clear}/${KEYS.exit}`, "clear/exit"),
		hint(style, EXIT_COMMANDS[0], "quit"),
		hint(style, KEYS.expand, "more"),
	].join(style("dim")(" · "));
}

/** Every key the TUI answers to, and nothing it does not. */
export function expandedHints(style: Styler): string[] {
	return [
		hint(style, KEYS.interrupt, "to interrupt the turn"),
		hint(style, KEYS.clear, "to clear the prompt, twice to exit"),
		hint(style, KEYS.exit, "to exit when the prompt is empty"),
		hint(style, EXIT_COMMANDS.join(", "), "to leave"),
		hint(style, "enter", "to submit, ctrl+j for a new line"),
		hint(style, KEYS.expand, "to collapse this help"),
	];
}

export function pressLine(style: Styler): string {
	return style("dim")(`Press ${KEYS.expand} to show full startup help and loaded resources.`);
}

/** What the agent is for, in one sentence that is true of every profile. */
export function onboardingLine(appName: string, style: Styler): string {
	return style("dim")(`Ask ${appName} about this directory. Its profile sets what it may read and change.`);
}

/**
 * The loaded resources, as Pi shows them: a bracketed heading with the names
 * collapsed onto one line, or one entry per line when the help is expanded.
 *
 * An empty section is dropped rather than printed empty, because a heading
 * with nothing under it reads as a resource that failed to load.
 */
export function resourceSections(facts: StartupFacts, style: Styler, expanded: boolean): string[] {
	const compact = (names: readonly string[]): string[] => (names.length === 0 ? [] : [`  ${names.join(", ")}`]);

	const sections: [string, string[]][] = [
		[
			"Profile",
			expanded
				? [`  ${facts.profileName} (${facts.profileId})`, `  model ${facts.model} · thinking ${facts.thinking}`, `  ${shortenHome(facts.profileDir, facts.home)}`]
				: [`  ${facts.profileId} · ${facts.profileName}`],
		],
		[
			"Tools",
			expanded
				? facts.tools.map((tool) => `  ${tool.name}  ${tool.description}`)
				: compact(facts.tools.map((tool) => tool.name)),
		],
		[
			"Skills",
			expanded
				? facts.skills.map((skill) => `  ${skill.name}  ${skill.description}`)
				: compact(facts.skills.map((skill) => skill.name)),
		],
	];

	const lines: string[] = [];
	for (const [name, body] of sections) {
		if (body.length === 0) {
			continue;
		}
		lines.push(style("bold")(`[${name}]`));
		for (const line of body) {
			lines.push(style("dim")(line));
		}
		lines.push("");
	}
	return lines;
}

/** The startup block as plain lines, already cut to the terminal. */
export function startupLines(
	facts: StartupFacts,
	style: Styler,
	width: number,
	expanded: boolean,
	logo?: readonly string[],
): string[] {
	const header: string[] = logo === undefined ? [logoLine(facts, style)] : logoBlock(facts, style, logo);
	if (expanded) {
		header.push(...expandedHints(style));
	} else {
		header.push(compactHints(style), pressLine(style));
	}
	header.push("", onboardingLine(facts.appName, style), "");

	// The logo block is inset by one column and the resource sections are not,
	// which is the shape Pi uses. A blank line stays blank rather than becoming a
	// single trailing space.
	const lines = [
		...header.map((line) => (line === "" ? "" : ` ${line}`)),
		...resourceSections(facts, style, expanded),
	];
	return lines.map((line) => truncateToWidth(line, width, "…"));
}

export interface StartupHeaderOptions {
	readonly expanded?: boolean;
	/**
	 * Lines the transcript may use.
	 *
	 * The block is five rows taller than the one-line name. When those rows would
	 * push the top of the block out of the transcript, the block is not worth
	 * having.
	 */
	readonly budget?: () => number;
}

/**
 * The block at the top of the transcript.
 *
 * It is a transcript entry rather than a fixed panel, so it scrolls away. Six
 * rows of logo that never leave cost six rows of a terminal forever.
 *
 * `ctrl+o` toggles between the short hint line and the full list, and between
 * the collapsed and expanded resource sections, which is one decision rather
 * than two: someone who wants the keys wants to know what loaded.
 */
export class StartupHeader implements Component {
	private readonly facts: StartupFacts;
	private readonly style: Styler;
	private readonly budget: (() => number) | undefined;
	private expanded: boolean;

	constructor(facts: StartupFacts, style: Styler, options: StartupHeaderOptions = {}) {
		this.facts = facts;
		this.style = style;
		this.expanded = options.expanded ?? false;
		this.budget = options.budget;
	}

	toggle(): boolean {
		this.expanded = !this.expanded;
		return this.expanded;
	}

	get isExpanded(): boolean {
		return this.expanded;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const usable = Math.max(1, width);
		return startupLines(this.facts, this.style, usable, this.expanded, this.logoFor(usable));
	}

	/**
	 * The block, when the terminal has room for it.
	 *
	 * Two ways it does not. The art wraps on a narrow terminal, and it is five
	 * rows taller than the one-line name, so on a short one it would push its own
	 * top rows out of the transcript. Both fall back to the one-line name rather
	 * than to a broken logo.
	 */
	private logoFor(width: number): readonly string[] | undefined {
		const block = logoLines(this.facts.appName);
		if (block === undefined) {
			return undefined;
		}
		const version = `v${this.facts.version}`;
		if (width < logoWidth(block) + LOGO_INSET + LOGO_GUTTER + version.length) {
			return undefined;
		}
		const budget = this.budget?.();
		if (budget === undefined) {
			return block;
		}
		const tall = startupLines(this.facts, this.style, width, this.expanded, block).length;
		return tall <= budget ? block : undefined;
	}
}
