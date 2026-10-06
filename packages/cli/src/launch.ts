import path from "node:path";

/**
 * A launch name is a command that selects a profile by default.
 *
 * One implementation, two names. A name carries no behavior of its own: it
 * supplies a default profile and nothing else, which a test asserts by running
 * `kula --profile code` and `k9999 --profile code` to the same result.
 */
export interface LaunchName {
	/** The command, as typed. */
	readonly command: string;
	/** The profile it selects when `--profile` is absent. */
	readonly profileId: string;
}

export const LAUNCH_NAMES: readonly LaunchName[] = [
	{ command: "k9999", profileId: "code" },
	{ command: "kula", profileId: "data" },
];

/** Used when neither `--profile` nor a recognized launch name is present. */
export const DEFAULT_PROFILE = "code";

/**
 * The profile a launch name selects.
 *
 * The name comes from the basename of `argv[1]`. An unrecognized basename —
 * running the entry by path, as the test suite and `npm run` do — leaves the
 * default alone instead of failing, because failing there would break the suite
 * for a cosmetic reason.
 */
export function profileForLaunchName(argv1: string | undefined): string {
	const command = typedCommand(argv1);
	return LAUNCH_NAMES.find((entry) => entry.command === command)?.profileId ?? DEFAULT_PROFILE;
}

/** The launch name that defaults to a profile, when one exists. */
export function launchNameFor(profileId: string): string | undefined {
	return LAUNCH_NAMES.find((entry) => entry.profileId === profileId)?.command;
}

/**
 * The name a session introduces itself with.
 *
 * Three answers, in order. The command that was typed, when it is one of the
 * launch names. The command that would have selected this profile, when the
 * entry was run by path, which is how `npm run` and the test suite do it. The
 * product name last, so a surface never prints `index.ts` as the program's
 * name.
 *
 * The middle answer is what makes `npm run kula` show KULA. Without it the dev
 * script would run the entry by path and introduce the data profile as k9999.
 */
export function sessionName(argv1: string | undefined, profileId: string): string {
	return typedCommand(argv1) ?? launchNameFor(profileId) ?? "k9999";
}

/** The recognized launch name in `argv[1]`, if there is one. */
function typedCommand(argv1: string | undefined): string | undefined {
	if (argv1 === undefined) {
		return undefined;
	}
	const command = path.basename(argv1).replace(/\.(?:js|mjs|cjs|ts)$/, "");
	return LAUNCH_NAMES.some((entry) => entry.command === command) ? command : undefined;
}

/** The launch names, for help text and `--list`. */
export function launchSummary(): string {
	return LAUNCH_NAMES.map((entry) => `${entry.command} → ${entry.profileId}`).join(", ");
}
