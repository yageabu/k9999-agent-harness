import { Key, matchesKey } from "@earendil-works/pi-tui";

/**
 * The keys the TUI answers to, in one place.
 *
 * The startup help prints these constants rather than writing `ctrl+o` by
 * hand. A hint that names a key is a claim about behavior, so the claim and
 * the handler read the same value and cannot drift apart.
 */
export const KEYS = {
	/** Show the full startup help and the expanded resource sections. */
	expand: Key.ctrl("o"),
	/** Stop the turn that is running. */
	interrupt: Key.escape,
	/** Clear the prompt, and exit when pressed twice in a row. */
	clear: Key.ctrl("c"),
	/** Exit, when the prompt is empty. */
	exit: Key.ctrl("d"),
} as const;

/**
 * The words that leave, typed into the prompt.
 *
 * A command is not a key, and it is checked where a key cannot be: on submit.
 * The help names the first of these and the app accepts all of them, so the
 * two lists stay in one place.
 */
export const EXIT_COMMANDS = ["/exit", "/quit"] as const;

export function isExitCommand(text: string): boolean {
	return EXIT_COMMANDS.some((command) => command === text);
}

export function isExpand(data: string): boolean {
	return matchesKey(data, KEYS.expand);
}

export function isInterrupt(data: string): boolean {
	return matchesKey(data, KEYS.interrupt);
}

export function isClear(data: string): boolean {
	return matchesKey(data, KEYS.clear);
}

export function isExit(data: string): boolean {
	return matchesKey(data, KEYS.exit);
}
